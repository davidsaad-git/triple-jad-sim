/**
 * Weapon identity data the player-attack sound resolver needs, extracted from
 * scim.gg's bundle:
 *
 * - `canonicalWeaponId`: scim, the item-variant -> base-item map
 *   built from `fl`. Only the entries whose base is a weapon the
 *   audio resolver or the weapon categories below care about are kept.
 * - the weapon sets used by, each already expanded with
 *   the item variants scim adds through `M5` (the `zy` map).
 * - weapon categories for crossbow / staff / powered staff /
 *   bow / thrown, used by the crossbow fallback, the equip sound kind and the
 *   projectile timing lookup.
 * - projectile impact timings `ny`.
 */

const CANONICAL: Readonly<Record<number, number>> = {
  12765: 11235, 12766: 11235, 12767: 11235, 12768: 11235, 29611: 11235,
  12773: 4151, 12774: 4151, 26482: 4151, 26484: 12006,
  12797: 11920, 23677: 11920, 25376: 11920, 30351: 11920,
  20000: 4587, 28031: 4587,
  20368: 11802, 29605: 11802, 20370: 11804, 20372: 11806, 20374: 11808,
  25063: 13243, 30345: 13243,
  25731: 22323, 25733: 22481, 25734: 22324,
  25736: 22325, 25739: 22325, 25738: 22486, 25741: 22486,
  25884: 25867, 25886: 25867, 25888: 25867, 25890: 25867, 25892: 25867, 25894: 25867, 25896: 25867, 33021: 25867,
  26486: 9185,
  26708: 13652, 28039: 13652,
  26710: 13576, 28035: 13576,
  27100: 21003,
  27246: 26219,
  28682: 21015,
  28688: 12926,
  29607: 27690,
  33314: 12899, 33318: 22292, 33322: 11907, 33323: 11905, 33326: 22288,
  33335: 28338,
}

export function canonicalWeaponId(id: number): number {
  return CANONICAL[id] ?? id
}

const set = (...ids: number[]): ReadonlySet<number> => new Set(ids)

/** Weapon sets of the resolver (base ids + variants). */
export const WEAPON_SETS = {
  /** Accursed sceptre (N5). */
  accursedSceptre: set(27662, 27665),
  /** Accursed sceptre (a) (Nxe). */
  accursedSceptreA: set(27676, 27679),
  /** Eye of Ayak (Pxe). */
  eyeOfAyak: set(31113, 31115),
  /** Tumeken's shadow (Fxe). */
  tumekensShadow: set(27275),
  /** Inquisitor's mace (Ixe). */
  inquisitorsMace: set(24417),
  /** Scythes (Lxe). */
  scythe: set(22325, 22486, 25736, 25738, 25739, 25740, 25741, 25742),
  /** Godswords (Rxe). */
  godsword: set(11802, 11804, 11806, 11808, 20368, 20370, 20372, 20374, 20593, 26233, 29605),
  /** Toxic blowpipe (P5). */
  blowpipe: set(12926),
  /** Bow of faerdhinen (zxe). */
  bowfa: set(25865, 25867, 25884, 25886, 25888, 25890, 25892, 25894, 25896, 33021),
  /** Dragon claws (J5). */
  dragonClaws: set(13652, 20784, 26708, 28039),
  /** Godswords with a special sound 3869 (Hxe). */
  godswordSpec: set(11802, 11806, 11808, 20368, 20372, 20374, 20593, 29605),
  /** Whips / tentacle (Y5). */
  whip: set(4151, 12006, 12773, 12774, 20405, 26482, 26484),
  /** Emberlight (Uxe). */
  emberlight: set(29589),
  /** Armadyl crossbow (Wxe). */
  armadylCrossbow: set(11785, 23611),
  /** Voidwaker (Gxe). */
  voidwaker: set(27690, 27869, 29607),
  /** Elder maul (X5). */
  elderMaul: set(21003, 27100),
  /** Abyssal bludgeon (Kxe). */
  abyssalBludgeon: set(13263),
  /** Burning claws (Z5). */
  burningClaws: set(29577),
  /** Scorching bow (qxe). */
  scorchingBow: set(29591),
} as const

export const ECLIPSE_ATLATL = 29000
export const SCORCHING_BOW = 29591

export type WeaponCategory = 'crossbow' | 'staff' | 'powered_staff' | 'bow' | 'thrown'

