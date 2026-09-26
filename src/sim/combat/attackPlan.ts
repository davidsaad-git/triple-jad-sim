/**
 * Player attack profiles, plans, rolls and projections (scim:
 * profile selection `yq`/`_K`, slayer-helm/inquisitor stages
 * /`wq`/`xq`, plan building `JG`/`CG`/`TG`, rolling,
 * projection `JW`/`XW`).
 *
 * Supported profile kinds: singleHit, independentMultiHit (scythe, dragon
 * dagger), secondHitIfFirstAccurate (keris). scim's accuracyBranchedSplit
 * (dragon/burning claws specials) and priorDamageHits are reported as
 * unsupported (no Zuk preset uses them).
 */
import type { EquipmentStats } from '../api'
import type { RandomFn } from '../core/rng'
import type { NpcActor, PlayerActor } from '../core/types'
import { prayerMultipliers } from '../data/prayers'
import { addItemStats, SEEKING_ARROWS } from '../items/itemStats'
import { canonicalItemId, catalogBaseId } from '../items/variants'
import {
  doubleRollHitChance,
  hitChance,
  playerMaxHit,
  playerVsNpcRolls,
  steadyStateHitChance,
  type NpcFormulaView,
  type PlayerFormulaView,
  type VoidSet,
} from './formulas'
import { ammoFitsWeapon, isStandardAmmo, type AttackResources } from './resources'
import { specialAttackOf, hasSpecialAttack } from './specials'
import { SPELLS } from './spells'
import type { DamageStyle, FormulaStyle, Fraction } from './types'
import { stanceOf } from './weaponCategories'

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

interface Bound {
  ratio: Fraction
  rounding: 'floor' | 'ceiling'
  offset?: number
}

type MaxHitSpec = { kind: 'base' } | { kind: 'staged'; stages: Fraction[] }
type AccuracySpec = { kind: 'standard'; attackRollStages?: Fraction[] } | { kind: 'doubleRoll'; attackRollStages?: Fraction[] } | { kind: 'guaranteed' }
type DamageProfileSpec = { kind: 'uniformToMaxHit' } | { kind: 'uniformMaxHitFractionBounds'; minimum: Bound; maximum: Bound }
type ProcSpec = { kind: 'rubyBolt'; chancePercent: number; targetCurrentHp: number } | { kind: 'diamondBolt'; chancePercent: number }

interface ProfileHit {
  accuracy: AccuracySpec
  damage: DamageProfileSpec
  proc?: ProcSpec
  impactDelayOffsetTicks?: number
}

export type AttackProfile =
  | { kind: 'unsupported'; gaps: string[] }
  | { kind: 'singleHit'; maxHit: MaxHitSpec; hit: ProfileHit }
  | { kind: 'independentMultiHit'; maxHit: MaxHitSpec; accuracy: AccuracySpec; maximumFractions: Fraction[] }
  | { kind: 'secondHitIfFirstAccurate'; maxHit: MaxHitSpec; first: ProfileHit; second: ProfileHit }

const F = (numerator: number, denominator: number): Fraction => ({ numerator, denominator })
const ONE = F(1, 1)
const HALF = F(1, 2)
const QUARTER = F(1, 4)
const SLAYER_MELEE = F(7, 6)
const SLAYER_IMBUED = F(23, 20)


const BASIC_SINGLE_HIT: AttackProfile = { kind: 'singleHit', maxHit: { kind: 'base' }, hit: { accuracy: { kind: 'standard' }, damage: { kind: 'uniformToMaxHit' } } }

/** scim (keris partisan / dual macuahuitl). */
const KERIS_LIKE: AttackProfile = {
  kind: 'secondHitIfFirstAccurate',
  maxHit: { kind: 'base' },
  first: {
    accuracy: { kind: 'standard' },
    damage: { kind: 'uniformMaxHitFractionBounds', minimum: { ratio: F(0, 1), rounding: 'floor' }, maximum: { ratio: HALF, rounding: 'floor' } },
  },
  second: {
    impactDelayOffsetTicks: 1,
    accuracy: { kind: 'standard' },
    damage: { kind: 'uniformMaxHitFractionBounds', minimum: { ratio: F(0, 1), rounding: 'ceiling' }, maximum: { ratio: HALF, rounding: 'ceiling' } },
  },
}


function independentPair(attack: Fraction, max: Fraction): AttackProfile {
  return { kind: 'independentMultiHit', maxHit: { kind: 'staged', stages: [max] }, accuracy: { kind: 'standard', attackRollStages: [attack] }, maximumFractions: [ONE, ONE] }
}


function stagedSingle(attack: Fraction, max?: Fraction): AttackProfile {
  return {
    kind: 'singleHit',
    maxHit: max === undefined ? { kind: 'base' } : { kind: 'staged', stages: [max] },
    hit: { accuracy: { kind: 'standard', attackRollStages: [attack] }, damage: { kind: 'uniformToMaxHit' } },
  }
}

/** scim (Voidwaker-style guaranteed hit, 50%-150%). */
const GUARANTEED_HALF_TO_ONE_AND_HALF: AttackProfile = {
  kind: 'singleHit',
  maxHit: { kind: 'base' },
  hit: {
    accuracy: { kind: 'guaranteed' },
    damage: { kind: 'uniformMaxHitFractionBounds', minimum: { ratio: HALF, rounding: 'floor' }, maximum: { ratio: F(3, 2), rounding: 'floor' } },
  },
}

