/**
 * Consumable table, names (`SN`), cooldown tracks (/`NJ`) and attack delays
 *. The "fixed" brew/combat/forgotten-brew amounts are computed
 * once with the literal level 99, exactly like scim.
 */
import type { CooldownTracks, SkillName } from '../api'

export type CooldownTrack = 'food' | 'potion' | 'combo_food'

export type PrayerRestoreFormula = 'super_restore' | 'sanfew' | 'prayer_potion'

export type ItemEffect =
  | { op: 'heal'; amount: number }
  | { op: 'heal_formula'; baseAmount: number; scaleStat: SkillName }
  | { op: 'overheal'; amount: number }
  | { op: 'overheal_formula'; scaleStat: SkillName; percent: number; flat: number }
  | { op: 'delayed_heal'; amount: number; delayTicks: number; group?: string }
  | { op: 'boost'; stat: SkillName; amount: number }
  | { op: 'boost_formula'; stat: SkillName; scaleStat: SkillName; percent: number; flat: number }
  | { op: 'drain'; stat: SkillName; amount: number }
  | { op: 'drain_formula'; stat: SkillName; percent: number; flat: number }
  | { op: 'restore_prayer'; amount: number }
  | { op: 'restore_prayer_formula'; formula: PrayerRestoreFormula }
  | { op: 'restore_all_stats' }
  | { op: 'restore_run'; amount: number }
  | { op: 'surge'; percent: number }
  | { op: 'cure_poison'; immunityTicks: number }
  | { op: 'reduce_poison'; amount: number }
  | { op: 'saturated_heart' }
  | { op: 'apply_timed_effect'; effectType: string; durationTicks: number }
  | { op: 'self_damage'; amount: number }
  | { op: 'self_damage_formula'; percent: number; flat: number }

export type ConsumeRule = { type: 'remove' } | { type: 'replace'; withId: number } | { type: 'none' } | { type: 'decrement' }

export interface ConsumableDef {
  track?: CooldownTrack
  delayTicks?: number
  consume: ConsumeRule
  effects: ItemEffect[]
  minHpToUse?: number
  playerGraphic?: number
}

const POTION_DELAY = 3

/** scim: four doses, the last one leaves a vial. */
function potionDoses(ids: readonly [number, number, number, number], effects: () => ItemEffect[], empty = 229): Record<number, ConsumableDef> {
  const [a, b, c, d] = ids
  const def = (next: number): ConsumableDef => ({ track: 'potion', delayTicks: POTION_DELAY, consume: { type: 'replace', withId: next }, effects: effects() })
  return { [a]: def(b), [b]: def(c), [c]: def(d), [d]: def(empty) }
}

/** scim: four doses spaced by `step` ids. */
function doseChain(first: number, step: number, empty: number, effects: () => ItemEffect[]): Record<number, ConsumableDef> {
  return potionDoses([first, first + step, first + step * 2, first + step * 3], effects, empty)
}

function withGraphic(defs: Record<number, ConsumableDef>, graphic: number): Record<number, ConsumableDef> {
  return Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, { ...v, playerGraphic: graphic }]))
}

/** Fixed amounts at level 99 (scim..). */
const COMBAT_BOOST_99 = Math.floor(99 * 0.15) + 5 // 19
const BREW_HEAL_99 = Math.floor(99 * 0.15) + 2 // 16
const BREW_DEF_99 = Math.floor(99 * 0.2) + 2 // 21
const BREW_DRAIN_99 = Math.floor(99 * 0.1) + 2 // 11
const FORGOTTEN_MAGIC_99 = Math.floor(99 * 0.08) + 3 // 10
const FORGOTTEN_PRAYER_99 = Math.floor(99 * 0.1) + 2 // 11
const FORGOTTEN_DRAIN_99 = Math.floor(99 * 0.1) + 2 // 11

const divineCombat = (next: number): ConsumableDef => ({
  track: 'potion',
  delayTicks: 3,
  consume: { type: 'replace', withId: next },
  effects: [
    { op: 'boost', stat: 'attack', amount: COMBAT_BOOST_99 },
    { op: 'boost', stat: 'strength', amount: COMBAT_BOOST_99 },
    { op: 'boost', stat: 'defence', amount: COMBAT_BOOST_99 },
    { op: 'self_damage', amount: 10 },
    { op: 'apply_timed_effect', effectType: 'divine', durationTicks: 500 },
  ],
  minHpToUse: 11,
})


