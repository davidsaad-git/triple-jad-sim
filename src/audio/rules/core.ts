/**
 * Encounter-independent sound rules, scim.gg with
 * the player attack resolver and its constants
 *. Layer name "core"; it runs after every encounter layer.
 *
 * Tables:.
 */
import type { PrayerId, SimEvent, SpellCastInfo } from '../../sim/api'
import { asTile, play, type RuleLayer, SILENT, type SoundEntry, type SoundSpec } from './types'
import {
  canonicalWeaponId,
  distanceToFootprint,
  ECLIPSE_ATLATL,
  IMPACT_TIMING,
  type ImpactTiming,
  impactCycles,
  SCORCHING_BOW,
  WEAPON_SETS as W,
  weaponCategory,
  weaponImpactTiming,
} from './weapons'

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>

const PLAYER = 'player'
/** Client cycles per tick. */
const CYCLES_PER_TICK = 30

// --- Player attack sounds -----------------------------------------------------

/** Fallback by attack kind. */
export const ATTACK_KIND_SOUNDS: Readonly<Record<string, number>> = {
  melee_slash: 2500,
  melee_stab: 2517,
  melee_crush: 2567,
  range_arrow: 2700,
  magic_fire: 160,
  magic_shadow: 178,
  magic_air: 220,
  magic_water: 211,
}

export const ATTACK_SOUNDS = {
  inquisitorsMace: 2508,
  scythe: 2524,
  godsword: 3847,
  godswordCrush: 3846,
  elderMaul: 3454,
  whip: 2720,
  bow: 2700,
  crossbow: 2695,
  atlatl: 2699,
  blowpipe: 2696,
  blowpipeSpec: 800,
  bowfa: 1352,
  godswordSpec: 3869,
  whipSpec: 2713,
  clawsAttack: 4139,
  burningClawsSpec: 9316,
  voidwakerSpecCast: 5027,
  voidwakerSpecImpact: 6182,
  shadowCast: 6410,
  shadowImpact: 1460,
  accursedCast: 178,
  accursedSpecCast: 183,
  accursedSpecImpact: 163,
  ayakCast: 178,
  ayakImpact: 1460,
} as const
const A = ATTACK_SOUNDS

const BLOWPIPE_SPEC: SoundSpec = [A.blowpipe, { id: A.blowpipeSpec, delayCycles: 32 }]
const CLAWS_SPEC: SoundEntry[] = [
  { id: 4138, delayCycles: 10 },
  { id: 4140, delayCycles: 30 },
  { id: 4141, delayCycles: 42 },
  { id: 4141, delayCycles: 60 },
]
const EMBERLIGHT_SPEC: SoundEntry[] = [
  { id: 9319, delayCycles: 11 },
  { id: 9320, delayCycles: 28 },
  { id: 9321, delayCycles: 53 },
]
const ACB_SPEC: SoundEntry = { id: 3892, delayCycles: 15 }
const VOIDWAKER_SPEC: SoundSpec = [A.voidwakerSpecCast, { id: A.voidwakerSpecImpact, delayCycles: 30 }]
const ELDER_MAUL_SPEC: SoundEntry = { id: 8984, delayCycles: 2 }
const BLUDGEON_SPEC: SoundEntry[] = [
  { id: 2715, delayCycles: 10 },
  { id: 1930, delayCycles: 30 },
]
const BURNING_CLAWS_SPEC: SoundEntry[] = [
  { id: A.burningClawsSpec, delayCycles: 29 },
  { id: A.burningClawsSpec, delayCycles: 60 },
]
const SCORCHING_SPEC: (number | SoundEntry)[] = [A.bow, { id: 9327, delayCycles: 11 }, { id: 9328, delayCycles: 46 }]
const SCORCHING_SPEC_IMPACTS = [9325, 9326]
const AYAK_SPEC: SoundEntry[] = [
  { id: 10313, delayCycles: 21 },
  { id: 10322, delayCycles: 81 },
  { id: 10319, delayCycles: 108 },
  { id: 10311, delayCycles: 122 },
  { id: 10329 },
  { id: 10330 },
  { id: 10325 },
  { id: 10318 },
  { id: 10327 },
  { id: 10326 },
]
const DARK_DEMONBANE: [number, number] = [5053, 5035]

