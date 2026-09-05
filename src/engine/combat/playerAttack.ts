import type { Loadout } from '../Loadout'
import type { Npc } from '../Npc'
import type { Player } from '../Player'
import type { World } from '../World'
import { attackRoll, effectiveLevel, hitChance, npcDefenceRoll, npcMagicDefenceRoll, rangedMaxHit, rollDamage, twistedBowMultipliers } from './formulas'

export interface PlayerHitResult {
  hit: boolean
  damage: number
  maxHit: number
  accuracy: number
}

/**
 * Resolve one player ranged attack against an NPC. Blowpipe darts, the
 * twisted bow's magic scaling and standard bolts/arrows are covered; special
 * attacks are not yet.
 */
export function resolveRangedAttack(world: World, player: Player, loadout: Loadout, npc: Npc): PlayerHitResult {
  const prayers = player.prayers
  const voidRanged = false
  const effAttack = effectiveLevel({
    level: player.levels.ranged,
    boost: player.boosts.ranged,
    prayerMultiplier: prayers.multiplier('rangedAttack'),
    styleBonus: loadout.weapon.styleBonus,
    voidMultiplier: voidRanged ? 1.1 : 1,
  })
  const effStrength = effectiveLevel({
    level: player.levels.ranged,
    boost: player.boosts.ranged,
    prayerMultiplier: prayers.multiplier('rangedStrength'),
    styleBonus: loadout.weapon.styleBonus,
    voidMultiplier: voidRanged ? 1.125 : 1,
  })
  let accuracyMult = 1
  let damageMult = 1
  if (loadout.weapon.special === 'twistedBow') {
    const m = twistedBowMultipliers(npc.def.levels.magic, npc.def.offensive.magicAttack)
    accuracyMult = m.accuracy
    damageMult = m.damage
  }
  const maxHit = rangedMaxHit(effStrength, loadout.bonuses.rangedStrength, damageMult)
  const attack = attackRoll(effAttack, loadout.bonuses.rangedAttack, accuracyMult)
  const defence = npcDefenceRoll(npc.def.levels.defence, npc.def.defensive.ranged)
  const accuracy = hitChance(attack, defence)
  const hit = world.rng.next() < accuracy
  const damage = hit ? rollDamage(maxHit, () => world.rng.next()) : 0
  return { hit, damage, maxHit, accuracy }
}

/** Magic defence roll helper exposed for spells later. */
export function npcMagicDefence(npc: Npc): number {
  return npcMagicDefenceRoll(npc.def.levels.magic, npc.def.defensive.magic)
}
