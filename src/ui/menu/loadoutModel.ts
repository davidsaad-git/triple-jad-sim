/**
 * Pure loadout logic used by the Configure dialog:
 * normalisation, equality, preset matching, requirements, editor edits and
 * custom-preset naming. Mirrors scim.
 */
import { EQUIP_SLOTS } from '../../sim/api'
import type { CombatSupplies, EquipSlot, Equipment, Inventory, InventoryItem, Loadout, PlayerStats, RunePouch, SkillName, Spellbook } from '../../sim/api'
import type { LoadoutPreset } from './simBridge'

export const SKILLS: readonly SkillName[] = ['attack', 'strength', 'defence', 'ranged', 'magic', 'prayer', 'hitpoints']


export const SKILL_LABELS: Record<SkillName, string> = {
  attack: 'Attack',
  strength: 'Strength',
  defence: 'Defence',
  ranged: 'Ranged',
  magic: 'Magic',
  prayer: 'Prayer',
  hitpoints: 'Hitpoints',
}

/** scim: all 1..99 except hitpoints 10..99. */
export const SKILL_BOUNDS: Record<SkillName, { min: number; max: number }> = {
  attack: { min: 1, max: 99 },
  strength: { min: 1, max: 99 },
  defence: { min: 1, max: 99 },
  ranged: { min: 1, max: 99 },
  magic: { min: 1, max: 99 },
  prayer: { min: 1, max: 99 },
  hitpoints: { min: 10, max: 99 },
}

export type BaseLevels = Record<SkillName, number>


export function clampLevel(skill: SkillName, v: number): number {
  const { min, max } = SKILL_BOUNDS[skill]
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : min
}


export function allNinetyNine(): BaseLevels {
  return { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, prayer: 99, hitpoints: 99 }
}

/** scim: base levels -> stats (current = max). */
export function statsFromLevels(levels: BaseLevels): PlayerStats {
  const out = {} as PlayerStats
  for (const s of SKILLS) out[s] = { current: levels[s], max: levels[s] }
  return out
}


export function combatLevel(l: BaseLevels): number {
  const base = 0.25 * (l.defence + l.hitpoints + Math.floor(l.prayer / 2))
  const melee = 0.325 * (l.attack + l.strength)
  const range = 0.325 * (Math.floor(l.ranged / 2) + l.ranged)
  const mage = 0.325 * (Math.floor(l.magic / 2) + l.magic)
  return Math.floor(base + Math.max(melee, range, mage))
}

// ---------------------------------------------------------------------------
// Construction / normalisation
// ---------------------------------------------------------------------------

export function emptyInventory(): Inventory {
  return Array.from({ length: 28 }, () => null)
}

/** scim: default supplies, spellbook arceuus. */
export function defaultSupplies(): CombatSupplies {
  return { equippedAmmo: null, quiverAmmo: null, runePouch: null, blowpipe: null, selectedSpell: null, spellbook: 'arceuus' }
}

const SPELLBOOKS: readonly Spellbook[] = ['standard', 'ancient', 'lunar', 'arceuus']

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toIdRef(v: unknown): { id: number; quantity?: number } | null {
  if (!isObj(v) || typeof v.id !== 'number' || !Number.isInteger(v.id) || v.id <= 0) return null
  if (typeof v.quantity === 'number' && v.quantity !== 1) return { id: v.id, quantity: v.quantity }
  return { id: v.id }
}

function toRunePouch(v: unknown): RunePouch | null {
  if (!isObj(v)) return null
  const kind = v.kind === 'divine' ? 'divine' : v.kind === 'standard' ? 'standard' : null
  if (!kind) return null
  const n = kind === 'divine' ? 4 : 3
  const src = Array.isArray(v.slots) ? v.slots : []
  const slots: RunePouch['slots'] = []
  for (let i = 0; i < n; i++) {
    const ref = toIdRef(src[i])
    slots.push(ref ? { id: ref.id } : null)
  }
  return { kind, slots }
}

