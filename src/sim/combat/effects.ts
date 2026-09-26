/**
 * Damage helpers and NPC status effects:
 * - `EO` damage-range roll, `DO`/`OO` protection prayers
 * - NPC burns, poison `QU`/`$U`
 * - eclipse set burn
 * - Power of Death
 * - special/spell post-hit effects
 * - drain helpers/`LE`, clears `RE`, defeat `BE`
 */
import type { PrayerId, SpecialAttackState } from '../api'
import type { RandomFn } from '../core/rng'
import type { BurnSeverity, NpcActor, PlayerActor } from '../core/types'
import { protects } from '../data/prayers'
import { catalogBaseId } from '../items/variants'
import { isFreezeImmune } from '../map/npcMovement'
import { specialAttackOf } from './specials'
import type { EquipmentHitEffects, FormulaStyle, PostHitEffect, PrayerReduction } from './types'

/** scim: a number, or uniform [min, max] on the combat stream. */
export function rollDamageValue(value: number | readonly [number, number], random: RandomFn): number {
  if (typeof value === 'number') return value
  const [min, max] = value
  return min >= max ? min : min + Math.floor(random() * (max - min + 1))
}

/** scim: apply the target's protection prayer. */
export function applyProtection(damage: number, style: string, prayer: PrayerId | null | undefined, reduction?: PrayerReduction): number {
  if (damage === 0) return 0
  if (!style || !prayer || style === 'typeless' || !protects(style, prayer)) return damage
  const r = reduction ?? { type: 'block' }
  switch (r.type) {
    case 'block':
      return 0
    case 'cap':
      return Math.min(r.value ?? 0, damage)
    case 'reduce':
      return Math.floor((damage * Math.round((r.value ?? 0) * 100)) / 100)
    case 'bypass':
      return damage
  }
}

// --- burns -----------------------------------------------------------------------

const SEVERITY_RANK: Readonly<Record<BurnSeverity, number>> = { weak: 0, normal: 1, strong: 2, incendiary: 3 }
const IMMUNITY_RANK = { Weak: 0, Normal: 1, Strong: 2 } as const

/** scim: is the NPC immune to a burn of this severity? */
export function isBurnImmune(npc: NpcActor, severity: BurnSeverity): boolean {
  if (severity === 'incendiary') return false
  const imm = npc.formulaStats.burnImmunity
  return imm != null && SEVERITY_RANK[severity] <= IMMUNITY_RANK[imm]
}


export function canTakeBurn(npc: NpcActor, severity: BurnSeverity): boolean {
  return npc.alive && !isBurnImmune(npc, severity) && (npc.burnStacks?.length ?? 0) < 5
}

/** scim: add a burn stack; the first stack schedules the first pulse. */
export function addBurnStack(args: {
  target: NpcActor
  sourceId: string
  origin: string
  severity: BurnSeverity
  pulses: number
  tick: number
  firstPulseDelayTicks?: number | undefined
}): boolean {
  const { target } = args
  if (!canTakeBurn(target, args.severity)) return false
  const stacks = target.burnStacks ?? []
  if (stacks.length === 0) target.burnNextPulseTick = args.tick + (args.firstPulseDelayTicks ?? 4)
  target.burnStacks = [...stacks, { origin: args.origin, sourceId: args.sourceId, pulsesRemaining: args.pulses }]
  return true
}


export function clearBurns(npc: NpcActor): void {
  npc.burnStacks = []
  npc.burnNextPulseTick = undefined
}

/** scim: a burn pulse due this tick, damage = stack count. */
export function pulseBurns(npc: NpcActor, tick: number): { sourceId: string; stackCount: number } | null {
  const stacks = npc.burnStacks
  if (stacks === undefined || stacks.length === 0) return null
  if (!npc.alive) {
    clearBurns(npc)
    return null
  }
  if (npc.burnNextPulseTick === undefined || npc.burnNextPulseTick > tick) return null
  const result = { sourceId: stacks[0]!.sourceId, stackCount: stacks.length }
  const remaining = stacks.flatMap((s) => (s.pulsesRemaining <= 1 ? [] : [{ ...s, pulsesRemaining: s.pulsesRemaining - 1 }]))
  npc.burnStacks = remaining
  npc.burnNextPulseTick = remaining.length === 0 ? undefined : tick + 4
  return result
}

// --- NPC poison ------------------------------------------------------------------


export function clearPoison(npc: NpcActor): void {
  npc.poison = undefined
}


