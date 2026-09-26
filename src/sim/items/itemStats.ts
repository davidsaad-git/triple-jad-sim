/**
 * Equipment stats and weight from the cache (scim,
 *, seeking arrows).
 */
import type { ObjType, ObjTypeLoader } from '../../cache/config/ObjType'
import { ObjStackability } from '../../cache/config/ObjType'
import type { EquipSlot, Equipment, EquipmentStats, Inventory } from '../api'
import { canonicalItemId } from './variants'

type Slot = EquipSlot

/** The ten stat-bearing slots in scim's order (ammo excluded). */
export const STAT_SLOTS: readonly Slot[] = ['head', 'cape', 'amulet', 'weapon', 'body', 'shield', 'legs', 'hands', 'boots', 'ring']

/** scim: seeking arrows (ranged attack forced to 20, ranged strength from here). */
export const SEEKING_ARROWS: Readonly<Record<number, { baseArrowId: number; rangedStrength: number }>> = {
  33553: { baseArrowId: 882, rangedStrength: 7 },
  33559: { baseArrowId: 884, rangedStrength: 10 },
  33565: { baseArrowId: 886, rangedStrength: 16 },
  33571: { baseArrowId: 888, rangedStrength: 22 },
  33577: { baseArrowId: 890, rangedStrength: 31 },
  33583: { baseArrowId: 892, rangedStrength: 49 },
  33589: { baseArrowId: 21326, rangedStrength: 55 },
  33595: { baseArrowId: 11212, rangedStrength: 60 },
  33601: { baseArrowId: 4160, rangedStrength: 28 },
}

/** scim: per-item overrides merged over the cache params. */
const STAT_OVERRIDES: Readonly<Record<number, Partial<EquipmentStats>>> = {
  24417: { attackCrush: 102, meleeStrength: 96 },
  27679: { attackSpeed: 5 },
  28951: { attackRanged: 18, rangedStrength: 3 },
  29031: { attackMagic: -15, attackRanged: 31, defenceStab: 15, defenceSlash: 18, defenceCrush: 57, defenceMagic: 55, defenceRanged: 32, meleeStrength: 3 },
  29033: { attackMagic: -15, attackRanged: 17, defenceStab: 9, defenceSlash: 13, defenceCrush: 37, defenceMagic: 31, defenceRanged: 17, meleeStrength: 1 },
  29035: { attackMagic: -6, attackRanged: 8, defenceStab: 2, defenceSlash: 3, defenceCrush: 14, defenceMagic: 10, defenceRanged: 4, meleeStrength: 3 },
  29037: { attackMagic: 30, defenceCrush: 51, defenceMagic: 28, meleeStrength: 2, magicDamage: 1 },
  29801: { attackStab: 25, attackSlash: 25, attackCrush: 25, attackMagic: -6, attackRanged: -8, meleeStrength: 12, prayer: 2 },
  29806: { attackMagic: 5, attackRanged: 6, meleeStrength: 4, prayer: 1 },
  30076: { attackMagic: -15, attackRanged: 30, defenceStab: 55, defenceSlash: 47, defenceCrush: 60, defenceMagic: 56, defenceRanged: 55, prayer: 3 },
  30079: { attackMagic: -10, attackRanged: 17, defenceStab: 31, defenceSlash: 25, defenceCrush: 33, defenceMagic: 30, defenceRanged: 31, prayer: 2 },
  31097: {
    attackStab: 5,
    attackSlash: 5,
    attackCrush: 5,
    attackMagic: 11,
    attackRanged: 15,
    defenceStab: 21,
    defenceSlash: 25,
    defenceCrush: 25,
    defenceMagic: 10,
    defenceRanged: 10,
    meleeStrength: 6,
    rangedStrength: 3,
    magicDamage: 2,
  },
  27624: { magicDamage: 10 },
  33639: { attackRanged: 20, rangedStrength: 8, prayer: 3 },
}


export function emptyEquipmentStats(): EquipmentStats {
  return {
    attackStab: 0,
    attackSlash: 0,
    attackCrush: 0,
    attackMagic: 0,
    attackRanged: 0,
    defenceStab: 0,
    defenceSlash: 0,
    defenceCrush: 0,
    defenceMagic: 0,
    defenceRanged: 0,
    meleeStrength: 0,
    rangedStrength: 0,
    magicDamage: 0,
    prayer: 0,
    attackSpeed: 4,
    attackRange: 1,
  }
}

/** scim: numeric param or the fallback. */
function param(obj: ObjType, id: number, fallback = 0): number {
  const v = obj.params?.get(id)
  return typeof v === 'number' ? v : fallback
}