/** Repair anything read from storage into a valid Loadout. */
export function normalizeLoadout(v: unknown): Loadout {
  const src = isObj(v) ? v : {}
  const equipment: Equipment = {}
  if (isObj(src.equipment)) {
    for (const slot of EQUIP_SLOTS) {
      const id = src.equipment[slot]
      if (typeof id === 'number' && Number.isInteger(id) && id > 0) equipment[slot] = id
    }
  }
  const inventory = emptyInventory()
  if (Array.isArray(src.inventory)) {
    for (let i = 0; i < 28; i++) {
      const ref = toIdRef(src.inventory[i])
      inventory[i] = ref
    }
  }
  const s = isObj(src.supplies) ? src.supplies : {}
  const spellbook = SPELLBOOKS.includes(s.spellbook as Spellbook) ? (s.spellbook as Spellbook) : 'arceuus'
  const blow = isObj(s.blowpipe) ? (toIdRef(s.blowpipe) ?? toIdRef(s.blowpipe.ammo)) : null
  const supplies: CombatSupplies = {
    equippedAmmo: toIdRef(s.equippedAmmo),
    quiverAmmo: toIdRef(s.quiverAmmo),
    runePouch: toRunePouch(s.runePouch),
    blowpipe: blow ? { id: blow.id } : null,
    selectedSpell: typeof s.selectedSpell === 'string' ? s.selectedSpell : null,
    spellbook,
  }
  return { equipment, inventory, supplies }
}

export function cloneLoadout(l: Loadout): Loadout {
  return normalizeLoadout(JSON.parse(JSON.stringify(l)) as unknown)
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

export function equipmentEqual(a: Equipment, b: Equipment): boolean {
  return EQUIP_SLOTS.every((s) => a[s] === b[s])
}

function qty(i: InventoryItem | null | undefined): number {
  return i?.quantity ?? 1
}

export function inventoryEqual(a: Inventory, b: Inventory): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? null
    const y = b[i] ?? null
    if (x === null && y === null) continue
    if (x === null || y === null) return false
    if (x.id !== y.id || qty(x) !== qty(y)) return false
  }
  return true
}

function refId(r: { id: number } | null): number | null {
  return r ? r.id : null
}

export function suppliesEqual(a: CombatSupplies, b: CombatSupplies): boolean {
  if (refId(a.equippedAmmo) !== refId(b.equippedAmmo)) return false
  if (refId(a.quiverAmmo) !== refId(b.quiverAmmo)) return false
  if (refId(a.blowpipe) !== refId(b.blowpipe)) return false
  if ((a.runePouch?.kind ?? null) !== (b.runePouch?.kind ?? null)) return false
  const as = a.runePouch?.slots ?? []
  const bs = b.runePouch?.slots ?? []
  if (as.length !== bs.length) return false
  for (let i = 0; i < as.length; i++) if (refId(as[i] ?? null) !== refId(bs[i] ?? null)) return false
  return a.selectedSpell === b.selectedSpell && a.spellbook === b.spellbook
}

export function loadoutEqual(a: Loadout, b: Loadout): boolean {
  return equipmentEqual(a.equipment, b.equipment) && inventoryEqual(a.inventory, b.inventory) && suppliesEqual(a.supplies, b.supplies)
}

export const CUSTOM_KEY = '__custom__'

