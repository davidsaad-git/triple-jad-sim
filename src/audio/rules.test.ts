import { describe, expect, it } from 'vitest'
import type { SimEventBody, SpellCastInfo, Tile } from '../sim/api'
import { EventAudioPlayer, type EventSoundSink, type ResolvedPlay } from './EventAudioPlayer'
import { createCoreLayer, equipSoundKind } from './rules/core'
import { INFERNO_LAYER } from './rules/inferno'
import { PASS, play, type RuleLayer, SILENT } from './rules/types'
import { canonicalWeaponId, distanceToFootprint } from './rules/weapons'
import { ev } from './testing'

const NAMES: Record<number, string> = {
  11832: 'Bandos chestplate',
  21021: 'Ancestral robe top',
  12492: "Black d'hide body",
  4712: "Ahrim's robetop",
  1127: 'Rune platebody',
}

const sink: EventSoundSink = {
  play: () => {},
  getMasterVolume: () => 1,
  getSfxVolume: () => 1,
  getAreaVolume: () => 1,
  isFocusSuspended: () => false,
}

function player(random = () => 0): EventAudioPlayer {
  return new EventAudioPlayer(sink, INFERNO_LAYER, createCoreLayer({ random, itemName: (id) => NAMES[id] ?? null }))
}

const PLAYER_TILE: Tile = [31, 33]

function resolve(body: SimEventBody, listener: Tile = PLAYER_TILE, random?: () => number): ResolvedPlay[] {
  return player(random).resolve(ev(body), listener)
}

/** Compact `[id, channel, delayMs?]` view. */
function brief(plays: ResolvedPlay[]): (string | number)[][] {
  return plays.map((p) => (p.delayMs === undefined ? [p.id, p.channel] : [p.id, p.channel, p.delayMs]))
}

const jadAttack = (attack: 'jad_magic' | 'jad_range' | 'jad_melee' | 'jad_healer_melee', arrival?: number): SimEventBody => ({
  type: 'zuk_attack',
  attack,
  sourceId: 'jad-1',
  targetId: 'player',
  sourcePosition: [24, 36],
  targetPosition: [31, 33],
  launchTick: 10,
  impactTick: 13,
  ...(arrival === undefined ? {} : { projectileArrivalCycles: arrival }),
})