/** Ancient Magicks `[cast, impact]` by spell name. */
export const ANCIENT_SPELL_SOUNDS: Readonly<Record<string, readonly [number, number]>> = {
  'Smoke Rush': [183, 185],
  'Shadow Rush': [178, 179],
  'Blood Rush': [106, 110],
  'Ice Rush': [171, 173],
  'Smoke Burst': [183, 182],
  'Shadow Burst': [178, 177],
  'Blood Burst': [106, 105],
  'Ice Burst': [171, 170],
  'Smoke Blitz': [183, 181],
  'Shadow Blitz': [178, 176],
  'Blood Blitz': [106, 104],
  'Ice Blitz': [171, 169],
  'Smoke Barrage': [183, 180],
  'Shadow Barrage': [178, 175],
  'Blood Barrage': [106, 102],
  'Ice Barrage': [171, 168],
}

const STAB_2501 = { melee_stab: 2501 }
const SPEAR = { melee_stab: 2562, melee_slash: 2524, melee_crush: 2555 }
/** Per-weapon melee sounds by attack kind. */
const MELEE_WEAPON_SOUNDS: Readonly<Record<number, Readonly<Record<string, number>>>> = {
  11889: SPEAR,
  23528: { melee_crush: 2508, melee_stab: 2509 },
  13263: { melee_crush: 1309 },
  22324: { melee_stab: 2549, melee_slash: 2548 },
  22325: { melee_crush: 2522 },
  4587: STAB_2501,
  29589: STAB_2501,
  27690: STAB_2501,
  22978: SPEAR,
  11824: { melee_stab: 2562, melee_slash: 2556, melee_crush: 2555 },
  11920: { melee_stab: 2498, melee_crush: 2497 },
}

/** scim: cast now, impact after the attack's hit delay in ticks. */
function castThenImpact(e: Ev<'attack_started'>, cast: number, impact: number): SoundSpec {
  const ticks = typeof e.impactDelayTicks === 'number' && e.impactDelayTicks > 0 ? e.impactDelayTicks : 0
  return ticks <= 0 ? [cast, impact] : [cast, { id: impact, delayCycles: ticks * CYCLES_PER_TICK }]
}

function castDistance(c: SpellCastInfo): number {
  return distanceToFootprint(c.sourcePosition[0], c.sourcePosition[1], c.targetPosition[0], c.targetPosition[1], c.targetSize)
}

/** scim: cast sound, plus the impact at the target's SW tile (area r10) only when the hit is accurate. */
function castWithImpact(cast: number, impact: number, spellCast: SpellCastInfo | undefined, timing: ImpactTiming): SoundSpec {
  if (spellCast?.accurate !== true) return cast
  return [cast, { id: impact, position: spellCast.targetPosition, range: 10, delayCycles: impactCycles(timing, castDistance(spellCast)) }]
}

/** scim: accursed sceptre special. */
function accursedSpec(e: Ev<'attack_started'>): SoundSpec {
  const cast = e.spellCast
  const timing = weaponImpactTiming(e.weaponId, true)
  if (!cast || !timing) return castThenImpact(e, A.accursedSpecCast, A.accursedSpecImpact)
  return [A.accursedSpecCast, { id: A.accursedSpecImpact, delayCycles: impactCycles(timing, castDistance(cast)) }]
}

/** scim: scorching bow special. */
function scorchingSpec(e: Ev<'attack_started'>): SoundSpec {
  const cast = e.spellCast
  const timing = weaponImpactTiming(SCORCHING_BOW, true)
  if (!cast || !timing) return SCORCHING_SPEC
  const delay = impactCycles(timing, castDistance(cast))
  return [...SCORCHING_SPEC, ...SCORCHING_SPEC_IMPACTS.map((id) => ({ id, delayCycles: delay }))]
}

