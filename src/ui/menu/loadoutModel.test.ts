import { describe, expect, it } from 'vitest'
import type { Loadout } from '../../sim/api'
import {
  allNinetyNine,
  autoSwitchPreset,
  clampLevel,
  combatLevel,
  CUSTOM_KEY,
  defaultSupplies,
  emptyInventory,
  loadoutEqual,
  matchPresetKey,
  normalizeLoadout,
  rebuildRunePouch,
  setEquipmentSlot,
  setInventorySlot,
  setRunePouchSlot,
  setSpellbook,
  uniqueName,
  unmetRequirements,
} from './loadoutModel'
import type { LoadoutPreset } from './simBridge'

function loadout(weapon?: number): Loadout {
  return { equipment: weapon === undefined ? {} : { weapon }, inventory: emptyInventory(), supplies: defaultSupplies() }
}

const presets: LoadoutPreset[] = [
  { id: 'max', name: 'Max', loadout: loadout(20997), requirements: { ranged: 85 } },
  { id: 'budget', name: 'Budget', loadout: loadout(9185), requirements: { ranged: 61 } },
  { id: 'naked', name: 'No Equipment', loadout: loadout(), requirements: {}, isFallback: true },
]

describe('stats', () => {
  it('clamps like scim bA', () => {
    expect(clampLevel('attack', 120)).toBe(99)
    expect(clampLevel('attack', 0)).toBe(1)
    expect(clampLevel('hitpoints', 5)).toBe(10)
    expect(clampLevel('magic', 55.9)).toBe(55)
    expect(clampLevel('magic', Number.NaN)).toBe(1)
  })
  it('computes the combat level', () => {
    expect(combatLevel(allNinetyNine())).toBe(126)
    expect(combatLevel({ attack: 1, strength: 1, defence: 1, ranged: 1, magic: 1, prayer: 1, hitpoints: 10 })).toBe(3)
  })
})

describe('preset matching and requirements', () => {
  it('matches presets by full loadout equality', () => {
    expect(matchPresetKey(presets, loadout(9185))).toBe('budget')
    expect(matchPresetKey(presets, loadout(4151))).toBe(CUSTOM_KEY)
    const withQty = loadout(9185)
    withQty.inventory[0] = { id: 9243, quantity: 1000 }
    expect(matchPresetKey(presets, withQty)).toBe(CUSTOM_KEY)
  })
  it('treats a missing quantity as 1', () => {
    const a = loadout()
    const b = loadout()
    a.inventory[0] = { id: 6685 }
    b.inventory[0] = { id: 6685, quantity: 1 }
    expect(loadoutEqual(a, b)).toBe(true)
  })
  it('auto-switches away from blocked presets', () => {
    const lv = { ...allNinetyNine(), ranged: 70 }
    expect(unmetRequirements(lv, presets[0]!.requirements)).toEqual({ ranged: 85 })
    expect(autoSwitchPreset(presets, lv, 'max')).toBe('budget')
    expect(autoSwitchPreset(presets, { ...lv, ranged: 40 }, 'max')).toBe('naked')
    expect(autoSwitchPreset(presets, allNinetyNine(), 'naked')).toBe('max')
    expect(autoSwitchPreset(presets, allNinetyNine(), 'max')).toBeNull()
    expect(autoSwitchPreset(presets, lv, CUSTOM_KEY)).toBeNull()
  })
})

describe('editor edits', () => {
  const twoH = (id: number) => id === 20997
  it('drops the shield for a 2h weapon and the 2h for a shield', () => {
    let l = setEquipmentSlot(loadout(), 'shield', 23991, twoH)
    l = setEquipmentSlot(l, 'weapon', 20997, twoH)
    expect(l.equipment).toEqual({ weapon: 20997 })
    l = setEquipmentSlot(l, 'shield', 23991, twoH)
    expect(l.equipment).toEqual({ shield: 23991 })
    l = setEquipmentSlot(l, 'shield', undefined, twoH)
    expect(l.equipment).toEqual({})
  })
  it('keeps the previous slot quantity and rebuilds the rune pouch', () => {
    let l = loadout()
    l.inventory[3] = { id: 11230, quantity: 4000 }
    l = setInventorySlot(l, 3, 6685)
    expect(l.inventory[3]).toEqual({ id: 6685, quantity: 4000 })
    l = setInventorySlot(l, 27, 12791)
    expect(l.supplies.runePouch).toEqual({ kind: 'standard', slots: [null, null, null] })
    l = setRunePouchSlot(l, 1, 560)
    expect(l.supplies.runePouch?.slots[1]).toEqual({ id: 560 })
    l = setInventorySlot(l, 27, 27281)
    expect(l.supplies.runePouch).toEqual({ kind: 'divine', slots: [null, { id: 560 }, null, null] })
    l = setInventorySlot(l, 27, undefined)
    expect(l.supplies.runePouch).toBeNull()
  })
  it('keeps the selected spell only in its own book', () => {
    const l = { ...loadout(), supplies: { ...defaultSupplies(), spellbook: 'ancient' as const, selectedSpell: 'Ice Barrage' } }
    const book = (s: string) => (s === 'Ice Barrage' ? ('ancient' as const) : undefined)
    expect(setSpellbook(l, 'arceuus', book).supplies.selectedSpell).toBeNull()
    expect(setSpellbook(l, 'ancient', book).supplies.selectedSpell).toBe('Ice Barrage')
  })
  it('rebuilds a pouch only when one is in the inventory', () => {
    expect(rebuildRunePouch(emptyInventory(), null)).toBeNull()
  })
})

describe('storage normalisation and naming', () => {
  it('repairs junk into a valid loadout', () => {
    const l = normalizeLoadout({ equipment: { weapon: 20997, head: -1, foo: 3 }, inventory: [{ id: 6685, quantity: 1 }, 'x', { id: 0 }], supplies: { spellbook: 'nope', blowpipe: { ammo: { id: 11230 } } } })
    expect(l.equipment).toEqual({ weapon: 20997 })
    expect(l.inventory).toHaveLength(28)
    expect(l.inventory[0]).toEqual({ id: 6685 })
    expect(l.inventory[1]).toBeNull()
    expect(l.supplies.spellbook).toBe('arceuus')
    expect(l.supplies.blowpipe).toEqual({ id: 11230 })
  })
  it('makes names unique accent-insensitively', () => {
    expect(uniqueName('Max (custom)', ['Max'])).toBe('Max (custom)')
    expect(uniqueName('Max', ['max', 'Max 2'])).toBe('Max 3')
  })
})
