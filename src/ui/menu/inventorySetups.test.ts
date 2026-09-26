import { describe, expect, it } from 'vitest'
import type { EquipSlot, Loadout } from '../../sim/api'
import { exportInventorySetup, IMPORT_ERRORS, importInventorySetup, MAX_SETUP_LENGTH, type SetupCatalog } from './inventorySetups'
import { defaultSupplies, emptyInventory, loadoutEqual } from './loadoutModel'

const EQUIP: Partial<Record<EquipSlot, Record<number, boolean>>> = {
  weapon: { 20997: true, 9185: true, 99999: false },
  shield: { 23991: true },
  head: { 25912: true },
  cape: { 28951: true },
}
const INV: Record<number, boolean> = { 6685: true, 3024: true, 27281: true, 12926: true, 555: true, 566: true, 565: true, 560: true, 777: false }

const catalog: SetupCatalog = {
  inventoryItem: (id) => (INV[id] === undefined ? undefined : { name: `Item ${id}`, verified: INV[id]! }),
  equipmentItem: (slot, id) => {
    const v = EQUIP[slot]?.[id]
    return v === undefined ? undefined : { name: `Gear ${id}`, verified: v }
  },
  isTwoHanded: (id) => id === 20997,
}

function sample(): Loadout {
  const inventory = emptyInventory()
  inventory[0] = { id: 12926 }
  inventory[1] = { id: 6685 }
  inventory[2] = { id: 3024, quantity: 3 }
  inventory[27] = { id: 27281 }
  return {
    equipment: { head: 25912, cape: 28951, weapon: 20997 },
    inventory,
    supplies: {
      ...defaultSupplies(),
      equippedAmmo: { id: 22947 },
      quiverAmmo: { id: 33595 },
      runePouch: { kind: 'divine', slots: [{ id: 566 }, { id: 565 }, { id: 560 }, { id: 555 }] },
      spellbook: 'ancient',
    },
  }
}

describe('Inventory Setups export', () => {
  it('writes scim key order, q only when != 1, hc, sb and layout', () => {
    const json = exportInventorySetup('  Max Tbow ', sample())
    const o = JSON.parse(json) as { setup: Record<string, unknown>; layout: unknown[] }
    expect(Object.keys(o)).toEqual(['setup', 'layout'])
    expect(Object.keys(o.setup)).toEqual(['inv', 'eq', 'rp', 'qv', 'name', 'hc', 'sb'])
    expect(o.setup.name).toBe('Max Tbow')
    expect(o.setup.hc).toBe('#FFFF0000')
    expect(o.setup.sb).toBe(1)
    const inv = o.setup.inv as unknown[]
    expect(inv).toHaveLength(28)
    expect(inv[2]).toEqual({ id: 3024, q: 3 })
    expect(inv[1]).toEqual({ id: 6685 })
    const eq = o.setup.eq as unknown[]
    expect(eq).toHaveLength(14)
    expect(eq[3]).toEqual({ id: 20997 })
    expect(eq[13]).toEqual({ id: 22947 })
    expect(eq[5]).toBeNull()
    expect(o.setup.qv).toEqual([{ id: 33595 }])
    expect(o.layout).toEqual([])
  })

  it('omits rp/qv/sb when absent or standard', () => {
    const l = sample()
    l.supplies = { ...defaultSupplies(), spellbook: 'standard' }
    const o = JSON.parse(exportInventorySetup('x', l)) as { setup: Record<string, unknown> }
    expect('rp' in o.setup).toBe(false)
    expect('qv' in o.setup).toBe(false)
    expect('sb' in o.setup).toBe(false)
  })
})

describe('Inventory Setups import', () => {
  it('round-trips an export', () => {
    const l = sample()
    const r = importInventorySetup(exportInventorySetup('Max Tbow', l), catalog)
    expect(r.kind).toBe('success')
    if (r.kind !== 'success') return
    expect(r.name).toBe('Max Tbow')
    // blowpipe / selectedSpell are always null after import
    expect(loadoutEqual(r.loadout, { ...l, supplies: { ...l.supplies, blowpipe: null, selectedSpell: null } })).toBe(true)
  })

  it('rejects oversized, invalid and wrongly sized setups', () => {
    expect(importInventorySetup('x'.repeat(MAX_SETUP_LENGTH + 1), catalog)).toEqual({ kind: 'error', message: IMPORT_ERRORS.tooLarge })
    expect(importInventorySetup('{nope', catalog)).toEqual({ kind: 'error', message: IMPORT_ERRORS.invalid })
    expect(importInventorySetup('{"setup":{"inv":[],"eq":[],"name":""},"layout":[]}', catalog)).toEqual({ kind: 'error', message: IMPORT_ERRORS.invalid })
    const short = JSON.stringify({ setup: { inv: Array(27).fill(null), eq: Array(14).fill(null), name: 'a' }, layout: [] })
    expect(importInventorySetup(short, catalog)).toEqual({ kind: 'error', message: IMPORT_ERRORS.slots })
  })

  it('drops unknown equipment, flags unverified/unsupported items and removes the shield under a 2h', () => {
    const eq: unknown[] = Array(14).fill(null)
    eq[3] = { id: 20997 }
    eq[5] = { id: 23991 }
    eq[0] = { id: 123 }
    const inv: unknown[] = Array(28).fill(null)
    inv[0] = { id: 777 }
    inv[1] = { id: 888, q: 5 }
    const r = importInventorySetup(JSON.stringify({ setup: { inv, eq, name: 'Mix', sb: 3 }, layout: [1, 2] }), catalog)
    expect(r.kind).toBe('success')
    if (r.kind !== 'success') return
    expect(r.loadout.equipment).toEqual({ weapon: 20997 })
    expect(r.unsupportedEquipmentIds).toEqual([123])
    expect(r.loadout.inventory[1]).toEqual({ id: 888, quantity: 5 })
    expect(r.loadout.supplies.spellbook).toBe('arceuus')
    const byId = new Map(r.verificationIssues.map((i) => [i.id, i]))
    expect(byId.get(777)).toMatchObject({ reason: 'unverified', omitted: false })
    expect(byId.get(888)).toMatchObject({ reason: 'unsupported', omitted: false })
    expect(byId.get(123)).toMatchObject({ reason: 'unsupported', omitted: true })
  })

  it('reads the rune pouch kind from its length', () => {
    const base = { inv: Array(28).fill(null), eq: Array(14).fill(null), name: 'p' }
    const std = importInventorySetup(JSON.stringify({ setup: { ...base, rp: [{ id: 555 }, null, { id: 560 }] }, layout: [] }), catalog)
    expect(std.kind === 'success' && std.loadout.supplies.runePouch).toEqual({ kind: 'standard', slots: [{ id: 555 }, null, { id: 560 }] })
    const none = importInventorySetup(JSON.stringify({ setup: { ...base, rp: [{ id: 555 }] }, layout: [] }), catalog)
    expect(none.kind === 'success' && none.loadout.supplies.runePouch).toBeNull()
  })
})
