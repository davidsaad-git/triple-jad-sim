/**
 * Attack resources and ammo compatibility (`lb`/`ub`/`db`/`fb`). Ammo and runes are never consumed.
 */
import type { CombatSupplies, Equipment, Inventory } from '../api'
import { CATALOG_AMMO_KINDS } from '../data/generated/catalog'
import { SEEKING_ARROWS } from '../items/itemStats'
import { canonicalItemId } from '../items/variants'
import { checkSpell } from './spells'
import type { FormulaStyle } from './types'

export type AttackResources =
  | { kind: 'none'; source: 'none' }
  | { kind: 'unavailable'; source: 'none' }
  | { kind: 'spell'; source: 'none'; spellId: string }
  | { kind: 'ammo'; source: 'equipped' | 'quiver' | 'blowpipe'; ammoId: number }

export const NO_RESOURCES: AttackResources = { kind: 'none', source: 'none' }

const ATLATLS = new Set([29000, 29851])
const ATLATL_DART = 28991
const BLOWPIPE = 12926
/** The blowpipe always fires dragon darts in scim (supplies.blowpipe is ignored). */
export const BLOWPIPE_DART = 11230
const ARROW_WEAPONS = new Set([11235, 20997, 29591])
const STANDARD_BOLT_WEAPONS = new Set([9185])
const DRAGON_BOLT_WEAPONS = new Set([11785, 26374])

export type AmmoKind = 'atlatl_dart' | 'arrow' | 'standard_bolt' | 'dragon_bolt' | 'unsupported'


export function ammoKind(id: number): AmmoKind {
  if (id === ATLATL_DART) return 'atlatl_dart'
  if (SEEKING_ARROWS[id] !== undefined) return 'arrow'
  return CATALOG_AMMO_KINDS[id] ?? 'unsupported'
}

/** scim: ammo the ammo picker lists (arrows and bolts). */
export function isStandardAmmo(id: number): boolean {
  const k = ammoKind(id)
  return k === 'arrow' || k === 'standard_bolt' || k === 'dragon_bolt'
}

/** scim: weapons that cannot attack without ammo. */
export function weaponNeedsAmmo(weaponId: number | undefined): boolean {
  const w = weaponId === undefined ? undefined : canonicalItemId(weaponId)
  return w !== undefined && (ATLATLS.has(w) || ARROW_WEAPONS.has(w) || STANDARD_BOLT_WEAPONS.has(w) || DRAGON_BOLT_WEAPONS.has(w))
}


export function ammoFitsWeapon(weaponId: number, ammoId: number): boolean {
  const w = canonicalItemId(weaponId)
  const k = ammoKind(ammoId)
  if (ATLATLS.has(w)) return k === 'atlatl_dart'
  if (ARROW_WEAPONS.has(w)) return k === 'arrow'
  if (STANDARD_BOLT_WEAPONS.has(w)) return k === 'standard_bolt'
  return DRAGON_BOLT_WEAPONS.has(w) && (k === 'standard_bolt' || k === 'dragon_bolt')
}

export interface ResourceArgs {
  weaponId: number | undefined
  equipment: Equipment
  inventory: Inventory
  formulaStyle: FormulaStyle
  supplies: CombatSupplies
  magicLevel?: number
  manualCastSpell?: string | null
  /** When present (even null) it replaces supplies.selectedSpell (scim's). */
  activeSpell?: string | null
}


export function resolveAttackResources(args: ResourceArgs): AttackResources {
  const configured = 'activeSpell' in args ? (args.activeSpell ?? null) : args.supplies.selectedSpell
  const spell = args.manualCastSpell ?? (args.formulaStyle === 'magic' ? configured : null)
  if (spell) {
    const ok = checkSpell(spell, {
      equipment: args.equipment,
      inventory: args.inventory,
      runePouch: args.supplies.runePouch,
      ...(args.magicLevel === undefined ? {} : { magicLevel: args.magicLevel }),
    }).ok
    return ok ? { kind: 'spell', source: 'none', spellId: spell } : { kind: 'unavailable', source: 'none' }
  }
  const w = args.weaponId === undefined ? undefined : canonicalItemId(args.weaponId)
  if (w !== undefined && ATLATLS.has(w)) {
    return args.supplies.equippedAmmo?.id === ATLATL_DART ? { kind: 'ammo', source: 'equipped', ammoId: ATLATL_DART } : { kind: 'unavailable', source: 'none' }
  }
  if (w === BLOWPIPE) return { kind: 'ammo', source: 'blowpipe', ammoId: BLOWPIPE_DART }
  const weapon = args.weaponId
  const eq = args.supplies.equippedAmmo
  if (weapon !== undefined && eq !== null && ammoFitsWeapon(weapon, eq.id)) return { kind: 'ammo', source: 'equipped', ammoId: eq.id }
  const qv = args.supplies.quiverAmmo
  if (weapon !== undefined && qv !== null && ammoFitsWeapon(weapon, qv.id)) return { kind: 'ammo', source: 'quiver', ammoId: qv.id }
  return weaponNeedsAmmo(weapon) ? { kind: 'unavailable', source: 'none' } : NO_RESOURCES
}
