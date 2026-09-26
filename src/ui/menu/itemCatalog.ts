/**
 * Item catalogs for the loadout editor's pickers. scim ships a wiki-derived list; we build ours from the cache
 * instead: every named, un-noted obj whose `wearPos1` maps to an equipment
 * slot (GY), ammo (`wearPos1 == 13`), plus the consumable table,
 * runes and rune pouches. "Verified" follows SIM support: armour is always
 * verified, weapons only when SIM knows how they attack.
 */
import type { CacheSystem } from '../../cache/CacheSystem'
import { ObjTypeLoader } from '../../cache/config/ObjType'
import type { EquipSlot } from '../../sim/api'
import { RUNE_POUCH_IDS } from './loadoutModel'
import type { SetupCatalog } from './inventorySetups'
import { CONSUMABLE_ITEM_IDS, FOOD_ITEM_IDS, LOADOUT_PRESETS, VERIFIED_WEAPON_IDS } from './simBridge'

export type ItemCategory = 'food' | 'potions' | 'runes' | 'gear' | 'other'

export interface CatalogItem {
  id: number
  name: string
  verified: boolean
  category?: ItemCategory
  twoHanded?: boolean
}

/** scim: wearPos1 -> slot. */
const WEAR_POS_SLOT: Record<number, EquipSlot> = { 0: 'head', 1: 'cape', 2: 'amulet', 3: 'weapon', 4: 'body', 5: 'shield', 7: 'legs', 9: 'hands', 10: 'boots', 12: 'ring' }
const AMMO_WEAR_POS = 13

/** Rune ids grouped like the rune pouch tray. */
export const RUNE_GROUPS: { key: string; runes: number[] }[] = [
  { key: 'elemental', runes: [556, 555, 557, 554] },
  { key: 'combination', runes: [4695, 4696, 4698, 4697, 4694, 4699] },
  { key: 'catalytic', runes: [558, 559, 564, 562, 561, 563, 560, 565, 566, 21880, 30843] },
]
const RUNE_IDS = RUNE_GROUPS.flatMap((g) => g.runes)

/** Dragon/standard bolt and arrow names allowed in the ammo picker. */
const ARROW_RE = /^(?:bronze|iron|steel|mithril|adamant|rune|broad|amethyst|dragon)(?: fire)? arrows?/i
const BOLT_RE =
  /^(?:bronze|blurite|iron|steel|mithril|adamant|runite|silver|broad|amethyst broad|opal|jade|pearl|topaz|sapphire|emerald|ruby|diamond|dragonstone|onyx) bolts?/i
const DRAGON_BOLT_RE = /^(?:dragon|opal dragon|jade dragon|pearl dragon|topaz dragon|sapphire dragon|emerald dragon|ruby dragon|diamond dragon|dragonstone dragon|onyx dragon) bolts?/i

export interface ItemCatalog extends SetupCatalog {
  equipment(slot: EquipSlot): CatalogItem[]
  ammo(): CatalogItem[]
  quiverAmmo(): CatalogItem[]
  inventory(): CatalogItem[]
  name(id: number): string | undefined
}

function presetIds(): Set<number> {
  const s = new Set<number>()
  for (const p of LOADOUT_PRESETS) {
    for (const id of Object.values(p.loadout.equipment)) if (id !== undefined) s.add(id)
    for (const i of p.loadout.inventory) if (i) s.add(i.id)
    const sup = p.loadout.supplies
    for (const r of [sup.equippedAmmo, sup.quiverAmmo, sup.blowpipe]) if (r) s.add(r.id)
  }
  return s
}

let cached: { cache: CacheSystem; catalog: ItemCatalog } | null = null

/** Built once per cache (decodes every obj; ~100-300 ms), then memoised. */
export function getItemCatalog(cache: CacheSystem): ItemCatalog {
  if (cached && cached.cache === cache) return cached.catalog
  const catalog = buildCatalog(cache)
  cached = { cache, catalog }
  return catalog
}

