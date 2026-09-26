/**
 * Player attack step (scim executeAttack, XP,
 * launch heals/`_J`, blood fury, spell secondaries,
 * target selection, Confliction/`TW`/`DW`/`OW`).
 */
import type { Equipment, SkillName } from '../api'
import type { EventBus } from '../core/EventBus'
import type { RandomFn } from '../core/rng'
import type { ConflictionAttack, NpcActor, PlayerActor } from '../core/types'
import type { WorldState } from '../core/WorldState'
import { CATALOG_TWO_HANDED, CATALOG_UNCHARGED } from '../data/generated/catalog'
import { catalogBaseId } from '../items/variants'
import type { Arena } from '../map/Arena'
import { facePlayerToward } from '../map/facing'
import { isAttackable } from '../map/npcMovement'
import { distanceToBox, playerInRange, tileInsideNpc } from '../map/reach'
import { buildAttackPlan, rollAttackPlan, type AccuracyMode, type RolledHit } from './attackPlan'
import type { CombatSystem } from './CombatSystem'
import { applyPostHitEffects, equipmentHitEffectsFor, spendSpecial } from './effects'
import { queueRetaliation } from './retaliation'
import { NO_RESOURCES, resolveAttackResources, type AttackResources } from './resources'
import { specialAttackOf, type SpecialAttackDef } from './specials'
import { spellInfo } from './spells'
import { legacyHitDelay, playerHitDelayFromCycles, projectileCycles, PROJECTILE_TIMINGS, weaponProjectileTiming } from './timing'
import type { DamageResult, DamageStyle, EquipmentHitEffects, FormulaStyle, PendingHit, PostHitEffect } from './types'
import {
  attackKindOf,
  autocastSpell,
  damageStyleOf,
  formulaStyleOf,
  legacyDelayCategory,
  playerCombatParams,
  weaponCategory,
  weaponCategoryKey,
  type CombatStyleName,
} from './weaponCategories'
import type { EquipmentStats } from '../api'

// --- target selection -------------------------------------------------------------


function clearAttack(player: PlayerActor): void {
  player.attackTarget = null
  player.attackInteractionActive = false
  player.manualCastSpell = null
}

/** scim: an attack-target op. */
export function setAttackTarget(player: PlayerActor, world: WorldState, op: { targetId: string | null; manualCastSpell: string | null }): void {
  const npc = op.targetId === null ? null : world.getNpc(op.targetId)
  if (npc && !isAttackable(npc, world.tick)) {
    clearAttack(player)
    return
  }
  player.attackTarget = op.targetId
  if (npc) player.lastAttackTarget = npc.id
  player.attackInteractionActive = op.targetId !== null
  player.manualCastSpell = op.targetId === null ? null : op.manualCastSpell
}

/** scim: clear the target when it became un-attackable; true when cleared. */
export function clearIfAttackBlocked(player: PlayerActor, world: WorldState): boolean {
  const npc = player.attackTarget === null ? null : world.getNpc(player.attackTarget)
  if (!npc || isAttackable(npc, world.tick)) return false
  clearAttack(player)
  return true
}

// --- XP ----------------------------------------------------------------------------

const THIRD = 4 / 3


function xpForDamage(style: DamageStyle, combatStyle: CombatStyleName, damage: number): { skill: SkillName; xp: number }[] {
  if (damage <= 0) return []
  const out: { skill: SkillName; xp: number }[] = []
  switch (style) {
    case 'melee':
      if (combatStyle === 'Controlled') out.push({ skill: 'attack', xp: damage * THIRD }, { skill: 'strength', xp: damage * THIRD }, { skill: 'defence', xp: damage * THIRD })
      else if (combatStyle === 'Defensive') out.push({ skill: 'defence', xp: damage * 4 })
      else if (combatStyle === 'Aggressive') out.push({ skill: 'strength', xp: damage * 4 })
      else out.push({ skill: 'attack', xp: damage * 4 })
      break
    case 'range':
      if (combatStyle === 'Longrange') out.push({ skill: 'ranged', xp: damage * 2 }, { skill: 'defence', xp: damage * 2 })
      else out.push({ skill: 'ranged', xp: damage * 4 })
      break
    case 'magic':
      if (combatStyle === 'Defensive Casting' || combatStyle === 'Longrange') out.push({ skill: 'magic', xp: damage * THIRD }, { skill: 'defence', xp: damage })
      else out.push({ skill: 'magic', xp: damage * 2 })
      break
    default:
      return []
  }
  out.push({ skill: 'hitpoints', xp: damage * THIRD })
  return out
}

