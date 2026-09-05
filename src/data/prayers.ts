/**
 * Prayer book (normal). Drain is in "drain effect" points per tick: a point
 * of prayer is lost each time the accumulated drain exceeds 60 + 2 * bonus.
 */
export type PrayerKey =
  | 'thickSkin' | 'burstOfStrength' | 'clarityOfThought' | 'sharpEye' | 'mysticWill'
  | 'rockSkin' | 'superhumanStrength' | 'improvedReflexes' | 'rapidRestore' | 'rapidHeal'
  | 'protectItem' | 'hawkEye' | 'mysticLore' | 'steelSkin' | 'ultimateStrength'
  | 'incredibleReflexes' | 'protectFromMagic' | 'protectFromMissiles' | 'protectFromMelee'
  | 'eagleEye' | 'mysticMight' | 'retribution' | 'redemption' | 'smite' | 'preserve'
  | 'chivalry' | 'piety' | 'rigour' | 'augury' | 'deadeye' | 'mysticVigour'

export type OverheadKey = 'protectFromMagic' | 'protectFromMissiles' | 'protectFromMelee' | 'retribution' | 'redemption' | 'smite'

export interface PrayerDef {
  key: PrayerKey
  name: string
  level: number
  drain: number
  /** Mutually exclusive groups: only one prayer per group can be active. */
  groups: readonly string[]
  overhead: boolean
  attack?: number
  strength?: number
  defence?: number
  rangedAttack?: number
  rangedStrength?: number
  magicAttack?: number
  magicDamagePercent?: number
}

const P = (
  key: PrayerKey,
  name: string,
  level: number,
  drain: number,
  groups: readonly string[],
  extra: Partial<Omit<PrayerDef, 'key' | 'name' | 'level' | 'drain' | 'groups' | 'overhead'>> = {},
  overhead = false,
): PrayerDef => ({ key, name, level, drain, groups, overhead, ...extra })

export const PRAYERS: readonly PrayerDef[] = [
  P('thickSkin', 'Thick Skin', 1, 3, ['defence'], { defence: 1.05 }),
  P('burstOfStrength', 'Burst of Strength', 4, 3, ['strength', 'ranged', 'magic'], { strength: 1.05 }),
  P('clarityOfThought', 'Clarity of Thought', 7, 3, ['attack', 'ranged', 'magic'], { attack: 1.05 }),
  P('sharpEye', 'Sharp Eye', 8, 3, ['ranged', 'attack', 'strength', 'magic'], { rangedAttack: 1.05, rangedStrength: 1.05 }),
  P('mysticWill', 'Mystic Will', 9, 3, ['magic', 'attack', 'strength', 'ranged'], { magicAttack: 1.05, magicDamagePercent: 1 }),
  P('rockSkin', 'Rock Skin', 10, 6, ['defence'], { defence: 1.1 }),
  P('superhumanStrength', 'Superhuman Strength', 13, 6, ['strength', 'ranged', 'magic'], { strength: 1.1 }),
  P('improvedReflexes', 'Improved Reflexes', 16, 6, ['attack', 'ranged', 'magic'], { attack: 1.1 }),
  P('rapidRestore', 'Rapid Restore', 19, 1, ['restore']),
  P('rapidHeal', 'Rapid Heal', 22, 2, ['heal']),
  P('protectItem', 'Protect Item', 25, 2, ['item']),
  P('hawkEye', 'Hawk Eye', 26, 6, ['ranged', 'attack', 'strength', 'magic'], { rangedAttack: 1.1, rangedStrength: 1.1 }),
  P('mysticLore', 'Mystic Lore', 27, 6, ['magic', 'attack', 'strength', 'ranged'], { magicAttack: 1.1, magicDamagePercent: 2 }),
  P('steelSkin', 'Steel Skin', 28, 12, ['defence'], { defence: 1.15 }),
  P('ultimateStrength', 'Ultimate Strength', 31, 12, ['strength', 'ranged', 'magic'], { strength: 1.15 }),
  P('incredibleReflexes', 'Incredible Reflexes', 34, 12, ['attack', 'ranged', 'magic'], { attack: 1.15 }),
  P('protectFromMagic', 'Protect from Magic', 37, 12, ['overhead'], {}, true),
  P('protectFromMissiles', 'Protect from Missiles', 40, 12, ['overhead'], {}, true),
  P('protectFromMelee', 'Protect from Melee', 43, 12, ['overhead'], {}, true),
  P('eagleEye', 'Eagle Eye', 44, 12, ['ranged', 'attack', 'strength', 'magic'], { rangedAttack: 1.15, rangedStrength: 1.15 }),
  P('mysticMight', 'Mystic Might', 45, 12, ['magic', 'attack', 'strength', 'ranged'], { magicAttack: 1.15, magicDamagePercent: 3 }),
  P('retribution', 'Retribution', 46, 3, ['overhead'], {}, true),
  P('redemption', 'Redemption', 49, 6, ['overhead'], {}, true),
  P('smite', 'Smite', 52, 18, ['overhead'], {}, true),
  P('preserve', 'Preserve', 55, 2, ['preserve']),
  P('chivalry', 'Chivalry', 60, 24, ['attack', 'strength', 'defence', 'ranged', 'magic'], { attack: 1.15, strength: 1.18, defence: 1.2 }),
  P('piety', 'Piety', 70, 24, ['attack', 'strength', 'defence', 'ranged', 'magic'], { attack: 1.2, strength: 1.23, defence: 1.25 }),
  P('rigour', 'Rigour', 74, 24, ['ranged', 'attack', 'strength', 'defence', 'magic'], { rangedAttack: 1.2, rangedStrength: 1.23, defence: 1.25 }),
  P('augury', 'Augury', 77, 24, ['magic', 'attack', 'strength', 'defence', 'ranged'], { magicAttack: 1.25, magicDamagePercent: 4, defence: 1.25 }),
  P('deadeye', 'Deadeye', 62, 24, ['ranged', 'attack', 'strength', 'defence', 'magic'], { rangedAttack: 1.18, rangedStrength: 1.18, defence: 1.18 }),
  P('mysticVigour', 'Mystic Vigour', 63, 24, ['magic', 'attack', 'strength', 'defence', 'ranged'], { magicAttack: 1.18, magicDamagePercent: 3, defence: 1.18 }),
]

export const PRAYER_BY_KEY: Record<PrayerKey, PrayerDef> = Object.fromEntries(PRAYERS.map((p) => [p.key, p])) as Record<PrayerKey, PrayerDef>

export function isOverhead(key: PrayerKey): key is OverheadKey {
  return PRAYER_BY_KEY[key].overhead
}
