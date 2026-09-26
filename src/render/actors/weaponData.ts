/**
 * Player weapon animation sets and attack visuals, re-implemented from
 * scim's lookups over data
 * tables extracted from the bundle (src/render/data/scimTables.json,
 * scripts/render-extract-bundle-data.ts).
 */
import tables from '../data/scimTables.json'

export interface AnimSet {
  idle?: number
  walk?: number
  run?: number
  walkBack?: number
  turnLeft?: number
  turnRight?: number
  turn180?: number
  standTurn?: number
  attack?: number
  block?: number
}

export interface WeaponVisuals {
  attackAnimation?: number
  castSpotanim: number
  castSpotanimHeight: number
  projectileId: number
  projectileStartHeight: number
  projectileEndHeight: number
  projectileSlope: number
  projectileStartDelay: number
  hitSpotanim: number
  hitSpotanimHeight: number
}

export interface ProjectileTiming {
  delay: number
  lengthAdjustment: number
  stepMultiplier: number
  progress: number
}

export interface SpellVisuals {
  castAnimationId: number
  fallbackAnimationId?: number
  castSpotanimId: number
  castSpotanimHeight?: number
  projectileId: number
  hitSpotanimId: number
  hitSpotanimHeight: number
  hitSpotanimHeightMode?: 'actor' | 'sequence'
  impactTiming?: ProjectileTiming
  projectileOrigin?: 'caster' | 'target'
  projectileStartHeight: number
  projectileEndHeight: number
  projectileSlope: number
  projectileStartDelay: number
}

export interface SpecialAttackVisuals {
  animationId?: number
  graphicId?: number
  targetGraphic?: { spotAnimId: number; delayCycles: number | 'projectile_arrival'; height: number }
}

interface Tables {
  variantBase: Record<string, number>
  catalogVariantBase: Record<string, number>
  weaponCategory: Record<string, string>
  weaponAnimSets: Record<string, AnimSet>
  defaultAnimSet: AnimSet
  categoryAnimSets: Record<string, AnimSet>
  itemAnimSets: Record<string, AnimSet>
  attackKindOverrides: Record<string, Record<string, number>>
  shieldBlocks: Record<string, number>
  noShieldBlock: number[]
  weaponBlocks: Record<string, number>
  projectileTiming: Record<string, ProjectileTiming>
  spells: Record<string, SpellVisuals>
  ammoVisuals: Record<string, WeaponVisuals>
  weaponVisualOverrides: Record<string, Partial<WeaponVisuals> & { sourceName?: string }>
  weaponVisualsBase: Record<string, WeaponVisuals>
  bowOfFaerdhinenVisuals: Record<string, WeaponVisuals>
  blowpipeVisuals: Record<string, WeaponVisuals>
  specialVisuals: Record<string, WeaponVisuals>
  specialAttacks: Record<string, SpecialAttackVisuals>
  arrowAmmo: Record<string, { baseArrowId: number }>
}

const T = tables as unknown as Tables
const NO_SHIELD_BLOCK = new Set(T.noShieldBlock)
const DEFAULT_BLOCK = 424
const DEFAULT_SHIELD_BLOCK = 1156
export const EAT_SEQ = 829
export const DEFAULT_ANIM_SET: AnimSet = T.defaultAnimSet

/** `hl`: variant -> base item id (models, animation tables). */
export function baseItemId(id: number): number {
  return T.variantBase[id] ?? id
}

/**: catalog variant -> base id. */
export function catalogBaseId(id: number): number {
  return T.catalogVariantBase[String(id)] ?? id
}

/** `yy`: weapon category of an item, undefined when unarmed/unknown. */
export function weaponCategory(id: number | undefined): string | undefined {
  if (id === undefined) return undefined
  return T.weaponCategory[baseItemId(id)]
}

/**: candidate animation sets for a weapon, best first, unarmed last. */
export function animSetsFor(weapon: number | undefined): AnimSet[] {
  const out: AnimSet[] = []
  if (weapon !== undefined) {
    const w = baseItemId(weapon)
    const own = T.weaponAnimSets[w]
    if (own) out.push(own)
    const item = T.itemAnimSets[w]
    if (item) out.push(item)
    const cat = weaponCategory(w)
    if (cat) {
      const c = T.categoryAnimSets[cat]
      if (c) out.push(c)
    }
  }
  out.push(DEFAULT_ANIM_SET)
  return out
}