/** scim: accumulate fractional XP, return whole-number drops. */
function accumulateXp(counters: PlayerActor['xpCounters'], gains: { skill: SkillName; xp: number }[]): { skill: SkillName; amount: number }[] {
  const drops: { skill: SkillName; amount: number }[] = []
  for (const g of gains) {
    const before = counters[g.skill] ?? 0
    const after = before + g.xp
    counters[g.skill] = after
    const amount = Math.floor(after) - Math.floor(before)
    if (amount > 0) drops.push({ skill: g.skill, amount })
  }
  return drops
}

// --- Confliction gauntlets ------------------------------------------------------------

const CONFLICTION = 31106


export function usesConflictionRolls(equipment: Equipment, formulaStyle: FormulaStyle, resources: AttackResources): boolean {
  if (equipment.hands !== CONFLICTION) return false
  const w = equipment.weapon
  if (w !== undefined && CATALOG_TWO_HANDED.has(w)) return false
  if (resources.kind === 'spell') return true
  return w !== undefined && !CATALOG_UNCHARGED.has(w) && formulaStyle === 'magic' && weaponCategoryKey(w) === 'powered_staff'
}


function conflictionAttackOf(equipment: Equipment, formulaStyle: FormulaStyle, resources: AttackResources, targetId: string): ConflictionAttack | null {
  if (!usesConflictionRolls(equipment, formulaStyle, resources)) return null
  if (resources.kind === 'spell') return { kind: 'spell', spellId: resources.spellId, targetId }
  const w = equipment.weapon
  return w === undefined ? null : { kind: 'charged_staff', weaponId: w, targetId }
}


function sameConfliction(a: ConflictionAttack, b: ConflictionAttack): boolean {
  if (a.kind !== b.kind || a.targetId !== b.targetId) return false
  return a.kind === 'spell' ? a.spellId === b.spellId : a.weaponId === b.weaponId
}


function conflictionMode(pending: ConflictionAttack | null, attack: ConflictionAttack | null): AccuracyMode {
  return pending !== null && attack !== null && sameConfliction(pending, attack) ? 'double_roll' : 'single_roll'
}


function nextConfliction(pending: ConflictionAttack | null, attack: ConflictionAttack | null, landed: boolean): ConflictionAttack | null {
  if (attack === null || (pending !== null && !sameConfliction(pending, attack))) return pending
  return landed ? null : attack
}

// --- spell secondaries ----------------------------------------------------------------

const ANCIENT_SCEPTRES = new Set([27624, 28238, 28240, 28242, 28244])

/** scim: spell post-hit effects (smoke poison rolls the combat stream here). */
function spellPostHitEffects(spellId: string | undefined, random: RandomFn, equipment: Equipment): PostHitEffect[] | undefined {
  const eff = spellId === undefined ? undefined : spellInfo(spellId)?.secondaryEffect
  if (eff === undefined) return undefined
  const boosted = equipment.weapon !== undefined && ANCIENT_SCEPTRES.has(catalogBaseId(equipment.weapon))
  switch (eff.kind) {
    case 'poison':
      return random() >= 0.125 ? undefined : [{ effect: 'poison', severity: boosted ? Math.floor((eff.severity * 11) / 10) : eff.severity }]
    case 'drain_attack':
      return [{ effect: 'drain_attack', percent: boosted ? (eff.percent * 11) / 10 : eff.percent }]
    case 'freeze':
      return [{ effect: 'freeze', durationTicks: boosted ? Math.floor((eff.durationTicks * 11) / 10) : eff.durationTicks }]
    case 'leech_hp':
      return undefined
  }
}

/** scim: blood spells heal at launch. */
function spellLaunchHeal(spellId: string | undefined): { percentOfDamage: number; minimumHeal: number } | undefined {
  const eff = spellId === undefined ? undefined : spellInfo(spellId)?.secondaryEffect
  return eff?.kind === 'leech_hp' ? { percentOfDamage: eff.percentOfDamage, minimumHeal: 0 } : undefined
}

