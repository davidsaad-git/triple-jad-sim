/**
 * The 29-prayer book and its availability /
 * filtering rules (/`T2`/`E2`/`D2`/`ahe`).
 * Only prayers with an engine id do anything; the rest are drawn disabled.
 */
import type { PrayerId } from '../../../sim/api'
import type { PrayerFilterOptions } from '../clientState'

export interface PrayerBookEntry {
  icon: string
  label: string
  level: number
  prayer?: PrayerId
  defenceLevel?: number
  tierGroup?: string
  successor?: string
  healing?: boolean
  upgrade?: { icon: string; label: string; level: number; prayer: PrayerId }
}

export const PRAYER_BOOK: readonly PrayerBookEntry[] = [
  { icon: 'thick_skin', label: 'Thick Skin', level: 1, tierGroup: 'defence', successor: 'rock_skin' },
  { icon: 'burst_of_strength', label: 'Burst of Strength', level: 4, tierGroup: 'strength', successor: 'superhuman_strength' },
  { icon: 'clarity_of_thought', label: 'Clarity of Thought', level: 7, tierGroup: 'attack', successor: 'improved_reflexes' },
  { icon: 'sharp_eye', label: 'Sharp Eye', level: 8, tierGroup: 'ranged', successor: 'hawk_eye' },
  { icon: 'mystic_will', label: 'Mystic Will', level: 9, tierGroup: 'magic', successor: 'mystic_lore' },
  { icon: 'rock_skin', label: 'Rock Skin', level: 10, tierGroup: 'defence', successor: 'steel_skin' },
  { icon: 'superhuman_strength', label: 'Superhuman Strength', level: 13, tierGroup: 'strength', successor: 'ultimate_strength' },
  { icon: 'improved_reflexes', label: 'Improved Reflexes', level: 16, tierGroup: 'attack', successor: 'incredible_reflexes' },
  { icon: 'rapid_restore', label: 'Rapid Restore', level: 19, healing: true },
  { icon: 'rapid_heal', label: 'Rapid Heal', level: 22, healing: true },
  { icon: 'protect_item', label: 'Protect Item', level: 25 },
  { icon: 'hawk_eye', label: 'Hawk Eye', level: 26, tierGroup: 'ranged', successor: 'eagle_eye' },
  { icon: 'mystic_lore', label: 'Mystic Lore', level: 27, tierGroup: 'magic', successor: 'mystic_might' },
  { icon: 'steel_skin', label: 'Steel Skin', level: 28, tierGroup: 'defence', successor: 'chivalry' },
  { icon: 'ultimate_strength', label: 'Ultimate Strength', level: 31, tierGroup: 'strength', successor: 'chivalry' },
  { icon: 'incredible_reflexes', label: 'Incredible Reflexes', level: 34, tierGroup: 'attack', successor: 'chivalry' },
  { icon: 'protect_from_magic', label: 'Protect from Magic', level: 37, prayer: 'ProtectMagic' },
  { icon: 'protect_from_missiles', label: 'Protect from Missiles', level: 40, prayer: 'ProtectRange' },
  { icon: 'protect_from_melee', label: 'Protect from Melee', level: 43, prayer: 'ProtectMelee' },
  { icon: 'eagle_eye', label: 'Eagle Eye', level: 44, prayer: 'EagleEye', tierGroup: 'ranged', successor: 'rigour', upgrade: { icon: 'deadeye', label: 'Deadeye', level: 62, prayer: 'Deadeye' } },
  { icon: 'mystic_might', label: 'Mystic Might', level: 45, prayer: 'MysticMight', tierGroup: 'magic', successor: 'augury', upgrade: { icon: 'mystic_vigour', label: 'Mystic Vigour', level: 63, prayer: 'MysticVigour' } },
  { icon: 'retribution', label: 'Retribution', level: 46 },
  { icon: 'redemption', label: 'Redemption', level: 49, prayer: 'Redemption' },
  { icon: 'smite', label: 'Smite', level: 52 },
  { icon: 'preserve', label: 'Preserve', level: 55, prayer: 'Preserve' },
  { icon: 'chivalry', label: 'Chivalry', level: 60, tierGroup: 'melee-combined', successor: 'piety', defenceLevel: 65 },
  { icon: 'piety', label: 'Piety', level: 70, prayer: 'Piety', tierGroup: 'melee-combined', defenceLevel: 70 },
  { icon: 'rigour', label: 'Rigour', level: 74, prayer: 'Rigour', tierGroup: 'ranged-combined', defenceLevel: 70 },
  { icon: 'augury', label: 'Augury', level: 77, prayer: 'Augury', tierGroup: 'magic-combined', defenceLevel: 70 },
]