function applyOverrides(id: number, stats: EquipmentStats): EquipmentStats {
  const seeking = SEEKING_ARROWS[id]
  if (seeking !== undefined) return { ...stats, attackRanged: 20, rangedStrength: seeking.rangedStrength }
  const base = STAT_OVERRIDES[canonicalItemId(id)]
  const exact = STAT_OVERRIDES[id]
  return base === undefined && exact === undefined ? stats : { ...stats, ...base, ...exact }
}

/** scim: one item's stats from its cache params. */
export function itemStatsFromObj(obj: ObjType): EquipmentStats {
  return applyOverrides(obj.id, {
    attackStab: param(obj, 0),
    attackSlash: param(obj, 1),
    attackCrush: param(obj, 2),
    attackMagic: param(obj, 3),
    attackRanged: param(obj, 4),
    defenceStab: param(obj, 5),
    defenceSlash: param(obj, 6),
    defenceCrush: param(obj, 7),
    defenceMagic: param(obj, 8),
    defenceRanged: param(obj, 9),
    meleeStrength: param(obj, 10),
    rangedStrength: param(obj, 189) || param(obj, 12),
    magicDamage: param(obj, 299) / 10,
    prayer: param(obj, 11),
    attackSpeed: param(obj, 14, 4),
    attackRange: Math.max(1, param(obj, 13)),
  })
}

/** Loads an obj if the cache has it (scim's loader throws for unknown ids; ours returns a default). */
export function loadObj(loader: ObjTypeLoader, id: number): ObjType | null {
  if (!loader.has(id)) return null
  return loader.load(id)
}

/** scim: summed stats over the ten slots; the weapon's speed/range replace the totals. */
export function computeEquipmentStats(equipment: Equipment, loader: ObjTypeLoader): EquipmentStats {
  const out = emptyEquipmentStats()
  for (const slot of STAT_SLOTS) {
    const id = equipment[slot]
    if (id === undefined) continue
    const obj = loadObj(loader, id)
    if (!obj) continue
    const s = itemStatsFromObj(obj)
    out.attackStab += s.attackStab
    out.attackSlash += s.attackSlash
    out.attackCrush += s.attackCrush
    out.attackMagic += s.attackMagic
    out.attackRanged += s.attackRanged
    out.defenceStab += s.defenceStab
    out.defenceSlash += s.defenceSlash
    out.defenceCrush += s.defenceCrush
    out.defenceMagic += s.defenceMagic
    out.defenceRanged += s.defenceRanged
    out.meleeStrength += s.meleeStrength
    out.rangedStrength += s.rangedStrength
    out.magicDamage += s.magicDamage
    out.prayer += s.prayer
    if (slot === 'weapon') {
      out.attackSpeed = s.attackSpeed
      out.attackRange = s.attackRange
    }
  }
  return out
}

/** scim's (obj opcode 11). */
export function isStackableObj(obj: ObjType): boolean {
  return obj.stackability === ObjStackability.ALWAYS
}

/** scim: carried weight in kg (cache weight is grams). */
export function computeWeight(equipment: Equipment, inventory: Inventory, loader: ObjTypeLoader): number {
  let grams = 0
  for (const slot of STAT_SLOTS) {
    const id = equipment[slot]
    if (id === undefined) continue
    const obj = loadObj(loader, id)
    if (obj) grams += obj.weight
  }
  for (const item of inventory) {
    if (!item) continue
    const obj = loadObj(loader, item.id)
    if (!obj) continue
    const q = item.quantity ?? 1
    grams += isStackableObj(obj) ? obj.weight : obj.weight * q
  }
  return grams / 1000
}

/** Sum of two stat blocks keeping the first's speed/range. */
export function addItemStats(a: EquipmentStats, b: EquipmentStats): EquipmentStats {
  return {
    attackStab: a.attackStab + b.attackStab,
    attackSlash: a.attackSlash + b.attackSlash,
    attackCrush: a.attackCrush + b.attackCrush,
    attackMagic: a.attackMagic + b.attackMagic,
    attackRanged: a.attackRanged + b.attackRanged,
    defenceStab: a.defenceStab + b.defenceStab,
    defenceSlash: a.defenceSlash + b.defenceSlash,
    defenceCrush: a.defenceCrush + b.defenceCrush,
    defenceMagic: a.defenceMagic + b.defenceMagic,
    defenceRanged: a.defenceRanged + b.defenceRanged,
    meleeStrength: a.meleeStrength + b.meleeStrength,
    rangedStrength: a.rangedStrength + b.rangedStrength,
    magicDamage: a.magicDamage + b.magicDamage,
    prayer: a.prayer + b.prayer,
    attackSpeed: a.attackSpeed,
    attackRange: a.attackRange,
  }
}