/** scim: roll chance-gated special effects. */
function rollChanceEffects(effects: PostHitEffect[] | undefined, branchIndex: number | null, random: RandomFn): PostHitEffect[] | undefined {
  if (effects === undefined) return undefined
  return effects.filter((e) => {
    if (e.effect === 'poison' && e.chancePercent !== undefined) return random() * 100 < e.chancePercent
    if (e.effect !== 'burn' || e.chancePercentByBranch === undefined) return true
    if (branchIndex === null) return false
    const chance = e.chancePercentByBranch[branchIndex]
    return chance !== undefined && random() * 100 < chance
  })
}

// --- attack step --------------------------------------------------------------------

export interface PlayerAttackDeps {
  world: WorldState
  arena: Arena
  tickEvents: EventBus
  combatSystem: CombatSystem
  random: RandomFn
  infiniteHealth: boolean
  lookupItemStats: (id: number) => EquipmentStats | null
  onDamageApplied: (result: DamageResult) => void
  onPlayerAttackStarted?: (info: { tick: number; sourceId: string; targetId: string; attackType: DamageStyle; attackKind: string }) => void
}

interface TargetHits {
  target: NpcActor
  hits: RolledHit[]
  expectedHit: number
}

/** scim: extra targets of a multi-target spell (SW tiles within radius of the target's SW tile). */
function extraTargets(primary: NpcActor, candidates: readonly NpcActor[], spec: { radius: number; maxTargets: number }): NpcActor[] {
  const [x, y] = primary.position
  const out: NpcActor[] = []
  for (const n of candidates) {
    if (n.id === primary.id || !n.alive || Math.abs(n.position[0] - x) > spec.radius || Math.abs(n.position[1] - y) > spec.radius) continue
    out.push(n)
    if (out.length === spec.maxTargets - 1) break
  }
  return out
}