/** scim: special-attack profiles by weapon. */
const SPECIAL_PROFILES: ReadonlyMap<number, AttackProfile> = (() => {
  const dq = stagedSingle(F(3, 2), F(3, 2))
  const uq = stagedSingle(F(2, 1), F(11, 10))
  const fq = stagedSingle(F(5, 4))
  const nq = independentPair(F(23, 20), F(23, 20))
  const rq = independentPair(F(5, 4), F(17, 20))
  const iq = stagedSingle(F(3, 2), F(3, 2))
  const aq = stagedSingle(F(2, 1), F(121, 100))
  const oq = stagedSingle(F(5, 4), F(11, 8))
  const sq = stagedSingle(F(2, 1), F(3, 2))
  const cq = stagedSingle(F(5, 4))
  const lq = stagedSingle(F(2, 1), F(13, 10))
  return new Map<number, AttackProfile>([
    [27665, dq], [27679, dq], [27676, dq], [27690, GUARANTEED_HALF_TO_ONE_AND_HALF], [11808, uq], [20374, uq],
    [4151, fq], [12773, fq], [12774, fq], [26482, fq], [4587, fq], [12006, BASIC_SINGLE_HIT], [26484, BASIC_SINGLE_HIT],
    [1215, nq], [1231, nq], [5680, nq], [5698, nq], [13265, rq], [13267, rq], [13269, rq], [13271, rq],
    [13576, iq], [11804, aq], [20370, aq], [11802, oq], [20368, oq], [11806, uq], [20372, uq], [12926, sq],
    [21003, cq], [27100, cq], [31113, lq],
  ])
})()

const SCYTHES = new Set([22325, 22486, 25736, 25738, 25739, 25741, 28543, 28545])
const BOWFA_LIKE = new Set([25865, 25867, 27187])
const KERIS = new Set([28997, 29850])
const CLAWS = new Set([13652, 20784])
const PURGING_STAFF = new Set([29594])
const SCORCHING_BOW = new Set([29591])
const BURNING_CLAWS = new Set([29577])
const BLUDGEON = new Set([13263])
const DRAGONBANE = new Set([21012, 22978, 25916, 25918, 30070])
const ATLATLS = new Set([29000, 29851])
const RUBY_BOLTS = new Set([9242, 21944])
const DIAMOND_BOLTS = new Set([9243, 21946])
const SLAYER_HELMS = new Set([11864, 19639, 19643, 19647, 21264, 21888, 23073, 24370, 25898, 25904, 25910, 29816, 33066, 33338, 33340])
const IMBUED_SLAYER_HELMS = new Set([11865, 25177, 26674])
const TWISTED_BOWS = new Set([20997, 28540])
const DEMONBANE_SPELLS = new Set(['Inferior Demonbane', 'Superior Demonbane', 'Dark Demonbane'])
const MARK_WEAPONS = new Set([29594, 33184])
const DEMONBANE_WEAPONS = new Map([
  [2402, 60],
  [6745, 60],
  [6746, 60],
  [19675, 70],
  [29577, 5],
  [29589, 70],
  [29591, 30],
])
const INQUISITOR = new Map([
  [24419, 5],
  [24420, 10],
  [24421, 10],
])

interface ProfileArgs {
  weaponId: number | undefined
  headId: number | undefined
  bodyId: number | undefined
  legsId: number | undefined
  formulaStyle: FormulaStyle
  targetSize: number
  isSpecialAttack: boolean
  resources: AttackResources
  targetAttributes: readonly string[]
  targetMagicLevel: number
  targetMagicAttackBonus: number
  targetCurrentHp: number | undefined
  playerCurrentHp: number | undefined
  playerMissingPrayerPoints: number
  markOfDarknessActive: boolean
  demonbaneVulnerability: number
}

interface Stages {
  attackRollStages: Fraction[]
  maxHitStages: Fraction[]
}

const NO_STAGES: Stages = { attackRollStages: [], maxHitStages: [] }

function pct(n: number): Fraction {
  return F(n, 100)
}

/** scim: scale a demonbane percentage by the target's vulnerability. */
function vulnerable(percent: number, vulnerability: number): Fraction {
  return pct(100 + (percent - 100) * vulnerability)
}

/** scim: twisted bow accuracy (`accuracy`) / damage percentage. */
export function twistedBowPercent(magic: number, accuracy: boolean): number {
  const n = accuracy ? 10 : 14
  const cap = accuracy ? 140 : 250
  const a = Math.trunc((3 * magic - n) / 100)
  const b = Math.trunc((Math.trunc((3 * magic) / 10) - 10 * n) ** 2 / 100)
  return Math.min(Math.max(cap + a - b, 0), cap)
}

/** scim: weapon/target stages. */
function weaponStages(a: ProfileArgs): Stages {
  const demon = a.targetAttributes.includes('demon')
  if (demon && a.resources.kind === 'spell' && DEMONBANE_SPELLS.has(a.resources.spellId)) {
    const v = a.demonbaneVulnerability
    if (a.markOfDarknessActive) {
      return a.weaponId !== undefined && MARK_WEAPONS.has(a.weaponId)
        ? { attackRollStages: [vulnerable(180, v)], maxHitStages: [vulnerable(150, v)] }
        : { attackRollStages: [vulnerable(140, v)], maxHitStages: [vulnerable(125, v)] }
    }
    return { attackRollStages: [vulnerable(120, v)], maxHitStages: [] }
  }
  if (a.resources.kind === 'spell') return NO_STAGES
  if (a.weaponId !== undefined && TWISTED_BOWS.has(a.weaponId)) {
    const m = Math.min(Math.max(a.targetMagicLevel, a.targetMagicAttackBonus), 250)
    return { attackRollStages: [pct(twistedBowPercent(m, true))], maxHitStages: [pct(twistedBowPercent(m, false))] }
  }
  if (a.weaponId !== undefined && BOWFA_LIKE.has(canonicalItemId(a.weaponId))) {
    const worn = [a.headId, a.bodyId, a.legsId].map((id) => (id === undefined ? undefined : canonicalItemId(id)))
    const sum = (worn.includes(23971) ? 5 : 0) + (worn.includes(23975) ? 15 : 0) + (worn.includes(23979) ? 10 : 0)
    return { attackRollStages: [pct(100 + sum)], maxHitStages: [F(200 + sum, 200)] }
  }
  if (demon && a.weaponId !== undefined) {
    const p = DEMONBANE_WEAPONS.get(canonicalItemId(a.weaponId))
    if (p !== undefined) {
      const f = vulnerable(100 + p, a.demonbaneVulnerability)
      return { attackRollStages: [f], maxHitStages: [f] }
    }
  }
  return NO_STAGES
}

