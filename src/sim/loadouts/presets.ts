/**
 * scim's Zuk loadout presets in scim's order with
 * requirements computed like scim.
 */
import type { CombatSupplies, Loadout, RunePouch, SkillName } from '../api'
import { COMBINATION_RUNE, RUNE } from '../combat/spells'
import { emptyInventory, inventoryFrom } from '../player/inventory'
import { loadoutRequirements } from '../player/stats'

export interface LoadoutPreset {
  id: string
  name: string
  loadout: Loadout
  requirements: Partial<Record<SkillName, number>>
  isFallback?: boolean
}

/** scim: shared supply block (inventory slots 6..26). */
const SUPPLY_BLOCK = [
  { id: 6685 }, { id: 3024 }, { id: 6685 }, { id: 6685 }, { id: 3024 }, { id: 3024 }, { id: 6685 }, { id: 6685 }, { id: 3024 }, { id: 3024 },
  { id: 6685 }, { id: 6685 }, { id: 3024 }, { id: 3024 }, { id: 6685 }, { id: 22461 }, { id: 3024 }, { id: 30125 }, { id: 22461 }, { id: 12625 },
  { id: 30125 },
] as const

/** scim divine pouch: soul, blood, death, water. */
const DIVINE_POUCH: RunePouch = { kind: 'divine', slots: [{ id: RUNE.soul }, { id: RUNE.blood }, { id: RUNE.death }, { id: RUNE.water }] }
/** scim standard pouch: water, chaos, death. */
const STANDARD_POUCH: RunePouch = { kind: 'standard', slots: [{ id: RUNE.water }, { id: RUNE.chaos }, { id: RUNE.death }] }

function supplies(s: Omit<CombatSupplies, 'runePouch'> & { runePouch: RunePouch | null }): CombatSupplies {
  return {
    ...s,
    runePouch: s.runePouch ? { kind: s.runePouch.kind, slots: s.runePouch.slots.map((x) => (x ? { ...x } : null)) } : null,
  }
}

function preset(id: string, name: string, loadout: Loadout): LoadoutPreset {
  return { id, name, loadout, requirements: loadoutRequirements(loadout.equipment, loadout.inventory) }
}

const MAX_TBOW = preset('max_tbow', 'Max Tbow', {
  equipment: { head: 25912, cape: 28951, amulet: 33639, weapon: 20997, body: 27238, legs: 27241, hands: 26235, boots: 31097, ring: 28310 },
  inventory: inventoryFrom([{ id: 21006 }, { id: 12817 }, { id: 26243 }, { id: 26245 }, { id: 31106 }, { id: 12926 }, ...SUPPLY_BLOCK, { id: 27281 }]),
  supplies: supplies({
    equippedAmmo: { id: 22947 },
    quiverAmmo: { id: 33595 },
    runePouch: DIVINE_POUCH,
    blowpipe: { id: 11230 },
    selectedSpell: 'Ice Barrage',
    spellbook: 'ancient',
  }),
})

const BOWFA = preset('bowfa', 'Bowfa', {
  equipment: { head: 23971, cape: 22109, amulet: 19547, weapon: 25865, body: 23975, legs: 23979, hands: 7462, boots: 22954, ring: 26764 },
  inventory: inventoryFrom([{ id: 27624 }, { id: 23991 }, { id: 4712 }, { id: 4714 }, { id: 12002 }, { id: 12926 }, ...SUPPLY_BLOCK, { id: 27281 }]),
  supplies: supplies({
    equippedAmmo: { id: 22947 },
    quiverAmmo: null,
    runePouch: DIVINE_POUCH,
    blowpipe: { id: 25849 },
    selectedSpell: 'Ice Barrage',
    spellbook: 'ancient',
  }),
})

const ATLATL_ECLIPSE = preset('atlatl_eclipse', 'Atlatl / RCB (Eclipse)', {
  equipment: { head: 29035, cape: 22109, amulet: 6585, weapon: 9185, body: 29031, shield: 23991, legs: 29033, hands: 7462, boots: 29806, ring: 26764 },
  inventory: inventoryFrom([
    { id: 29000 }, { id: 28991, q: 4000 }, { id: 6914 }, { id: 4712 }, { id: 4714 }, { id: 12002 }, { id: 12926 }, { id: 6685 }, { id: 3024 }, { id: 6685 },
    { id: 6685 }, { id: 3024 }, { id: 3024 }, { id: 6685 }, { id: 6685 }, { id: 3024 }, { id: 3024 }, { id: 6685 }, { id: 6685 }, { id: 3024 },
    { id: 12695 }, { id: 22461 }, { id: 30125 }, { id: 30125 }, { id: 3024 }, { id: 12625 }, null, { id: 12791 },
  ]),
  supplies: supplies({
    equippedAmmo: { id: 9242 },
    quiverAmmo: null,
    runePouch: STANDARD_POUCH,
    blowpipe: { id: 25849 },
    selectedSpell: 'Ice Burst',
    spellbook: 'ancient',
  }),
})