describe('Inferno (zuk) layer: JalTok-Jad and Yt-HurKot', () => {
  it('magic cue plays 159, range / melee cues are silent', () => {
    expect(brief(resolve({ type: 'zuk_jad_cue', sourceId: 'jad-1', style: 'magic' }))).toEqual([[159, 'sfx']])
    expect(resolve({ type: 'zuk_jad_cue', sourceId: 'jad-1', style: 'range' })).toEqual([])
    expect(resolve({ type: 'zuk_jad_cue', sourceId: 'jad-1', style: 'melee' })).toEqual([])
  })

  it('magic release plays 162 now and 163 at projectile arrival, both sfx', () => {
    // Arrival 2 + 8 * dJ with dJ = 4 -> 34 cycles -> 680 ms.
    expect(brief(resolve(jadAttack('jad_magic', 34)))).toEqual([
      [162, 'sfx'],
      [163, 'sfx', 680],
    ])
    expect(brief(resolve(jadAttack('jad_magic')))).toEqual([[162, 'sfx']])
    // Arrival 0 means no delay at all.
    expect(brief(resolve(jadAttack('jad_magic', 0)))).toEqual([
      [162, 'sfx'],
      [163, 'sfx'],
    ])
  })

  it('range 163, melee 408, healer melee 608; full volume regardless of distance', () => {
    expect(brief(resolve(jadAttack('jad_range', 34)))).toEqual([[163, 'sfx']])
    expect(brief(resolve(jadAttack('jad_melee')))).toEqual([[408, 'sfx']])
    expect(brief(resolve(jadAttack('jad_healer_melee')))).toEqual([[608, 'sfx']])
    const far = resolve(jadAttack('jad_range'), [0, 0])
    expect(far.map((p) => p.volume)).toEqual([1])
  })

  it('hits: Jad 410, healer 610; deaths: Jad 409, healer silent', () => {
    expect(brief(resolve({ type: 'zuk_hit', actorId: 'jad-1', npcKind: 'jad', position: [24, 36] }))).toEqual([[410, 'sfx']])
    expect(brief(resolve({ type: 'zuk_hit', actorId: 'h-1', npcKind: 'jad_healer', position: [24, 42] }))).toEqual([[610, 'sfx']])
    expect(brief(resolve({ type: 'zuk_death', actorId: 'jad-1', npcKind: 'jad', position: [24, 36] }))).toEqual([[409, 'sfx']])
    expect(resolve({ type: 'zuk_death', actorId: 'h-1', npcKind: 'jad_healer', position: [24, 42] })).toEqual([])
  })

  it('malformed events are silent', () => {
    expect(resolve({ ...jadAttack('jad_magic', 34), impactTick: 9 } as SimEventBody)).toEqual([])
    expect(resolve({ ...jadAttack('jad_magic', -1) } as SimEventBody)).toEqual([])
    expect(resolve({ type: 'zuk_hit', actorId: 'jad-1', npcKind: 'jad', position: [Number.NaN, 1] })).toEqual([])
  })

  it('inferno_visual: spotanim 659 on a tile plays 156 on the area channel, r8, at the graphic delay', () => {
    const body: SimEventBody = {
      type: 'inferno_visual',
      animations: [],
      projectiles: [],
      graphics: [
        { spotAnimId: 659, target: { kind: 'tile', position: [31, 35] }, delayCycles: 12, height: 0 },
        { spotAnimId: 659, target: { kind: 'actor', actorId: 'player', size: 1, position: [31, 33] }, delayCycles: 0, height: 0 },
        { spotAnimId: 448, target: { kind: 'tile', position: [31, 33] }, delayCycles: 0, height: 0 },
      ],
    }
    const plays = resolve(body)
    expect(brief(plays)).toEqual([[156, 'area', 240]])
    // Manhattan 2 - 1 = 1 -> (8 - 1) / 8.
    expect(plays[0]!.volume).toBeCloseTo(7 / 8)
  })
})

const cast = (targetPosition: Tile, accurate: boolean, size = 5, source: Tile = PLAYER_TILE): SpellCastInfo => ({
  sourcePosition: source,
  targetPosition,
  targetSize: size,
  accurate,
})

function attack(extra: Partial<Extract<SimEventBody, { type: 'attack_started' }>>): SimEventBody {
  return {
    type: 'attack_started',
    sourceId: 'player',
    targetId: 'jad-1',
    style: 'range',
    attackKind: 'range_arrow',
    impactDelayTicks: 2,
    ...extra,
  }
}

