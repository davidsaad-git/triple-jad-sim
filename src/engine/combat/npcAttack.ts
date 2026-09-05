import type { AttackStyle, MonsterDef } from '../../data/inferno/monsters'
import type { Player } from '../Player'
import type { World } from '../World'
import { attackRoll, defenceRoll, effectiveLevel, hitChance, npcEffectiveLevel, npcMaxHit, rollDamage } from './formulas'

export interface NpcHitResult {
  style: AttackStyle
  /** Damage before prayer; 0 when the accuracy roll failed. */
  rolled: number
  /** Damage after protection prayers. */
  dealt: number
  hit: boolean
  prayed: boolean
}

/** Which overhead fully blocks a monster style. */
export function protectingPrayerFor(style: AttackStyle): 'protectFromMelee' | 'protectFromMissiles' | 'protectFromMagic' | null {
  switch (style) {
    case 'stab':
    case 'slash':
    case 'crush':
      return 'protectFromMelee'
    case 'ranged':
      return 'protectFromMissiles'
    case 'magic':
      return 'protectFromMagic'
    default:
      return null
  }
}

function playerDefenceRollFor(player: Player, style: AttackStyle): number {
  const b = player.bonuses
  const prayers = player.prayers
  if (style === 'magic') {
    // 70% magic + 30% defence, magic defence bonus.
    const magic = effectiveLevel({ level: player.levels.magic, boost: player.boosts.magic, prayerMultiplier: prayers.multiplier('magicAttack'), styleBonus: 0, voidMultiplier: 1 })
    const def = effectiveLevel({ level: player.levels.defence, boost: player.boosts.defence, prayerMultiplier: prayers.multiplier('defence'), styleBonus: 0, voidMultiplier: 1 })
    const eff = Math.floor(magic * 0.7) + Math.floor(def * 0.3)
    return defenceRoll(eff, b.magicDefence)
  }
  const eff = effectiveLevel({ level: player.levels.defence, boost: player.boosts.defence, prayerMultiplier: prayers.multiplier('defence'), styleBonus: 0, voidMultiplier: 1 })
  const bonus = style === 'stab' ? b.stabDefence : style === 'slash' ? b.slashDefence : style === 'crush' ? b.crushDefence : style === 'ranged' ? b.rangedDefence : 0
  return defenceRoll(eff, bonus)
}

function npcAttackRollFor(def: MonsterDef, style: AttackStyle): number {
  const l = def.levels
  const o = def.offensive
  if (style === 'magic') return attackRoll(npcEffectiveLevel(l.magic), o.magicAttack)
  if (style === 'ranged') return attackRoll(npcEffectiveLevel(l.ranged), o.rangedAttack)
  return attackRoll(npcEffectiveLevel(l.attack), o.attack)
}

export function npcMaxHitFor(def: MonsterDef, style: AttackStyle): number {
  const l = def.levels
  const o = def.offensive
  if (style === 'magic') return npcMaxHit(l.magic, o.magicDamage)
  if (style === 'ranged') return npcMaxHit(l.ranged, o.rangedStrength)
  return npcMaxHit(l.strength, o.strength)
}

/**
 * Resolve a standard NPC attack on the player at the moment it lands:
 * accuracy roll, damage roll, and protection prayer (which fully blocks NPC
 * attacks of the matching style).
 */
export function resolveNpcAttack(world: World, def: MonsterDef, style: AttackStyle, player: Player, options: { alwaysHit?: boolean; maxHitOverride?: number } = {}): NpcHitResult {
  const prayer = protectingPrayerFor(style)
  const prayed = prayer !== null && player.prayers.active.has(prayer)
  const maxHit = options.maxHitOverride ?? npcMaxHitFor(def, style)
  const hit = options.alwaysHit ? true : world.rng.next() < hitChance(npcAttackRollFor(def, style), playerDefenceRollFor(player, style))
  const rolled = hit ? rollDamage(maxHit, () => world.rng.next()) : 0
  const dealt = prayed ? 0 : rolled
  return { style, rolled, dealt, hit, prayed }
}