export const CONSUMABLES: Readonly<Record<number, ConsumableDef>> = {
  ...potionDoses([22461, 22464, 22467, 22470], () => [
    { op: 'boost_formula', stat: 'ranged', scaleStat: 'ranged', percent: 0.1, flat: 4 },
    { op: 'boost_formula', stat: 'defence', scaleStat: 'defence', percent: 0.15, flat: 5 },
  ]),
  ...potionDoses([12625, 12627, 12629, 12631], () => [
    { op: 'restore_run', amount: 2000 },
    { op: 'apply_timed_effect', effectType: 'stamina', durationTicks: 200 },
  ]),
  ...potionDoses([30125, 30128, 30131, 30134], () => [{ op: 'apply_timed_effect', effectType: 'prayer_regeneration', durationTicks: 800 }]),
  ...potionDoses([31650, 31653, 31656, 31659], () => [
    { op: 'overheal_formula', scaleStat: 'hitpoints', percent: 0.1, flat: 2 },
    { op: 'boost_formula', stat: 'ranged', scaleStat: 'ranged', percent: 0.1, flat: 4 },
    { op: 'drain_formula', stat: 'attack', percent: 0.1, flat: 2 },
    { op: 'drain_formula', stat: 'strength', percent: 0.1, flat: 2 },
    { op: 'drain_formula', stat: 'defence', percent: 0.1, flat: 2 },
    { op: 'drain_formula', stat: 'magic', percent: 0.1, flat: 2 },
  ]),
  13441: { track: 'food', delayTicks: 3, consume: { type: 'remove' }, effects: [{ op: 'heal_formula', baseAmount: 3, scaleStat: 'hitpoints' }] },
  29143: {
    track: 'food',
    delayTicks: 3,
    consume: { type: 'remove' },
    effects: [
      { op: 'heal', amount: 14 },
      { op: 'delayed_heal', amount: 12, delayTicks: 7, group: 'hunter_meat' },
    ],
  },
  3144: { track: 'combo_food', delayTicks: 3, consume: { type: 'remove' }, effects: [{ op: 'heal', amount: 18 }] },
  27641: { track: 'potion', delayTicks: 0, consume: { type: 'none' }, effects: [{ op: 'saturated_heart' }], playerGraphic: 2287 },
  ...doseChain(10925, 2, 229, () => [{ op: 'restore_all_stats' }, { op: 'restore_prayer_formula', formula: 'sanfew' }, { op: 'cure_poison', immunityTicks: 600 }]),
  ...doseChain(3024, 2, 229, () => [{ op: 'restore_all_stats' }, { op: 'restore_prayer_formula', formula: 'super_restore' }]),
  ...doseChain(6685, 2, 229, () => [
    { op: 'overheal', amount: BREW_HEAL_99 },
    { op: 'boost', stat: 'defence', amount: BREW_DEF_99 },
    { op: 'drain', stat: 'attack', amount: BREW_DRAIN_99 },
    { op: 'drain', stat: 'strength', amount: BREW_DRAIN_99 },
    { op: 'drain', stat: 'magic', amount: BREW_DRAIN_99 },
    { op: 'drain', stat: 'ranged', amount: BREW_DRAIN_99 },
  ]),
  ...doseChain(12695, 2, 229, () => [
    { op: 'boost', stat: 'attack', amount: COMBAT_BOOST_99 },
    { op: 'boost', stat: 'strength', amount: COMBAT_BOOST_99 },
    { op: 'boost', stat: 'defence', amount: COMBAT_BOOST_99 },
  ]),
  23685: divineCombat(23688),
  23688: divineCombat(23691),
  23691: divineCombat(23694),
  23694: divineCombat(229),
  ...doseChain(27629, 3, 229, () => [
    { op: 'boost', stat: 'magic', amount: FORGOTTEN_MAGIC_99 },
    { op: 'restore_prayer', amount: FORGOTTEN_PRAYER_99 },
    { op: 'drain', stat: 'attack', amount: FORGOTTEN_DRAIN_99 },
    { op: 'drain', stat: 'strength', amount: FORGOTTEN_DRAIN_99 },
    { op: 'drain', stat: 'defence', amount: FORGOTTEN_DRAIN_99 },
  ]),
  ...doseChain(4417, 2, 1980, () => [
    { op: 'overheal', amount: 5 },
    { op: 'restore_run', amount: 500 },
    { op: 'reduce_poison', amount: 1 },
  ]),
  ...doseChain(5952, 2, 229, () => [{ op: 'cure_poison', immunityTicks: 1200 }]),
  ...doseChain(31638, 3, 229, () => [
    { op: 'restore_run', amount: 2000 },
    { op: 'apply_timed_effect', effectType: 'stamina', durationTicks: 400 },
  ]),
  ...doseChain(31614, 3, 229, () => [{ op: 'restore_run', amount: 3900 }]),
  ...withGraphic(doseChain(30875, 3, 229, () => [{ op: 'surge', percent: 25 }]), 3232),
  ...potionDoses([2434, 139, 141, 143], () => [{ op: 'restore_prayer_formula', formula: 'prayer_potion' }]),
  29183: { track: 'potion', delayTicks: 3, consume: { type: 'replace', withId: 29201 }, effects: [{ op: 'heal', amount: 8 }] },
  29201: { track: 'potion', delayTicks: 3, consume: { type: 'remove' }, effects: [{ op: 'heal', amount: 8 }] },
  229: { track: 'potion', delayTicks: 0, consume: { type: 'none' }, effects: [] },
  22081: { consume: { type: 'none' }, effects: [{ op: 'self_damage', amount: 10 }] },
  7510: { consume: { type: 'none' }, effects: [{ op: 'self_damage', amount: 1 }], minHpToUse: 3 },
}