/** scim: single hit with weapon stages and an optional bolt proc. */
function singleHitProfile(a: ProfileArgs): AttackProfile {
  const st = weaponStages(a)
  const [first, ...rest] = st.maxHitStages
  const maxHit: MaxHitSpec = first === undefined ? { kind: 'base' } : { kind: 'staged', stages: [first, ...rest] }
  const accuracy: AccuracySpec = st.attackRollStages.length === 0 ? { kind: 'standard' } : { kind: 'standard', attackRollStages: st.attackRollStages }
  const ammo = a.resources.kind === 'ammo' ? catalogBaseId(a.resources.ammoId) : undefined
  let proc: ProcSpec | undefined
  if (ammo !== undefined && RUBY_BOLTS.has(ammo) && a.targetCurrentHp !== undefined && a.playerCurrentHp !== undefined && a.playerCurrentHp >= 10) {
    proc = { kind: 'rubyBolt', chancePercent: 6, targetCurrentHp: a.targetCurrentHp }
  } else if (ammo !== undefined && DIAMOND_BOLTS.has(ammo)) {
    proc = { kind: 'diamondBolt', chancePercent: 10 }
  }
  return { kind: 'singleHit', maxHit, hit: { accuracy, damage: { kind: 'uniformToMaxHit' }, ...(proc === undefined ? {} : { proc }) } }
}

/** scim: scythe hit fractions by target size. */
function scytheFractions(size: number): Fraction[] {
  return size === 1 ? [ONE] : size === 2 ? [ONE, HALF] : [ONE, HALF, QUARTER]
}


function baseProfile(a: ProfileArgs): AttackProfile | null {
  if (a.isSpecialAttack) {
    if (a.weaponId === undefined || specialAttackOf(a.weaponId)?.instantEffect !== undefined) return null
    if (ATLATLS.has(a.weaponId)) return { kind: 'unsupported', gaps: ['eclipse_special_formula'] }
    if (a.weaponId === 29589 || PURGING_STAFF.has(a.weaponId)) return singleHitProfile(a)
    if (SCORCHING_BOW.has(a.weaponId)) return BASIC_SINGLE_HIT
    if (BURNING_CLAWS.has(a.weaponId) || CLAWS.has(a.weaponId)) return { kind: 'unsupported', gaps: ['accuracy_branched_split'] }
    if (BLUDGEON.has(a.weaponId)) {
      return {
        kind: 'singleHit',
        maxHit: { kind: 'staged', stages: [F(200 + Math.max(0, Math.floor(a.playerMissingPrayerPoints)), 200)] },
        hit: { accuracy: { kind: 'standard' }, damage: { kind: 'uniformToMaxHit' } },
      }
    }
    const p = SPECIAL_PROFILES.get(a.weaponId)
    if (p === undefined) {
      return hasSpecialAttack(a.weaponId)
        ? { kind: 'unsupported', gaps: [a.weaponId === 26219 || a.weaponId === 27246 ? 'fang_endpoint_rounding' : 'animation_only_special'] }
        : null
    }
    return p
  }
  if (a.resources.kind === 'spell') return singleHitProfile(a)
  if (a.weaponId !== undefined && a.targetAttributes.includes('dragon') && DRAGONBANE.has(a.weaponId)) return null
  if (a.weaponId === undefined) return BASIC_SINGLE_HIT
  if (!SCYTHES.has(a.weaponId) && !KERIS.has(a.weaponId)) return singleHitProfile(a)
  if (SCYTHES.has(a.weaponId)) {
    return { kind: 'independentMultiHit', maxHit: { kind: 'base' }, accuracy: { kind: 'standard' }, maximumFractions: scytheFractions(a.targetSize) }
  }
  return KERIS_LIKE
}

/** scim: slayer helmet stage (every target counts as on-task). */
function slayerStage(headId: number | undefined, style: FormulaStyle, weaponId: number | undefined): Fraction | null {
  if (headId === undefined) return null
  const h = canonicalItemId(headId)
  if (style.startsWith('melee_') || (weaponId !== undefined && ATLATLS.has(weaponId))) {
    return SLAYER_HELMS.has(h) || IMBUED_SLAYER_HELMS.has(h) ? SLAYER_MELEE : null
  }
  return IMBUED_SLAYER_HELMS.has(h) ? SLAYER_IMBUED : null
}

function prependAccuracy(acc: AccuracySpec, stage: Fraction): AccuracySpec {
  return acc.kind === 'guaranteed' ? acc : { ...acc, attackRollStages: [stage, ...(acc.attackRollStages ?? [])] }
}
function appendAccuracy(acc: AccuracySpec, stage: Fraction): AccuracySpec {
  return acc.kind === 'guaranteed' ? acc : { ...acc, attackRollStages: [...(acc.attackRollStages ?? []), stage] }
}
function prependMax(m: MaxHitSpec, stage: Fraction): MaxHitSpec {
  return m.kind === 'base' ? { kind: 'staged', stages: [stage] } : { kind: 'staged', stages: [stage, ...m.stages] }
}
function appendMax(m: MaxHitSpec, stage: Fraction): MaxHitSpec {
  return m.kind === 'base' ? { kind: 'staged', stages: [stage] } : { kind: 'staged', stages: [...m.stages, stage] }
}