export function playerCombatStep(player: PlayerActor, deps: PlayerAttackDeps): void {
  const { world } = deps
  if (!player.alive || !player.attackTarget || clearIfAttackBlocked(player, world)) return
  const actor = world.actors.get(player.attackTarget)
  if (!actor || !actor.alive || actor.kind !== 'npc') {
    player.attackTarget = null
    return
  }
  if (!player.attackInteractionActive) return
  const target = actor
  facePlayerToward(player, target)
  const pause = player.autoAttackPause
  if (pause && world.tick >= pause.resumeTick) player.autoAttackPause = null
  else if (pause?.targetId === target.id) return

  const styleIndex = player.selectedAttackStyleIndex
  const manual = player.manualCastSpell
  let params = playerCombatParams(player)
  if (manual) params = { attackSpeed: 5, attackRange: 10 }
  if (!playerInRange(deps.arena, player.position, target.position, target.size, params.attackRange, true) || tileInsideNpc(player.position, target.position, target.size)) return
  const next = deps.combatSystem.getNextAttackTick(player.id)
  if (next !== undefined && world.tick < next) return

  const specToggled = player.isSpecialAttackActive
  let def: SpecialAttackDef | undefined
  let newSpec: PlayerActor['specialAttack'] | null = null
  if (specToggled) {
    if (player.equipment.weapon !== undefined) def = specialAttackOf(player.equipment.weapon)
    if (def?.targetAttribute !== undefined && !target.formulaStats.attributes.includes(def.targetAttribute)) def = undefined
    if (def !== undefined) newSpec = spendSpecial(player.specialAttack, def.energyCost ?? 50)
  }
  const isSpec = newSpec !== null
  const poweredSpell = isSpec && def?.poweredSpellWeaponId !== undefined
  const weapon = player.equipment.weapon
  const autocast = poweredSpell
    ? null
    : autocastSpell({
        weaponId: weapon,
        selectedStyleIndex: styleIndex,
        selectedSpell: player.combatSupplies.selectedSpell,
        spellbook: player.combatSupplies.spellbook,
      })
  const formulaStyle: FormulaStyle = poweredSpell || manual ? 'magic' : formulaStyleOf(weapon, styleIndex)
  const resources: AttackResources = poweredSpell
    ? NO_RESOURCES
    : resolveAttackResources({
        weaponId: weapon,
        equipment: player.equipment,
        inventory: player.inventory,
        formulaStyle,
        supplies: player.combatSupplies,
        magicLevel: player.stats.magic.current,
        manualCastSpell: manual,
        activeSpell: autocast?.name ?? null,
      })
  if (resources.kind === 'unavailable') {
    player.manualCastSpell = null
    return
  }
  const baseStyle = damageStyleOf(formulaStyle)
  const baseKind = attackKindOf(formulaStyle)
  const spellId = resources.kind === 'spell' ? resources.spellId : autocast?.name
  const confliction = conflictionAttackOf(player.equipment, formulaStyle, resources, target.id)
  const accuracyMode = conflictionMode(player.pendingConflictionAttack, confliction)
  const finalStyle: DamageStyle = isSpec && def?.styleOverride ? def.styleOverride : baseStyle
  const finalKind = isSpec && def?.attackKindOverride ? def.attackKindOverride : baseKind
  const finalSpeed = isSpec && def?.attackSpeedOverride ? def.attackSpeedOverride : params.attackSpeed
  const distance = distanceToBox(player.position[0], player.position[1], target.position[0], target.position[1], target.size)
  const delaySpell = poweredSpell ? null : manual ? (spellInfo(manual) ?? autocast) : autocast
  let hitDelay: number
  if (delaySpell?.fixedHitDelay != null) hitDelay = delaySpell.fixedHitDelay
  else if (delaySpell) hitDelay = playerHitDelayFromCycles(projectileCycles(PROJECTILE_TIMINGS.magic_spell, distance))
  else if (isSpec && def?.hitDelayTicks !== undefined) hitDelay = def.hitDelayTicks
  else {
    const timing = weaponProjectileTiming(weapon, isSpec)
    hitDelay = timing ? playerHitDelayFromCycles(projectileCycles(timing, distance)) : legacyHitDelay(legacyDelayCategory(weapon, formulaStyle), distance)
  }
  const outgoingMult = 1
  const specMult = 1
  const multi = isSpec || spellId === undefined ? undefined : spellInfo(spellId)?.multiTarget
  const targets =
    multi === undefined
      ? [target]
      : [
          target,
          ...extraTargets(
            target,
            world.getNpcs().filter((n) => isAttackable(n, world.tick)),
            multi,
          ),
        ]
  const rolledTargets: TargetHits[] = []
  let selectedBranch: number | null = null
  for (const t of targets) {
    const plan = buildAttackPlan({
      player,
      target: t,
      formulaStyle,
      resources,
      attackSpeedTicks: finalSpeed,
      delivery: { style: finalStyle, attackKind: finalKind, impactDelayTicks: hitDelay },
      application: { outgoingDamageMultiplier: outgoingMult, specialAttackDamageMultiplier: specMult },
      manualCast: manual !== null,
      isSpecialAttack: isSpec,
      standardAccuracyMode: accuracyMode,
      lookupItemStats: deps.lookupItemStats,
    })
    if (plan?.kind === 'unsupported' || (plan === null && isSpec)) {
      if (t.id === target.id) {
        if (specToggled) player.isSpecialAttackActive = false
        return
      }
      continue
    }
    const rolled =
      plan === null
        ? { hits: [{ damage: 0, accurate: false, style: finalStyle, attackKind: finalKind, impactDelayTicks: hitDelay }], expectedHit: 0, selectedBranchIndex: null }
        : rollAttackPlan(plan, deps.random)
    if (t.id === target.id) selectedBranch = rolled.selectedBranchIndex
    rolledTargets.push({ target: t, hits: rolled.hits, expectedHit: rolled.expectedHit })
  }
  const [primary, ...supplemental] = rolledTargets
  if (!primary) return
  if (specToggled) player.isSpecialAttackActive = false
  if (newSpec !== null) player.specialAttack = newSpec
  executeAttack({
    player,
    target,
    deps,
    hits: primary.hits,
    expectedHit: primary.expectedHit,
    supplemental,
    formulaStyle,
    styleIndex,
    finalStyle,
    finalSpeed,
    resources,
    confliction,
    spellId,
    isSpec,
    def,
    outgoingMult,
    specMult,
    selectedBranch,
    onFireEffects: isSpec ? def?.onFireEffects : undefined,
  })
}

interface ExecuteArgs {
  player: PlayerActor
  target: NpcActor
  deps: PlayerAttackDeps
  hits: RolledHit[]
  expectedHit: number
  supplemental: TargetHits[]
  formulaStyle: FormulaStyle
  styleIndex: number
  finalStyle: DamageStyle
  finalSpeed: number
  resources: AttackResources
  confliction: ConflictionAttack | null
  spellId: string | undefined
  isSpec: boolean
  def: SpecialAttackDef | undefined
  outgoingMult: number
  specMult: number
  selectedBranch: number | null
  onFireEffects: PostHitEffect[] | undefined
}