/** scim: sounds of a player attack, or null when the event is not a player attack. */
export function resolvePlayerAttackSound(event: SimEvent): SoundSpec | null {
  if (event.type !== 'attack_started' || event.sourceId !== PLAYER) return null
  const e = event
  const spell = e.spellId ?? undefined
  const ancient = spell === undefined ? undefined : ANCIENT_SPELL_SOUNDS[spell]
  if (ancient) return castWithImpact(ancient[0], ancient[1], e.spellCast, IMPACT_TIMING.magic_spell)
  if (spell === 'Dark Demonbane') return castThenImpact(e, DARK_DEMONBANE[0], DARK_DEMONBANE[1])

  const weapon = e.weaponId === undefined ? undefined : canonicalWeaponId(e.weaponId)
  const special = e.usingSpecialAttack === true
  if (typeof weapon === 'number') {
    if (weapon === ECLIPSE_ATLATL) return A.atlatl
    if (W.tumekensShadow.has(weapon)) return castWithImpact(A.shadowCast, A.shadowImpact, e.spellCast, IMPACT_TIMING.tumekens_shadow)
    if (special) {
      if (W.blowpipe.has(weapon)) return BLOWPIPE_SPEC
      if (W.dragonClaws.has(weapon)) return CLAWS_SPEC
      if (W.godswordSpec.has(weapon)) return A.godswordSpec
      if (W.whip.has(weapon)) return A.whipSpec
      if (W.emberlight.has(weapon)) return EMBERLIGHT_SPEC
      if (W.armadylCrossbow.has(weapon)) return ACB_SPEC
      if (W.voidwaker.has(weapon)) return VOIDWAKER_SPEC
      if (W.elderMaul.has(weapon)) return ELDER_MAUL_SPEC
      if (W.abyssalBludgeon.has(weapon)) return BLUDGEON_SPEC
      if (W.burningClaws.has(weapon)) return BURNING_CLAWS_SPEC
      if (W.scorchingBow.has(weapon)) return scorchingSpec(e)
    }
    const melee = MELEE_WEAPON_SOUNDS[weapon]?.[e.attackKind]
    if (melee !== undefined) return melee
    if (W.inquisitorsMace.has(weapon)) return A.inquisitorsMace
    if (W.scythe.has(weapon)) return A.scythe
    if (W.godsword.has(weapon)) return e.attackKind === 'melee_crush' ? A.godswordCrush : A.godsword
    if (W.elderMaul.has(weapon)) return A.elderMaul
    if (W.whip.has(weapon)) return A.whip
    if (W.blowpipe.has(weapon)) return A.blowpipe
    if (W.bowfa.has(weapon)) return A.bowfa
    if (W.burningClaws.has(weapon) || W.dragonClaws.has(weapon)) return A.clawsAttack
    if (W.eyeOfAyak.has(weapon)) return special ? AYAK_SPEC : castWithImpact(A.ayakCast, A.ayakImpact, e.spellCast, IMPACT_TIMING.eye_of_ayak)
    if (special && (W.accursedSceptre.has(weapon) || W.accursedSceptreA.has(weapon))) return accursedSpec(e)
    if (W.accursedSceptre.has(weapon)) return A.accursedCast
    if (weaponCategory(weapon) === 'crossbow') return A.crossbow
  }
  return ATTACK_KIND_SOUNDS[e.attackKind] ?? null
}

// --- Other player sounds ------------------------------------------------------

export const PRAYER_ON_SOUNDS: Readonly<Record<PrayerId, number>> = {
  ProtectMagic: 2675,
  ProtectRange: 2677,
  ProtectMelee: 2676,
  EagleEye: 2665,
  MysticMight: 2669,
  Piety: 3825,
  Rigour: 2685,
  Augury: 2670,
  Deadeye: 10194,
  MysticVigour: 10100,
  Redemption: 2680,
  Preserve: 2679,
}

export const PLAYER_SOUNDS = {
  prayerOff: 2663,
  prayerDepleted: 2672,
  eat: 2393,
  drink: 2401,
  surge: 6182,
  magicSplash: 227,
  hitBlock: 511,
  death: 512,
  markOfDarknessExpired: 5000,
  saturatedHeart: 6847,
  saturatedHeartExpired: 228,
  redemptionHeal: 2681,
} as const
const P = PLAYER_SOUNDS

