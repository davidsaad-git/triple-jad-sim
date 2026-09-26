import type { CacheSystem } from '../cache/CacheSystem'
import { NpcTypeLoader } from '../cache/config/NpcType'
import { ObjTypeLoader } from '../cache/config/ObjType'
import type { ItemTypeInfo, NpcTypeInfo } from './menu'

/** Cached NPC / item type lookups for menus and tooltips (null when a type fails to load). */
export interface TypeLookup {
  npc(npcTypeId: number): NpcTypeInfo | null
  item(itemId: number): ItemTypeInfo | null
}

const lookups = new WeakMap<CacheSystem, TypeLookup>()

export function typeLookupFor(cache: CacheSystem): TypeLookup {
  const existing = lookups.get(cache)
  if (existing) return existing
  let npcLoader: NpcTypeLoader | null = null
  let objLoader: ObjTypeLoader | null = null
  const npcs = new Map<number, NpcTypeInfo | null>()
  const items = new Map<number, ItemTypeInfo | null>()
  const lookup: TypeLookup = {
    npc(id) {
      if (npcs.has(id)) return npcs.get(id) ?? null
      let info: NpcTypeInfo | null = null
      try {
        npcLoader ??= new NpcTypeLoader(cache)
        const t = npcLoader.load(id)
        info = { name: t.name, actions: [...t.actions], combatLevel: t.combatLevel }
      } catch {
        info = null
      }
      npcs.set(id, info)
      return info
    },
    item(id) {
      if (items.has(id)) return items.get(id) ?? null
      let info: ItemTypeInfo | null = null
      try {
        objLoader ??= new ObjTypeLoader(cache)
        const t = objLoader.load(id)
        info = { name: t.name, groundActions: [...t.groundActions] }
      } catch {
        info = null
      }
      items.set(id, info)
      return info
    },
  }
  lookups.set(cache, lookup)
  return lookup
}
