/**
 * Combat spell table (scim, `py`, `kre`),
 * cast visuals, level requirements, rune costs
 * (`GA`) and the rune/level check `CL`/`SL`. Runes are only
 * presence-checked, never consumed.
 */
import type { Equipment, Inventory, RunePouch, Spellbook } from '../api'
import { canonicalItemId } from '../items/variants'

/** Rune ids. */
export const RUNE = {
  fire: 554,
  water: 555,
  air: 556,
  earth: 557,
  mind: 558,
  body: 559,
  death: 560,
  nature: 561,
  chaos: 562,
  law: 563,
  cosmic: 564,
  blood: 565,
  soul: 566,
  wrath: 21880,
} as const

/** Combination runes. */
export const COMBINATION_RUNE = { steam: 4694, mist: 4695, dust: 4696, smoke: 4697, mud: 4698, lava: 4699, aether: 30843 } as const

/** scim: combination rune -> the runes it provides. */
const COMBINATION_PROVIDES: Readonly<Record<number, readonly number[]>> = {
  [COMBINATION_RUNE.mist]: [RUNE.air, RUNE.water],
  [COMBINATION_RUNE.dust]: [RUNE.air, RUNE.earth],
  [COMBINATION_RUNE.smoke]: [RUNE.air, RUNE.fire],
  [COMBINATION_RUNE.mud]: [RUNE.water, RUNE.earth],
  [COMBINATION_RUNE.steam]: [RUNE.water, RUNE.fire],
  [COMBINATION_RUNE.lava]: [RUNE.earth, RUNE.fire],
  [COMBINATION_RUNE.aether]: [RUNE.cosmic, RUNE.soul],
}

/** scim: rune -> combination runes that provide it. */
const PROVIDED_BY: Readonly<Record<number, readonly number[]>> = (() => {
  const m = new Map<number, number[]>()
  for (const [combo, runes] of Object.entries(COMBINATION_PROVIDES)) {
    for (const r of runes) {
      const list = m.get(r) ?? []
      list.push(Number(combo))
      m.set(r, list)
    }
  }
  return Object.fromEntries(m)
})()

/** scim: staves/tomes that supply unlimited runes. */
const RUNE_SOURCES: Readonly<Record<number, readonly number[]>> = {
  1381: [RUNE.air], 1397: [RUNE.air], 1405: [RUNE.air], 1383: [RUNE.water], 1395: [RUNE.water], 1403: [RUNE.water], 21006: [RUNE.water],
  1385: [RUNE.earth], 1399: [RUNE.earth], 1407: [RUNE.earth], 1387: [RUNE.fire], 1393: [RUNE.fire], 1401: [RUNE.fire],
  3053: [RUNE.earth, RUNE.fire], 3054: [RUNE.earth, RUNE.fire], 6562: [RUNE.water, RUNE.earth], 6563: [RUNE.water, RUNE.earth],
  11787: [RUNE.water, RUNE.fire], 11789: [RUNE.water, RUNE.fire], 11998: [RUNE.air, RUNE.fire], 12000: [RUNE.air, RUNE.fire],
  20730: [RUNE.air, RUNE.water], 20733: [RUNE.air, RUNE.water], 20736: [RUNE.air, RUNE.earth], 20739: [RUNE.air, RUNE.earth],
  30634: [RUNE.water, RUNE.fire], 20714: [RUNE.fire], 25574: [RUNE.water], 30064: [RUNE.earth],
}

export type SecondaryEffect =
  | { kind: 'poison'; severity: number }
  | { kind: 'drain_attack'; percent: number }
  | { kind: 'leech_hp'; percentOfDamage: number }
  | { kind: 'freeze'; durationTicks: number }

export interface SpellDefinition {
  name: string
  spellbook: Spellbook
  element: 'air' | 'water' | 'earth' | 'fire' | null
  maxHit: number
  scalesWithMagic?: 'magic_dart'
  secondaryEffect?: SecondaryEffect
}


