import { describe, expect, it } from 'vitest'
import type { PlayerStats } from '../api'
import { initialCombatTimers, initialPoisonState, initialSpecialAttack } from '../player/timers'
import { statsFromLevels, defaultBaseLevels, loadoutRequirements, combatLevel } from '../player/stats'
import { consumeInventory, inventoryFrom } from '../player/inventory'
import { LOADOUT_PRESETS, DEFAULT_PRESET_ID } from '../loadouts/presets'
import { consumableDef, doseChainOf, setTrack, trackReady, TRACK_ATTACK_DELAY, consumableOptionText } from './consumables'
import { applyItemEffects, hasEnhancedPrayerRestoration, prayerRestoreAmount, type ItemActionState } from './itemEffects'

function state(overrides: Partial<ItemActionState> = {}): ItemActionState {
  const stats: PlayerStats = statsFromLevels(defaultBaseLevels())
  return {
    playerHP: 99,
    maxHP: 99,
    stats,
    poisonState: initialPoisonState(),
    potionBoosts: [],
    prayerState: { points: 99, maxPoints: 99, drainCounter: 0, activePrayers: [], prayerActivationTicks: {} },
    runEnergy: { energy: 10000 },
    specialAttack: initialSpecialAttack(),
    combatTimers: initialCombatTimers(),
    cooldownTracks: { food: 0, potion: 0, combo_food: 0 },
    activeEffects: [],
    currentTick: 5,
    ...overrides,
  }
}

describe('consumable table', () => {
  it('saradomin brew: +16 overheal, def +21, drains 11', () => {
    const def = consumableDef(6685)!
    const s = applyItemEffects(def.effects, state({ playerHP: 50 }))
    expect(s.playerHP).toBe(66)
    expect(s.stats.defence.current).toBe(120)
    expect(s.stats.attack.current).toBe(88)
    expect(s.stats.ranged.current).toBe(88)
    expect(s.stats.magic.current).toBe(88)
    expect(s.stats.strength.current).toBe(88)
    expect(s.stats.hitpoints.current).toBe(66)
  })
  it('overheal can lower HP above the cap (brew at 121 -> 115)', () => {
    const s = applyItemEffects(consumableDef(6685)!.effects, state({ playerHP: 121 }))
    expect(s.playerHP).toBe(115)
  })
  it('super restore: restores stats by floor(max/4)+8 and prayer 32 (34 enhanced)', () => {
    const base = state()
    base.stats.ranged = { current: 50, max: 99 }
    base.prayerState = { ...base.prayerState, points: 10 }
    const s = applyItemEffects(consumableDef(3024)!.effects, base)
    expect(s.stats.ranged.current).toBe(50 + 24 + 8)
    expect(s.prayerState.points).toBe(42)
    const e = applyItemEffects(consumableDef(3024)!.effects, base, { enhancedPrayerRestoration: true })
    expect(e.prayerState.points).toBe(44)
    expect(prayerRestoreAmount('super_restore', 99, false)).toBe(32)
    expect(prayerRestoreAmount('prayer_potion', 99, true)).toBe(33)
  })
  it('bastion: ranged +13, defence +19 at 99', () => {
    const s = applyItemEffects(consumableDef(22461)!.effects, state())
    expect(s.stats.ranged.current).toBe(112)
    expect(s.stats.defence.current).toBe(118)
  })
  it('anglerfish heals 22 and overheals', () => {
    const s = applyItemEffects(consumableDef(13441)!.effects, state({ playerHP: 95 }))
    expect(s.playerHP).toBe(117)
  })
  it('dose chains end in a vial', () => {
    expect(doseChainOf(6687)).toEqual({ doses: [6685, 6687, 6689, 6691], empty: 229 })
    expect(consumableDef(6691)!.consume).toEqual({ type: 'replace', withId: 229 })
    expect(consumableOptionText(3144)).toBe('Eat')
    expect(consumableOptionText(3024)).toBe('Drink')
  })
  it('enhanced prayer restoration: ring of the gods (i)', () => {
    expect(hasEnhancedPrayerRestoration({ ring: 26764 }, inventoryFrom([]))).toBe(true)
    expect(hasEnhancedPrayerRestoration({}, inventoryFrom([]))).toBe(false)
  })
})