export function poisonNpc(args: { target: NpcActor; sourceId: string; severity: number; tick: number }): boolean {
  const { target } = args
  if (args.severity <= 0 || !target.alive || target.formulaStats.poisonResistance >= 100) return false
  const cur = target.poison
  target.poison = {
    sourceId: args.sourceId,
    severity: Math.max(cur?.severity ?? 0, args.severity),
    nextPulseTick: cur?.nextPulseTick ?? args.tick + 30,
  }
  return true
}

/** scim: a poison pulse every 30 ticks for ceil(severity / 5), severity then drops by 1. */
export function pulsePoison(npc: NpcActor, tick: number): { sourceId: string; damage: number } | null {
  const p = npc.poison
  if (p === undefined) return null
  if (!npc.alive) {
    clearPoison(npc)
    return null
  }
  if (p.nextPulseTick > tick) return null
  const result = { sourceId: p.sourceId, damage: Math.ceil(p.severity / 5) }
  const sev = p.severity - 1
  if (sev <= 0) clearPoison(npc)
  else npc.poison = { ...p, severity: sev, nextPulseTick: tick + 30 }
  return result
}

// --- eclipse set -----------------------------------------------------------------

/** scim: eclipse moon set + atlatl on a ranged style. */
export function equipmentHitEffectsFor(equipment: PlayerActor['equipment'], style: FormulaStyle): EquipmentHitEffects {
  const base = (id: number | undefined): number | undefined => (id === undefined ? undefined : catalogBaseId(id))
  return {
    eclipseBurn:
      style === 'ranged' && base(equipment.weapon) === 29000 && base(equipment.head) === 29010 && base(equipment.body) === 29004 && base(equipment.legs) === 29007,
  }
}

/** scim: on an accurate hit, 20% to add a strong 10-pulse burn. */
export function rollEclipseBurn(args: {
  snapshot: EquipmentHitEffects
  accurate: boolean
  target: NpcActor
  sourceId: string
  impactTick: number
  roll: RandomFn
}): void {
  if (!args.snapshot.eclipseBurn || !args.accurate) return
  if (!canTakeBurn(args.target, 'strong')) return
  if (args.roll() >= 0.2) return
  addBurnStack({ target: args.target, sourceId: args.sourceId, origin: 'eclipse', severity: 'strong', pulses: 10, tick: args.impactTick })
}

// --- Power of Death ---------------------------------------------------------------

/** scim: spend an instant (Power of Death) special. */
export function instantSpecial(
  weaponId: number | undefined,
  special: SpecialAttackState,
  costMultiplier = 1,
): { specialAttack: SpecialAttackState; activated: boolean } | null {
  const def = weaponId === undefined ? undefined : specialAttackOf(weaponId)
  if (def?.instantEffect !== 'powerOfDeath') return null
  const spent = spendSpecial(special, Math.max(0, Math.floor((def.energyCost ?? 100) * costMultiplier)))
  return { specialAttack: spent ?? special, activated: spent !== null }
}


export function spendSpecial(special: SpecialAttackState, cost: number): SpecialAttackState | null {
  return special.energy < cost ? null : { ...special, energy: special.energy - cost }
}

/** scim: handle the spec toggle for instant-spec weapons; true when handled. */
export function tryInstantSpecial(player: PlayerActor, tick: number, costMultiplier = 1): boolean {
  const r = instantSpecial(player.equipment.weapon, player.specialAttack, costMultiplier)
  if (r === null) return false
  player.isSpecialAttackActive = false
  player.specialAttack = r.specialAttack
  if (r.activated) player.powerOfDeathUntilTick = tick + 100
  return true
}


function hasPowerOfDeathWeapon(player: PlayerActor): boolean {
  return player.equipment.weapon !== undefined && specialAttackOf(player.equipment.weapon)?.instantEffect === 'powerOfDeath'
}

/** scim: melee damage factor while Power of Death is active. */
export function powerOfDeathFactor(player: PlayerActor, tick: number): number {
  return tick < (player.powerOfDeathUntilTick ?? 0) && hasPowerOfDeathWeapon(player) ? 0.5 : 1
}

/** scim: taking damage without the staff equipped ends Power of Death. */
export function notePlayerDamage(player: PlayerActor, damage: number): void {
  if (damage > 0 && !hasPowerOfDeathWeapon(player)) player.powerOfDeathUntilTick = undefined
}

// --- drains / defeat --------------------------------------------------------------


function percentDrain(level: number, alreadyDrained: number, percent: number): number {
  return Math.floor((Math.max(0, level - alreadyDrained) * percent) / 100)
}