/**: block sequence candidates. */
export function blockSeqsFor(weapon: number | undefined, shield: number | undefined): number[] {
  const out: number[] = []
  const w = weapon === undefined ? undefined : baseItemId(weapon)
  const s = shield === undefined ? undefined : baseItemId(shield)
  if (s !== undefined && !NO_SHIELD_BLOCK.has(s)) out.push(T.shieldBlocks[s] ?? DEFAULT_SHIELD_BLOCK)
  if (w !== undefined) {
    const wb = T.weaponBlocks[w]
    if (wb !== undefined) out.push(wb)
  }
  for (const set of animSetsFor(weapon)) if (set.block !== undefined) out.push(set.block)
  out.push(DEFAULT_BLOCK)
  return out
}

/**: per-attack-kind override of the attack animation. */
export function attackKindAnimation(weapon: number | undefined, attackKind: string | undefined): number | undefined {
  if (weapon === undefined || attackKind === undefined) return undefined
  return T.attackKindOverrides[weapon]?.[attackKind] ?? T.attackKindOverrides[baseItemId(weapon)]?.[attackKind]
}

/**. */
export function specialAttackVisuals(weapon: number): SpecialAttackVisuals | undefined {
  const s = T.specialAttacks[baseItemId(weapon)]
  if (s !== undefined && weapon === 28688) return { ...s, animationId: 10656 }
  return s
}

/** `cy`: spell visuals by spell name. */
export function spellVisuals(spell: string): SpellVisuals | undefined {
  return T.spells[spell]
}

export function projectileTimingTable(name: string): ProjectileTiming {
  return T.projectileTiming[name]!
}

const SPECIAL_TIMING: Record<number, ProjectileTiming> = {
  12926: { delay: 32, lengthAdjustment: 0, stepMultiplier: 7, progress: 105 },
  27665: { delay: 50, lengthAdjustment: -4, stepMultiplier: 10, progress: 70 },
  27679: { delay: 50, lengthAdjustment: -4, stepMultiplier: 10, progress: 70 },
  27676: { delay: 50, lengthAdjustment: -4, stepMultiplier: 10, progress: 70 },
  29591: { delay: 46, lengthAdjustment: 4, stepMultiplier: 4, progress: 80 },
}

function weaponTiming(w: number): ProjectileTiming | undefined {
  switch (w) {
    case 12926:
      return { ...projectileTimingTable('thrown'), progress: 105 }
    case 27275:
      return projectileTimingTable('tumekens_shadow')
    case 31113:
      return projectileTimingTable('eye_of_ayak')
    case 30070:
      return projectileTimingTable('magic_spell')
    case 27665:
      return { delay: 46, lengthAdjustment: 0, stepMultiplier: 10, progress: 64 }
    default:
      return undefined
  }
}

/**: projectile timing of a weapon. */
export function projectileTiming(weapon: number | undefined, special = false): ProjectileTiming | undefined {
  if (weapon === undefined) return undefined
  const w = baseItemId(weapon)
  if (special && SPECIAL_TIMING[w]) return SPECIAL_TIMING[w]
  const own = weaponTiming(w)
  if (own) return own
  switch (weaponCategory(weapon)) {
    case 'bow':
    case 'crossbow':
      return projectileTimingTable('arrow')
    case 'thrown':
      return projectileTimingTable('thrown')
    case 'powered_staff':
      return projectileTimingTable('magic_spell')
    default:
      return undefined
  }
}

/** `ry`. */
export function timingCycles(t: ProjectileTiming, distance: number): number {
  return t.delay + t.lengthAdjustment + t.stepMultiplier * distance
}

/** Item facts needs (from the cache ObjType): slot and name. */
export interface ItemFacts {
  name: string
  /** wearPos1 of the item (13 = ammo, 3 = weapon). */
  wearPos: number
}

const ATLATLS = new Set([29000, 29851])
const ATLATL_DART = 28991
const ARROW_BOWS = new Set([11235, 20997, 29591])
const RUNE_CROSSBOWS = new Set([9185])
const DRAGON_BOLT_CROSSBOWS = new Set([11785, 26374])
const CROSSBOWS_WITH_BOLT_FALLBACK = new Set([9185, 11785])
const ARROW_RE = /^(?:bronze|iron|steel|mithril|adamant|rune|broad|amethyst|dragon)(?: fire)? arrows?/i
const BOLT_RE = /^(?:bronze|blurite|iron|steel|mithril|adamant|runite|silver|broad|amethyst broad|opal|jade|pearl|topaz|sapphire|emerald|ruby|diamond|dragonstone|onyx) bolts?/i
const DRAGON_BOLT_RE = /^(?:dragon|opal dragon|jade dragon|pearl dragon|topaz dragon|sapphire dragon|emerald dragon|ruby dragon|diamond dragon|dragonstone dragon|onyx dragon) bolts?/i