export const SPELLS: readonly SpellDefinition[] = [
  { name: 'Wind Strike', spellbook: 'standard', element: 'air', maxHit: 8 },
  { name: 'Water Strike', spellbook: 'standard', element: 'water', maxHit: 8 },
  { name: 'Earth Strike', spellbook: 'standard', element: 'earth', maxHit: 8 },
  { name: 'Fire Strike', spellbook: 'standard', element: 'fire', maxHit: 8 },
  { name: 'Wind Bolt', spellbook: 'standard', element: 'air', maxHit: 12 },
  { name: 'Water Bolt', spellbook: 'standard', element: 'water', maxHit: 12 },
  { name: 'Earth Bolt', spellbook: 'standard', element: 'earth', maxHit: 12 },
  { name: 'Fire Bolt', spellbook: 'standard', element: 'fire', maxHit: 12 },
  { name: 'Wind Blast', spellbook: 'standard', element: 'air', maxHit: 16 },
  { name: 'Water Blast', spellbook: 'standard', element: 'water', maxHit: 16 },
  { name: 'Earth Blast', spellbook: 'standard', element: 'earth', maxHit: 16 },
  { name: 'Fire Blast', spellbook: 'standard', element: 'fire', maxHit: 16 },
  { name: 'Wind Wave', spellbook: 'standard', element: 'air', maxHit: 20 },
  { name: 'Water Wave', spellbook: 'standard', element: 'water', maxHit: 20 },
  { name: 'Earth Wave', spellbook: 'standard', element: 'earth', maxHit: 20 },
  { name: 'Fire Wave', spellbook: 'standard', element: 'fire', maxHit: 20 },
  { name: 'Wind Surge', spellbook: 'standard', element: 'air', maxHit: 24 },
  { name: 'Water Surge', spellbook: 'standard', element: 'water', maxHit: 24 },
  { name: 'Earth Surge', spellbook: 'standard', element: 'earth', maxHit: 24 },
  { name: 'Fire Surge', spellbook: 'standard', element: 'fire', maxHit: 24 },
  { name: 'Saradomin Strike', spellbook: 'standard', element: null, maxHit: 20 },
  { name: 'Claws of Guthix', spellbook: 'standard', element: null, maxHit: 20 },
  { name: 'Flames of Zamorak', spellbook: 'standard', element: null, maxHit: 20 },
  { name: 'Crumble Undead', spellbook: 'standard', element: null, maxHit: 15 },
  { name: 'Iban Blast', spellbook: 'standard', element: null, maxHit: 25 },
  { name: 'Magic Dart', spellbook: 'standard', element: null, maxHit: 0, scalesWithMagic: 'magic_dart' },
  { name: 'Smoke Rush', spellbook: 'ancient', element: null, maxHit: 13, secondaryEffect: { kind: 'poison', severity: 10 } },
  { name: 'Shadow Rush', spellbook: 'ancient', element: null, maxHit: 14, secondaryEffect: { kind: 'drain_attack', percent: 10 } },
  { name: 'Blood Rush', spellbook: 'ancient', element: null, maxHit: 15, secondaryEffect: { kind: 'leech_hp', percentOfDamage: 25 } },
  { name: 'Ice Rush', spellbook: 'ancient', element: null, maxHit: 16, secondaryEffect: { kind: 'freeze', durationTicks: 8 } },
  { name: 'Smoke Burst', spellbook: 'ancient', element: null, maxHit: 17, secondaryEffect: { kind: 'poison', severity: 10 } },
  { name: 'Shadow Burst', spellbook: 'ancient', element: null, maxHit: 18, secondaryEffect: { kind: 'drain_attack', percent: 10 } },
  { name: 'Blood Burst', spellbook: 'ancient', element: null, maxHit: 21, secondaryEffect: { kind: 'leech_hp', percentOfDamage: 25 } },
  { name: 'Ice Burst', spellbook: 'ancient', element: null, maxHit: 22, secondaryEffect: { kind: 'freeze', durationTicks: 16 } },
  { name: 'Smoke Blitz', spellbook: 'ancient', element: null, maxHit: 23, secondaryEffect: { kind: 'poison', severity: 20 } },
  { name: 'Shadow Blitz', spellbook: 'ancient', element: null, maxHit: 24, secondaryEffect: { kind: 'drain_attack', percent: 15 } },
  { name: 'Blood Blitz', spellbook: 'ancient', element: null, maxHit: 25, secondaryEffect: { kind: 'leech_hp', percentOfDamage: 25 } },
  { name: 'Ice Blitz', spellbook: 'ancient', element: null, maxHit: 26, secondaryEffect: { kind: 'freeze', durationTicks: 24 } },
  { name: 'Smoke Barrage', spellbook: 'ancient', element: null, maxHit: 27, secondaryEffect: { kind: 'poison', severity: 20 } },
  { name: 'Shadow Barrage', spellbook: 'ancient', element: null, maxHit: 28, secondaryEffect: { kind: 'drain_attack', percent: 15 } },
  { name: 'Blood Barrage', spellbook: 'ancient', element: null, maxHit: 29, secondaryEffect: { kind: 'leech_hp', percentOfDamage: 25 } },
  { name: 'Ice Barrage', spellbook: 'ancient', element: null, maxHit: 30, secondaryEffect: { kind: 'freeze', durationTicks: 32 } },
  { name: 'Ghostly Grasp', spellbook: 'arceuus', element: null, maxHit: 12 },
  { name: 'Skeletal Grasp', spellbook: 'arceuus', element: null, maxHit: 17 },
  { name: 'Undead Grasp', spellbook: 'arceuus', element: null, maxHit: 24 },
  { name: 'Inferior Demonbane', spellbook: 'arceuus', element: null, maxHit: 16 },
  { name: 'Superior Demonbane', spellbook: 'arceuus', element: null, maxHit: 23 },
  { name: 'Dark Demonbane', spellbook: 'arceuus', element: null, maxHit: 30 },
]