/** scim: set the defence drain, respecting a drain floor. */
function setDefenceDrain(npc: NpcActor, value: number): void {
  npc.debuffs ??= {}
  const floor = npc.defenceDrainFloor
  npc.debuffs.defenceDrain = floor === undefined ? value : Math.min(value, Math.max(0, npc.formulaStats.levels.defence - floor))
}

/** scim: an NPC dies. */
export function markNpcDead(npc: NpcActor, tick: number): void {
  npc.alive = false
  npc.despawnTick ??= tick
  if (npc.combat.retaliation) {
    npc.combat.retaliation.pending = []
    npc.combat.retaliation.lastIncomingAttackTick = null
  }
  clearBurns(npc)
  clearPoison(npc)
}

/** scim: effects that apply on an accurate 0-damage hit. */
export function appliesOnAccurateZero(e: PostHitEffect): boolean {
  return e.effect === 'drain_attack' || e.effect === 'freeze' || e.effect === 'weaken' || e.effect === 'condemn'
}

/** scim: apply special/spell effects ('on-hit' after landing, 'on-fire' at launch). */
export function applyPostHitEffects(
  player: PlayerActor,
  target: NpcActor,
  damage: number,
  effects: readonly PostHitEffect[],
  tick: number,
  phase: 'on-hit' | 'on-fire',
): void {
  target.debuffs ??= {}
  const d = target.debuffs
  const lv = target.formulaStats.levels
  for (const e of effects) {
    switch (e.effect) {
      case 'weaken': {
        const pct = target.formulaStats.attributes.includes('demon') ? 15 : 5
        d.attackDrain = (d.attackDrain ?? 0) + Math.floor((lv.attack * pct) / 100) + 1
        d.strengthDrain = (d.strengthDrain ?? 0) + Math.floor((lv.strength * pct) / 100) + 1
        setDefenceDrain(target, (d.defenceDrain ?? 0) + Math.floor((lv.defence * pct) / 100) + 1)
        break
      }
      case 'condemn':
        setDefenceDrain(target, Math.max(d.defenceDrain ?? 0, Math.floor((lv.defence * 15) / 100)))
        d.magicDrain = Math.max(d.magicDrain ?? 0, Math.floor((lv.magic * 15) / 100))
        break
      case 'heal_hp': {
        const heal = Math.max(e.minimumHeal ?? 10, Math.floor((damage * e.percentOfDamage) / 100))
        player.vitals.hp = Math.min(player.vitals.maxHp, player.vitals.hp + heal)
        player.stats.hitpoints.current = player.vitals.hp
        break
      }
      case 'restore_prayer': {
        const pts = Math.max(5, Math.floor((damage * e.percentOfDamage) / 100))
        player.prayerState.points = Math.min(player.prayerState.maxPoints, player.prayerState.points + pts)
        player.stats.prayer.current = player.prayerState.points
        break
      }
      case 'drain_defence':
        if (e.flat) setDefenceDrain(target, (d.defenceDrain ?? 0) + damage)
        else if (e.percent) setDefenceDrain(target, (d.defenceDrain ?? 0) + percentDrain(lv.defence, d.defenceDrain ?? 0, e.percent))
        break
      case 'drain_magic':
        d.magicDrain = (d.magicDrain ?? 0) + e.base + Math.floor((damage * e.percentOfDamage) / 100)
        break
      case 'drain_attack':
        if (d.attackDrain) break
        d.attackDrain = percentDrain(lv.attack, 0, e.percent)
        break
      case 'poison':
        poisonNpc({ target, sourceId: player.id, severity: e.severity, tick })
        break
      case 'freeze': {
        if (isFreezeImmune(target, tick)) break
        const res = target.formulaStats.freezeResistance
        const dur = Math.floor((e.durationTicks * Math.max(0, 100 - res)) / 100)
        if (dur <= 0) break
        d.boundFromTick = tick
        d.boundUntilTick = tick + dur
        break
      }
      case 'bind': {
        if (phase === 'on-hit' && isFreezeImmune(target, tick)) break
        const from = tick + (e.delayTicks ?? 0)
        const until = from + e.durationTicks
        const curFrom = d.boundFromTick
        const curUntil = d.boundUntilTick
        const overlaps = curUntil !== undefined && (curFrom ?? 0) <= until && from <= curUntil
        d.boundFromTick = overlaps ? Math.min(curFrom ?? 0, from) : from
        d.boundUntilTick = overlaps ? Math.max(curUntil!, until) : until
        break
      }
      case 'burn':
        addBurnStack({
          target,
          sourceId: player.id,
          origin: 'special-attack',
          severity: e.severity,
          pulses: e.pulses,
          tick,
          firstPulseDelayTicks: e.firstPulseDelayTicks,
        })
        break
    }
  }
}