/** scim: the launch-time applied damage used by heals. */
function scaledLaunchDamage(a: ExecuteArgs, damage: number): number {
  const out = Math.max(0, Math.floor(Math.floor(damage) * a.outgoingMult))
  return Math.max(0, Math.floor(out * a.specMult))
}


function launchHeal(a: ExecuteArgs, heal: { percentOfDamage: number; minimumHeal: number }, damage: number): void {
  const p = a.player
  if (p.vitals.hp >= p.vitals.maxHp) return
  const amount = Math.max(heal.minimumHeal, Math.floor((scaledLaunchDamage(a, damage) * heal.percentOfDamage) / 100))
  p.vitals.hp = Math.min(p.vitals.maxHp, p.vitals.hp + amount)
  p.stats.hitpoints.current = p.vitals.hp
}

/** scim: amulet of blood fury. */
function bloodFury(a: ExecuteArgs, landed: { hit: RolledHit; landed: boolean }[]): void {
  const p = a.player
  let proc = false
  let total = 0
  for (const { hit, landed: ok } of landed) {
    if (!ok) continue
    const dmg = scaledLaunchDamage(a, hit.damage)
    if (p.equipment.amulet !== 24780 || hit.style !== 'melee' || dmg <= 0 || a.deps.random() >= 0.2) continue
    proc = true
    total += Math.floor(dmg * 0.3)
  }
  if (!proc) return
  p.vitals.hp = Math.min(p.vitals.maxHp, p.vitals.hp + total)
  p.stats.hitpoints.current = p.vitals.hp
  a.deps.tickEvents.emit({ type: 'npc_graphic_applied', targetId: a.target.id, spotAnimId: 1542, height: 92 })
}