const BUDGET_RCB = preset('budget_rcb', 'Budget (Rune xbow)', {
  equipment: { head: 4753, cape: 22109, amulet: 6585, weapon: 9185, body: 12492, shield: 23991, legs: 12494, hands: 7462, boots: 19921, ring: 26764 },
  inventory: inventoryFrom([
    { id: 6914 }, { id: 25404 }, { id: 25416 }, { id: 12002 }, { id: 12926 }, { id: 9243, q: 1000 }, { id: 6685 }, { id: 3024 }, { id: 6685 }, { id: 6685 },
    { id: 3024 }, { id: 3024 }, { id: 6685 }, { id: 6685 }, { id: 3024 }, { id: 3024 }, { id: 6685 }, { id: 6685 }, { id: 3024 }, { id: 3024 },
    { id: 6685 }, { id: 6685 }, { id: 22461 }, { id: 30125 }, { id: 30125 }, { id: 12625 }, null, { id: 12791 },
  ]),
  supplies: supplies({
    equippedAmmo: { id: 9242 },
    quiverAmmo: null,
    runePouch: STANDARD_POUCH,
    blowpipe: { id: 25849 },
    selectedSpell: 'Ice Burst',
    spellbook: 'ancient',
  }),
})

const MAGE_TANK = preset('mage_tank', 'Mage Tank', {
  equipment: { head: 21018, cape: 21791, amulet: 12002, weapon: 27275, body: 21021, legs: 21024, hands: 31106, boots: 31097, ring: 28313 },
  inventory: inventoryFrom([
    { id: 31113 }, { id: 22326 }, { id: 27251 }, null, { id: 4759 }, { id: 11832 }, { id: 6685 }, { id: 6685 }, { id: 31638 }, { id: 3024 },
    { id: 3024 }, { id: 6685 }, { id: 30125 }, { id: 3024 }, { id: 3024 }, { id: 6685 }, { id: 30125 }, { id: 3024 }, { id: 3024 }, { id: 6685 },
    { id: 30125 }, { id: 3024 }, { id: 3024 }, { id: 6685 }, { id: 3024 }, { id: 3024 }, { id: 27641 }, { id: 27281 },
  ]),
  supplies: supplies({
    equippedAmmo: { id: 22947 },
    quiverAmmo: null,
    runePouch: DIVINE_POUCH,
    blowpipe: null,
    selectedSpell: 'Ice Barrage',
    spellbook: 'ancient',
  }),
})

/** scim: the shared "No Equipment" fallback (default arceuus supplies). */
const NAKED: LoadoutPreset = {
  id: 'naked',
  name: 'No Equipment',
  loadout: {
    equipment: {},
    inventory: emptyInventory(),
    supplies: { equippedAmmo: null, quiverAmmo: null, runePouch: null, blowpipe: null, selectedSpell: null, spellbook: 'arceuus' },
  },
  requirements: {},
  isFallback: true,
}

export const LOADOUT_PRESETS: LoadoutPreset[] = [MAX_TBOW, BOWFA, ATLATL_ECLIPSE, BUDGET_RCB, MAGE_TANK, NAKED]

export const DEFAULT_PRESET_ID = 'max_tbow'

/** A fresh deep copy of a preset's loadout. */
export function presetLoadout(id: string): Loadout {
  const p = LOADOUT_PRESETS.find((x) => x.id === id) ?? LOADOUT_PRESETS[0]!
  const l = p.loadout
  return {
    equipment: { ...l.equipment },
    inventory: l.inventory.map((i) => (i ? { ...i } : null)),
    supplies: supplies(l.supplies),
  }
}

/** Unused-rune helper kept for loadout editors (combination runes). */
export const RUNE_IDS = { ...RUNE, ...COMBINATION_RUNE }
