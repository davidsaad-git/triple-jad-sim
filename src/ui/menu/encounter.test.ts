import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory localStorage installed before the settings store module loads.
const storage = vi.hoisted(() => {
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = ls
  return map
})

import { settingsStore, SETTINGS_STORAGE_KEY } from '../../app/settings/settings'
import {
  CUSTOM_PRESETS_KEY,
  ENCOUNTER_EQUIPMENT_KEY,
  ENCOUNTER_KEY,
  loadCurrentLoadout,
  loadCustomPresets,
  loadPlayerStats,
  loadStartConfig,
  mechanicsOverridesFor,
  mergedMechanicsConfig,
  PLAYER_GROUP_KEY,
  PLAYER_STATS_KEY,
  resetEncounterMechanics,
  saveCurrentLoadout,
  saveCustomPresets,
  saveMechanicsConfig,
  savePlayerStats,
} from './encounter'
import { allNinetyNine, defaultSupplies, emptyInventory } from './loadoutModel'

beforeEach(() => {
  storage.clear()
  settingsStore.patch({ mechanicsConfigPerEncounter: {} })
})

describe('player stats persistence (osrs-player-stats)', () => {
  it('defaults to 99s and round-trips', () => {
    expect(loadPlayerStats()).toEqual(allNinetyNine())
    savePlayerStats({ ...allNinetyNine(), ranged: 80, hitpoints: 3 })
    expect(JSON.parse(storage.get(PLAYER_STATS_KEY)!)).toMatchObject({ ranged: 80, hitpoints: 10 })
    expect(loadPlayerStats().ranged).toBe(80)
  })
  it('falls back to all 99 when any stored skill is invalid', () => {
    storage.set(PLAYER_STATS_KEY, JSON.stringify({ ...allNinetyNine(), magic: 120 }))
    expect(loadPlayerStats()).toEqual(allNinetyNine())
  })
})

describe('loadout persistence (osrs-encounter-equipment / osrs-custom-equipment-presets)', () => {
  it('stores the current loadout under the encounter key', () => {
    const inventory = emptyInventory()
    inventory[0] = { id: 6685 }
    const l = { equipment: { weapon: 20997 }, inventory, supplies: defaultSupplies() }
    saveCurrentLoadout(l)
    expect(Object.keys(JSON.parse(storage.get(ENCOUNTER_EQUIPMENT_KEY)!))).toEqual([ENCOUNTER_KEY])
    expect(loadCurrentLoadout()).toEqual(l)
  })
  it('stores custom presets per encounter and skips junk', () => {
    const l = { equipment: {}, inventory: emptyInventory(), supplies: defaultSupplies() }
    saveCustomPresets([{ id: 'a', name: 'Mine', loadout: l }])
    expect(loadCustomPresets().map((p) => p.name)).toEqual(['Mine'])
    storage.set(CUSTOM_PRESETS_KEY, JSON.stringify({ [ENCOUNTER_KEY]: [{ id: '', name: 'x' }, 5] }))
    expect(loadCustomPresets()).toEqual([])
  })
  it("restores a preset's equipment when only its inventory still matches", () => {
    saveCurrentLoadout({ equipment: { ring: 1 }, inventory: emptyInventory(), supplies: defaultSupplies() })
    expect(loadCurrentLoadout().equipment).toEqual({})
  })
})

describe('mechanics persistence (mechanicsConfigPerEncounter)', () => {
  it('stores only differing keys; player keys under __player__', () => {
    const next = mechanicsOverridesFor({ ...mergedMechanicsConfig(), infiniteHealth: true, vialSmasher: false }, {})
    expect(next[ENCOUNTER_KEY]).toEqual({ infiniteHealth: true })
    expect(next[PLAYER_GROUP_KEY]).toEqual({ vialSmasher: false })
    const back = mechanicsOverridesFor({ ...mergedMechanicsConfig(next), infiniteHealth: false, vialSmasher: true }, next)
    expect(back).toEqual({})
  })
  it('saves through the settings blob and merges on read', () => {
    saveMechanicsConfig({ ...mergedMechanicsConfig(), infiniteSpecialAttack: true, doubleDeathCharge: false })
    const blob = JSON.parse(storage.get(SETTINGS_STORAGE_KEY)!) as { mechanicsConfigPerEncounter: Record<string, unknown> }
    expect(blob.mechanicsConfigPerEncounter).toEqual({ [ENCOUNTER_KEY]: { infiniteSpecialAttack: true }, [PLAYER_GROUP_KEY]: { doubleDeathCharge: false } })
    const cfg = mergedMechanicsConfig()
    expect(cfg.infiniteSpecialAttack).toBe(true)
    expect(cfg.doubleDeathCharge).toBe(false)
    expect(cfg.autoPrepot).toBe(true)
  })
  it('Configure/Enter wipes only the encounter overrides', () => {
    saveMechanicsConfig({ ...mergedMechanicsConfig(), infiniteHealth: true, vialSmasher: false })
    resetEncounterMechanics()
    expect(settingsStore.get().mechanicsConfigPerEncounter).toEqual({ [PLAYER_GROUP_KEY]: { vialSmasher: false } })
    expect(loadStartConfig().mechanics.infiniteHealth).toBe(false)
    expect(loadStartConfig().mechanics.vialSmasher).toBe(false)
  })
})
