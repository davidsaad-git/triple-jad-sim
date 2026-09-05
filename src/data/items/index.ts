import equipmentJson from './equipment.json'

export type EquipmentSlot = 'head' | 'cape' | 'neck' | 'ammo' | 'weapon' | 'body' | 'shield' | 'legs' | 'hands' | 'feet' | 'ring'

export interface EquipmentItem {
  name: string
  id: number
  slot: EquipmentSlot
  astab: number
  aslash: number
  acrush: number
  amagic: number
  arange: number
  dstab: number
  dslash: number
  dcrush: number
  dmagic: number
  drange: number
  str: number
  rstr: number
  mdmg: number
  prayer: number
  speed?: number
  attackrange?: number
  combatstyle?: string
}

export const EQUIPMENT: readonly EquipmentItem[] = equipmentJson as EquipmentItem[]
export const EQUIPMENT_BY_ID: ReadonlyMap<number, EquipmentItem> = new Map(EQUIPMENT.map((e) => [e.id, e]))
export const EQUIPMENT_BY_NAME: ReadonlyMap<string, EquipmentItem> = new Map(EQUIPMENT.map((e) => [e.name.toLowerCase(), e]))

export function findItem(idOrName: number | string): EquipmentItem | undefined {
  return typeof idOrName === 'number' ? EQUIPMENT_BY_ID.get(idOrName) : EQUIPMENT_BY_NAME.get(idOrName.toLowerCase())
}
