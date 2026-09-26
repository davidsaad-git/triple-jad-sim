/**
 * Prayer data (scim: `gm` ids, `_m` groups, `oee` drain effects,
 * `cee` multipliers; names/levels/icons from the prayer book).
 */
import type { PrayerId } from '../api'

export type PrayerCategory = 'protection' | 'offensive' | 'independent'

export interface PrayerMultipliers {
  attack: number
  strength: number
  defence: number
  ranged: number
  rangedStrength: number
  magic: number
  magicDamage: number
}

export interface PrayerInfo {
  id: PrayerId
  name: string
  /** Prayer level needed (base level). */
  level: number
  /** Defence level needed (Piety, Rigour, Augury). */
  defenceLevel?: number
  /** Prayer-book icon name. */
  icon: string
  /** Drain effect per tick; resistance = 2 * prayer bonus + 60. */
  drainRate: number
  category: PrayerCategory
  multipliers?: Partial<PrayerMultipliers>
  /** Deadeye / Mystic Vigour replace this prayer in the book once the level allows (mechanic `upgradedPrayers`). */
  upgradesFrom?: PrayerId
}

export const PRAYERS: readonly PrayerInfo[] = [
  { id: 'ProtectMagic', name: 'Protect from Magic', level: 37, icon: 'protect_from_magic', drainRate: 12, category: 'protection' },
  { id: 'ProtectRange', name: 'Protect from Missiles', level: 40, icon: 'protect_from_missiles', drainRate: 12, category: 'protection' },
  { id: 'ProtectMelee', name: 'Protect from Melee', level: 43, icon: 'protect_from_melee', drainRate: 12, category: 'protection' },
  { id: 'EagleEye', name: 'Eagle Eye', level: 44, icon: 'eagle_eye', drainRate: 12, category: 'offensive', multipliers: { ranged: 1.15, rangedStrength: 1.15 } },
  { id: 'MysticMight', name: 'Mystic Might', level: 45, icon: 'mystic_might', drainRate: 12, category: 'offensive', multipliers: { magic: 1.15, magicDamage: 1.02 } },
  { id: 'Redemption', name: 'Redemption', level: 49, icon: 'redemption', drainRate: 6, category: 'protection' },
  { id: 'Preserve', name: 'Preserve', level: 55, icon: 'preserve', drainRate: 2, category: 'independent' },
  { id: 'Deadeye', name: 'Deadeye', level: 62, icon: 'deadeye', drainRate: 12, category: 'offensive', multipliers: { ranged: 1.18, rangedStrength: 1.18, defence: 1.05 }, upgradesFrom: 'EagleEye' },
  { id: 'MysticVigour', name: 'Mystic Vigour', level: 63, icon: 'mystic_vigour', drainRate: 12, category: 'offensive', multipliers: { magic: 1.18, magicDamage: 1.03, defence: 1.05 }, upgradesFrom: 'MysticMight' },
  { id: 'Piety', name: 'Piety', level: 70, defenceLevel: 70, icon: 'piety', drainRate: 24, category: 'offensive', multipliers: { attack: 1.2, strength: 1.23, defence: 1.25 } },
  { id: 'Rigour', name: 'Rigour', level: 74, defenceLevel: 70, icon: 'rigour', drainRate: 24, category: 'offensive', multipliers: { ranged: 1.2, rangedStrength: 1.23, defence: 1.25 } },
  { id: 'Augury', name: 'Augury', level: 77, defenceLevel: 70, icon: 'augury', drainRate: 24, category: 'offensive', multipliers: { magic: 1.25, defence: 1.25, magicDamage: 1.04 } },
]

export const PRAYER_BY_ID: Readonly<Record<PrayerId, PrayerInfo>> = Object.fromEntries(PRAYERS.map((p) => [p.id, p])) as Record<
  PrayerId,
  PrayerInfo
>


export function prayerCategory(id: PrayerId): PrayerCategory {
  return PRAYER_BY_ID[id].category
}


export function prayerDrainRate(id: PrayerId): number {
  return PRAYER_BY_ID[id].drainRate
}

/** Redemption heal fraction. */
export const REDEMPTION_HEAL_FRACTION = 0.25

/** All-1 multipliers. */
export const NEUTRAL_MULTIPLIERS: Readonly<PrayerMultipliers> = {
  attack: 1,
  strength: 1,
  defence: 1,
  ranged: 1,
  rangedStrength: 1,
  magic: 1,
  magicDamage: 1,
}

/** scim: per-field maximum over the given prayers. */
export function combinePrayerMultipliers(prayers: readonly (PrayerId | null | undefined)[]): PrayerMultipliers {
  let m: PrayerMultipliers = { ...NEUTRAL_MULTIPLIERS }
  for (const p of prayers) {
    if (p == null) continue
    const e = PRAYER_BY_ID[p].multipliers
    if (e === undefined) continue
    m = {
      attack: Math.max(m.attack, e.attack ?? m.attack),
      strength: Math.max(m.strength, e.strength ?? m.strength),
      defence: Math.max(m.defence, e.defence ?? m.defence),
      ranged: Math.max(m.ranged, e.ranged ?? m.ranged),
      rangedStrength: Math.max(m.rangedStrength, e.rangedStrength ?? m.rangedStrength),
      magic: Math.max(m.magic, e.magic ?? m.magic),
      magicDamage: Math.max(m.magicDamage, e.magicDamage ?? m.magicDamage),
    }
  }
  return m
}

/** scim: multipliers from the protection + offensive slots. */
export function prayerMultipliers(activePrayer: PrayerId | null, offensivePrayer: PrayerId | null): PrayerMultipliers {
  return combinePrayerMultipliers([activePrayer, offensivePrayer])
}

/** scim: does `prayer` protect from `style`? */
export function protects(style: string, prayer: PrayerId | null | undefined): boolean {
  if (!prayer) return false
  return (
    (style === 'magic' && prayer === 'ProtectMagic') ||
    (style === 'range' && prayer === 'ProtectRange') ||
    (style === 'melee' && prayer === 'ProtectMelee')
  )
}