function executeAttack(a: ExecuteArgs): void {
  const { deps, player, target } = a
  const random = deps.random
  const [first, ...extra] = a.hits
  if (!first) return
  const specEffects = a.isSpec ? a.def?.postHitEffects : undefined
  const postHitEffects = (): PostHitEffect[] | undefined =>
    a.isSpec ? rollChanceEffects(specEffects, a.selectedBranch, random) : spellPostHitEffects(a.spellId, random, player.equipment)
  const forcedMiss = false
  const supplemental = a.supplemental.map((t) => ({ ...t, hpAtLaunch: t.target.vitals.hp, forcedMisses: t.hits.map(() => false) }))
  const onKill = a.isSpec ? a.def?.onKillEffect : undefined
  const hpAtLaunch = target.vitals.hp
  const eqEffects: EquipmentHitEffects = equipmentHitEffectsFor(player.equipment, a.formulaStyle)
  const landed = !forcedMiss && first.accurate
  const ammoId = a.resources.kind === 'ammo' ? a.resources.ammoId : undefined
  const ok = deps.combatSystem.processAttack(deps.world, player, target, {
    events: deps.tickEvents,
    infiniteHealth: deps.infiniteHealth,
    enablePendingHits: first.impactDelayTicks > 0,
    outgoingDamageMultiplier: a.outgoingMult,
    specDamageMultiplier: a.specMult,
    getAttackSpeed: () => a.finalSpeed,
    resolveAttack: () => ({
      style: first.style,
      attackKind: first.attackKind,
      rolledDamage: first.damage,
      accuracySucceeded: landed,
      impactDelayTicks: first.impactDelayTicks,
      spellId: a.spellId,
      usingSpecialAttack: a.isSpec,
      onKillEffect: onKill,
      postHitEffects: postHitEffects(),
      equipmentHitEffects: eqEffects,
      weaponId: player.equipment.weapon,
      ammoId,
      ammoSource: a.resources.source,
      expectedHit: a.expectedHit,
      sourceSelfDamageRatio: landed ? first.procSelfDamageRatio : undefined,
    }),
    onDamageApplied: (r) => deps.onDamageApplied(r),
    onAttackStarted: () => {
      const heal = a.isSpec ? a.def?.launchHeal : spellLaunchHeal(a.spellId)
      if (heal !== undefined) {
        if (landed && first.damage > 0) launchHeal(a, heal, first.damage)
        for (const t of supplemental) {
          t.hits.forEach((h, i) => {
            if (t.forcedMisses[i] !== true && h.accurate && h.damage > 0) launchHeal(a, heal, h.damage)
          })
        }
      }
      bloodFury(a, [{ hit: first, landed }, ...extra.map((h) => ({ hit: h, landed: !forcedMiss && h.accurate }))])
      if (a.onFireEffects && a.onFireEffects.length > 0) {
        applyPostHitEffects(player, target, 0, rollChanceEffects(a.onFireEffects, a.selectedBranch, random) ?? [], deps.world.tick, 'on-fire')
      }
      deps.onPlayerAttackStarted?.({ tick: deps.world.tick, sourceId: player.id, targetId: target.id, attackType: first.style, attackKind: first.attackKind })
    },
  })
  if (!ok) return
  for (const t of supplemental) {
    t.hits.forEach((h, i) => {
      deps.combatSystem.processSupplementalHitRequest(
        deps.world,
        {
          attacker: player,
          target: t.target,
          attack: {
            style: h.style,
            attackKind: h.attackKind,
            rolledDamage: h.damage,
            accuracySucceeded: t.forcedMisses[i] !== true && h.accurate,
            impactDelayTicks: h.impactDelayTicks,
            spellId: a.spellId,
            usingSpecialAttack: a.isSpec,
            onKillEffect: onKill,
            postHitEffects: a.isSpec ? specEffects : spellPostHitEffects(a.spellId, random, player.equipment),
            equipmentHitEffects: eqEffects,
            weaponId: player.equipment.weapon,
            ammoId,
            ammoSource: a.resources.source,
            expectedHit: t.expectedHit,
          },
        },
        {
          events: deps.tickEvents,
          infiniteHealth: deps.infiniteHealth,
          enablePendingHits: h.impactDelayTicks > 0,
          outgoingDamageMultiplier: a.outgoingMult,
          specDamageMultiplier: a.specMult,
          onDamageApplied: (r) => deps.onDamageApplied(r),
        },
      )
    })
  }
  player.pendingConflictionAttack = nextConfliction(player.pendingConflictionAttack, a.confliction, landed)
  player.manualCastSpell = null
  for (const h of extra) {
    const record: PendingHit = {
      sourceId: player.id,
      targetId: target.id,
      style: h.style,
      attackKind: h.attackKind,
      launchTick: deps.world.tick,
      impactTick: deps.world.tick + h.impactDelayTicks,
      rolledDamage: h.damage,
      damageCapAtCalculation: undefined,
      accuracySucceeded: !forcedMiss && h.accurate,
      damageBonusPercent: undefined,
      prayerCheckAt: 'launch',
      judgedProtectionPrayer: null,
      applyPoison: undefined,
      usingSpecialAttack: a.isSpec,
      onKillEffect: onKill,
      postHitEffects: postHitEffects(),
      expectedHit: undefined,
      sourceSelfDamageRatio: !forcedMiss && h.accurate ? h.procSelfDamageRatio : undefined,
      launchDamageMultipliers: { incomingDamageMultiplier: undefined, outgoingDamageMultiplier: a.outgoingMult, specDamageMultiplier: a.specMult },
      equipmentHitEffects: eqEffects,
    }
    deps.combatSystem.queuePendingHit(deps.world, record, { source: player, target })
    queueRetaliation(target, record)
  }
  emitXpDrop(a, [
    { hits: a.hits, forcedMiss, hpAtLaunch },
    ...supplemental.map((t) => ({ hits: t.hits, forcedMiss: t.forcedMisses.every(Boolean), hpAtLaunch: t.hpAtLaunch })),
  ])
}


function emitXpDrop(a: ExecuteArgs, groups: { hits: RolledHit[]; forcedMiss: boolean; hpAtLaunch: number }[]): void {
  let total = 0
  for (const g of groups) {
    let dealt = 0
    for (const h of g.hits) {
      if (g.forcedMiss || !h.accurate) continue
      const base = Math.max(1, Math.max(0, Math.floor(h.damage)))
      const out = Math.max(0, Math.floor(base * a.outgoingMult))
      const spec = Math.max(0, Math.floor(out * a.specMult))
      const remaining = Math.max(0, g.hpAtLaunch - dealt)
      const applied = Math.min(spec, remaining)
      dealt += applied
      total += applied
    }
  }
  if (total === 0) return
  const styles = weaponCategory(a.player.equipment.weapon).styles
  const combatStyle = (styles[a.styleIndex] ?? styles[0])!.combatStyle
  const drops = accumulateXp(a.player.xpCounters, xpForDamage(a.finalStyle, combatStyle, total))
  if (drops.length > 0) a.deps.tickEvents.emit({ type: 'xp_drop', skills: drops, predictedHit: total })
}