describe('cooldown tracks', () => {
  it('food -> potion -> karambwan in one tick all succeed; potion then food fails', () => {
    let t = { food: 0, potion: 0, combo_food: 0 }
    expect(trackReady(t, 'food', 10)).toBe(true)
    t = setTrack(t, 'food', 10, 3)
    expect(trackReady(t, 'potion', 10)).toBe(true)
    t = setTrack(t, 'potion', 10, 3)
    expect(trackReady(t, 'combo_food', 10)).toBe(true)
    let u = setTrack({ food: 0, potion: 0, combo_food: 0 }, 'potion', 10, 3)
    expect(trackReady(u, 'food', 10)).toBe(false)
    u = setTrack({ food: 0, potion: 0, combo_food: 0 }, 'combo_food', 10, 3)
    expect(trackReady(u, 'potion', 12)).toBe(false)
    expect(trackReady(u, 'potion', 13)).toBe(true)
  })
  it('attack delays per track', () => {
    expect(TRACK_ATTACK_DELAY).toEqual({ food: 3, combo_food: 2, potion: 0 })
  })
})

describe('inventory', () => {
  it('consume rules', () => {
    const inv = inventoryFrom([{ id: 6685 }, { id: 28991, q: 3 }])
    expect(consumeInventory(inv, 0, { type: 'replace', withId: 6687 })[0]).toEqual({ id: 6687 })
    expect(consumeInventory(inv, 1, { type: 'decrement' })[1]).toEqual({ id: 28991, quantity: 2 })
    expect(consumeInventory(inv, 0, { type: 'remove' })[0]).toBe(null)
  })
})

describe('presets', () => {
  it('order and default', () => {
    expect(LOADOUT_PRESETS.map((p) => p.id)).toEqual(['max_tbow', 'bowfa', 'atlatl_eclipse', 'budget_rcb', 'mage_tank', 'naked'])
    expect(DEFAULT_PRESET_ID).toBe('max_tbow')
    expect(LOADOUT_PRESETS.at(-1)!.isFallback).toBe(true)
  })
  it('requirements computed like scim IA', () => {
    const req = (id: string) => LOADOUT_PRESETS.find((p) => p.id === id)!.requirements
    expect(req('max_tbow')).toEqual({ ranged: 85, defence: 80, strength: 80, magic: 80, prayer: 75, hitpoints: 90 })
    expect(req('bowfa')).toEqual({ ranged: 80, defence: 70, magic: 70, strength: 60, attack: 50, prayer: 60 })
    expect(req('atlatl_eclipse')).toEqual({ ranged: 75, defence: 70, magic: 70, attack: 50, strength: 50 })
    expect(req('budget_rcb')).toEqual({ ranged: 75, defence: 70, magic: 70 })
    expect(req('mage_tank')).toEqual({ magic: 85, defence: 80, strength: 80, ranged: 80, prayer: 80, hitpoints: 90 })
    expect(loadoutRequirements({}, inventoryFrom([]))).toEqual({})
  })
  it('max tbow inventory layout', () => {
    const inv = LOADOUT_PRESETS[0]!.loadout.inventory
    expect(inv).toHaveLength(28)
    expect(inv.map((i) => i?.id ?? null)).toEqual([
      21006, 12817, 26243, 26245, 31106, 12926, 6685, 3024, 6685, 6685, 3024, 3024, 6685, 6685, 3024, 3024, 6685, 6685, 3024, 3024, 6685, 22461, 3024,
      30125, 22461, 12625, 30125, 27281,
    ])
  })
  it('combat level', () => {
    expect(combatLevel(defaultBaseLevels())).toBe(126)
  })
})
