/**
 * Inventory helpers (scim, `_A`).
 */
import type { Inventory, InventoryItem } from '../api'
import type { ConsumeRule } from '../items/consumables'

export const INVENTORY_SIZE = 28


export function emptyInventory(): Inventory {
  return Array<InventoryItem | null>(INVENTORY_SIZE).fill(null)
}

/** scim: preset shorthand `{id, q}` -> `{id, quantity}` (quantity omitted when absent). */
export function inventoryFrom(list: readonly ({ id: number; q?: number } | null)[]): Inventory {
  const out = emptyInventory()
  for (let i = 0; i < Math.min(list.length, INVENTORY_SIZE); i++) {
    const e = list[i]
    if (e) out[i] = e.q === undefined ? { id: e.id } : { id: e.id, quantity: e.q }
  }
  return out
}

export function copyInventory(inv: Inventory): Inventory {
  return inv.map((i) => (i ? { ...i } : null))
}

/** scim: add an item (stackables merge); null when there is no room. */
export function addToInventory(inv: Inventory, id: number, quantity: number, stackable: boolean): Inventory | null {
  const out = copyInventory(inv)
  if (stackable) {
    const idx = out.findIndex((i) => i !== null && i.id === id)
    const cur = idx === -1 ? null : out[idx]!
    if (cur) {
      out[idx] = { id, quantity: (cur.quantity ?? 1) + quantity }
      return out
    }
  }
  const free = out.indexOf(null)
  if (free === -1) return null
  out[free] = stackable || quantity > 1 ? { id, quantity } : { id }
  return out
}


export function removeFromInventory(inv: Inventory, index: number): Inventory {
  if (!inv[index]) return inv
  const out = copyInventory(inv)
  out[index] = null
  return out
}


export function consumeInventory(inv: Inventory, index: number, rule: ConsumeRule): Inventory {
  const out = [...inv]
  const item = out[index] ?? null
  switch (rule.type) {
    case 'remove':
      out[index] = null
      break
    case 'replace':
      out[index] = { id: rule.withId }
      break
    case 'none':
      break
    case 'decrement': {
      if (item === null) break
      const q = item.quantity ?? 1
      out[index] = q > 1 ? { id: item.id, quantity: q - 1 } : null
      break
    }
  }
  return out
}

/** scim `countEmptySlotsInInventory`: empty slots plus the source slot itself. */
export function countFreeSlots(inv: Inventory, sourceIndex: number): number {
  let n = 0
  for (let i = 0; i < inv.length; i++) if (inv[i] === null || i === sourceIndex) n += 1
  return n
}
