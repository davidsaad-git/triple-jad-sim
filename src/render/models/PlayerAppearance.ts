/**
 * Player appearance description: the identikit body parts, the five body
 * colours and the worn equipment. This is the data the client receives in the
 * appearance block of a player update; `PlayerModelBuilder` turns it into a
 * model the way `PlayerComposition.getModel()` does.
 *
 * Kit ids are identikit config ids (index 2, archive 3). Their `bodyPartId`
 * gives the part: 0 hair, 1 jaw, 2 torso, 3 arms, 4 hands, 5 legs, 6 feet for
 * male kits and 7..13 for the female equivalents. The build-240 cache holds
 * (male) hair 0-9 + more, jaw 10-17, torso 18-25, arms 26-32, hands 33-35,
 * legs 36-41, feet 42-44 for the classic set.
 */

export type EquipmentSlotName =
  | 'head'
  | 'cape'
  | 'neck'
  | 'weapon'
  | 'body'
  | 'shield'
  | 'legs'
  | 'hands'
  | 'feet'
  | 'ring'
  | 'ammo'

export type PlayerEquipment = Partial<Record<EquipmentSlotName, number>>

export interface PlayerAppearance {
  male: boolean
  /** Seven identikit ids in the order hair, jaw, torso, arms, hands, legs, feet. */
  kits: number[]
  /** Five colour indexes in the order hair, torso, legs, feet, skin (see `BODY_COLOR_TABLES`). */
  colors: number[]
  /** Worn item ids by slot; absent / -1 means nothing worn. */
  equipment: PlayerEquipment
}

/** Index into `PlayerAppearance.kits`. */
export const KitIndex = {
  Hair: 0,
  Jaw: 1,
  Torso: 2,
  Arms: 3,
  Hands: 4,
  Legs: 5,
  Feet: 6,
} as const
export type KitIndex = (typeof KitIndex)[keyof typeof KitIndex]

/** Index into `PlayerAppearance.colors`. */
export const ColorIndex = {
  Hair: 0,
  Torso: 1,
  Legs: 2,
  Feet: 3,
  Skin: 4,
} as const
export type ColorIndex = (typeof ColorIndex)[keyof typeof ColorIndex]

/**
 * The client's twelve appearance slots (`PlayerComposition.equipment[12]`),
 * which are also the item `wearPos` values. Ring (12) and ammo (13) exist as
 * wear positions but have no appearance slot: they never contribute models.
 */
export const AppearanceSlot = {
  Head: 0,
  Cape: 1,
  Neck: 2,
  Weapon: 3,
  Torso: 4,
  Shield: 5,
  Arms: 6,
  Legs: 7,
  Hair: 8,
  Hands: 9,
  Feet: 10,
  Jaw: 11,
} as const
export type AppearanceSlot = (typeof AppearanceSlot)[keyof typeof AppearanceSlot]

export const APPEARANCE_SLOT_COUNT = 12

/** Wear positions of the named equipment slots (ObjType opcode 13 `wearPos1`). */
export const EQUIPMENT_WEAR_POS: Record<EquipmentSlotName, number> = {
  head: 0,
  cape: 1,
  neck: 2,
  weapon: 3,
  body: 4,
  shield: 5,
  legs: 7,
  hands: 9,
  feet: 10,
  ring: 12,
  ammo: 13,
}

/** Appearance slot each kit index fills when no item covers it. */
export const KIT_APPEARANCE_SLOT: Record<KitIndex, AppearanceSlot> = {
  [KitIndex.Hair]: AppearanceSlot.Hair,
  [KitIndex.Jaw]: AppearanceSlot.Jaw,
  [KitIndex.Torso]: AppearanceSlot.Torso,
  [KitIndex.Arms]: AppearanceSlot.Arms,
  [KitIndex.Hands]: AppearanceSlot.Hands,
  [KitIndex.Legs]: AppearanceSlot.Legs,
  [KitIndex.Feet]: AppearanceSlot.Feet,
}

/**
 * The client's `PlayerComposition` body-colour tables (packed HSL16). The
 * merged body model is recoloured `BODY_COLOR_FROM[i] -> BODY_COLOR_TABLES[i][colors[i]]`
 * for i in hair, torso, legs, feet, skin. The kit models are authored with the
 * `BODY_COLOR_FROM` colours (verified against the build-240 kit models: hair
 * 6798 on the jaw, 8741 on torso/arms, 25238 on legs, 4626 on feet, 4550 skin).
 * Index 0 of every table is the identity colour.
 */
export const BODY_COLOR_FROM: readonly number[] = [6798, 8741, 25238, 4626, 4550]

export const BODY_COLOR_TABLES: readonly (readonly number[])[] = [
  // hair
  [6798, 107, 10283, 16, 4797, 7744, 5799, 4634, 33697, 22433, 2983, 54193, 8, 5281, 10438, 3650, 38214, 43691, 200, 571, 908, 21830, 28946, 49835, 51526],
  // torso
  [8741, 12, 64030, 43162, 7735, 8404, 1701, 38430, 24094, 10153, 56621, 4783, 1341, 16578, 35003, 25239],
  // legs
  [25238, 8742, 12, 64030, 43162, 7735, 8404, 1701, 38430, 24094, 10153, 56621, 4783, 1341, 16578, 35003],
  // feet
  [4626, 11146, 6439, 12, 4758, 10270],
  // skin
  [4550, 4537, 5681, 5673, 5790, 6806, 8076, 4574],
]

/** Replacement colour for body colour slot `slot` and colour index `index` (clamped to the table). */
export function bodyColor(slot: number, index: number): number {
  const table = BODY_COLOR_TABLES[slot]
  if (!table || table.length === 0) return BODY_COLOR_FROM[slot] ?? 0
  const i = Math.min(Math.max(index | 0, 0), table.length - 1)
  return table[i]!
}

/**
 * The classic default male look (what a fresh character wears): kits 0 hair,
 * 10 jaw, 18 torso, 26 arms, 33 hands, 36 legs, 42 feet, all colour index 0.
 */
export const DEFAULT_MALE_KITS: readonly number[] = [0, 10, 18, 26, 33, 36, 42]
/** Female counterparts (body parts 7..13): 45 hair, no jaw (-1), 56 torso, 61 arms, 67 hands, 70 legs, 79 feet. */
export const DEFAULT_FEMALE_KITS: readonly number[] = [45, -1, 56, 61, 67, 70, 79]
export const DEFAULT_COLORS: readonly number[] = [0, 0, 0, 0, 0]

export function defaultAppearance(male = true): PlayerAppearance {
  return {
    male,
    kits: [...(male ? DEFAULT_MALE_KITS : DEFAULT_FEMALE_KITS)],
    colors: [...DEFAULT_COLORS],
    equipment: {},
  }
}

/** Stable string key for caching models built from an appearance. */
export function appearanceKey(a: PlayerAppearance): string {
  const eq = (Object.keys(EQUIPMENT_WEAR_POS) as EquipmentSlotName[]).map((s) => a.equipment[s] ?? -1)
  return `${a.male ? 'm' : 'f'}|${a.kits.join(',')}|${a.colors.join(',')}|${eq.join(',')}`
}