/** scim (prepend) (append). */
function addStage(p: AttackProfile, stage: Fraction, append: boolean): AttackProfile {
  const acc = append ? appendAccuracy : prependAccuracy
  const max = append ? appendMax : prependMax
  switch (p.kind) {
    case 'singleHit':
      return { ...p, maxHit: max(p.maxHit, stage), hit: { ...p.hit, accuracy: acc(p.hit.accuracy, stage) } }
    case 'independentMultiHit':
      return { ...p, maxHit: max(p.maxHit, stage), accuracy: acc(p.accuracy, stage) }
    case 'secondHitIfFirstAccurate':
      return {
        ...p,
        maxHit: max(p.maxHit, stage),
        first: { ...p.first, accuracy: acc(p.first.accuracy, stage) },
        second: { ...p.second, accuracy: acc(p.second.accuracy, stage) },
      }
    case 'unsupported':
      return p
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) [x, y] = [y, x % y]
  return x
}

/** scim: merge the slayer stage additively into a single demonbane stage. */
function mergeAdditive(p: AttackProfile, stage: Fraction): AttackProfile {
  if (
    p.kind !== 'singleHit' ||
    p.maxHit.kind !== 'staged' ||
    p.maxHit.stages.length !== 1 ||
    p.hit.accuracy.kind !== 'standard' ||
    p.hit.accuracy.attackRollStages?.length !== 1
  ) {
    return addStage(p, stage, false)
  }
  const s0 = p.maxHit.stages[0]!
  const den = s0.denominator * stage.denominator
  const num = s0.numerator * stage.denominator + stage.numerator * s0.denominator - den
  const g = gcd(num, den)
  return { ...p, maxHit: { kind: 'staged', stages: [F(num / g, den / g)] }, hit: { ...p.hit, accuracy: prependAccuracy(p.hit.accuracy, stage) } }
}


export function selectAttackProfile(raw: ProfileArgs): AttackProfile | null {
  const a: ProfileArgs = { ...raw, weaponId: raw.weaponId === undefined ? undefined : canonicalItemId(raw.weaponId) }
  const base = baseProfile(a)
  if (base === null || base.kind === 'unsupported') return base
  let p: AttackProfile = base
  const slayer = slayerStage(a.headId, a.formulaStyle, a.weaponId)
  if (slayer !== null) {
    if (a.weaponId !== undefined && SCORCHING_BOW.has(a.weaponId) && a.targetAttributes.includes('demon')) p = mergeAdditive(p, slayer)
    else if (a.weaponId !== undefined && BOWFA_LIKE.has(a.weaponId)) p = addStage(p, slayer, true)
    else p = addStage(p, slayer, false)
  }
  if (a.formulaStyle === 'melee_crush') {
    const bonus = [a.headId, a.bodyId, a.legsId].reduce<number>((sum, id) => sum + (id === undefined ? 0 : (INQUISITOR.get(id) ?? 0)), 0)
    if (bonus !== 0) p = addStage(p, F(1000 + bonus, 1000), true)
  }
  return p
}

// ---------------------------------------------------------------------------
// Plans (ready-to-roll)
// ---------------------------------------------------------------------------

export type AccuracyMode = 'single_roll' | 'double_roll' | 'steady_state'

export type PlannedDamage =
  | { kind: 'uniform'; minimumInclusive: number; maximumInclusive: number }
  | { kind: 'fixed'; damage: number }
  | { kind: 'minimum'; base: PlannedDamage; minimumDamage: number }

export type PlannedProc =
  | { kind: 'fixedDamage'; chance: number; damage: number; selfDamageRatio?: Fraction }
  | { kind: 'uniformDamage'; chance: number; minimumInclusive: number; maximumInclusive: number }

export interface Delivery {
  style: DamageStyle
  attackKind: string
  impactDelayTicks: number
}

export interface PlannedHit extends Delivery {
  gate: { kind: 'always' } | { kind: 'ifPriorAccurate'; priorHitIndex: number }
  accuracy: { kind: 'roll'; chance: number } | { kind: 'guaranteed' }
  damage: PlannedDamage
  proc?: PlannedProc
}

export interface Application {
  outgoingDamageMultiplier: number
  specialAttackDamageMultiplier: number
}

export interface ReadyPlan {
  kind: 'ready'
  attackSpeedTicks: number
  application: Application
  diagnostics: { baseAttackRoll: number; baseDefenceRoll: number; baseMaxHit: number; profileMaxHit: number }
  hits: PlannedHit[]
}

export type PlanResult = ReadyPlan | { kind: 'unsupported'; gaps: string[] } | null

function floorStage(x: number, f: Fraction): number {
  return Math.floor((x * f.numerator) / f.denominator)
}

function applyStages(x: number, stages: readonly Fraction[]): number {
  return stages.reduce(floorStage, x)
}

function boundValue(maxHit: number, b: Bound): number {
  const v = (maxHit * b.ratio.numerator) / b.ratio.denominator
  return Math.max(0, (b.rounding === 'floor' ? Math.floor(v) : Math.ceil(v)) + (b.offset ?? 0))
}