const CATEGORY: Readonly<Record<number, WeaponCategory>> = (() => {
  const out: Record<number, WeaponCategory> = {}
  const add = (cat: WeaponCategory, ids: number[]) => {
    for (const id of ids) out[id] = cat
  }
  add('crossbow', [9185, 11785, 26374])
  add('staff', [4675, 6914, 11791, 21006, 22296, 27624, 27676, 27679, 29594, 30070])
  add('powered_staff', [
    11905, 11907, 12899, 22288, 22292, 22323, 22481, 22552, 22555, 23898, 23899, 23900, 25731, 25733, 27275, 27277, 27662, 27665,
    28547, 28549, 28583, 28585, 28796, 31113, 31115, 33314, 33318, 33322, 33323, 33326,
  ])
  add('bow', [11235, 20997, 25865, 25867, 29000, 29591])
  add('thrown', [12926])
  return out
})()

/** scim: category of the canonical weapon (only the categories audio needs). */
export function weaponCategory(id: number | undefined): WeaponCategory | undefined {
  return id === undefined ? undefined : CATEGORY[canonicalWeaponId(id)]
}

/** Projectile impact timing (scim entries). */
export interface ImpactTiming {
  delay: number
  lengthAdjustment: number
  stepMultiplier: number
}

export const IMPACT_TIMING = {
  magic_spell: { delay: 51, lengthAdjustment: -5, stepMultiplier: 10 },
  tumekens_shadow: { delay: 56, lengthAdjustment: 16, stepMultiplier: 10 },
  eye_of_ayak: { delay: 51, lengthAdjustment: -5, stepMultiplier: 5 },
  arrow: { delay: 41, lengthAdjustment: 5, stepMultiplier: 5 },
  thrown: { delay: 32, lengthAdjustment: 0, stepMultiplier: 5 },
} as const satisfies Record<string, ImpactTiming>

/** scim: client cycles from the attack to the projectile arrival at Chebyshev distance `d`. */
export function impactCycles(t: ImpactTiming, d: number): number {
  return t.delay + t.lengthAdjustment + t.stepMultiplier * d
}

const CATEGORY_TIMING: Partial<Record<WeaponCategory, ImpactTiming>> = {
  bow: IMPACT_TIMING.arrow,
  crossbow: IMPACT_TIMING.arrow,
  thrown: IMPACT_TIMING.thrown,
  powered_staff: IMPACT_TIMING.magic_spell,
}
const WEAPON_TIMING: Readonly<Record<number, ImpactTiming>> = {
  12926: IMPACT_TIMING.thrown,
  27275: IMPACT_TIMING.tumekens_shadow,
  31113: IMPACT_TIMING.eye_of_ayak,
  30070: IMPACT_TIMING.magic_spell,
  27665: { delay: 46, lengthAdjustment: 0, stepMultiplier: 10 },
}
const SPEC_TIMING: Readonly<Record<number, ImpactTiming>> = {
  12926: { delay: 32, lengthAdjustment: 0, stepMultiplier: 7 },
  27665: { delay: 50, lengthAdjustment: -4, stepMultiplier: 10 },
  27679: { delay: 50, lengthAdjustment: -4, stepMultiplier: 10 },
  27676: { delay: 50, lengthAdjustment: -4, stepMultiplier: 10 },
  29591: { delay: 46, lengthAdjustment: 4, stepMultiplier: 4 },
}


export function weaponImpactTiming(weaponId: number | undefined, special = false): ImpactTiming | undefined {
  if (weaponId === undefined) return undefined
  const id = canonicalWeaponId(weaponId)
  const spec = special ? SPEC_TIMING[id] : undefined
  if (spec) return spec
  const own = WEAPON_TIMING[id]
  if (own) return own
  const cat = weaponCategory(weaponId)
  return cat ? CATEGORY_TIMING[cat] : undefined
}

/**
 * scim: Chebyshev distance from a tile to the nearest tile of a
 * `size` x `size` footprint whose south-west tile is (tx, ty).
 */
export function distanceToFootprint(sx: number, sy: number, tx: number, ty: number, size: number): number {
  const ex = tx + size - 1
  const ey = ty + size - 1
  const dx = sx < tx ? tx - sx : sx > ex ? sx - ex : 0
  const dy = sy < ty ? ty - sy : sy > ey ? sy - ey : 0
  return Math.max(dx, dy)
}
