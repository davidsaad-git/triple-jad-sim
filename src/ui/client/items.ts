/**
 * Item facts the chrome needs, read from the cache ObjType (scim reads the
 * same fields through its `objTypeLoader`): display name, inventory actions,
 * wear position, stackability, and the special-attack weapon enum (906).
 */
import type { CacheSystem } from '../../cache/CacheSystem'
import { EnumTypeLoader } from '../../cache/config/EnumType'
import { ObjStackability, ObjTypeLoader } from '../../cache/config/ObjType'
import type { EquipSlot, Inventory, InventoryItem } from '../../sim/api'

export interface ItemInfo {
  id: number
  name: string
  /** Five inventory ops (null = empty), like the cache `inventoryActions`. */
  inventoryActions: readonly (string | null)[]
  wearPos1: number
  wearPos2: number
  stackable: boolean
}

/** scim: wearPos1 -> equipment slot (13 = ammo). */
const WEAR_POS_SLOT: Readonly<Record<number, EquipSlot>> = { 0: 'head', 1: 'cape', 2: 'amulet', 3: 'weapon', 4: 'body', 5: 'shield', 7: 'legs', 9: 'hands', 10: 'boots', 12: 'ring' }
export const AMMO_WEAR_POS = 13
/** Special attack weapons enum (scim = 906). */
export const SPECIAL_ATTACK_ENUM = 906

interface CacheItemLookup {
  item(id: number): ItemInfo | null
  specialWeapons(): ReadonlySet<number>
}

const lookups = new WeakMap<CacheSystem, CacheItemLookup>()

export function itemLookup(cache: CacheSystem): CacheItemLookup {
  const existing = lookups.get(cache)
  if (existing) return existing
  let loader: ObjTypeLoader | null = null
  let specials: Set<number> | null = null
  const infos = new Map<number, ItemInfo | null>()
  const lookup: CacheItemLookup = {
    item(id) {
      const hit = infos.get(id)
      if (hit !== undefined) return hit
      let info: ItemInfo | null = null
      try {
        loader ??= new ObjTypeLoader(cache)
        if (loader.has(id)) {
          const t = loader.load(id)
          info = {
            id,
            name: t.name,
            inventoryActions: [...t.inventoryActions],
            wearPos1: t.wearPos1,
            wearPos2: t.wearPos2,
            stackable: t.stackability === ObjStackability.ALWAYS || t.isNoted,
          }
        }
      } catch {
        info = null
      }
      infos.set(id, info)
      return info
    },
    specialWeapons() {
      if (specials) return specials
      specials = new Set()
      try {
        const e = new EnumTypeLoader(cache).load(SPECIAL_ATTACK_ENUM)
        e.keys.forEach((k, i) => {
          if ((e.intValues[i] ?? 0) > 0) specials!.add(k)
        })
      } catch {
        // enum missing: no weapon has a special attack
      }
      return specials
    },
  }
  lookups.set(cache, lookup)
  return lookup
}

/** Display name: the cache name, else a fallback. */
export function itemDisplayName(info: ItemInfo | null, fallback = 'Item'): string {
  return info && info.name && info.name !== 'null' ? info.name : fallback
}

/** First non-null inventory action (the left-click option), trimmed. */
export function firstInventoryAction(info: ItemInfo | null): string | null {
  if (!info) return null
  for (const a of info.inventoryActions) if (a != null) return a.trim()
  return null
}

export function equipSlotOf(info: ItemInfo | null): EquipSlot | 'ammo' | null {
  if (!info) return null
  if (info.wearPos1 === AMMO_WEAR_POS) return 'ammo'
  return WEAR_POS_SLOT[info.wearPos1] ?? null
}

/** Two-handed weapons occupy the shield slot too (wearPos2 == 5). */
export function isTwoHanded(info: ItemInfo | null): boolean {
  return !!info && info.wearPos1 === 3 && info.wearPos2 === 5
}

export function hasSpecialAttack(cache: CacheSystem, weaponId: number | undefined): boolean {
  return weaponId !== undefined && itemLookup(cache).specialWeapons().has(weaponId)
}

export type InventoryClickAction = { kind: 'drop' } | { kind: 'use' } | { kind: 'equip'; slot: EquipSlot | 'ammo' } | { kind: 'none' }

/**
 * What a left click on an inventory item does: shift-drop,
 * consumables are used, else the first cache action (wield/wear -> equip,
 * eat/drink/invigorate/use -> use), anything else nothing.
 */
export function inventoryClickAction(info: ItemInfo | null, isConsumable: boolean, shiftDrop: boolean): InventoryClickAction {
  if (shiftDrop) return { kind: 'drop' }
  if (isConsumable) return { kind: 'use' }
  if (!info) return { kind: 'none' }
  const op = firstInventoryAction(info)?.toLowerCase()
  if (op === 'wield' || op === 'wear') {
    const slot = equipSlotOf(info)
    return slot ? { kind: 'equip', slot } : { kind: 'none' }
  }
  if (op === 'eat' || op === 'drink' || op === 'invigorate' || op === 'use') return { kind: 'use' }
  return { kind: 'none' }
}

/**
 * Instant Inventory's predicted layout after equipping inventory slot `index`
 * into `slot` (UI-only preview; the real swap happens on the tick). The worn
 * item returns into the vacated slot; a two-handed weapon also sends the
 * shield to the first free slot (and a shield sends a 2h weapon back).
 */
export function predictEquip(
  inventory: Inventory,
  equipment: Partial<Record<EquipSlot, number>>,
  index: number,
  slot: EquipSlot,
  lookup: (id: number) => ItemInfo | null,
): { inventory: Inventory; equipment: Partial<Record<EquipSlot, number>> } | null {
  const item = inventory[index]
  if (!item) return null
  const inv: (InventoryItem | null)[] = inventory.slice()
  const eq = { ...equipment }
  const info = lookup(item.id)
  const returned: number[] = []
  const worn = eq[slot]
  if (worn !== undefined) returned.push(worn)
  eq[slot] = item.id
  if (slot === 'weapon' && isTwoHanded(info) && eq.shield !== undefined) {
    returned.push(eq.shield)
    delete eq.shield
  }
  if (slot === 'shield' && eq.weapon !== undefined && isTwoHanded(lookup(eq.weapon))) {
    returned.push(eq.weapon)
    delete eq.weapon
  }
  inv[index] = null
  for (const id of returned) {
    const free = inv[index] === null ? index : inv.findIndex((s) => s === null)
    if (free === -1) return null
    inv[free] = { id }
  }
  return { inventory: inv, equipment: eq }
}
