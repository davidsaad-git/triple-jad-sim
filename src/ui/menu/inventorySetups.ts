/**
 * RuneLite "Inventory Setups" import/export. Pure: item knowledge comes from the
 * `SetupCatalog` passed in (the item picker catalog in the app, a fake in tests).
 */
import type { EquipSlot, Loadout, RunePouch, Spellbook } from '../../sim/api'
import { defaultSupplies, emptyInventory } from './loadoutModel'
import type { VerificationIssue } from './encounter'

export interface SetupCatalogItem {
  name: string
  verified: boolean
}

export interface SetupCatalog {
  /** Inventory catalog entry (consumables, runes, pouches, gear). */
  inventoryItem(id: number): SetupCatalogItem | undefined
  /** Entry of the given equipment slot's catalog. */
  equipmentItem(slot: EquipSlot, id: number): SetupCatalogItem | undefined
  isTwoHanded(id: number): boolean
}

export const MAX_SETUP_LENGTH = 65536
const INV_SLOTS = 28
const EQ_SLOTS = 14
const MAX_POUCH = 4
const MAX_LAYOUT = 2048
const MAX_NAME = 255
const HIGHLIGHT_COLOUR = '#FFFF0000'

/** scim: equipment index map; index 13 = ammo. */
export const EQUIPMENT_INDEX: Record<EquipSlot, number> = { head: 0, cape: 1, amulet: 2, weapon: 3, body: 4, shield: 5, legs: 7, hands: 9, boots: 10, ring: 12 }
const AMMO_INDEX = 13

/** scim (import) / `BN` (export). */
const SPELLBOOK_FROM_SB: Record<number, Spellbook> = { 0: 'standard', 1: 'ancient', 2: 'lunar', 3: 'arceuus', 4: 'standard' }
const SB_FROM_SPELLBOOK: Record<Spellbook, number> = { standard: 0, ancient: 1, lunar: 2, arceuus: 3 }

export const IMPORT_ERRORS = {
  tooLarge: 'That is far larger than an Inventory Setup export.',
  invalid: 'Paste a valid Inventory Setup export string.',
  slots: 'The export must contain 28 inventory slots and 14 equipment slots.',
} as const

export type ImportResult =
  | { kind: 'error'; message: string }
  | { kind: 'success'; name: string; loadout: Loadout; unsupportedEquipmentIds: number[]; verificationIssues: VerificationIssue[] }

interface SlotEntry {
  id: number
  q?: number
}

function isPosInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/** zod-like validation of `{id: int>0, q?: int>0} | null`. */
function parseSlot(v: unknown): SlotEntry | null | undefined {
  if (v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  if (!isPosInt(o.id)) return undefined
  if (o.q !== undefined && !isPosInt(o.q)) return undefined
  return o.q === undefined ? { id: o.id } : { id: o.id, q: o.q }
}

function parseSlotArray(v: unknown, max: number): (SlotEntry | null)[] | undefined {
  if (!Array.isArray(v) || v.length > max) return undefined
  const out: (SlotEntry | null)[] = []
  for (const e of v) {
    const s = parseSlot(e)
    if (s === undefined) return undefined
    out.push(s)
  }
  return out
}

interface ParsedSetup {
  inv: (SlotEntry | null)[]
  eq: (SlotEntry | null)[]
  rp: (SlotEntry | null)[] | null | undefined
  qv: (SlotEntry | null)[] | null | undefined
  name: string
  sb: number | undefined
}

function parseSetup(root: unknown): ParsedSetup | null {
  if (typeof root !== 'object' || root === null || Array.isArray(root)) return null
  const r = root as Record<string, unknown>
  const setup = r.setup
  if (typeof setup !== 'object' || setup === null || Array.isArray(setup)) return null
  const layout = r.layout
  if (!Array.isArray(layout) || layout.length > MAX_LAYOUT || !layout.every((x) => typeof x === 'number' && Number.isInteger(x))) return null
  const s = setup as Record<string, unknown>
  const inv = parseSlotArray(s.inv, INV_SLOTS)
  const eq = parseSlotArray(s.eq, EQ_SLOTS)
  if (!inv || !eq) return null
  let rp: ParsedSetup['rp']
  if (s.rp === undefined || s.rp === null) rp = s.rp
  else {
    rp = parseSlotArray(s.rp, MAX_POUCH)
    if (!rp) return null
  }
  let qv: ParsedSetup['qv']
  if (s.qv === undefined || s.qv === null) qv = s.qv
  else {
    qv = parseSlotArray(s.qv, MAX_POUCH)
    if (!qv) return null
  }
  if (typeof s.name !== 'string') return null
  const name = s.name.trim()
  if (name.length < 1 || name.length > MAX_NAME) return null
  let sb: number | undefined
  if (s.sb !== undefined) {
    if (typeof s.sb !== 'number' || !Number.isInteger(s.sb) || s.sb < 0 || s.sb > 4) return null
    sb = s.sb
  }
  return { inv, eq, rp, qv, name, sb }
}


export function importInventorySetup(text: string, catalog: SetupCatalog): ImportResult {
  if (text.length > MAX_SETUP_LENGTH) return { kind: 'error', message: IMPORT_ERRORS.tooLarge }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { kind: 'error', message: IMPORT_ERRORS.invalid }
  }
  const setup = parseSetup(json)
  if (!setup) return { kind: 'error', message: IMPORT_ERRORS.invalid }
  if (setup.inv.length !== INV_SLOTS || setup.eq.length !== EQ_SLOTS) return { kind: 'error', message: IMPORT_ERRORS.slots }

  const issues = new Map<number, VerificationIssue>()
  const note = (i: VerificationIssue) => {
    if (!issues.get(i.id) || i.omitted) issues.set(i.id, i)
  }
  for (const e of setup.inv) {
    if (!e) continue
    const item = catalog.inventoryItem(e.id)
    if (!item) note({ id: e.id, name: `Item ${e.id}`, reason: 'unsupported', omitted: false })
    else if (!item.verified) note({ id: e.id, name: item.name, reason: 'unverified', omitted: false })
  }
  const equipment: Loadout['equipment'] = {}
  const unsupported: number[] = []
  for (const [slot, idx] of Object.entries(EQUIPMENT_INDEX) as [EquipSlot, number][]) {
    const e = setup.eq[idx]
    if (!e) continue
    const item = catalog.equipmentItem(slot, e.id)
    if (item) {
      equipment[slot] = e.id
      if (!item.verified) note({ id: e.id, name: item.name, reason: 'unverified', omitted: false })
    } else {
      unsupported.push(e.id)
      note({ id: e.id, name: `Item ${e.id}`, reason: 'unsupported', omitted: true })
    }
  }
  if (equipment.weapon !== undefined && catalog.isTwoHanded(equipment.weapon)) delete equipment.shield

  const inventory = emptyInventory()
  for (let i = 0; i < INV_SLOTS; i++) {
    const e = setup.inv[i]
    inventory[i] = e ? (e.q === undefined ? { id: e.id } : { id: e.id, quantity: e.q }) : null
  }
  let runePouch: RunePouch | null = null
  if (setup.rp && (setup.rp.length === 3 || setup.rp.length === 4)) {
    const slots = setup.rp.map((e) => {
      if (!e) return null
      if (!catalog.inventoryItem(e.id)) note({ id: e.id, name: `Item ${e.id}`, reason: 'unsupported', omitted: false })
      return { id: e.id }
    })
    runePouch = { kind: setup.rp.length === 3 ? 'standard' : 'divine', slots }
  }
  const eqAmmo = setup.eq[AMMO_INDEX]
  const qv0 = setup.qv?.[0]
  const loadout: Loadout = {
    equipment,
    inventory,
    supplies: {
      ...defaultSupplies(),
      equippedAmmo: eqAmmo ? { id: eqAmmo.id } : null,
      quiverAmmo: qv0 ? { id: qv0.id } : null,
      runePouch,
      spellbook: SPELLBOOK_FROM_SB[setup.sb ?? 0] ?? 'standard',
    },
  }
  return { kind: 'success', name: setup.name, loadout, unsupportedEquipmentIds: unsupported, verificationIssues: [...issues.values()] }
}

function slotOut(e: { id: number; quantity?: number } | null | undefined): SlotEntry | null {
  if (!e) return null
  return e.quantity !== undefined && e.quantity !== 1 ? { id: e.id, q: e.quantity } : { id: e.id }
}

/** scim: key order setup{inv, eq, rp?, qv?, name, hc, sb?}, layout. */
export function exportInventorySetup(name: string, loadout: Loadout): string {
  const eq: (SlotEntry | null)[] = Array.from({ length: EQ_SLOTS }, () => null)
  for (const [slot, idx] of Object.entries(EQUIPMENT_INDEX) as [EquipSlot, number][]) {
    const id = loadout.equipment[slot]
    eq[idx] = id === undefined ? null : { id }
  }
  eq[AMMO_INDEX] = slotOut(loadout.supplies.equippedAmmo)
  const setup: Record<string, unknown> = { inv: loadout.inventory.map(slotOut), eq }
  if (loadout.supplies.runePouch) setup.rp = loadout.supplies.runePouch.slots.map(slotOut)
  if (loadout.supplies.quiverAmmo) setup.qv = [slotOut(loadout.supplies.quiverAmmo)]
  setup.name = name.trim()
  setup.hc = HIGHLIGHT_COLOUR
  if (loadout.supplies.spellbook !== 'standard') setup.sb = SB_FROM_SPELLBOOK[loadout.supplies.spellbook]
  return JSON.stringify({ setup, layout: [] })
}

/** Clipboard write with a textarea fallback. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the textarea path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/** Clipboard read; null when nothing readable. */
export async function readClipboard(): Promise<string | null> {
  try {
    const t = await globalThis.navigator?.clipboard?.readText()
    return t && t.trim().length > 0 ? t : null
  } catch {
    return null
  }
}