/** scim: key of the preset equal to `loadout`, else `__custom__`. */
export function matchPresetKey(presets: readonly LoadoutPreset[], loadout: Loadout): string {
  for (const p of presets) if (loadoutEqual(normalizeLoadout(p.loadout), loadout)) return p.id
  return CUSTOM_KEY
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export type Requirements = Partial<Record<SkillName, number>>

export function unmetRequirements(levels: BaseLevels, req: Requirements | undefined): Requirements {
  const out: Requirements = {}
  if (!req) return out
  for (const s of SKILLS) {
    const r = req[s]
    if (r !== undefined && levels[s] < r) out[s] = r
  }
  return out
}

export function hasUnmet(r: Requirements | undefined): boolean {
  return r !== undefined && Object.keys(r).length > 0
}

/**
 * scim: when the selected built-in preset becomes blocked, switch to the
 * first satisfiable real preset (or the fallback); when on the fallback and a
 * real preset becomes satisfiable, switch to it. Null = stay.
 */
export function autoSwitchPreset(presets: readonly LoadoutPreset[], levels: BaseLevels, selectedKey: string): string | null {
  const real = presets.filter((p) => !p.isFallback)
  const fallback = presets.find((p) => p.isFallback)
  const selected = presets.find((p) => p.id === selectedKey)
  const firstOk = real.find((p) => !hasUnmet(unmetRequirements(levels, p.requirements)))
  if (selected && !selected.isFallback && hasUnmet(unmetRequirements(levels, selected.requirements))) {
    return (firstOk ?? fallback)?.id ?? null
  }
  if (selected?.isFallback && firstOk) return firstOk.id
  return null
}


export function switchedNote(fromName: string, toName: string): string {
  return `Switched to ${toName}. ${fromName} needs`
}


export const ALL_BLOCKED_NOTE = 'All equipment sets need higher combat levels. Staying on No Equipment until you level up:'

// ---------------------------------------------------------------------------
// Editor edits (scim gde)
// ---------------------------------------------------------------------------

export const RUNE_POUCH_IDS: Record<number, RunePouch['kind']> = { 12791: 'standard', 27281: 'divine' }

export function isRunePouch(id: number | undefined): boolean {
  return id !== undefined && RUNE_POUCH_IDS[id] !== undefined
}

/** scim: rebuild the pouch from the first pouch in the inventory keeping existing runes. */
export function rebuildRunePouch(inventory: Inventory, current: RunePouch | null): RunePouch | null {
  const pouch = inventory.find((i) => i !== null && isRunePouch(i.id))
  if (!pouch) return null
  const kind = RUNE_POUCH_IDS[pouch.id]!
  const prev = current?.slots ?? []
  const n = kind === 'divine' ? 4 : 3
  const slots: RunePouch['slots'] = []
  for (let i = 0; i < n; i++) slots.push(prev[i] ?? null)
  return { kind, slots }
}

/** Set/clear an equipment slot; 2h weapons drop the shield and a shield drops a 2h weapon. */
export function setEquipmentSlot(l: Loadout, slot: EquipSlot, id: number | undefined, isTwoHanded: (id: number) => boolean): Loadout {
  const equipment: Equipment = { ...l.equipment }
  if (id === undefined) delete equipment[slot]
  else equipment[slot] = id
  if (slot === 'weapon' && equipment.weapon !== undefined && isTwoHanded(equipment.weapon)) delete equipment.shield
  if (slot === 'shield' && equipment.shield !== undefined && equipment.weapon !== undefined && isTwoHanded(equipment.weapon)) delete equipment.weapon
  return { ...l, equipment }
}

/** Inventory slot edit: quantity inherited from the previous entry. */
export function setInventorySlot(l: Loadout, index: number, id: number | undefined): Loadout {
  const inventory = [...l.inventory]
  const prev = inventory[index] ?? null
  const entry: InventoryItem | null = id === undefined ? null : prev?.quantity !== undefined ? { id, quantity: prev.quantity } : { id }
  inventory[index] = entry
  const touchesPouch = isRunePouch(prev?.id) || isRunePouch(id)
  const supplies = touchesPouch ? { ...l.supplies, runePouch: rebuildRunePouch(inventory, l.supplies.runePouch) } : l.supplies
  return { ...l, inventory, supplies }
}

/** scim: set one rune pouch slot. */
export function setRunePouchSlot(l: Loadout, index: number, id: number | undefined): Loadout {
  const pouch = l.supplies.runePouch
  if (!pouch) return l
  const slots = [...pouch.slots]
  slots[index] = id === undefined ? null : { id }
  return { ...l, supplies: { ...l.supplies, runePouch: { ...pouch, slots } } }
}

/** Spellbook change keeps the selected spell only when it belongs to the new book. */
export function setSpellbook(l: Loadout, book: Spellbook, spellBook: (spell: string) => Spellbook | undefined): Loadout {
  const keep = l.supplies.selectedSpell !== null && spellBook(l.supplies.selectedSpell) === book
  return { ...l, supplies: { ...l.supplies, spellbook: book, selectedSpell: keep ? l.supplies.selectedSpell : null } }
}

/** Quiver ids. */
export const QUIVER_IDS: ReadonlySet<number> = new Set([28826, 28947, 28949, 28951, 28953, 28828, 28955, 28957, 28830, 28902, 28906])

export function hasQuiver(l: Loadout): boolean {
  if (l.equipment.cape !== undefined && QUIVER_IDS.has(l.equipment.cape)) return true
  return l.inventory.some((i) => i !== null && QUIVER_IDS.has(i.id))
}

// ---------------------------------------------------------------------------
// Custom preset naming
// ---------------------------------------------------------------------------

export function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

export function uniqueName(base: string, taken: readonly string[]): string {
  const has = (n: string) => taken.some((t) => sameName(t, n))
  if (!has(base)) return base
  for (let i = 2; i <= taken.length + 1; i++) {
    const n = `${base} ${i}`
    if (!has(n)) return n
  }
  return `${base} ${taken.length + 2}`
}

/** Up to two icon ids for a preset tile: weapon then body. */
export function tileIconIds(l: Loadout): number[] {
  return [l.equipment.weapon, l.equipment.body].filter((x): x is number => x !== undefined).slice(0, 2)
}