describe('core layer: player attacks ($xe)', () => {
  it('ranged weapons of the Zuk loadouts', () => {
    expect(brief(resolve(attack({ weaponId: 20997 })))).toEqual([[2700, 'sfx']]) // twisted bow
    expect(brief(resolve(attack({ weaponId: 25867 })))).toEqual([[1352, 'sfx']]) // bowfa
    expect(brief(resolve(attack({ weaponId: 25884 })))).toEqual([[1352, 'sfx']]) // bowfa variant
    expect(brief(resolve(attack({ weaponId: 9185 })))).toEqual([[2695, 'sfx']]) // rune crossbow
    expect(brief(resolve(attack({ weaponId: 26486 })))).toEqual([[2695, 'sfx']]) // rune crossbow (or)
    expect(brief(resolve(attack({ weaponId: 11785 })))).toEqual([[2695, 'sfx']]) // ACB normal
    expect(brief(resolve(attack({ weaponId: 11785, usingSpecialAttack: true })))).toEqual([[3892, 'sfx', 300]])
    expect(brief(resolve(attack({ weaponId: 29000 })))).toEqual([[2699, 'sfx']]) // atlatl
    expect(brief(resolve(attack({ weaponId: 29000, usingSpecialAttack: true })))).toEqual([[2699, 'sfx']])
    expect(brief(resolve(attack({ weaponId: 12926 })))).toEqual([[2696, 'sfx']]) // blowpipe
    expect(brief(resolve(attack({ weaponId: 12926, usingSpecialAttack: true })))).toEqual([
      [2696, 'sfx'],
      [800, 'sfx', 640],
    ])
    // Unknown ranged weapon falls back to the attack kind.
    expect(brief(resolve(attack({ weaponId: 861 })))).toEqual([[2700, 'sfx']])
  })

  it("Tumeken's shadow: 6410 now, 1460 at the target's SW tile only when accurate", () => {
    const jadSw: Tile = [24, 36]
    // Player (31,33) to the 5x5 footprint x 24..28, y 36..40: Chebyshev 3.
    expect(distanceToFootprint(31, 33, 24, 36, 5)).toBe(3)
    const hit = resolve(attack({ style: 'magic', attackKind: 'magic_fire', weaponId: 27275, spellCast: cast(jadSw, true) }))
    // 56 + 16 + 10 * 3 = 102 cycles.
    expect(brief(hit)).toEqual([
      [6410, 'sfx'],
      [1460, 'area', 2040],
    ])
    // Area r10 from the SW tile: Manhattan 7 + 3 - 1 = 9 -> 1/10.
    expect(hit[1]!.volume).toBeCloseTo(0.1)
    const miss = resolve(attack({ style: 'magic', attackKind: 'magic_fire', weaponId: 27275, spellCast: cast(jadSw, false) }))
    expect(brief(miss)).toEqual([[6410, 'sfx']])
    // Standing north-east of a Jad far enough silences the impact entirely.
    const far = resolve(attack({ style: 'magic', attackKind: 'magic_fire', weaponId: 27275, spellCast: cast(jadSw, true, 5, [33, 42]) }), [33, 42])
    expect(brief(far)).toEqual([[6410, 'sfx']])
  })

  it('standard spells on a staff play 160; Ancient spells play cast + accurate impact', () => {
    expect(brief(resolve(attack({ style: 'magic', attackKind: 'magic_fire', weaponId: 22323 })))).toEqual([[160, 'sfx']]) // sang
    const barrage = resolve(
      attack({ style: 'magic', attackKind: 'magic_fire', weaponId: 21006, spellId: 'Ice Barrage', spellCast: cast([30, 33], true, 1) }),
    )
    // magic_spell: 51 - 5 + 10 * 1.
    expect(brief(barrage)).toEqual([
      [171, 'sfx'],
      [168, 'area', 1120],
    ])
    expect(barrage[1]!.volume).toBe(1)
    expect(brief(resolve(attack({ style: 'magic', attackKind: 'magic_fire', spellId: 'Blood Blitz', spellCast: cast([30, 33], false, 1) })))).toEqual([
      [106, 'sfx'],
    ])
  })

  it('Eye of Ayak, accursed sceptre and specials', () => {
    const ayak = resolve(attack({ style: 'magic', attackKind: 'magic_fire', weaponId: 31113, spellCast: cast([29, 33], true, 1) }))
    // eye_of_ayak: 51 - 5 + 5 * 2.
    expect(brief(ayak)).toEqual([
      [178, 'sfx'],
      [1460, 'area', 1120],
    ])
    const ayakSpec = resolve(attack({ style: 'magic', attackKind: 'magic_fire', weaponId: 31113, usingSpecialAttack: true }))
    expect(ayakSpec.map((p) => p.id)).toEqual([10313, 10322, 10319, 10311, 10329, 10330, 10325, 10318, 10327, 10326])
    expect(ayakSpec[0]!.delayMs).toBe(420)
    expect(brief(resolve(attack({ style: 'magic', attackKind: 'magic_fire', weaponId: 27665 })))).toEqual([[178, 'sfx']])
    // Accursed spec: dS lS = 50 - 4 + 10 * d, d = 2.
    expect(
      brief(resolve(attack({ style: 'magic', attackKind: 'magic_fire', weaponId: 27665, usingSpecialAttack: true, spellCast: cast([29, 33], true, 1) }))),
    ).toEqual([
      [183, 'sfx'],
      [163, 'sfx', 1320],
    ])
    // Without spell info the impact follows the hit delay in ticks.
    expect(brief(resolve(attack({ style: 'magic', attackKind: 'magic_fire', weaponId: 27665, usingSpecialAttack: true, impactDelayTicks: 3 })))).toEqual([
      [183, 'sfx'],
      [163, 'sfx', 1800],
    ])
  })

  it('melee fallbacks and weapon tables', () => {
    expect(brief(resolve(attack({ style: 'melee', attackKind: 'melee_slash', weaponId: 4151 })))).toEqual([[2720, 'sfx']])
    expect(brief(resolve(attack({ style: 'melee', attackKind: 'melee_slash', weaponId: 4151, usingSpecialAttack: true })))).toEqual([[2713, 'sfx']])
    expect(brief(resolve(attack({ style: 'melee', attackKind: 'melee_stab', weaponId: 11889 })))).toEqual([[2562, 'sfx']])
    expect(brief(resolve(attack({ style: 'melee', attackKind: 'melee_crush', weaponId: 11802 })))).toEqual([[3846, 'sfx']])
    expect(brief(resolve(attack({ style: 'melee', attackKind: 'melee_crush' })))).toEqual([[2567, 'sfx']]) // unarmed
    expect(canonicalWeaponId(20368)).toBe(11802)
  })

  it('NPC attacks and unknown attack kinds are silent', () => {
    expect(resolve(attack({ sourceId: 'jad-1', targetId: 'player', style: 'magic', attackKind: 'magic_fire' }))).toEqual([])
    expect(resolve(attack({ attackKind: 'typeless' }))).toEqual([])
  })
})