/** scim: fixed hit delays. */
const FIXED_HIT_DELAY: Readonly<Record<string, number>> = { 'Inferior Demonbane': 2, 'Superior Demonbane': 2, 'Dark Demonbane': 2 }
/** scim: multi-target spells (radius 1, up to 9 targets). */
const MULTI_TARGET = new Set(['Smoke Burst', 'Shadow Burst', 'Blood Burst', 'Ice Burst', 'Smoke Barrage', 'Shadow Barrage', 'Blood Barrage', 'Ice Barrage'])
/** scim: non-damage spells excluded from combat lists. */
const NON_COMBAT = new Set(['Dark Lure', 'Lesser Corruption', 'Greater Corruption', 'Bind', 'Snare', 'Entangle', 'Confuse', 'Weaken', 'Curse', 'Vulnerability', 'Enfeeble', 'Stun', 'Tele Block'])

/** scim: icon/sprite name derived from the spell name (e.g. `ice_barrage`). */
export function spellIcon(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export interface SpellInfo {
  name: string
  spellbook: Spellbook
  icon: string
  attackRange: number
  fixedHitDelay?: number
  multiTarget?: { radius: number; maxTargets: number }
  secondaryEffect?: SecondaryEffect
}


export function spellInfo(name: string): SpellInfo | null {
  const def = SPELLS.find((sp) => sp.name === name)
  if (!def) return null
  const fixed = FIXED_HIT_DELAY[def.name]
  return {
    name: def.name,
    spellbook: def.spellbook,
    icon: spellIcon(def.name),
    attackRange: 10,
    ...(fixed === undefined ? {} : { fixedHitDelay: fixed }),
    ...(MULTI_TARGET.has(def.name) ? { multiTarget: { radius: 1, maxTargets: 9 } } : {}),
    ...(def.secondaryEffect === undefined ? {} : { secondaryEffect: def.secondaryEffect }),
  }
}

/** scim: combat spells of a spellbook. */
export function spellsOfBook(book: Spellbook): SpellDefinition[] {
  return SPELLS.filter((sp) => sp.spellbook === book && !NON_COMBAT.has(sp.name))
}

/** scim: magic level requirements. */
export const SPELL_LEVELS: Readonly<Record<string, number>> = {
  'Wind Strike': 1, 'Water Strike': 5, 'Earth Strike': 9, 'Fire Strike': 13, 'Wind Bolt': 17, 'Water Bolt': 23, 'Earth Bolt': 29,
  'Fire Bolt': 35, 'Crumble Undead': 39, 'Wind Blast': 41, 'Water Blast': 47, 'Iban Blast': 50, 'Magic Dart': 50, 'Earth Blast': 53,
  'Fire Blast': 59, 'Saradomin Strike': 60, 'Claws of Guthix': 60, 'Flames of Zamorak': 60, 'Wind Wave': 62, 'Water Wave': 65,
  'Earth Wave': 70, 'Fire Wave': 75, 'Wind Surge': 81, 'Water Surge': 85, 'Earth Surge': 90, 'Fire Surge': 95, 'Smoke Rush': 50,
  'Shadow Rush': 52, 'Blood Rush': 56, 'Ice Rush': 58, 'Smoke Burst': 62, 'Shadow Burst': 64, 'Blood Burst': 68, 'Ice Burst': 70,
  'Smoke Blitz': 74, 'Shadow Blitz': 76, 'Blood Blitz': 80, 'Ice Blitz': 82, 'Smoke Barrage': 86, 'Shadow Barrage': 88,
  'Blood Barrage': 92, 'Ice Barrage': 94, 'Ghostly Grasp': 35, 'Inferior Demonbane': 44, 'Skeletal Grasp': 56,
  'Superior Demonbane': 62, 'Undead Grasp': 79, 'Dark Demonbane': 82, 'Arceuus Home Teleport': 1, 'Mark of Darkness': 59, 'Death Charge': 80,
}

const R = RUNE
/** scim: rune types a spell needs. */
export const SPELL_RUNES: Readonly<Record<string, readonly number[]>> = {
  'Wind Strike': [R.air, R.mind], 'Water Strike': [R.water, R.air, R.mind], 'Earth Strike': [R.earth, R.air, R.mind], 'Fire Strike': [R.fire, R.air, R.mind],
  'Wind Bolt': [R.air, R.chaos], 'Water Bolt': [R.water, R.air, R.chaos], 'Earth Bolt': [R.earth, R.air, R.chaos], 'Fire Bolt': [R.fire, R.air, R.chaos],
  'Crumble Undead': [R.earth, R.air, R.chaos], 'Wind Blast': [R.air, R.death], 'Water Blast': [R.water, R.air, R.death], 'Iban Blast': [R.fire, R.death],
  'Magic Dart': [R.mind, R.death], 'Earth Blast': [R.earth, R.air, R.death], 'Fire Blast': [R.fire, R.air, R.death], 'Saradomin Strike': [R.fire, R.blood, R.air],
  'Claws of Guthix': [R.fire, R.blood, R.air], 'Flames of Zamorak': [R.fire, R.blood, R.air], 'Wind Wave': [R.air, R.blood], 'Water Wave': [R.water, R.air, R.blood],
  'Earth Wave': [R.earth, R.air, R.blood], 'Fire Wave': [R.fire, R.air, R.blood], 'Wind Surge': [R.air, R.wrath], 'Water Surge': [R.water, R.air, R.wrath],
  'Earth Surge': [R.earth, R.air, R.wrath], 'Fire Surge': [R.fire, R.air, R.wrath], 'Smoke Rush': [R.air, R.fire, R.chaos, R.death],
  'Shadow Rush': [R.air, R.chaos, R.death, R.soul], 'Blood Rush': [R.blood, R.chaos, R.death], 'Ice Rush': [R.water, R.chaos, R.death],
  'Smoke Burst': [R.air, R.fire, R.chaos, R.death], 'Shadow Burst': [R.air, R.chaos, R.death, R.soul], 'Blood Burst': [R.blood, R.chaos, R.death],
  'Ice Burst': [R.water, R.chaos, R.death], 'Smoke Blitz': [R.air, R.fire, R.blood, R.death], 'Shadow Blitz': [R.air, R.blood, R.death, R.soul],
  'Blood Blitz': [R.blood, R.death], 'Ice Blitz': [R.water, R.blood, R.death], 'Smoke Barrage': [R.air, R.fire, R.blood, R.death],
  'Shadow Barrage': [R.air, R.blood, R.death, R.soul], 'Blood Barrage': [R.blood, R.death, R.soul], 'Ice Barrage': [R.water, R.blood, R.death],
  'Inferior Demonbane': [R.fire, R.chaos], 'Superior Demonbane': [R.fire, R.soul], 'Dark Demonbane': [R.fire, R.soul], 'Ghostly Grasp': [R.air, R.chaos],
  'Skeletal Grasp': [R.earth, R.death], 'Undead Grasp': [R.fire, R.blood], 'Mark of Darkness': [R.cosmic, R.soul], 'Death Charge': [R.death, R.blood, R.soul],
}

export interface SpellCheckContext {
  equipment: Equipment
  inventory: Inventory
  runePouch: RunePouch | null
  magicLevel?: number
}

function providedByEquipment(rune: number, equipment: Equipment): boolean {
  for (const id of [equipment.weapon, equipment.shield]) {
    if (id !== undefined && RUNE_SOURCES[canonicalItemId(id)]?.includes(rune)) return true
  }
  return false
}

/** scim: is a rune type available (staff, inventory, rune pouch, combination runes)? */
function hasRune(rune: number, ctx: SpellCheckContext): boolean {
  if (providedByEquipment(rune, ctx.equipment)) return true
  const accepted = [rune, ...(PROVIDED_BY[rune] ?? [])]
  for (const item of ctx.inventory) if (item && accepted.includes(item.id)) return true
  for (const slot of ctx.runePouch?.slots ?? []) if (slot && accepted.includes(slot.id)) return true
  return false
}

export type SpellCheckResult = { ok: true } | { ok: false; reason: 'unknown-spell' | 'missing-level' | 'missing-runes' }


export function checkSpell(name: string, ctx: SpellCheckContext): SpellCheckResult {
  const runes = SPELL_RUNES[name]
  if (!runes) return { ok: false, reason: 'unknown-spell' }
  if (ctx.magicLevel !== undefined) {
    const lvl = SPELL_LEVELS[name]
    if (lvl !== undefined && ctx.magicLevel < lvl) return { ok: false, reason: 'missing-level' }
  }
  return runes.every((r) => hasRune(r, ctx)) ? { ok: true } : { ok: false, reason: 'missing-runes' }
}

/** Cast/projectile visuals. */
export interface SpellVisual {
  castAnimationId: number
  castSpotanimId: number
  castSpotanimHeight?: number
  projectileId: number
  hitSpotanimId: number
  hitSpotanimHeight: number
  projectileStartHeight: number
  projectileEndHeight: number
  projectileSlope: number
  projectileStartDelay: number
  projectileOrigin?: 'caster' | 'target'
  fallbackAnimationId?: number
}

function standardVisual(cast: number, [castSpot, projectile, hit]: [number, number, number]): SpellVisual {
  return {
    castAnimationId: cast,
    castSpotanimId: castSpot,
    projectileId: projectile,
    hitSpotanimId: hit,
    hitSpotanimHeight: 0,
    projectileStartHeight: 172,
    projectileEndHeight: 124,
    projectileSlope: 16,
    projectileStartDelay: 51,
  }
}

function ancientVisual(cast: number, [projectile, hit]: [number, number], opts: { height?: number; origin?: 'caster' | 'target' } = {}): SpellVisual {
  return {
    castAnimationId: cast,
    castSpotanimId: -1,
    castSpotanimHeight: 0,
    hitSpotanimId: hit,
    hitSpotanimHeight: opts.height ?? 0,
    projectileId: projectile,
    projectileOrigin: opts.origin ?? 'caster',
    projectileStartHeight: 172,
    projectileEndHeight: opts.height ?? 0,
    projectileSlope: 16,
    projectileStartDelay: 51,
  }
}

function demonbane(castSpot: number, hit: number): SpellVisual {
  return {
    castAnimationId: 8977,
    fallbackAnimationId: 1162,
    castSpotanimId: castSpot,
    hitSpotanimId: hit,
    hitSpotanimHeight: 0,
    projectileId: -1,
    projectileStartHeight: 0,
    projectileEndHeight: 0,
    projectileSlope: 0,
    projectileStartDelay: 0,
  }
}

export const SPELL_VISUALS: Readonly<Record<string, SpellVisual>> = {
  'Wind Strike': standardVisual(1162, [90, 91, 92]),
  'Water Strike': standardVisual(1162, [93, 94, 95]),
  'Earth Strike': standardVisual(1162, [96, 97, 98]),
  'Fire Strike': standardVisual(1162, [99, 100, 101]),
  'Wind Bolt': standardVisual(1162, [117, 118, 119]),
  'Water Bolt': standardVisual(1162, [120, 121, 122]),
  'Earth Bolt': standardVisual(1162, [123, 124, 125]),
  'Fire Bolt': standardVisual(1162, [126, 127, 128]),
  'Wind Blast': standardVisual(1162, [132, 133, 134]),
  'Water Blast': standardVisual(1162, [135, 136, 137]),
  'Earth Blast': standardVisual(1162, [138, 139, 140]),
  'Fire Blast': standardVisual(1162, [129, 130, 131]),
  'Wind Wave': standardVisual(1167, [158, 159, 160]),
  'Water Wave': standardVisual(1167, [161, 162, 163]),
  'Earth Wave': standardVisual(1167, [164, 165, 166]),
  'Fire Wave': standardVisual(1167, [155, 156, 157]),
  'Wind Surge': standardVisual(7855, [1455, 1456, 1457]),
  'Water Surge': standardVisual(7855, [1458, 1459, 1460]),
  'Earth Surge': standardVisual(7855, [1461, 1462, 1463]),
  'Fire Surge': standardVisual(7855, [1464, 1465, 1466]),
  'Crumble Undead': standardVisual(1166, [145, 146, 147]),
  'Iban Blast': standardVisual(708, [87, 88, 89]),
  'Smoke Rush': ancientVisual(10091, [384, 385], { height: 124 }),
  'Shadow Rush': ancientVisual(10091, [378, 379]),
  'Blood Rush': ancientVisual(10091, [-1, 373]),
  'Ice Rush': ancientVisual(10091, [360, 361]),
  'Smoke Burst': ancientVisual(10092, [388, 389], { origin: 'target', height: 124 }),
  'Shadow Burst': ancientVisual(10092, [-1, 382]),
  'Blood Burst': ancientVisual(10092, [-1, 376]),
  'Ice Burst': ancientVisual(10092, [366, 363], { origin: 'target' }),
  'Smoke Blitz': ancientVisual(10091, [386, 387], { height: 124 }),
  'Shadow Blitz': ancientVisual(10091, [380, 381]),
  'Blood Blitz': ancientVisual(10091, [374, 375]),
  'Ice Blitz': { ...ancientVisual(10091, [-1, 367]), castSpotanimId: 366, castSpotanimHeight: 124 },
  'Smoke Barrage': ancientVisual(10092, [390, 391], { origin: 'target', height: 124 }),
  'Shadow Barrage': ancientVisual(10092, [-1, 383]),
  'Blood Barrage': ancientVisual(10092, [-1, 377]),
  'Ice Barrage': ancientVisual(10092, [368, 369], { origin: 'target' }),
  'Inferior Demonbane': demonbane(1865, 1866),
  'Superior Demonbane': demonbane(1867, 1868),
  'Dark Demonbane': demonbane(1869, 1870),
}

/** Magic-level stat of the spells table, including sprite name for the spellbook UI. */
export interface SpellTableEntry extends SpellDefinition {
  level: number | null
  runes: readonly number[]
  icon: string
  visual?: SpellVisual
}

export const SPELL_TABLE: readonly SpellTableEntry[] = SPELLS.map((sp) => ({
  ...sp,
  level: SPELL_LEVELS[sp.name] ?? null,
  runes: SPELL_RUNES[sp.name] ?? [],
  icon: spellIcon(sp.name),
  ...(SPELL_VISUALS[sp.name] === undefined ? {} : { visual: SPELL_VISUALS[sp.name]! }),
}))