const BY_ICON: ReadonlyMap<string, PrayerBookEntry> = new Map(PRAYER_BOOK.map((e) => [e.icon, e]))

export interface Availability {
  basePrayerLevel: number
  baseDefenceLevel: number
}

export const MAX_AVAILABILITY: Availability = { basePrayerLevel: 99, baseDefenceLevel: 99 }

const hasLevel = (e: { level: number }, a: Availability): boolean => a.basePrayerLevel >= e.level
const hasReqs = (e: { defenceLevel?: number }, a: Availability): boolean => a.baseDefenceLevel >= (e.defenceLevel ?? 1)
const usable = (e: PrayerBookEntry, a: Availability): boolean => hasLevel(e, a) && hasReqs(e, a)

export interface DisplayedPrayer extends PrayerBookEntry {
  displayIcon: string
  basePrayer?: PrayerId
  available: boolean
}

/** Book entries as displayed: upgrades swap icon/label/prayer when the base level allows. */
export function displayedPrayers(entries: readonly PrayerBookEntry[], a: Availability, upgraded = true): DisplayedPrayer[] {
  return entries.map((e) => {
    const up = e.upgrade
    if (up === undefined || !upgraded || a.basePrayerLevel < up.level) {
      return { ...e, displayIcon: e.icon, ...(e.prayer ? { basePrayer: e.prayer } : {}), available: usable(e, a) }
    }
    return { ...e, displayIcon: up.icon, label: up.label, prayer: up.prayer, ...(e.prayer ? { basePrayer: e.prayer } : {}), available: hasReqs(e, a) }
  })
}

/** Order the book by a saved icon order (unknown icons keep their book order after known ones; scim). */
export function orderedBook(order: readonly string[] | null): PrayerBookEntry[] {
  if (!order) return [...PRAYER_BOOK]
  const pos = new Map(order.map((icon, i) => [icon, i]))
  return [...PRAYER_BOOK].sort((a, b) => {
    const ia = pos.get(a.icon)
    const ib = pos.get(b.icon)
    if (ia !== undefined && ib !== undefined) return ia - ib
    if (ia === undefined && ib === undefined) return PRAYER_BOOK.indexOf(a) - PRAYER_BOOK.indexOf(b)
    return ia === undefined ? 1 : -1
  })
}

/** Filter-mode visibility of one entry. */
export function passesPrayerFilters(e: PrayerBookEntry, f: PrayerFilterOptions, a: Availability): boolean {
  const next = e.successor === undefined ? undefined : BY_ICON.get(e.successor)
  if (next && !f.showLowerTiers && (!f.showTieredOverMultiskill || next.tierGroup === e.tierGroup) && usable(next, a)) return false
  if (!f.showRapidHealing && e.healing) return false
  if (!f.showLackLevel && !hasLevel(e, a)) return false
  if (!f.showLackRequirements && !hasReqs(e, a)) return false
  return true
}

/** Book entries shown in the grid: reorder mode shows everything. */
export function visiblePrayers(ordered: readonly PrayerBookEntry[], hidden: ReadonlySet<string>, f: PrayerFilterOptions, filtering: boolean, reordering: boolean, a: Availability): PrayerBookEntry[] {
  if (reordering) return [...ordered]
  const shown = ordered.filter((e) => !hidden.has(e.icon))
  return filtering ? shown.filter((e) => passesPrayerFilters(e, f, a)) : shown
}

/** Quick-prayer selections mapped through upgrades and availability. */
export function effectiveQuickPrayers(selections: readonly PrayerId[], a: Availability, upgraded = true): PrayerId[] {
  const shown = displayedPrayers(PRAYER_BOOK, a, upgraded)
  const toBase = new Map<PrayerId, PrayerId>()
  for (const e of PRAYER_BOOK) {
    if (e.prayer === undefined) continue
    toBase.set(e.prayer, e.prayer)
    if (e.upgrade) toBase.set(e.upgrade.prayer, e.prayer)
  }
  const toShown = new Map<PrayerId, PrayerId>()
  for (const e of shown) if (e.basePrayer !== undefined && e.prayer !== undefined && e.basePrayer !== e.prayer) toShown.set(e.basePrayer, e.prayer)
  const allowed = new Set(shown.flatMap((e) => (e.prayer !== undefined && e.available ? [e.prayer] : [])))
  return [...new Set(selections.map((p) => toShown.get(toBase.get(p) ?? p) ?? toBase.get(p) ?? p))].filter((p) => allowed.has(p))
}