describe('core layer: hits, prayers, consumables, equipment, death', () => {
  it('magic splash on an NPC plays 227 at the target SW tile (area r10); everything else silent', () => {
    const splash = (extra: Partial<Extract<SimEventBody, { type: 'hit_applied' }>>): SimEventBody => ({
      type: 'hit_applied',
      targetId: 'jad-1',
      targetPosition: [28, 33],
      damage: 0,
      blocked: false,
      attackKind: 'magic_fire',
      prayedCorrectly: null,
      accurate: false,
      ...extra,
    })
    const plays = resolve(splash({}))
    expect(brief(plays)).toEqual([[227, 'area']])
    // Manhattan 3 - 1 = 2 -> 8/10.
    expect(plays[0]!.volume).toBeCloseTo(0.8)
    expect(resolve(splash({ accurate: true }))).toEqual([])
    expect(resolve(splash({ attackKind: 'range_arrow' }))).toEqual([])
    expect(resolve(splash({ targetId: 'player' }))).toEqual([])
  })

  it('player hitsplats: random 518-521 or block 511, 400 ms late; NPC and other types silent', () => {
    const splat = (hitsplatType: 'damage' | 'block' | 'heal' | 'poison', targetId = 'player'): SimEventBody => ({
      type: 'hitsplat_spawned',
      targetId,
      amount: 10,
      hitsplatType,
    })
    expect(brief(resolve(splat('damage'), PLAYER_TILE, () => 0))).toEqual([[518, 'sfx', 400]])
    expect(brief(resolve(splat('damage'), PLAYER_TILE, () => 0.3))).toEqual([[519, 'sfx', 400]])
    expect(brief(resolve(splat('damage'), PLAYER_TILE, () => 0.999))).toEqual([[521, 'sfx', 400]])
    expect(brief(resolve(splat('block')))).toEqual([[511, 'sfx', 400]])
    expect(resolve(splat('heal'))).toEqual([])
    expect(resolve(splat('poison'))).toEqual([])
    expect(resolve(splat('damage', 'jad-1'))).toEqual([])
  })

  it('prayers: activation sound of the new prayer, 2663 when turned off, 2672 depleted / failed', () => {
    const change = (from: string | null, to: string | null): SimEventBody => ({ type: 'prayer_changed', actorId: 'player', from, to }) as SimEventBody
    expect(brief(resolve(change(null, 'ProtectMagic')))).toEqual([[2675, 'sfx']])
    expect(brief(resolve(change('ProtectMagic', 'ProtectRange')))).toEqual([[2677, 'sfx']])
    expect(brief(resolve(change(null, 'ProtectMelee')))).toEqual([[2676, 'sfx']])
    expect(brief(resolve(change('EagleEye', 'Rigour')))).toEqual([[2685, 'sfx']])
    expect(brief(resolve(change(null, 'Augury')))).toEqual([[2670, 'sfx']])
    expect(brief(resolve(change('ProtectMagic', null)))).toEqual([[2663, 'sfx']])
    expect(brief(resolve({ type: 'prayer_depleted' }))).toEqual([[2672, 'sfx']])
    expect(brief(resolve({ type: 'prayer_activation_failed', actorId: 'player', attemptedPrayer: 'ProtectMagic' }))).toEqual([[2672, 'sfx']])
  })

  it('consumables: food 2393, potions 2401, surge potion 6182 + 2401', () => {
    expect(brief(resolve({ type: 'item_consumed', track: 'food', itemId: 385 }))).toEqual([[2393, 'sfx']])
    expect(brief(resolve({ type: 'item_consumed', track: 'combo_food', itemId: 3144 }))).toEqual([[2393, 'sfx']])
    expect(brief(resolve({ type: 'item_consumed', track: 'potion', itemId: 6685 }))).toEqual([[2401, 'sfx']])
    expect(brief(resolve({ type: 'item_consumed', track: 'potion', itemId: 30875 }))).toEqual([
      [6182, 'sfx'],
      [2401, 'sfx'],
    ])
  })

  it('equip sounds by slot / item kind', () => {
    const equip = (slot: string, itemId: number, equipSound?: number): SimEventBody =>
      ({ type: 'item_equipped', slot, itemId, ...(equipSound === undefined ? {} : { equipSound }) }) as SimEventBody
    expect(brief(resolve(equip('head', 1)))).toEqual([[2240, 'sfx']])
    expect(brief(resolve(equip('legs', 1)))).toEqual([[2242, 'sfx']])
    expect(brief(resolve(equip('hands', 1)))).toEqual([[2236, 'sfx']])
    expect(brief(resolve(equip('body', 11832)))).toEqual([[2239, 'sfx']]) // chestplate
    expect(brief(resolve(equip('body', 1127)))).toEqual([[2239, 'sfx']]) // platebody
    expect(brief(resolve(equip('body', 21021)))).toEqual([[2238, 'sfx']]) // robe top
    expect(brief(resolve(equip('body', 12492)))).toEqual([[2238, 'sfx']]) // d'hide
    expect(brief(resolve(equip('weapon', 27275)))).toEqual([[2247, 'sfx']]) // powered staff
    expect(brief(resolve(equip('weapon', 21006)))).toEqual([[2247, 'sfx']]) // kodai (staff)
    expect(brief(resolve(equip('weapon', 20997)))).toEqual([[2238, 'sfx']]) // bow
    expect(brief(resolve(equip('cape', 21295)))).toEqual([[2238, 'sfx']])
    // An explicit id from the engine wins; a kind string maps through scim's table.
    expect(brief(resolve(equip('body', 21021, 2239)))).toEqual([[2239, 'sfx']])
    expect(brief(resolve({ type: 'item_equipped', slot: 'body', itemId: 1, equipSound: 'metal_body' } as unknown as SimEventBody))).toEqual([
      [2239, 'sfx'],
    ])
    expect(equipSoundKind('body', 4712, (id) => NAMES[id] ?? null)).toBe('fun')
  })

  it('death, saturated heart, redemption, mark of darkness', () => {
    expect(brief(resolve({ type: 'actor_died', actorId: 'player' }))).toEqual([[512, 'sfx']])
    expect(resolve({ type: 'actor_died', actorId: 'jad-1' })).toEqual([])
    expect(brief(resolve({ type: 'player_graphic_applied', spotAnimId: 436 }))).toEqual([[2681, 'sfx']])
    expect(brief(resolve({ type: 'player_graphic_applied', spotAnimId: 2287 }))).toEqual([[6847, 'sfx']])
    expect(brief(resolve({ type: 'status_effect_expired', effect: 'saturated_heart' }))).toEqual([[228, 'sfx']])
    expect(brief(resolve({ type: 'status_effect_expired', effect: 'mark_of_darkness' }))).toEqual([[5000, 'sfx']])
    expect(brief(resolve({ type: 'spell_self_cast', animationId: 8970 }))).toEqual([
      [5046, 'sfx'],
      [5015, 'sfx'],
    ])
    expect(resolve({ type: 'movement', actorId: 'player', from: [1, 1], to: [1, 2] })).toEqual([])
  })
})

