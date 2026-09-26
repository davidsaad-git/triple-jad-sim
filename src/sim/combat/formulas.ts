/**
 * Combat formulas. Levels are multiplied by prayer
 * multipliers as JS doubles in scim's operation order (e.g.
 * floor(100 * 1.15) = 114), so results stay bit-identical to scim.
 */
import type { EquipmentStats, PrayerId } from '../api'
import type { RandomFn } from '../core/rng'
import type { NpcActor, NpcFormulaStats, PlayerActor } from '../core/types'
import { NEUTRAL_MULTIPLIERS, prayerMultipliers, type PrayerMultipliers } from '../data/prayers'
import { emptyEquipmentStats } from '../items/itemStats'
import type { FormulaStyle } from './types'
import { stanceOf, type Stance } from './weaponCategories'

export type VoidSet = 'none' | 'melee' | 'ranged' | 'magic' | 'elite_ranged' | 'elite_magic'

export interface PlayerLevels {
  attack: number
  strength: number
  defence: number
  ranged: number
  magic: number
}

export interface PlayerFormulaView {
  kind: 'player'
  levels: PlayerLevels
  stance: Stance
  voidSet?: VoidSet
  /** Eclipse atlatl: strength level used as the ranged-strength level. */
  rangedStrengthLevel?: number
  magicBaseMaxHit?: number
}

export interface NpcFormulaView extends NpcFormulaStats {
  kind: 'npc'
  id: number
}

// --- player effective levels ---------------------------------------------------


export function effectiveMeleeAttack(p: PlayerFormulaView, pm: PrayerMultipliers): number {
  const lvl = Math.floor(p.levels.attack * pm.attack)
  const stance = p.stance === 'Accurate' ? 3 : p.stance === 'Controlled' ? 1 : 0
  const v = p.voidSet === 'melee' ? 1.1 : 1
  return Math.floor((lvl + stance + 8) * v)
}


export function effectiveMeleeStrength(p: PlayerFormulaView, pm: PrayerMultipliers): number {
  const lvl = Math.floor(p.levels.strength * pm.strength)
  const stance = p.stance === 'Aggressive' ? 3 : p.stance === 'Controlled' ? 1 : 0
  const v = p.voidSet === 'melee' ? 1.1 : 1
  return Math.floor((lvl + stance + 8) * v)
}


export function effectiveRangedAttack(p: PlayerFormulaView, pm: PrayerMultipliers): number {
  const lvl = Math.floor(p.levels.ranged * pm.ranged)
  const stance = p.stance === 'Accurate' ? 3 : 0
  const v = p.voidSet === 'ranged' || p.voidSet === 'elite_ranged' ? 1.1 : 1
  return Math.floor((lvl + stance + 8) * v)
}


export function effectiveRangedStrength(p: PlayerFormulaView, pm: PrayerMultipliers): number {
  const lvl = Math.floor((p.rangedStrengthLevel ?? p.levels.ranged) * pm.rangedStrength)
  const stance = p.stance === 'Accurate' ? 3 : 0
  const v = p.voidSet === 'elite_ranged' ? 1.125 : p.voidSet === 'ranged' ? 1.1 : 1
  return Math.floor((lvl + stance + 8) * v)
}


export function effectiveMagicAttack(p: PlayerFormulaView, pm: PrayerMultipliers): number {
  const lvl = Math.floor(p.levels.magic * pm.magic)
  const stance = p.stance === 'Accurate' ? 3 : p.stance === 'Longrange' ? 1 : 0
  const v = p.voidSet === 'magic' || p.voidSet === 'elite_magic' ? 1.45 : 1
  return Math.floor(lvl * v + stance + 8)
}


export function defenceStanceBonus(stance: Stance): number {
  return stance === 'Defensive' || stance === 'Longrange' ? 3 : stance === 'Controlled' ? 1 : 0
}


export function effectiveDefence(p: PlayerFormulaView, pm: PrayerMultipliers): number {
  return Math.floor(p.levels.defence * pm.defence) + defenceStanceBonus(p.stance) + 8
}


export function effectiveMagicDefence(p: PlayerFormulaView, pm: PrayerMultipliers): number {
  const mag = Math.floor(p.levels.magic * pm.magic)
  const def = Math.floor(p.levels.defence * pm.defence)
  return Math.floor((mag * 7) / 10) + Math.floor((def * 3) / 10) + defenceStanceBonus(p.stance) + 8
}

// --- hit chance ------------------------------------------------------------------


export function hitChance(attackRoll: number, defenceRoll: number): number {
  return attackRoll > defenceRoll ? 1 - (defenceRoll + 2) / (2 * (attackRoll + 1)) : attackRoll / (2 * (defenceRoll + 1))
}