function modeChance(attackRoll: number, defenceRoll: number, mode: AccuracyMode): number {
  const single = hitChance(attackRoll, defenceRoll)
  switch (mode) {
    case 'single_roll':
      return single
    case 'double_roll':
      return doubleRollHitChance(attackRoll, defenceRoll)
    case 'steady_state':
      return steadyStateHitChance(single, doubleRollHitChance(attackRoll, defenceRoll))
  }
}

interface PlanContext {
  formulaStyle: FormulaStyle
  delivery: Delivery
  maxHit: number
  attackRoll: number
  defenceRoll: number
  mode: AccuracyMode
}


function plannedAccuracy(acc: AccuracySpec, ctx: PlanContext): PlannedHit['accuracy'] {
  switch (acc.kind) {
    case 'standard':
      return { kind: 'roll', chance: modeChance(applyStages(ctx.attackRoll, acc.attackRollStages ?? []), ctx.defenceRoll, ctx.mode) }
    case 'doubleRoll':
      return { kind: 'roll', chance: doubleRollHitChance(applyStages(ctx.attackRoll, acc.attackRollStages ?? []), ctx.defenceRoll) }
    case 'guaranteed':
      return { kind: 'guaranteed' }
  }
}


function plannedDamage(d: DamageProfileSpec, ctx: PlanContext): PlannedDamage {
  if (d.kind === 'uniformToMaxHit') {
    const u: PlannedDamage = { kind: 'uniform', minimumInclusive: 0, maximumInclusive: ctx.maxHit }
    return ctx.formulaStyle === 'magic' ? { kind: 'minimum', base: u, minimumDamage: 1 } : u
  }
  return { kind: 'uniform', minimumInclusive: boundValue(ctx.maxHit, d.minimum), maximumInclusive: boundValue(ctx.maxHit, d.maximum) }
}


function plannedProc(p: ProcSpec, maxHit: number): PlannedProc {
  return p.kind === 'rubyBolt'
    ? { kind: 'fixedDamage', chance: p.chancePercent / 100, damage: Math.min(100, Math.floor(p.targetCurrentHp / 5)), selfDamageRatio: F(1, 10) }
    : { kind: 'uniformDamage', chance: p.chancePercent / 100, minimumInclusive: 0, maximumInclusive: Math.floor((maxHit * 115) / 100) }
}


function plannedHit(h: ProfileHit, gate: PlannedHit['gate'], ctx: PlanContext): PlannedHit {
  const offset = h.impactDelayOffsetTicks ?? 0
  return {
    ...ctx.delivery,
    impactDelayTicks: ctx.delivery.impactDelayTicks + offset,
    gate,
    accuracy: plannedAccuracy(h.accuracy, ctx),
    damage: plannedDamage(h.damage, ctx),
    ...(h.proc === undefined ? {} : { proc: plannedProc(h.proc, ctx.maxHit) }),
  }
}


function plannedHits(p: Exclude<AttackProfile, { kind: 'unsupported' }>, ctx: PlanContext): PlannedHit[] {
  switch (p.kind) {
    case 'singleHit':
      return [plannedHit(p.hit, { kind: 'always' }, ctx)]
    case 'independentMultiHit':
      return p.maximumFractions.map((f) => ({
        ...ctx.delivery,
        gate: { kind: 'always' },
        accuracy: plannedAccuracy(p.accuracy, ctx),
        damage: { kind: 'uniform', minimumInclusive: 0, maximumInclusive: floorStage(ctx.maxHit, f) },
      }))
    case 'secondHitIfFirstAccurate':
      return [plannedHit(p.first, { kind: 'always' }, ctx), plannedHit(p.second, { kind: 'ifPriorAccurate', priorHitIndex: 0 }, ctx)]
  }
}

const RANGED_VOID = {
  bodies: new Set([8839, 20465, 24177, 33476, 33478, 26463, 27000, 13072, 20467, 24178, 33480, 33482, 26469, 27003]),
  eliteBodies: new Set([13072, 20467, 24178, 33480, 33482, 26469, 27003]),
  legs: new Set([8840, 20469, 24179, 33484, 33486, 26465, 27001, 13073, 20471, 24180, 33488, 33490, 26471, 27004]),
  eliteLegs: new Set([13073, 20471, 24180, 33488, 33490, 26471, 27004]),
  gloves: new Set([8842, 20475, 24182, 33492, 33494, 26467, 27002]),
  mageHelms: new Set([11663, 20477, 24183, 33468, 33470, 26473, 27005]),
  rangerHelms: new Set([11664, 20479, 24184, 33472, 33474, 26475, 27006]),
  meleeHelms: new Set([11665, 20481, 24185, 33464, 33466, 26477, 27007]),
}


export function voidSetOf(eq: PlayerActor['equipment']): VoidSet {
  const [head, body, legs, hands] = [eq.head, eq.body, eq.legs, eq.hands].map((id) => (id === undefined ? undefined : canonicalItemId(id)))
  const v = RANGED_VOID
  if (body === undefined || legs === undefined || hands === undefined || !v.bodies.has(body) || !v.legs.has(legs) || !v.gloves.has(hands)) return 'none'
  const elite = v.eliteBodies.has(body) && v.eliteLegs.has(legs)
  if (head !== undefined && v.mageHelms.has(head)) return elite ? 'elite_magic' : 'magic'
  if (head !== undefined && v.rangerHelms.has(head)) return elite ? 'elite_ranged' : 'ranged'
  if (head !== undefined && v.meleeHelms.has(head)) return 'melee'
  return 'none'
}

const QUIVERS = new Set([28828, 28951, 28953, 28955, 28957, 33528, 33530])