describe('rule chain semantics', () => {
  const body: SimEventBody = { type: 'actor_died', actorId: 'player' }
  const layer = (name: string, rule: RuleLayer['rules']['actor_died']): RuleLayer => ({ name, rules: rule ? { actor_died: rule } : {} })

  it('the encounter layer runs before core; the first play wins', () => {
    const p = new EventAudioPlayer(sink, layer('enc', { resolve: () => play(1) }), createCoreLayer())
    expect(p.resolve(ev(body), PLAYER_TILE).map((x) => x.id)).toEqual([1])
  })

  it('pass continues, silent stops, an empty play stops', () => {
    expect(new EventAudioPlayer(sink, layer('enc', { resolve: () => PASS }), createCoreLayer()).resolve(ev(body), PLAYER_TILE).map((x) => x.id)).toEqual([512])
    expect(new EventAudioPlayer(sink, layer('enc', { resolve: () => SILENT }), createCoreLayer()).resolve(ev(body), PLAYER_TILE)).toEqual([])
    expect(new EventAudioPlayer(sink, layer('enc', { resolve: () => play([]) }), createCoreLayer()).resolve(ev(body), PLAYER_TILE)).toEqual([])
  })

  it('static resolves, rule-level position/volume/channel and inaudible entries', () => {
    const p = new EventAudioPlayer(
      sink,
      layer('enc', {
        resolve: () =>
          play([{ id: 7 }, { id: 8, position: [0, 0], range: 5 }, { id: 9, channel: 'sfx' }], { position: [31, 36], range: 10, volume: 0.5 }),
      }),
    )
    const plays = p.resolve(ev(body), PLAYER_TILE)
    // 7: rule position, Manhattan 3 - 1 = 2 -> 0.8 * 0.5; 8: out of its own range -> skipped; 9: forced sfx.
    expect(plays.map((x) => [x.id, x.channel, Number(x.volume.toFixed(3))])).toEqual([
      [7, 'area', 0.4],
      [9, 'sfx', 0.4],
    ])
    const s = new EventAudioPlayer(sink, layer('enc', { resolve: [5, { id: 6, delayCycles: 3 }] }))
    expect(brief(s.resolve(ev(body), PLAYER_TILE))).toEqual([
      [5, 'sfx'],
      [6, 'sfx', 60],
    ])
  })

  it('collects every playable id for preloading', () => {
    const ids = player().getAllSoundIds()
    for (const id of [159, 162, 163, 408, 409, 410, 608, 610, 156, 227, 511, 518, 521, 512, 2393, 2401, 6182, 2675, 2663, 2672, 2700, 1352, 2695, 3892, 2699, 2696, 800, 6410, 1460, 2238, 2247]) {
      expect(ids).toContain(id)
    }
  })
})