/** Player damage hitsplat sounds, one picked at random. */
export const HIT_SOUNDS = [518, 519, 520, 521] as const
/** Player hitsplat sounds start 20 cycles (400 ms) late. */
export const HIT_SOUND_DELAY_CYCLES = 20
const SPLASH_RANGE = 10
const SURGE_POTIONS: ReadonlySet<number> = new Set([30875, 30878, 30881, 30884])
const MARK_OF_DARKNESS_CAST = [5046, 5015]
const MARK_OF_DARKNESS_ANIM = 8970
const SATURATED_HEART_SPOTANIM = 2287
const REDEMPTION_SPOTANIM = 436

export type EquipSoundKind = 'fun' | 'metal_body' | 'helmet' | 'legs' | 'hands' | 'staff'

/** Equip sound by kind; unknown kinds play the generic 2238. */
export const EQUIP_SOUNDS: Readonly<Record<EquipSoundKind, number>> = {
  fun: 2238,
  metal_body: 2239,
  helmet: 2240,
  legs: 2242,
  hands: 2236,
  staff: 2247,
}

const METAL_BODY_WORDS = ['platebody', 'chainbody', 'hauberk', 'cuirass', 'chestplate', 'platemail', 'armour', 'armor']
const SOFT_BODY_WORDS = ['robe', 'robetop', 'tunic', 'shirt', 'jacket', 'vest', 'leather', 'hide', "d'hide"]

/**
 * scim. Used when the
 * engine's `item_equipped` event carries no `equipSound`.
 */
export function equipSoundKind(slot: string, itemId: number, itemName: (id: number) => string | null): EquipSoundKind {
  if (slot === 'head') return 'helmet'
  if (slot === 'legs') return 'legs'
  if (slot === 'hands') return 'hands'
  if (slot === 'body') {
    const name = (itemName(itemId) ?? '').toLowerCase()
    return !SOFT_BODY_WORDS.some((w) => name.includes(w)) && METAL_BODY_WORDS.some((w) => name.includes(w)) ? 'metal_body' : 'fun'
  }
  if (slot === 'weapon') {
    const cat = weaponCategory(itemId)
    return cat === 'staff' || cat === 'powered_staff' ? 'staff' : 'fun'
  }
  return 'fun'
}

export interface CoreLayerOptions {
  /** Random source for the damage hitsplat pick (scim uses unseeded Math.random). */
  random?: () => number
  /** Item name lookup (cache ObjType) for the metal-body equip sound. */
  itemName?: (id: number) => string | null
}

function attackPreloadIds(): number[] {
  const ids: number[] = [
    ...Object.values(ATTACK_KIND_SOUNDS),
    ...Object.values(ATTACK_SOUNDS),
    ...CLAWS_SPEC.map((e) => e.id),
    ...EMBERLIGHT_SPEC.map((e) => e.id),
    ACB_SPEC.id,
    ELDER_MAUL_SPEC.id,
    ...BLUDGEON_SPEC.map((e) => e.id),
    ...SCORCHING_SPEC.map((e) => (typeof e === 'number' ? e : e.id)),
    ...SCORCHING_SPEC_IMPACTS,
    ...Object.values(MELEE_WEAPON_SOUNDS).flatMap((t) => Object.values(t)),
    ...DARK_DEMONBANE,
    ...Object.values(ANCIENT_SPELL_SOUNDS).flat(),
    ...AYAK_SPEC.map((e) => e.id),
  ]
  return [...new Set(ids)]
}