/** `lb`: ammunition kind. */
export function ammoKind(ammo: number, facts: ItemFacts | undefined): 'atlatl_dart' | 'arrow' | 'dragon_bolt' | 'standard_bolt' | 'unsupported' {
  if (ammo === ATLATL_DART) return 'atlatl_dart'
  if (T.arrowAmmo[ammo] !== undefined) return 'arrow'
  if (facts?.wearPos === 13) {
    if (DRAGON_BOLT_RE.test(facts.name)) return 'dragon_bolt'
    if (BOLT_RE.test(facts.name)) return 'standard_bolt'
    if (ARROW_RE.test(facts.name)) return 'arrow'
  }
  return 'unsupported'
}

function ammoCompatible(weaponBase: number, ammo: number, facts: ItemFacts | undefined): boolean {
  const k = ammoKind(ammo, facts)
  if (ATLATLS.has(weaponBase)) return k === 'atlatl_dart'
  if (ARROW_BOWS.has(weaponBase)) return k === 'arrow'
  if (RUNE_CROSSBOWS.has(weaponBase)) return k === 'standard_bolt'
  if (DRAGON_BOLT_CROSSBOWS.has(weaponBase)) return k === 'standard_bolt' || k === 'dragon_bolt'
  return false
}

/**
 *: attack visuals of a weapon, optionally with its ammo.
 * `facts` gives the ammo item's cache name/slot.
 */
export function weaponVisuals(
  weapon: number | undefined,
  ammo?: number,
  special = false,
  facts?: (id: number) => ItemFacts | undefined,
): WeaponVisuals | undefined {
  if (weapon === undefined) return undefined
  const base = baseItemId(weapon)
  const key = base === weapon ? catalogBaseId(weapon) : base
  if (special) {
    const s = T.specialVisuals[weapon] ?? T.specialVisuals[key]
    if (s) return s
  }
  const isBlowpipe = T.blowpipeVisuals[weapon] !== undefined || T.blowpipeVisuals[key] !== undefined
  const bowfa = T.bowOfFaerdhinenVisuals[weapon] ?? T.bowOfFaerdhinenVisuals[key]
  if (bowfa) return bowfa
  const own = T.weaponVisualsBase[key]
  if (own) return own
  const ammoVis =
    (base === weapon ? T.ammoVisuals[weapon] : undefined) ??
    T.ammoVisuals[key] ??
    (CROSSBOWS_WITH_BOLT_FALLBACK.has(key) ? T.ammoVisuals[9144] : undefined)
  const override = T.weaponVisualOverrides[weapon] ?? T.weaponVisualOverrides[key]
  if (ammo !== undefined && !(special && key === 11235)) {
    const cat = weaponCategory(weapon)
    const ammoFacts = facts?.(ammo)
    const dart = isBlowpipe && !!ammoFacts && ammoFacts.wearPos === 3 && / dart(?:\(|$)/i.test(ammoFacts.name)
    const launcher = (cat === 'bow' || cat === 'crossbow') && ammoCompatible(key, ammo, ammoFacts)
    if (dart || launcher) {
      const arrowBase = T.arrowAmmo[ammo]?.baseArrowId ?? ammo
      const vis = T.ammoVisuals[ammo] ?? T.ammoVisuals[catalogBaseId(arrowBase)] ?? (cat === 'crossbow' ? T.ammoVisuals[9144] : undefined)
      if (!vis) return undefined
      let attackAnimation = override?.attackAnimation ?? ammoVis?.attackAnimation
      if (attackAnimation === undefined) attackAnimation = animSetsFor(weapon).find((s) => s.attack !== undefined)?.attack
      if (attackAnimation === undefined) attackAnimation = vis.attackAnimation
      return { ...vis, ...override, ...(attackAnimation === undefined ? {} : { attackAnimation }) } as WeaponVisuals
    }
  }
  if (ammoVis) return override ? ({ ...ammoVis, ...override } as WeaponVisuals) : ammoVis
  return undefined
}

/** `AS`: player attack sequence candidates. */
export function attackSequenceCandidates(
  attack:
    | { kind: 'spell'; castAnimationId: number; fallbackAnimationId?: number | undefined }
    | { kind: 'weapon'; weaponId: number | undefined; attackKind: string | undefined; specAnimationId?: number | undefined },
): number[] {
  if (attack.kind === 'spell') return [attack.castAnimationId, attack.fallbackAnimationId].filter((v): v is number => v !== undefined)
  const list = [
    attack.specAnimationId,
    attackKindAnimation(attack.weaponId, attack.attackKind),
    weaponVisuals(attack.weaponId)?.attackAnimation,
    ...animSetsFor(attack.weaponId).map((s) => s.attack),
  ]
  return list.filter((v): v is number => v !== undefined && v >= 0)
}