/** scim: weapon/quiver adjustments to the stat block. */
function adjustStats(player: PlayerActor, resources: AttackResources, stats: EquipmentStats): EquipmentStats {
  const weapon = player.equipment.weapon
  const quiverBonus =
    resources.kind === 'ammo' && resources.source === 'quiver' && player.equipment.cape !== undefined && QUIVERS.has(player.equipment.cape) && isStandardAmmo(resources.ammoId)
  const s = quiverBonus ? { ...stats, attackRanged: stats.attackRanged + 10, rangedStrength: stats.rangedStrength + 1 } : stats
  if (weapon !== undefined && ATLATLS.has(weapon)) return { ...s, rangedStrength: s.meleeStrength }
  if (weapon === 27275) return { ...s, attackMagic: s.attackMagic * 3, magicDamage: Math.min(100, s.magicDamage * 3) }
  return s
}

/** scim: powered-staff base max hits. */
export function poweredStaffBaseMaxHit(weaponId: number | undefined, magic: number): number | undefined {
  switch (weaponId === undefined ? undefined : canonicalItemId(weaponId)) {
    case 11905:
    case 11907:
    case 22288:
      return Math.max(1, Math.floor(magic / 3) - 5)
    case 12899:
    case 22292:
      return Math.max(1, Math.floor(magic / 3) - 2)
    case 22323:
      return Math.max(6, Math.floor(magic / 3))
    case 27275:
    case 28547:
      return Math.max(1, Math.floor(magic / 3) + 1)
    case 28585:
      return Math.floor((8 * magic + 963) / 37)
    case 22555:
      return Math.floor(magic / 3) - 8
    case 27665:
      return Math.floor(magic / 3) - 6
    case 28796:
      return Math.floor(magic / 3) + 5
    case 23898:
      return 23
    case 23899:
      return 31
    case 23900:
      return 39
    case 31113:
      return Math.max(1, Math.floor(magic / 3) - 6)
    default:
      return undefined
  }
}

export interface AttackPlanInput {
  player: PlayerActor
  target: NpcActor
  formulaStyle: FormulaStyle
  resources: AttackResources
  attackSpeedTicks: number
  delivery: Delivery
  application: Application
  manualCast: boolean
  isSpecialAttack: boolean
  standardAccuracyMode: AccuracyMode
  lookupItemStats: (id: number) => EquipmentStats | null
}

/** scim: select a profile and build a ready plan (null = attack without a plan, i.e. an automatic miss). */
export function buildAttackPlan(e: AttackPlanInput): PlanResult {
  const p = e.player
  const t = e.target
  const profile = selectAttackProfile({
    weaponId: p.equipment.weapon,
    headId: p.equipment.head,
    bodyId: p.equipment.body,
    legsId: p.equipment.legs,
    formulaStyle: e.formulaStyle,
    targetSize: t.size,
    isSpecialAttack: e.isSpecialAttack,
    resources: e.resources,
    targetAttributes: t.formulaStats.attributes,
    targetMagicLevel: t.formulaStats.levels.magic,
    targetMagicAttackBonus: t.formulaStats.offensive.magic,
    targetCurrentHp: t.vitals.hp,
    playerCurrentHp: p.vitals.hp,
    playerMissingPrayerPoints: p.stats.prayer.max - p.stats.prayer.current,
    markOfDarknessActive: p.combatTimers.markOfDarknessActiveTicks > 0,
    demonbaneVulnerability: t.formulaStats.demonbaneVulnerability ?? 1,
  })
  if (profile === null || profile.kind === 'unsupported') return profile

  // JG: target view, stats, magic base.
  const s = t.formulaStats
  const d = t.debuffs
  const targetView: NpcFormulaView = {
    kind: 'npc',
    id: t.npcTypeId,
    ...s,
    levels: { ...s.levels, defence: Math.max(0, s.levels.defence - (d?.defenceDrain ?? 0)), magic: Math.max(0, s.levels.magic - (d?.magicDrain ?? 0)) },
    offensive: { ...s.offensive },
    defensive: { ...s.defensive },
  }
  let stats: EquipmentStats
  if (e.resources.kind === 'ammo') {
    const ammo = e.lookupItemStats(e.resources.ammoId)
    if (ammo === null) return null
    stats = adjustStats(p, e.resources, addItemStats(p.equipmentStats, ammo))
  } else if (e.resources.kind === 'unavailable') {
    return null
  } else {
    stats = adjustStats(p, e.resources, p.equipmentStats)
  }
  let magicBase: number | undefined
  const powered = e.isSpecialAttack && p.equipment.weapon !== undefined && specialAttackOf(p.equipment.weapon)?.poweredSpellWeaponId !== undefined
  if (powered) magicBase = poweredStaffBaseMaxHit(27665, p.stats.magic.current)
  else if (e.formulaStyle === 'magic') {
    if (e.resources.kind === 'spell') {
      const spellId = e.resources.spellId
      const def = SPELLS.find((sp) => sp.name === spellId)
      if (def === undefined) return null
      magicBase = def.name === 'Magic Dart' ? Math.floor(p.stats.magic.current / 10) + 10 : def.maxHit
    } else if (e.resources.kind === 'none') {
      const b = poweredStaffBaseMaxHit(p.equipment.weapon, p.stats.magic.current)
      if (b === undefined) return null
      magicBase = b
    } else return null
  }
  const weapon = p.equipment.weapon
  const attacker: PlayerFormulaView = {
    kind: 'player',
    levels: {
      attack: p.stats.attack.current,
      strength: p.stats.strength.current,
      defence: p.stats.defence.current,
      ranged: p.stats.ranged.current,
      magic: p.stats.magic.current,
    },
    stance: e.manualCast ? 'Manual Cast' : stanceOf(p),
    voidSet: voidSetOf(p.equipment),
    ...(weapon !== undefined && ATLATLS.has(weapon) ? { rangedStrengthLevel: p.stats.strength.current } : {}),
    ...(magicBase === undefined ? {} : { magicBaseMaxHit: magicBase }),
  }
  const pm = prayerMultipliers(p.activePrayer, p.offensivePrayer)
  const defenceStyle = e.isSpecialAttack && weapon !== undefined ? specialAttackOf(weapon)?.defenceStyle : undefined
  const rolls = playerVsNpcRolls(attacker, targetView, e.formulaStyle, stats, pm, defenceStyle ?? e.formulaStyle)
  const baseMax = playerMaxHit(attacker, e.formulaStyle, stats, pm)
  const profileMax = profile.maxHit.kind === 'base' ? baseMax : applyStages(baseMax, profile.maxHit.stages)
  const ctx: PlanContext = {
    formulaStyle: e.formulaStyle,
    delivery: e.delivery,
    maxHit: profileMax,
    attackRoll: rolls.attackRoll,
    defenceRoll: rolls.defenceRoll,
    mode: e.standardAccuracyMode,
  }
  let plan: ReadyPlan = {
    kind: 'ready',
    attackSpeedTicks: e.attackSpeedTicks,
    application: e.application,
    diagnostics: { baseAttackRoll: rolls.attackRoll, baseDefenceRoll: rolls.defenceRoll, baseMaxHit: baseMax, profileMaxHit: profileMax },
    hits: plannedHits(profile, ctx),
  }
  // Seeking arrows: every hit deals at least 3 (scim with minimumDamage 3).
  if (
    e.formulaStyle === 'ranged' &&
    e.resources.kind === 'ammo' &&
    e.resources.source !== 'blowpipe' &&
    SEEKING_ARROWS[e.resources.ammoId] !== undefined &&
    weapon !== undefined &&
    ammoFitsWeapon(weapon, e.resources.ammoId)
  ) {
    plan = { ...plan, hits: plan.hits.map((h) => ({ ...h, damage: { kind: 'minimum', base: h.damage, minimumDamage: 3 } })) }
  }
  // Target-forced accuracy / maximum (none for the Jad wave, kept for fidelity).
  const alwaysAccurate = s.alwaysAccuratePlayerHit === true
  const alwaysMax = s.alwaysMaximumPlayerHit === true && (e.delivery.style === 'magic' || e.delivery.attackKind === 'range_arrow')
  if (alwaysAccurate || alwaysMax) {
    plan = { ...plan, hits: plan.hits.map((h) => ({ ...h, accuracy: { kind: 'guaranteed' } })) }
    if (alwaysMax) {
      const proj = projectPlan(plan)
      plan = { ...plan, hits: plan.hits.map((h, i) => ({ ...h, damage: { kind: 'fixed', damage: proj.hits[i]?.maximumRolledDamage ?? 0 } })) }
    }
  }
  return plan
}

// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------

function rollDamageSpec(d: PlannedDamage, random: RandomFn): number {
  switch (d.kind) {
    case 'uniform':
      return d.minimumInclusive + Math.floor(random() * (d.maximumInclusive - d.minimumInclusive + 1))
    case 'fixed':
      return d.damage
    case 'minimum':
      return Math.max(d.minimumDamage, rollDamageSpec(d.base, random))
  }
}

export interface RolledHit extends Delivery {
  damage: number
  accurate: boolean
  procActivated?: boolean
  procSelfDamageRatio?: Fraction
}

export interface RolledAttack {
  hits: RolledHit[]
  maximumRolledDamages: number[]
  expectedHit: number
  selectedBranchIndex: number | null
}

/** scim: roll every hit (gate -> proc -> accuracy -> damage) and attach the projection. */
export function rollAttackPlan(plan: ReadyPlan, random: RandomFn): RolledAttack {
  const rolled: { accurate: boolean; damage: number }[] = []
  const hits: RolledHit[] = []
  for (const h of plan.hits) {
    const gatePassed = h.gate.kind === 'always' ? true : (rolled[h.gate.priorHitIndex]?.accurate ?? false)
    const procActivated = gatePassed && h.proc !== undefined && random() < h.proc.chance
    const accurate = gatePassed && (procActivated || (h.accuracy.kind === 'guaranteed' ? true : random() < h.accuracy.chance))
    let damage = 0
    if (accurate) {
      if (procActivated) {
        const proc = h.proc!
        damage = proc.kind === 'fixedDamage' ? proc.damage : proc.minimumInclusive + Math.floor(random() * (proc.maximumInclusive - proc.minimumInclusive + 1))
      } else damage = rollDamageSpec(h.damage, random)
    }
    rolled.push({ accurate, damage })
    const selfRatio = procActivated && h.proc?.kind === 'fixedDamage' ? h.proc.selfDamageRatio : undefined
    hits.push({
      style: h.style,
      attackKind: h.attackKind,
      impactDelayTicks: h.impactDelayTicks,
      damage,
      accurate,
      ...(procActivated ? { procActivated: true } : {}),
      ...(selfRatio === undefined ? {} : { procSelfDamageRatio: selfRatio }),
    })
  }
  const proj = projectPlan(plan)
  return { hits, maximumRolledDamages: proj.hits.map((x) => x.maximumRolledDamage), expectedHit: proj.expectedAppliedDamagePerAttack, selectedBranchIndex: null }
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface HitProjection {
  planIndex: number
  gateProbability: number
  accuracyProbability: number
  expectedRolledDamage: number
  expectedAppliedDamage: number
  maximumRolledDamage: number
  maximumAppliedDamage: number
}

export interface PlanProjection {
  hits: HitProjection[]
  expectedRolledDamagePerAttack: number
  expectedAppliedDamagePerAttack: number
  maximumRolledDamagePerAttack: number
  maximumAppliedDamagePerAttack: number
  appliedDamagePerSecond: number
}

function damageDistribution(d: PlannedDamage): Map<number, number> {
  switch (d.kind) {
    case 'uniform': {
      const m = new Map<number, number>()
      const p = 1 / (d.maximumInclusive - d.minimumInclusive + 1)
      for (let x = d.minimumInclusive; x <= d.maximumInclusive; x++) m.set(x, p)
      return m
    }
    case 'fixed':
      return new Map([[d.damage, 1]])
    case 'minimum': {
      const out = new Map<number, number>()
      for (const [x, p] of damageDistribution(d.base)) {
        const v = Math.max(d.minimumDamage, x)
        if (p > 0) out.set(v, (out.get(v) ?? 0) + p)
      }
      return out
    }
  }
}

function procDistribution(p: PlannedProc): Map<number, number> {
  if (p.kind === 'fixedDamage') return new Map([[p.damage, 1]])
  const m = new Map<number, number>()
  const q = 1 / (p.maximumInclusive - p.minimumInclusive + 1)
  for (let x = p.minimumInclusive; x <= p.maximumInclusive; x++) m.set(x, q)
  return m
}


function appliedDamage(x: number, a: Application): number {
  return Math.floor(Math.floor(x * a.outgoingDamageMultiplier) * a.specialAttackDamageMultiplier)
}

interface Branch {
  probability: number
  priorAccuracy: boolean[]
  maxRolledTotal: number
  maxAppliedTotal: number
}

/** scim: expectation over the full outcome distribution. */
export function projectPlan(plan: ReadyPlan): PlanProjection {
  let branches: Branch[] = [{ probability: 1, priorAccuracy: [], maxRolledTotal: 0, maxAppliedTotal: 0 }]
  const hits: HitProjection[] = []
  plan.hits.forEach((h, index) => {
    // Accuracy indices later gates depend on (the only dependency our kinds use).
    const deps = new Set<number>()
    for (const later of plan.hits.slice(index + 1)) if (later.gate.kind === 'ifPriorAccurate') deps.add(later.gate.priorHitIndex)
    const depIdx = [...deps].filter((i) => i < index + 1)
    const merged = new Map<string, Branch>()
    let gateProbability = 0
    let accuracyProbability = 0
    let expectedRolled = 0
    let expectedApplied = 0
    let maxRolled = 0
    let maxApplied = 0
    const outcome = (b: Branch, accurate: boolean, rolledDamage: number, probability: number): void => {
      const applied = appliedDamage(accurate ? Math.max(1, rolledDamage) : 0, plan.application)
      if (accurate) accuracyProbability += probability
      expectedRolled += probability * rolledDamage
      expectedApplied += probability * applied
      maxRolled = Math.max(maxRolled, rolledDamage)
      maxApplied = Math.max(maxApplied, applied)
      const next: Branch = {
        probability,
        priorAccuracy: [...b.priorAccuracy, accurate],
        maxRolledTotal: b.maxRolledTotal + rolledDamage,
        maxAppliedTotal: b.maxAppliedTotal + applied,
      }
      const key = JSON.stringify(depIdx.map((i) => next.priorAccuracy[i]))
      const cur = merged.get(key)
      merged.set(
        key,
        cur === undefined
          ? next
          : {
              ...cur,
              probability: cur.probability + next.probability,
              maxRolledTotal: Math.max(cur.maxRolledTotal, next.maxRolledTotal),
              maxAppliedTotal: Math.max(cur.maxAppliedTotal, next.maxAppliedTotal),
            },
      )
    }
    for (const b of branches) {
      const gateOpen = h.gate.kind === 'always' ? true : (b.priorAccuracy[h.gate.priorHitIndex] ?? false)
      if (!gateOpen) {
        outcome(b, false, 0, b.probability)
        continue
      }
      gateProbability += b.probability
      const procChance = h.proc?.chance ?? 0
      if (h.proc !== undefined && procChance > 0) for (const [x, q] of procDistribution(h.proc)) outcome(b, true, x, b.probability * procChance * q)
      const acc = h.accuracy.kind === 'guaranteed' ? 1 : h.accuracy.chance
      if (acc < 1) outcome(b, false, 0, b.probability * (1 - procChance) * (1 - acc))
      if (acc > 0) for (const [x, q] of damageDistribution(h.damage)) outcome(b, true, x, b.probability * (1 - procChance) * acc * q)
    }
    branches = [...merged.values()]
    hits.push({
      planIndex: index,
      gateProbability,
      accuracyProbability,
      expectedRolledDamage: expectedRolled,
      expectedAppliedDamage: expectedApplied,
      maximumRolledDamage: maxRolled,
      maximumAppliedDamage: maxApplied,
    })
  })
  const expectedRolledTotal = hits.reduce((s, h) => s + h.expectedRolledDamage, 0)
  const expectedAppliedTotal = hits.reduce((s, h) => s + h.expectedAppliedDamage, 0)
  return {
    hits,
    expectedRolledDamagePerAttack: expectedRolledTotal,
    expectedAppliedDamagePerAttack: expectedAppliedTotal,
    maximumRolledDamagePerAttack: branches.reduce((m, b) => Math.max(m, b.maxRolledTotal), 0),
    maximumAppliedDamagePerAttack: branches.reduce((m, b) => Math.max(m, b.maxAppliedTotal), 0),
    appliedDamagePerSecond: expectedAppliedTotal / (plan.attackSpeedTicks * 0.6),
  }
}