export function createCoreLayer(opts: CoreLayerOptions = {}): RuleLayer {
  const random = opts.random ?? Math.random
  const itemName = opts.itemName ?? (() => null)

  return {
    name: 'core',
    rules: {
      attack_started: {
        resolve: (e) => {
          const sound = resolvePlayerAttackSound(e)
          return sound === null ? SILENT : play(sound)
        },
        preloadIds: attackPreloadIds(),
      },
      hit_applied: {
        resolve: (e) => {
          if (e.type !== 'hit_applied') return SILENT
          if (e.targetId === PLAYER || !(e.accurate === false && typeof e.attackKind === 'string' && e.attackKind.startsWith('magic'))) {
            return SILENT
          }
          const pos = asTile(e.targetPosition)
          return pos ? play(P.magicSplash, { position: pos, range: SPLASH_RANGE }) : play(P.magicSplash, { range: SPLASH_RANGE })
        },
        preloadIds: [P.magicSplash],
      },
      hitsplat_spawned: {
        resolve: (e) => {
          if (e.type !== 'hitsplat_spawned' || e.targetId !== PLAYER) return SILENT
          if (e.hitsplatType === 'block') return play({ id: P.hitBlock, delayCycles: HIT_SOUND_DELAY_CYCLES })
          if (e.hitsplatType === 'damage') {
            const id = HIT_SOUNDS[Math.floor(random() * HIT_SOUNDS.length)] ?? HIT_SOUNDS[0]
            return play({ id, delayCycles: HIT_SOUND_DELAY_CYCLES })
          }
          return SILENT
        },
        preloadIds: [...HIT_SOUNDS, P.hitBlock],
      },
      prayer_changed: {
        resolve: (e) => {
          if (e.type !== 'prayer_changed') return SILENT
          if (e.to !== null) {
            const id = PRAYER_ON_SOUNDS[e.to] as number | undefined
            return id === undefined ? SILENT : play(id)
          }
          return play(P.prayerOff)
        },
        preloadIds: [...Object.values(PRAYER_ON_SOUNDS), P.prayerOff],
      },
      prayer_depleted: { resolve: () => play(P.prayerDepleted), preloadIds: [P.prayerDepleted] },
      prayer_activation_failed: { resolve: () => play(P.prayerDepleted), preloadIds: [P.prayerDepleted] },
      item_consumed: {
        resolve: (e) => {
          if (e.type !== 'item_consumed') return SILENT
          if (SURGE_POTIONS.has(e.itemId)) return play([P.surge, P.drink])
          return play(e.track === 'potion' ? P.drink : P.eat)
        },
        preloadIds: [P.eat, P.drink, P.surge],
      },
      item_equipped: {
        resolve: (e) => {
          if (e.type !== 'item_equipped') return SILENT
          return play(resolveEquipSound(e, itemName))
        },
        preloadIds: Object.values(EQUIP_SOUNDS),
      },
      spell_self_cast: {
        resolve: (e) => (e.type === 'spell_self_cast' && e['animationId'] === MARK_OF_DARKNESS_ANIM ? play(MARK_OF_DARKNESS_CAST) : SILENT),
        preloadIds: MARK_OF_DARKNESS_CAST,
      },
      player_graphic_applied: {
        resolve: (e) => {
          if (e.type !== 'player_graphic_applied') return SILENT
          if (e.spotAnimId === SATURATED_HEART_SPOTANIM) return play(P.saturatedHeart)
          if (e.spotAnimId === REDEMPTION_SPOTANIM) return play(P.redemptionHeal)
          return SILENT
        },
        preloadIds: [P.saturatedHeart, P.redemptionHeal],
      },
      status_effect_expired: {
        resolve: (e) => {
          if (e.type !== 'status_effect_expired') return SILENT
          if (e.effect === 'mark_of_darkness') return play(P.markOfDarknessExpired)
          if (e.effect === 'saturated_heart') return play(P.saturatedHeartExpired)
          return SILENT
        },
        preloadIds: [P.markOfDarknessExpired, P.saturatedHeartExpired],
      },
      actor_died: {
        resolve: (e) => (e.type === 'actor_died' && e.actorId === PLAYER ? play(P.death) : SILENT),
        preloadIds: [P.death],
      },
    },
  }
}

/**
 * `item_equipped` -> sound id. scim's engine stamps the event with the equip
 * sound *kind*; our contract types `equipSound` as a number, so: a kind string
 * maps through the kind table (unknown -> 2238), a positive number is taken as
 * the sound id itself, and a missing value is derived from slot + item like
 * scim's engine does.
 */
function resolveEquipSound(e: Ev<'item_equipped'>, itemName: (id: number) => string | null): number {
  const raw: unknown = e.equipSound
  if (typeof raw === 'string') return (EQUIP_SOUNDS as Record<string, number | undefined>)[raw] ?? EQUIP_SOUNDS.fun
  if (typeof raw === 'number' && raw > 0) return raw
  return EQUIP_SOUNDS[equipSoundKind(e.slot, e.itemId, itemName)]
}