/** scim: double-roll accuracy (Confliction gauntlets). */
export function doubleRollHitChance(attackRoll: number, defenceRoll: number): number {
  return attackRoll >= defenceRoll
    ? 1 - ((defenceRoll + 2) * (2 * defenceRoll + 3)) / (6 * (attackRoll + 1) ** 2)
    : (attackRoll * (4 * attackRoll + 5)) / (6 * (attackRoll + 1) * (defenceRoll + 1))
}

/** scim: steady-state accuracy mixing single and double rolls. */
export function steadyStateHitChance(single: number, double: number): number {
  if (single === 1) return 1
  const q = (1 - single) / (double + 1 - single)
  return (1 - q) * single + q * double
}

// --- rolls -----------------------------------------------------------------------

/** scim: player attack roll. */
export function playerAttackRoll(p: PlayerFormulaView, style: FormulaStyle, eq: EquipmentStats, pm: PrayerMultipliers): number {
  switch (style) {
    case 'melee_stab':
      return Math.floor(effectiveMeleeAttack(p, pm) * (eq.attackStab + 64))
    case 'melee_slash':
      return Math.floor(effectiveMeleeAttack(p, pm) * (eq.attackSlash + 64))
    case 'melee_crush':
      return Math.floor(effectiveMeleeAttack(p, pm) * (eq.attackCrush + 64))
    case 'ranged':
      return Math.floor(effectiveRangedAttack(p, pm) * (eq.attackRanged + 64))
    case 'magic':
      return Math.floor(effectiveMagicAttack(p, pm) * (eq.attackMagic + 64))
  }
}

/** scim: NPC attack roll (no stance, no +8). */
export function npcAttackRoll(n: NpcFormulaView, style: FormulaStyle): number {
  switch (style) {
    case 'melee_stab':
    case 'melee_slash':
    case 'melee_crush':
      return Math.floor((n.levels.attack + 9) * (n.offensive.atk + 64))
    case 'ranged':
      return Math.floor((n.levels.ranged + 9) * (n.offensive.ranged + 64))
    case 'magic':
      return Math.floor((n.levels.magic + 9) * (n.offensive.magic + 64))
  }
}

function playerDefenceBonus(style: FormulaStyle, eq: EquipmentStats): number {
  switch (style) {
    case 'melee_stab':
      return eq.defenceStab
    case 'melee_slash':
      return eq.defenceSlash
    case 'melee_crush':
      return eq.defenceCrush
    case 'ranged':
      return eq.defenceRanged
    case 'magic':
      return eq.defenceMagic
  }
}

/** scim: player defence roll. */
export function playerDefenceRoll(p: PlayerFormulaView, style: FormulaStyle, eq: EquipmentStats, pm: PrayerMultipliers): number {
  const eff = style === 'magic' ? effectiveMagicDefence(p, pm) : effectiveDefence(p, pm)
  return Math.floor(eff * (playerDefenceBonus(style, eq) + 64))
}

function npcDefenceBonus(style: FormulaStyle, d: NpcFormulaStats['defensive']): number {
  switch (style) {
    case 'melee_stab':
      return d.stab
    case 'melee_slash':
      return d.slash
    case 'melee_crush':
      return d.crush
    case 'ranged':
      return d.ranged
    case 'magic':
      return d.magic
  }
}

/** scim: NPC defence roll (magic level for magic, defence level otherwise). */
export function npcDefenceRoll(n: NpcFormulaView, style: FormulaStyle): number {
  const lvl = style === 'magic' ? n.levels.magic : n.levels.defence
  return Math.floor((lvl + 9) * (npcDefenceBonus(style, n.defensive) + 64))
}

// --- max hits --------------------------------------------------------------------


export function baseMaxHit(effectiveStrength: number, strengthBonus: number): number {
  return Math.floor((effectiveStrength * (strengthBonus + 64) + 320) / 640)
}

/** scim: NPC max hit (only when the plan has none). */
export function npcMaxHit(n: NpcFormulaView, style: FormulaStyle): number {
  switch (style) {
    case 'melee_stab':
    case 'melee_slash':
    case 'melee_crush':
      return baseMaxHit(n.levels.strength + 9, n.offensive.str)
    case 'ranged':
      return baseMaxHit(n.levels.ranged + 9, n.offensive.rangedStr)
    case 'magic':
      return baseMaxHit(n.levels.magic + 9, n.offensive.magicStr)
  }
}

