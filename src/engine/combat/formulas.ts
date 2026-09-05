/**
 * OSRS combat formulas (wiki: Damage per second/Melee, /Ranged, /Magic;
 * Maximum ranged hit; Maximum magic hit; Twisted bow). Pure functions so
 * they can be unit-tested against known values.
 */

export type CombatStyleBonus = 'accurate' | 'aggressive' | 'controlled' | 'defensive' | 'rapid' | 'longrange' | 'none'

export interface EffectiveLevelInput {
  level: number
  boost: number
  /** e.g. 1.2 for Rigour accuracy; 1 for none. */
  prayerMultiplier: number
  /** +3 accurate/aggressive, +1 controlled, 0 rapid, +3 defensive (for defence). */
  styleBonus: number
  /** e.g. 1.1 for void, 1.125 elite ranged void strength, 1.45 magic void accuracy. */
  voidMultiplier: number
}

export function effectiveLevel(i: EffectiveLevelInput): number {
  const base = Math.floor((i.level + i.boost) * i.prayerMultiplier)
  const withStyle = base + i.styleBonus + 8
  return Math.floor(withStyle * i.voidMultiplier)
}

/** Effective level for an NPC: level + 9 (NPCs always get the +1 style bonus). */
export function npcEffectiveLevel(level: number): number {
  return level + 9
}

export function meleeMaxHit(effectiveStrength: number, strengthBonus: number, gearMultiplier = 1): number {
  const base = Math.floor((effectiveStrength * (strengthBonus + 64) + 320) / 640)
  return Math.floor(base * gearMultiplier)
}

export function rangedMaxHit(effectiveRangedStrength: number, rangedStrengthBonus: number, gearMultiplier = 1): number {
  const base = Math.floor(0.5 + (effectiveRangedStrength * (rangedStrengthBonus + 64)) / 640)
  return Math.floor(base * gearMultiplier)
}

/**
 * Magic max hit: base spell damage scaled by the additive percentage bonuses
 * (visible magic damage %, prayer %, void 5%) then by multiplicative gear
 * (slayer helm 1.15 etc.). Each step is floored.
 */
export function magicMaxHit(baseDamage: number, additivePercent: number, multiplicative = 1): number {
  const withAdditive = Math.floor(baseDamage * (1 + additivePercent / 100))
  return Math.floor(withAdditive * multiplicative)
}

/** NPC max hit as the wiki NPC calculator does it (same as melee formula with level + 9). */
export function npcMaxHit(level: number, strengthBonus: number): number {
  return Math.floor((npcEffectiveLevel(level) * (strengthBonus + 64) + 320) / 640)
}

export function attackRoll(effectiveAttack: number, attackBonus: number, gearMultiplier = 1): number {
  return Math.floor(effectiveAttack * (attackBonus + 64) * gearMultiplier)
}

export function defenceRoll(effectiveDefence: number, defenceBonus: number): number {
  return effectiveDefence * (defenceBonus + 64)
}

export function npcDefenceRoll(defenceLevel: number, styleDefenceBonus: number): number {
  return (defenceLevel + 9) * (styleDefenceBonus + 64)
}

export function npcMagicDefenceRoll(magicLevel: number, magicDefenceBonus: number): number {
  return (magicLevel + 9) * (magicDefenceBonus + 64)
}

/** Probability in [0, 1] that an attack roll beats a defence roll. */
export function hitChance(attack: number, defence: number): number {
  if (attack > defence) {
    return 1 - (defence + 2) / (2 * (attack + 1))
  }
  return attack / (2 * (defence + 1))
}

/** Roll damage uniformly in 0..max inclusive using the supplied RNG (0 <= r < 1). */
export function rollDamage(maxHit: number, random: () => number): number {
  return Math.floor(random() * (maxHit + 1))
}

/**
 * Twisted bow accuracy and damage multipliers (Mod Kieren's formula). The
 * target's magic is the higher of its magic level and magic attack bonus,
 * capped at 250 outside the Chambers of Xeric.
 */
export function twistedBowMultipliers(targetMagicLevel: number, targetMagicAccuracy: number, cap = 250): { accuracy: number; damage: number } {
  const m = Math.min(Math.max(targetMagicLevel, targetMagicAccuracy), cap)
  const x = Math.floor((3 * m) / 10)
  const accuracyPercent = clamp(140 + Math.floor((10 * x - 10) / 100) - Math.floor(((x - 100) * (x - 100)) / 100), 0, 140)
  const damagePercent = clamp(250 + Math.floor((10 * x - 14) / 100) - Math.floor(((x - 140) * (x - 140)) / 100), 0, 250)
  return { accuracy: accuracyPercent / 100, damage: damagePercent / 100 }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Player hit delay in ticks for a projectile weapon, from the wiki Hit delay page. */
export function bowHitDelay(distance: number): number {
  return 1 + Math.floor((3 + distance) / 6)
}

export function thrownHitDelay(distance: number): number {
  return 1 + Math.floor(distance / 6)
}

export function spellHitDelay(distance: number): number {
  return 1 + Math.floor((1 + distance) / 3)
}

/** Prayer drain: points are lost when the accumulated drain exceeds 60 + 2 * prayer bonus. */
export function prayerDrainResistance(prayerBonus: number): number {
  return 60 + 2 * prayerBonus
}