/** scim: dwarven rock cake "Guzzle". */
const ROCK_CAKE_GUZZLE: ConsumableDef = { consume: { type: 'none' }, effects: [{ op: 'self_damage_formula', percent: 0.1, flat: 1 }] }


export function consumableDef(itemId: number, option: 'default' | 'guzzle' = 'default'): ConsumableDef | undefined {
  return option === 'guzzle' ? (itemId === 7510 ? ROCK_CAKE_GUZZLE : undefined) : CONSUMABLES[itemId]
}

/** scim: consumable names. */
export const CONSUMABLE_NAMES: Readonly<Record<number, string>> = {
  139: 'Prayer potion(3)', 141: 'Prayer potion(2)', 143: 'Prayer potion(1)', 229: 'Vial', 2434: 'Prayer potion(4)',
  3024: 'Super restore(4)', 3026: 'Super restore(3)', 3028: 'Super restore(2)', 3030: 'Super restore(1)', 3144: 'Cooked karambwan',
  4417: 'Guthix rest(4)', 4419: 'Guthix rest(3)', 4421: 'Guthix rest(2)', 4423: 'Guthix rest(1)', 5952: 'Antidote++(4)',
  5954: 'Antidote++(3)', 5956: 'Antidote++(2)', 5958: 'Antidote++(1)', 6685: 'Saradomin brew(4)', 6687: 'Saradomin brew(3)',
  6689: 'Saradomin brew(2)', 6691: 'Saradomin brew(1)', 7510: 'Dwarven rock cake', 10925: 'Sanfew serum(4)', 10927: 'Sanfew serum(3)',
  10929: 'Sanfew serum(2)', 10931: 'Sanfew serum(1)', 12625: 'Stamina potion(4)', 12627: 'Stamina potion(3)', 12629: 'Stamina potion(2)',
  12631: 'Stamina potion(1)', 12695: 'Super combat potion(4)', 12697: 'Super combat potion(3)', 12699: 'Super combat potion(2)',
  12701: 'Super combat potion(1)', 13441: 'Anglerfish', 22081: 'Locator orb', 22461: 'Bastion potion(4)', 22464: 'Bastion potion(3)',
  22467: 'Bastion potion(2)', 22470: 'Bastion potion(1)', 23685: 'Divine super combat potion(4)', 23688: 'Divine super combat potion(3)',
  23691: 'Divine super combat potion(2)', 23694: 'Divine super combat potion(1)', 27629: 'Forgotten brew(4)', 27632: 'Forgotten brew(3)',
  27635: 'Forgotten brew(2)', 27638: 'Forgotten brew(1)', 27641: 'Saturated heart', 29143: 'Cooked moonlight antelope',
  29183: 'Snowy knight mix(2)', 29186: 'Ruby harvest mix(2)', 29201: 'Snowy knight mix(1)', 30125: 'Prayer regeneration potion(4)',
  30128: 'Prayer regeneration potion(3)', 30131: 'Prayer regeneration potion(2)', 30134: 'Prayer regeneration potion(1)',
  30875: 'Surge potion(4)', 30878: 'Surge potion(3)', 30881: 'Surge potion(2)', 30884: 'Surge potion(1)',
  31614: 'Extreme energy potion(4)', 31617: 'Extreme energy potion(3)', 31620: 'Extreme energy potion(2)', 31623: 'Extreme energy potion(1)',
  31638: 'Extended stamina potion(4)', 31641: 'Extended stamina potion(3)', 31644: 'Extended stamina potion(2)',
  31647: 'Extended stamina potion(1)', 31650: 'Armadyl brew(4)', 31653: 'Armadyl brew(3)', 31656: 'Armadyl brew(2)', 31659: 'Armadyl brew(1)',
}