function buildCatalog(cache: CacheSystem): ItemCatalog {
  const loader = new ObjTypeLoader(cache)
  const bySlot = new Map<EquipSlot, CatalogItem[]>()
  const ammo: CatalogItem[] = []
  const names = new Map<number, string>()
  const presetItems = presetIds()
  const seenName = new Map<string, CatalogItem>()
  for (const id of loader.ids) {
    let obj
    try {
      obj = loader.load(id)
    } catch {
      continue
    }
    const name = obj.name
    if (!name || name === 'null' || obj.isNoted || obj.isPlaceholder) continue
    names.set(id, name)
    const slot = WEAR_POS_SLOT[obj.wearPos1]
    const isAmmo = obj.wearPos1 === AMMO_WEAR_POS
    if (!slot && !isAmmo) continue
    // Collapse duplicate names per slot keeping the lowest id, unless a preset uses another id.
    const key = `${slot ?? 'ammo'}|${name.toLowerCase()}`
    const prev = seenName.get(key)
    if (prev && !presetItems.has(id)) continue
    const verified = slot === 'weapon' ? VERIFIED_WEAPON_IDS.has(id) || presetItems.has(id) : true
    const item: CatalogItem = { id, name, verified, category: 'gear', twoHanded: slot === 'weapon' && obj.wearPos2 === 5 }
    if (prev && presetItems.has(id)) {
      const list = slot ? bySlot.get(slot) : ammo
      if (list) {
        const i = list.indexOf(prev)
        if (i >= 0) list.splice(i, 1)
      }
    }
    seenName.set(key, item)
    if (slot) {
      let list = bySlot.get(slot)
      if (!list) bySlot.set(slot, (list = []))
      list.push(item)
    } else ammo.push(item)
  }
  const byName = (a: CatalogItem, b: CatalogItem) => a.name.localeCompare(b.name)
  for (const list of bySlot.values()) list.sort(byName)
  ammo.sort(byName)
  const ammoPicker = ammo.filter((i) => ARROW_RE.test(i.name) || BOLT_RE.test(i.name) || DRAGON_BOLT_RE.test(i.name) || presetItems.has(i.id))
  const quiverAmmo = ammoPicker.filter((i) => ARROW_RE.test(i.name) || /arrow/i.test(i.name))

  // Inventory catalog: consumables, pouches + runes, then gear.
  const inv = new Map<number, CatalogItem>()
  for (const id of CONSUMABLE_ITEM_IDS) {
    const name = names.get(id)
    if (!name) continue
    const category: ItemCategory = /\(\d+\)$/.test(name) ? 'potions' : FOOD_ITEM_IDS.has(id) ? 'food' : 'other'
    inv.set(id, { id, name, verified: true, category })
  }
  for (const id of [...Object.keys(RUNE_POUCH_IDS).map(Number), ...RUNE_IDS]) {
    const name = names.get(id)
    if (name && !inv.has(id)) inv.set(id, { id, name, verified: true, category: 'runes' })
  }
  for (const list of [...bySlot.values(), ammo]) for (const it of list) if (!inv.has(it.id)) inv.set(it.id, it)
  for (const id of presetItems) {
    const name = names.get(id)
    if (name && !inv.has(id)) inv.set(id, { id, name, verified: true, category: 'gear' })
  }
  const inventory = [...inv.values()].sort(byName)

  const findIn = (list: CatalogItem[] | undefined, id: number) => list?.find((i) => i.id === id)
  return {
    equipment: (slot) => bySlot.get(slot) ?? [],
    ammo: () => ammoPicker,
    quiverAmmo: () => quiverAmmo,
    inventory: () => inventory,
    name: (id) => names.get(id),
    inventoryItem: (id) => inv.get(id),
    equipmentItem: (slot, id) => findIn(bySlot.get(slot), id),
    isTwoHanded: (id) => findIn(bySlot.get('weapon'), id)?.twoHanded === true,
  }
}

/** Item icon path; generated by CLIENT-UI's build-ui-assets. */
export { itemIconUrl } from '../packs'