/** scim: player max hit. Magic: base * (1 + dmg% + (prayer-1) + elite) left to right. */
export function playerMaxHit(p: PlayerFormulaView, style: FormulaStyle, eq: EquipmentStats, pm: PrayerMultipliers): number {
  switch (style) {
    case 'melee_stab':
    case 'melee_slash':
    case 'melee_crush':
      return baseMaxHit(effectiveMeleeStrength(p, pm), eq.meleeStrength)
    case 'ranged':
      return baseMaxHit(effectiveRangedStrength(p, pm), eq.rangedStrength)
    case 'magic': {
      const base = Math.floor(p.magicBaseMaxHit ?? 0)
      const dmg = eq.magicDamage / 100
      const prayer = pm.magicDamage - 1
      const elite = p.voidSet === 'elite_magic' ? 0.05 : 0
      return Math.floor(base * (1 + dmg + prayer + elite))
    }
  }
}

/** scim: player vs NPC rolls. */
export function playerVsNpcRolls(
  p: PlayerFormulaView,
  n: NpcFormulaView,
  style: FormulaStyle,
  eq: EquipmentStats,
  pm: PrayerMultipliers = NEUTRAL_MULTIPLIERS,
  defenceStyle: FormulaStyle = style,
): { attackRoll: number; defenceRoll: number; chance: number } {
  const attackRoll = playerAttackRoll(p, style, eq, pm)
  const defenceRoll = npcDefenceRoll(n, defenceStyle)
  return { attackRoll, defenceRoll, chance: hitChance(attackRoll, defenceRoll) }
}

// --- NPC attack resolution -------------------------------------------------------

/** scim: NPC formula view with debuff drains. */
export function npcFormulaView(npc: NpcActor): NpcFormulaView {
  const s = npc.formulaStats
  const d = npc.debuffs
  return {
    kind: 'npc',
    id: npc.npcTypeId,
    ...s,
    levels: {
      ...s.levels,
      attack: Math.max(0, s.levels.attack - (d?.attackDrain ?? 0)),
      strength: Math.max(0, s.levels.strength - (d?.strengthDrain ?? 0)),
      magic: Math.max(0, s.levels.magic - (d?.magicDrain ?? 0)),
      defence: Math.max(0, s.levels.defence - (d?.defenceDrain ?? 0)),
    },
  }
}

/** scim: player view (current levels + stance). */
export function playerFormulaView(player: PlayerActor): PlayerFormulaView {
  return {
    kind: 'player',
    levels: {
      attack: player.stats.attack.current,
      strength: player.stats.strength.current,
      defence: player.stats.defence.current,
      ranged: player.stats.ranged.current,
      magic: player.stats.magic.current,
    },
    stance: stanceOf(player),
  }
}

export interface NpcRollResult {
  accuracy: number
  accuracySucceeded: boolean
  maxHit: number
  rolledDamage: number
}

/** scim: accuracy then damage, always exactly two draws. */
export function rollNpcAttack(args: {
  attacker: NpcFormulaView
  target: PlayerFormulaView | NpcFormulaView
  targetEquipmentStats?: EquipmentStats
  targetPrayerMultipliers?: PrayerMultipliers
  style: FormulaStyle
  random: RandomFn
  maxHitOverride?: number
}): NpcRollResult {
  const eq = args.targetEquipmentStats ?? emptyEquipmentStats()
  const pm = args.targetPrayerMultipliers ?? NEUTRAL_MULTIPLIERS
  const atk = npcAttackRoll(args.attacker, args.style)
  const def = args.target.kind === 'player' ? playerDefenceRoll(args.target, args.style, eq, pm) : npcDefenceRoll(args.target, args.style)
  const accuracy = hitChance(atk, def)
  const maxHit = args.maxHitOverride ?? npcMaxHit(args.attacker, args.style)
  const accuracySucceeded = args.random() < accuracy
  const rolledDamage = Math.floor(args.random() * (Math.max(0, Math.trunc(maxHit)) + 1))
  return { accuracy, accuracySucceeded, maxHit, rolledDamage }
}

/** Player defence against an NPC style, as used by (current levels, stance, both prayer slots). */
export function npcRollVsPlayer(attacker: NpcActor, player: PlayerActor, style: FormulaStyle, random: RandomFn, maxHit?: number): NpcRollResult {
  return rollNpcAttack({
    attacker: npcFormulaView(attacker),
    target: playerFormulaView(player),
    targetEquipmentStats: player.equipmentStats,
    targetPrayerMultipliers: prayerMultipliers(player.activePrayer as PrayerId | null, player.offensivePrayer),
    style,
    random,
    ...(maxHit === undefined ? {} : { maxHitOverride: maxHit }),
  })
}

/** scim: Chebyshev distance from the attacker's centre tile to the target's SW tile. */
export function centreDistance(attacker: { position: readonly [number, number]; size: number }, target: { position: readonly [number, number] }): number {
  const cx = attacker.position[0] + Math.floor(attacker.size / 2)
  const cy = attacker.position[1] + Math.floor(attacker.size / 2)
  return Math.max(Math.abs(cx - target.position[0]), Math.abs(cy - target.position[1]))
}