/** Inventory left-click text for a consumable (the cache's first action normally supplies it). */
export function consumableOptionText(itemId: number): 'Eat' | 'Drink' | 'Use' {
  const def = CONSUMABLES[itemId]
  if (!def) return 'Use'
  if (def.track === 'food' || def.track === 'combo_food') return 'Eat'
  if (def.track === 'potion') return 'Drink'
  return 'Use'
}

export interface DoseChainInfo {
  /** Item ids from most to fewest doses. */
  doses: number[]
  /** Id left after the last dose (229 vial, 1980 cup), or null when the item is removed/kept. */
  empty: number | null
}

/** Dose chain of a potion (follows the `replace` consume rules). */
export function doseChainOf(itemId: number): DoseChainInfo | null {
  const def = CONSUMABLES[itemId]
  if (!def || def.consume.type !== 'replace') return null
  // Walk back to the first dose.
  let first = itemId
  for (;;) {
    const prev = Object.entries(CONSUMABLES).find(([, d]) => d.consume.type === 'replace' && d.consume.withId === first)
    if (!prev) break
    first = Number(prev[0])
  }
  const doses: number[] = []
  let cur: number | null = first
  let empty: number | null = null
  while (cur !== null) {
    const d: ConsumableDef | undefined = CONSUMABLES[cur]
    if (!d) {
      empty = cur
      break
    }
    doses.push(cur)
    cur = d.consume.type === 'replace' && d.consume.withId !== cur ? d.consume.withId : null
    if (cur !== null && (cur === 229 || cur === 1980)) {
      empty = cur
      break
    }
  }
  return { doses, empty }
}

/** scim: effect ops auto-prepot applies. */
export const PREPOT_OPS: ReadonlySet<ItemEffect['op']> = new Set(['boost', 'boost_formula', 'saturated_heart', 'apply_timed_effect', 'cure_poison'])

/** scim: tracks that block a track. */
const BLOCKED_BY: Readonly<Record<CooldownTrack, readonly CooldownTrack[]>> = { food: ['potion', 'combo_food'], potion: ['combo_food'], combo_food: [] }


export function trackReady(tracks: CooldownTracks, track: CooldownTrack, tick: number): boolean {
  if (tick < tracks[track]) return false
  for (const t of BLOCKED_BY[track]) if (tick < tracks[t]) return false
  return true
}


export function setTrack(tracks: CooldownTracks, track: CooldownTrack, tick: number, delay: number): CooldownTracks {
  return { ...tracks, [track]: Math.max(tracks[track], tick + delay) }
}

/** scim: attack-timer push per track. */
export const TRACK_ATTACK_DELAY: Readonly<Record<CooldownTrack, number>> = { food: 3, combo_food: 2, potion: 0 }
