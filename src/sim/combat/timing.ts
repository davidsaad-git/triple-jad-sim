/**
 * Projectile timing and hit delays (scim, `ry`, `iy`,
 *; per-weapon tables).
 */
import { canonicalItemId } from '../items/variants'
import { weaponCategoryId, type LegacyDelayCategory } from './weaponCategories'

export interface ProjectileTiming {
  delay: number
  lengthAdjustment: number
  stepMultiplier: number
  progress: number
}


export const PROJECTILE_TIMINGS = {
  magic_spell: { delay: 51, lengthAdjustment: -5, stepMultiplier: 10, progress: 64 },
  tumekens_shadow: { delay: 56, lengthAdjustment: 16, stepMultiplier: 10, progress: 40 },
  eye_of_ayak: { delay: 51, lengthAdjustment: -5, stepMultiplier: 5, progress: 64 },
  arrow: { delay: 41, lengthAdjustment: 5, stepMultiplier: 5, progress: 11 },
  thrown: { delay: 32, lengthAdjustment: 0, stepMultiplier: 5, progress: 11 },
} as const satisfies Record<string, ProjectileTiming>

/** scim: projectile flight in client cycles. */
export function projectileCycles(t: { delay: number; lengthAdjustment: number; stepMultiplier: number }, distance: number): number {
  return t.delay + t.lengthAdjustment + t.stepMultiplier * distance
}

/** scim: player hit delay in ticks. */
export function playerHitDelayFromCycles(cycles: number): number {
  return 1 + Math.floor(cycles / 30)
}

/** scim: NPC hit delay in ticks. */
export function npcHitDelayFromCycles(cycles: number): number {
  return Math.floor(cycles / 30)
}

/** scim: legacy delays for weapons without a timing entry. */
export function legacyHitDelay(category: LegacyDelayCategory, distance: number): number {
  switch (category) {
    case 'melee':
      return 1
    case 'bow':
      return 1 + Math.floor((distance + 3) / 6)
    case 'thrown':
      return 1 + Math.floor(distance / 6)
    case 'magic':
      return 1 + Math.floor((distance + 1) / 3)
    case 'magic_slow':
      return 2 + Math.floor((distance + 1) / 3)
  }
}

const SANGUINE_TIMING: ProjectileTiming = { delay: 46, lengthAdjustment: 0, stepMultiplier: 10, progress: 64 }
const ACCURSED_SPEC_TIMING: ProjectileTiming = { delay: 50, lengthAdjustment: -4, stepMultiplier: 10, progress: 70 }

/** scim: by weapon category. */
const BY_CATEGORY: Readonly<Record<string, ProjectileTiming>> = {
  bow: PROJECTILE_TIMINGS.arrow,
  crossbow: PROJECTILE_TIMINGS.arrow,
  thrown: PROJECTILE_TIMINGS.thrown,
  powered_staff: PROJECTILE_TIMINGS.magic_spell,
}

/** scim: by weapon (canonical id). */
const BY_WEAPON: Readonly<Record<number, ProjectileTiming>> = {
  12926: { ...PROJECTILE_TIMINGS.thrown, progress: 105 },
  27275: PROJECTILE_TIMINGS.tumekens_shadow,
  31113: PROJECTILE_TIMINGS.eye_of_ayak,
  30070: PROJECTILE_TIMINGS.magic_spell,
  27665: SANGUINE_TIMING,
}

/** scim: special-attack timings. */
const SPEC_BY_WEAPON: Readonly<Record<number, ProjectileTiming>> = {
  12926: { delay: 32, lengthAdjustment: 0, stepMultiplier: 7, progress: 105 },
  27665: ACCURSED_SPEC_TIMING,
  27679: ACCURSED_SPEC_TIMING,
  27676: ACCURSED_SPEC_TIMING,
  29591: { delay: 46, lengthAdjustment: 4, stepMultiplier: 4, progress: 80 },
}


export function weaponProjectileTiming(weaponId: number | undefined, isSpecial = false): ProjectileTiming | undefined {
  if (weaponId === undefined) return undefined
  const base = canonicalItemId(weaponId)
  const spec = isSpecial ? SPEC_BY_WEAPON[base] : undefined
  if (spec) return spec
  const byWeapon = BY_WEAPON[base]
  if (byWeapon) return byWeapon
  const cat = weaponCategoryId(weaponId)
  return cat ? BY_CATEGORY[cat] : undefined
}
