/**
 * Whole-tick scenario tests on the real cache (loaded once for this file).
 */
import { describe, expect, it } from 'vitest'
import type { PrayerId, SimEvent } from './api'
import { centreDistance } from './combat/formulas'
import { JAD_SPAWN_TILES, PLAYER_START } from './encounters/tripleJad/constants'
import { presetLoadout } from './loadouts/presets'
import { eventsOf, makeEngine, runTicks } from './testing/testCache'

const SAFE = { infiniteHealth: true }

function jadDistanceAt(engine: ReturnType<typeof makeEngine>, jadId: string): number {
  const st = engine.getState()
  const jad = st.npcs.find((n) => n.id === jadId)!
  return centreDistance({ position: jad.position, size: jad.size }, { position: st.playerPosition })
}

describe('world setup', () => {
  it('three JalTok-Jads at the wave-68 tiles, player at (31,33), kind tripleJad', () => {
    const e = makeEngine()
    const s = e.getState()
    expect(s.encounter.kind).toBe('tripleJad')
    expect(s.playerPosition).toEqual(PLAYER_START)
    expect(s.npcs.map((n) => n.position)).toEqual(JAD_SPAWN_TILES)
    expect(s.npcs.every((n) => n.npcTypeId === 7700 && n.size === 5 && n.hp === 350 && n.archetypeId === 'jad')).toBe(true)
    const delays = (s.encounter.state.jads as { initialDelayTicks: number }[]).map((j) => j.initialDelayTicks)
    expect([...delays].sort((a, b) => a - b)).toEqual([8, 11, 14])
    expect(s.currentTick).toBe(0)
  })
  it('the encounter seed shuffles which Jad gets which delay', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const e = makeEngine({ encounterSeed: seed })
      seen.add(JSON.stringify((e.getState().encounter.state.jads as { initialDelayTicks: number }[]).map((j) => j.initialDelayTicks)))
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('Jad attack cycle', () => {
  const e = makeEngine({ mechanics: SAFE, encounterSeed: 7 })
  const jads = e.getState().encounter.state.jads as { id: string; initialDelayTicks: number }[]
  const events = runTicks(e, 60)
  const cues = eventsOf(events, 'zuk_jad_cue')
  const attacks = eventsOf(events, 'zuk_attack').filter((a) => a.attack.startsWith('jad_'))

  it('first windup at spawn + delay, then every 9 ticks (magic/range only while not adjacent)', () => {
    for (const j of jads) {
      const ticks = cues.filter((c) => c.sourceId === j.id).map((c) => c.tick)
      expect(ticks[0]).toBe(j.initialDelayTicks)
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBe(9)
      expect(cues.filter((c) => c.sourceId === j.id).every((c) => c.style !== 'melee')).toBe(true)
    }
  })
  it('three Jads produce a 3-tick cadence', () => {
    const ticks = cues.map((c) => c.tick).sort((a, b) => a - b)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBe(3)
  })
  it('release 3 ticks after the cue; animation and cue emitted together', () => {
    for (const c of cues) {
      if (c.tick + 3 > 60) continue
      const a = attacks.find((x) => x.sourceId === c.sourceId && x.launchTick === c.tick + 3)
      expect(a?.attack).toBe(`jad_${c.style}`)
      const anim = eventsOf(events, 'inferno_visual').find((v) => v.tick === c.tick && v.animations.some((an) => an.actorId === c.sourceId && an.clipId === c.style))
      expect(anim).toBeDefined()
    }
  })
  it('magic impact = floor((2+8d)/30) with projectiles 448/449/450 shifted by -90; range = 2 and graphic 451', () => {
    for (const a of attacks) {
      if (a.attack === 'jad_magic') {
        const d = Math.max(Math.abs(a.sourcePosition[0] + 2 - a.targetPosition[0]), Math.abs(a.sourcePosition[1] + 2 - a.targetPosition[1]))
        expect(a.impactTick - a.launchTick).toBe(Math.floor((2 + 8 * d) / 30))
        expect(a.projectileArrivalCycles).toBe(2 + 8 * d)
        const v = eventsOf(events, 'inferno_visual').find((x) => x.tick === a.launchTick && x.projectiles.length === 3 && x.projectiles[0]!.target.kind === 'actor')
        expect(v?.projectiles.map((p) => [p.spotAnimId, p.startDelayCycles, p.endDelayCycles])).toEqual([
          [448, 2, 2 + 8 * d],
          [449, 6, 6 + 8 * d],
          [450, 10, 12 + 8 * d],
        ])
      } else if (a.attack === 'jad_range') {
        expect(a.impactTick - a.launchTick).toBe(2)
        const g = eventsOf(events, 'inferno_visual').find((x) => x.tick === a.launchTick && x.graphics.some((gr) => gr.spotAnimId === 451))
        expect(g?.graphics[0]).toMatchObject({ spotAnimId: 451, height: 92, delayCycles: 0, target: { kind: 'tile', position: a.targetPosition } })
      }
    }
  })
  it('every attack lands at its impact tick in the player band', () => {
    for (const a of attacks) {
      if (a.impactTick > 60) continue
      const kind = a.attack === 'jad_magic' ? 'magic_fire' : a.attack === 'jad_range' ? 'range_arrow' : 'melee_stab'
      expect(eventsOf(events, 'hit_applied').some((h) => h.tick === a.impactTick && h.targetId === 'player' && h.attackKind === kind)).toBe(true)
    }
  })
  it('stationary Jads face the player', () => {
    const s = e.getState()
    expect(s.npcs.every((n) => n.combatTargetId === 'player')).toBe(true)
    expect(jadDistanceAt(e, s.npcs[0]!.id)).toBeGreaterThan(2)
  })
})

describe('prayer judgement at release', () => {
  const PRAYER: Record<string, PrayerId> = { magic: 'ProtectMagic', range: 'ProtectRange', melee: 'ProtectMelee' }
  it('correct overhead on the release tick blocks; switching after release is too late', () => {
    const e = makeEngine({ mechanics: SAFE, encounterSeed: 3 })
    const all: SimEvent[] = []
    const plan = new Map<number, PrayerId>()
    for (let t = 0; t < 80; t++) {
      const s = e.getState()
      const want = plan.get(s.currentTick + 1)
      if (want && s.activePrayer !== want) e.queueProtectionPrayer(want)
      e.advanceTick(s.playerPosition)
      for (const ev of e.lastTickEvents) {
        all.push(ev)
        if (ev.type === 'zuk_jad_cue') plan.set(ev.tick + 3, PRAYER[ev.style]!)
      }
    }
    const jadHits = eventsOf(all, 'hit_applied').filter((h) => h.targetId === 'player' && h.attackKind !== 'melee_crush')
    expect(jadHits.length).toBeGreaterThan(10)
    expect(jadHits.every((h) => h.damage === 0 && h.prayedCorrectly === true)).toBe(true)
  })
  it('prayer turned on only after a range release does not protect', () => {
    const e = makeEngine({ mechanics: SAFE, encounterSeed: 3 })
    let rangeRelease: { tick: number; impact: number } | null = null
    for (let t = 0; t < 120 && !rangeRelease; t++) {
      e.advanceTick(e.getState().playerPosition)
      const a = eventsOf(e.lastTickEvents, 'zuk_attack').find((x) => x.attack === 'jad_range')
      if (a) rangeRelease = { tick: a.launchTick, impact: a.impactTick }
    }
    expect(rangeRelease).not.toBeNull()
    e.queueProtectionPrayer('ProtectRange')
    const evs = runTicks(e, rangeRelease!.impact - rangeRelease!.tick)
    const hit = eventsOf(evs, 'hit_applied').find((h) => h.targetId === 'player' && h.attackKind === 'range_arrow')
    expect(hit?.prayedCorrectly).toBe(false)
  })
})

describe('input band', () => {
  it('prayer activated this tick does not drain; flicking costs nothing', () => {
    const e = makeEngine({ mechanics: { ...SAFE, autoPrepot: false } })
    for (let i = 0; i < 40; i++) {
      e.queueProtectionPrayer('ProtectMagic')
      e.advanceTick(e.getState().playerPosition)
    }
    expect(e.getState().prayerState.points).toBe(99)
    e.queueProtectionPrayer('ProtectMagic')
    runTicks(e, 20)
    // 12 drain per tick vs resistance 60 + 2 * prayer bonus.
    const bonus = e.getState().equipmentStats.prayer
    expect(e.getState().prayerState.points).toBe(99 - Math.floor((19 * 12) / (60 + 2 * bonus)))
  })
  it('brew then restore in one tick: the restore is blocked by the potion track; karambwan still works', () => {
    const inv = presetLoadout('max_tbow').inventory
    inv[0] = { id: 3144 }
    const e = makeEngine({ mechanics: SAFE, loadout: { ...presetLoadout('max_tbow'), inventory: inv } })
    e.queueItemAction(6, 'default') // brew
    e.queueItemAction(7, 'default') // restore
    e.queueItemAction(0, 'default') // karambwan (combo food)
    e.advanceTick(e.getState().playerPosition)
    const consumed = eventsOf(e.lastTickEvents, 'item_consumed')
    expect(consumed.map((c) => [c.track, c.itemId])).toEqual([
      ['potion', 6685],
      ['combo_food', 3144],
    ])
    const s = e.getState()
    expect(s.inventory[6]?.id).toBe(6687)
    expect(s.inventory[7]?.id).toBe(3024)
    expect(s.cooldownTracks).toEqual({ food: 0, potion: 4, combo_food: 4 })
  })
  it('eating while the attack timer runs pushes it back by 3 (food) and clears the target', () => {
    const inv = presetLoadout('max_tbow').inventory
    inv[0] = { id: 13441 }
    const e = makeEngine({ mechanics: SAFE, loadout: { ...presetLoadout('max_tbow'), inventory: inv } })
    const jad = e.getState().npcs[0]!.id
    e.applyAction({ attackTarget: jad })
    runTicks(e, 1)
    const next = e.getState().playerNextAttackTick
    expect(next).toBe(e.getState().currentTick + 5)
    e.queueItemAction(0, 'default')
    runTicks(e, 1)
    expect(e.getState().playerNextAttackTick).toBe((next ?? 0) + 3)
    expect(e.getState().attackTarget).toBe(null)
  })
  it('attack click after an item in the same band keeps attacking', () => {
    const e = makeEngine({ mechanics: SAFE })
    const jad = e.getState().npcs[0]!.id
    e.queueItemAction(6, 'default')
    e.applyAction({ attackTarget: jad })
    const evs = runTicks(e, 1)
    expect(eventsOf(evs, 'attack_started').length).toBe(1)
  })
  it('equip after an attack click in the same band: target kept but interaction paused', () => {
    const e = makeEngine({ mechanics: SAFE })
    const jad = e.getState().npcs[0]!.id
    e.applyAction({ attackTarget: jad })
    e.queueEquipFromInventory(1, 12817, 'shield')
    const evs = runTicks(e, 1)
    const s = e.getState()
    expect(s.attackTarget).toBe(jad)
    expect(eventsOf(evs, 'attack_started').length).toBe(0)
    expect(eventsOf(evs, 'item_equipped')).toMatchObject([{ slot: 'shield', itemId: 12817 }])
    expect(s.playerEquipment.weapon).toBeUndefined()
    expect(s.inventory.some((i) => i?.id === 20997)).toBe(true)
  })
  it('quick prayers and the pending projection', () => {
    const e = makeEngine({ mechanics: SAFE })
    e.queueQuickPrayerToggle(['ProtectMagic', 'Rigour'])
    const pending = e.getState()
    expect(pending.pendingProtectionPrayer).toEqual([true, 'ProtectMagic'])
    expect(pending.pendingOffensivePrayer).toEqual([true, 'Rigour'])
    expect(pending.quickPrayersActive).toBe(true)
    const evs = runTicks(e, 1)
    const s = e.getState()
    expect(s.activePrayer).toBe('ProtectMagic')
    expect(s.offensivePrayer).toBe('Rigour')
    expect(eventsOf(evs, 'prayer_changed').map((p) => [p.from, p.to])).toEqual([
      [null, 'ProtectMagic'],
      [null, 'Rigour'],
    ])
    e.queueQuickPrayerToggle(['ProtectMagic', 'Rigour'])
    runTicks(e, 1)
    expect(e.getState().activePrayer).toBe(null)
    expect(e.getState().quickPrayersActive).toBe(false)
  })
  it('run toggle projection and spec toggle projection', () => {
    const e = makeEngine({ mechanics: SAFE })
    e.queueRunToggle()
    expect(e.getState().isRunEnabled).toBe(false)
    runTicks(e, 1)
    expect(e.getState().isRunEnabled).toBe(false)
    // Twisted bow has no special: the toggle does nothing.
    e.queueSpecialAttackToggle()
    expect(e.getState().pendingSpecialAttackActive).toBe(false)
  })
})

describe('movement', () => {
  it('runs two tiles per tick to a clicked tile and drains run energy', () => {
    const e = makeEngine({ mechanics: SAFE })
    const target: [number, number] = [31, 45]
    e.advanceTick(target)
    const s = e.getState()
    expect(s.playerPosition).toEqual([31, 35])
    expect(s.playerIsRunning).toBe(true)
    expect(s.playerMovementPath).toEqual([
      [31, 34],
      [31, 35],
    ])
    expect(s.runEnergy.energy).toBeLessThan(10000)
    const moves = eventsOf(e.lastTickEvents, 'movement').filter((m) => m.actorId === 'player')
    expect(moves).toMatchObject([{ from: [31, 33], to: [31, 35] }])
  })
  it('the walkable area is the cache-built arena (bounds 17..45 x 17..46)', () => {
    const e = makeEngine({ mechanics: SAFE })
    expect(e.arena.bounds).toMatchObject({ minX: 17, maxX: 45, minY: 17, maxY: 46 })
    for (let i = 0; i < 20; i++) e.advanceTick([50, 33])
    expect(e.getState().playerPosition).toEqual([45, 33])
    // A click more than 10 tiles beyond the arena has no alternative route (scim SY): no movement.
    e.advanceTick([60, 20])
    expect(e.getState().playerPosition).toEqual([45, 33])
  })
})

describe('HUD max hit / DPS (regression vs the live site)', () => {
  function projection(preset: string, prayer: PrayerId | null, targetIndex: 'jad' | 'healer') {
    const e = makeEngine({ preset, mechanics: SAFE })
    if (prayer) e.queueOffensivePrayer(prayer)
    let target = e.getState().npcs[0]!.id
    if (targetIndex === 'healer') {
      e.executeEncounterCommand({ type: 'spawn-jad-healers', jadId: target })
      target = e.getState().npcs.find((n) => n.archetypeId === 'jad_healer')!.id
    }
    e.applyAction({ attackTarget: target })
    runTicks(e, 1)
    return e.getAdjustedTheoreticalDps()!
  }
  it('max tbow vs Jad with prepot: 77 without Rigour, 92 with Rigour', () => {
    const plain = projection('max_tbow', null, 'jad')
    expect(plain.baseMaxHit).toBe(32)
    expect(plain.maxHit).toBe(77)
    expect(projection('max_tbow', 'Rigour', 'jad').maxHit).toBe(92)
  })
  it('max tbow vs Yt-HurKot: 59 without Rigour, 70 with Rigour', () => {
    expect(projection('max_tbow', null, 'healer').maxHit).toBe(59)
    expect(projection('max_tbow', 'Rigour', 'healer').maxHit).toBe(70)
  })
  it('expectedHit is attached to the first hit of each player attack in the damage history', () => {
    const e = makeEngine({ mechanics: SAFE })
    const jad = e.getState().npcs[0]!.id
    e.applyAction({ attackTarget: jad })
    runTicks(e, 10)
    const hist = e.getState().damageHistory.filter((h) => h.source === 'PlayerAttack')
    expect(hist.length).toBeGreaterThan(0)
    expect(hist.every((h) => typeof h.expectedHit === 'number' && h.expectedHit > 0)).toBe(true)
  })
})

describe('healers', () => {
  it('spawn when a player hit leaves the Jad at <= 175, at the wave-68 offsets', () => {
    const e = makeEngine({ mechanics: SAFE, combatSeed: 5 })
    const jad = e.getState().npcs[0]!
    e.executeEncounterCommand({ type: 'set-jad-hp', jadId: jad.id, hp: 176 })
    e.applyAction({ attackTarget: jad.id })
    let spawnedAt = -1
    for (let i = 0; i < 40 && spawnedAt < 0; i++) {
      runTicks(e, 1)
      if (e.getState().npcs.some((n) => n.archetypeId === 'jad_healer')) spawnedAt = e.getState().currentTick
    }
    expect(spawnedAt).toBeGreaterThan(0)
    const s = e.getState()
    const healers = s.npcs.filter((n) => n.archetypeId === 'jad_healer')
    expect(healers.map((h) => h.npcTypeId)).toEqual([7701, 7701, 7701])
    const jadNow = s.npcs.find((n) => n.id === jad.id)!
    expect(healers.map((h) => h.spawnTick)).toEqual([spawnedAt, spawnedAt, spawnedAt])
    // Healers spawn in the NPC band before moving; compare against the spawn tiles recorded in history.
    expect(healers.map((h) => h.history.get(spawnedAt))).toBeDefined()
    const expectedTiles = [
      [jadNow.position[0], jadNow.position[1] + 6],
      [jadNow.position[0] + 1, jadNow.position[1] + 5],
      [jadNow.position[0], jadNow.position[1] + 5],
    ]
    const spawnTiles = healers.map((h) => [...h.history.entries()].sort((a, b) => a[0] - b[0])[0]![1])
    expect(spawnTiles).toEqual(expectedTiles)
    expect(jadNow.hp).toBeLessThanOrEqual(175 + 10)
  })
  it('heal the Jad by 10 every 4 ticks while adjacent, graphic 444 once per Jad per tick', () => {
    const e = makeEngine({ mechanics: SAFE })
    const jad = e.getState().npcs[0]!
    e.executeEncounterCommand({ type: 'set-jad-hp', jadId: jad.id, hp: 100 })
    e.executeEncounterCommand({ type: 'spawn-jad-healers', jadId: jad.id })
    const evs = runTicks(e, 13)
    const heals = eventsOf(evs, 'hitsplat_spawned').filter((h) => h.targetId === jad.id && h.hitsplatType === 'heal')
    const byTick = new Map<number, number>()
    for (const h of heals) byTick.set(h.tick, (byTick.get(h.tick) ?? 0) + h.amount)
    expect(heals.every((h) => h.amount === 10)).toBe(true)
    const ticks = [...byTick.keys()].sort((a, b) => a - b)
    for (let i = 1; i < ticks.length; i++) expect((ticks[i]! - ticks[i - 1]!) % 4).toBe(0)
    for (const t of ticks) {
      const g = eventsOf(evs, 'inferno_visual').filter((v) => v.tick === t && v.graphics.some((gr) => gr.spotAnimId === 444))
      expect(g).toHaveLength(1)
    }
    // Two of the three heal (the (0,+6) one is stuck behind (0,+5)).
    expect(byTick.get(ticks[0]!)).toBe(20)
    expect(e.getState().npcs.find((n) => n.id === jad.id)!.hp).toBe(100 + 20 * ticks.length)
  })
  it('a hit switches the healer to the player; it attacks only from first engagement + 3, then every 4', () => {
    const e = makeEngine({ mechanics: SAFE })
    const jad = e.getState().npcs[2]!
    e.executeEncounterCommand({ type: 'spawn-jad-healers', jadId: jad.id })
    const healer = e.getState().npcs.find((n) => n.archetypeId === 'jad_healer')!
    e.applyAction({ attackTarget: healer.id })
    const evs = runTicks(e, 30)
    const started = eventsOf(evs, 'attack_started').find((a) => a.sourceId === 'player' && a.targetId === healer.id)!
    const impact = started.tick + started.impactDelayTicks
    const attacks = eventsOf(evs, 'zuk_attack').filter((a) => a.sourceId === healer.id)
    expect(attacks.length).toBeGreaterThan(0)
    expect(attacks[0]!.tick).toBeGreaterThanOrEqual(impact + 3)
    for (let i = 1; i < attacks.length; i++) expect(attacks[i]!.tick - attacks[i - 1]!.tick).toBeGreaterThanOrEqual(4)
    expect(attacks.every((a) => a.attack === 'jad_healer_melee' && a.impactTick === a.launchTick)).toBe(true)
  })
})

describe('Jad death and victory', () => {
  it('removal 6 ticks after death takes its healers with it; zuk_death on the death tick', () => {
    const e = makeEngine({ mechanics: SAFE })
    const jad = e.getState().npcs[0]!
    e.executeEncounterCommand({ type: 'spawn-jad-healers', jadId: jad.id })
    e.executeEncounterCommand({ type: 'set-jad-hp', jadId: jad.id, hp: 1 })
    e.applyAction({ attackTarget: jad.id })
    const evs = runTicks(e, 20)
    const died = eventsOf(evs, 'actor_died').find((d) => d.actorId === jad.id)!
    expect(eventsOf(evs, 'zuk_death')).toMatchObject([{ actorId: jad.id, npcKind: 'jad', tick: died.tick }])
    const despawned = eventsOf(evs, 'actor_despawned')
    expect(despawned.find((d) => d.actorId === jad.id)?.tick).toBe(died.tick + 6)
    expect(despawned.filter((d) => d.actorId.startsWith('jad_healer')).every((d) => d.tick === died.tick + 6)).toBe(true)
    expect(despawned.filter((d) => d.actorId.startsWith('jad_healer'))).toHaveLength(3)
  })
  it('killing all three resolves to victory 6 ticks after the last death', () => {
    const e = makeEngine({ mechanics: SAFE })
    for (const n of e.getState().npcs) e.executeEncounterCommand({ type: 'set-jad-hp', jadId: n.id, hp: 1 })
    const ids = e.getState().npcs.map((n) => n.id)
    let lastDeath = -1
    for (const id of ids) {
      e.applyAction({ attackTarget: id })
      for (let i = 0; i < 20; i++) {
        runTicks(e, 1)
        if (eventsOf(e.lastTickEvents, 'actor_died').some((d) => d.actorId === id)) {
          lastDeath = e.getState().currentTick
          break
        }
      }
    }
    expect(e.getState().encounterOutcome).toMatchObject({ phase: 'resolving', decisiveTick: lastDeath, completionTick: lastDeath + 6 })
    runTicks(e, 6)
    expect(e.getState().encounterOutcome.phase).toBe('victory')
    expect(e.canAdvance()).toBe(false)
  })
})

describe('determinism', () => {
  function transcript(combatSeed: number, encounterSeed: number): string {
    const e = makeEngine({ mechanics: SAFE, combatSeed, encounterSeed })
    const out: string[] = []
    e.applyAction({ attackTarget: e.getState().npcs[1]!.id })
    for (let i = 0; i < 80; i++) {
      if (i === 20) e.queueProtectionPrayer('ProtectMagic')
      e.advanceTick(e.getState().playerPosition)
      for (const ev of e.lastTickEvents) out.push(JSON.stringify(ev))
    }
    return out.join('\n')
  }
  it('same seeds, same inputs -> identical event streams', () => {
    expect(transcript(11, 22)).toBe(transcript(11, 22))
  })
  it('different seeds diverge', () => {
    expect(transcript(11, 22)).not.toBe(transcript(12, 23))
  })
  it('reset re-seeds, rebuilds and keeps event ids increasing', () => {
    const e = makeEngine({ mechanics: SAFE })
    runTicks(e, 5)
    const lastId = e.lastTickEvents.at(-1)?.eventId ?? 0
    e.reset({ combatSeed: 3, encounterSeed: 4 })
    expect(e.getState().currentTick).toBe(0)
    expect(e.getState().npcs).toHaveLength(3)
    expect(e.getState().stats.ranged.current).toBe(112)
    runTicks(e, 1)
    expect(e.lastTickEvents.every((ev) => ev.eventId > lastId)).toBe(true)
  })
})

describe('player attacks: spells, specials, prepot, ammo', () => {
  it('manual Ice Barrage: spellCast payload, spell hit delay and freeze on an accurate hit', () => {
    const e = makeEngine({ mechanics: SAFE, combatSeed: 9 })
    const jad = e.getState().npcs[0]!
    e.applyAction({ attackTarget: jad.id, manualCastSpell: 'Ice Barrage' })
    const evs = runTicks(e, 1)
    const started = eventsOf(evs, 'attack_started').find((a) => a.sourceId === 'player')!
    expect(started).toMatchObject({ spellId: 'Ice Barrage', style: 'magic', attackKind: 'magic_fire', spellCast: { targetPosition: jad.position, targetSize: 5 } })
    const p = e.getState().playerPosition
    const d = Math.max(Math.max(jad.position[0] - p[0], p[0] - (jad.position[0] + 4), 0), Math.max(jad.position[1] - p[1], p[1] - (jad.position[1] + 4), 0))
    expect(started.impactDelayTicks).toBe(1 + Math.floor((46 + 10 * d) / 30))
    expect(e.getState().playerNextAttackTick).toBe(e.getState().currentTick + 5)
    const later = runTicks(e, started.impactDelayTicks)
    const hit = eventsOf(later, 'hit_applied').find((h) => h.targetId === jad.id)!
    expect(eventsOf(later, 'zuk_hit').some((z) => z.actorId === jad.id && z.npcKind === 'jad')).toBe(true)
    if (hit.accurate) expect(e.worldState.getNpc(jad.id)!.debuffs?.boundUntilTick).toBe(e.getState().currentTick + 32)
  })
  it('zuk_hit is emitted for a 0-damage miss too', () => {
    const e = makeEngine({ preset: 'naked', mechanics: SAFE })
    const jad = e.getState().npcs[0]!
    e.applyAction({ attackTarget: jad.id })
    const evs = runTicks(e, 40)
    const misses = eventsOf(evs, 'hit_applied').filter((h) => h.targetId === jad.id && !h.accurate)
    expect(misses.length).toBeGreaterThan(0)
    for (const m of misses) expect(eventsOf(evs, 'zuk_hit').some((z) => z.tick === m.tick && z.actorId === jad.id)).toBe(true)
  })
  it('mage tank prepot: defence 120, magic 112 (divine heart), stamina 400, prayer regeneration 800', () => {
    const e = makeEngine({ preset: 'mage_tank', mechanics: SAFE })
    const s = e.getState()
    expect(s.stats.defence.current).toBe(120)
    expect(s.stats.magic.current).toBe(112)
    expect(s.combatTimers.saturatedHeartActiveTicks).toBe(500)
    expect(s.potionBoosts.find((b) => b.stat === 'magic')).toMatchObject({ amount: 13, isDivine: true })
    const effects = e.worldState.getPlayer()!.activeEffects
    expect(effects.find((x) => x.type === 'stamina')?.ticksRemaining).toBe(400)
    expect(effects.find((x) => x.type === 'prayer_regeneration')?.ticksRemaining).toBe(800)
  })
  it('atlatl preset: equipping the atlatl needs the darts in the ammo slot', () => {
    const e = makeEngine({ preset: 'atlatl_eclipse', mechanics: SAFE })
    e.queueEquipFromInventory(0, 29000, 'weapon')
    e.queueEquipAmmoFromInventory(1, 28991)
    runTicks(e, 1)
    const s = e.getState()
    expect(s.playerEquipment.weapon).toBe(29000)
    expect(s.playerEquipment.shield).toBeUndefined()
    expect(s.playerCombatSupplies.equippedAmmo).toEqual({ id: 28991 })
    expect(s.inventory[1]).toEqual({ id: 9242 })
    expect(s.inventory.some((i) => i?.id === 9185)).toBe(true)
    expect(s.inventory.some((i) => i?.id === 23991)).toBe(true)
    e.applyAction({ attackTarget: s.npcs[0]!.id })
    const evs = runTicks(e, 3)
    expect(eventsOf(evs, 'attack_started').find((a) => a.sourceId === 'player')).toMatchObject({ weaponId: 29000, ammoId: 28991, style: 'range' })
  })
  it('blowpipe special: costs 50 energy and uses the special timing', () => {
    const e = makeEngine({ mechanics: SAFE })
    e.queueEquipFromInventory(5, 12926, 'weapon')
    runTicks(e, 1)
    e.queueSpecialAttackToggle()
    expect(e.getState().pendingSpecialAttackActive).toBe(true)
    e.applyAction({ attackTarget: e.getState().npcs[0]!.id })
    const evs = runTicks(e, 3)
    const started = eventsOf(evs, 'attack_started').find((a) => a.sourceId === 'player')!
    expect(started.usingSpecialAttack).toBe(true)
    expect(e.getState().specialAttack.energy).toBe(50)
    expect(e.getState().isSpecialAttackActive).toBe(false)
  })
})

describe('healer placement fallback (BUILD_PLAN wave-68 rule)', () => {
  it('an occupied offset tile moves to the nearest free walkable tile (Chebyshev rings, x then y)', () => {
    const e = makeEngine({ mechanics: SAFE })
    const jad = e.getState().npcs[0]!
    expect(jad.position).toEqual([24, 36])
    e.executeEncounterCommand({ type: 'spawn-jad-healers', jadId: jad.id })
    e.executeEncounterCommand({ type: 'spawn-jad-healers', jadId: jad.id })
    const healers = e.getState().npcs.filter((n) => n.archetypeId === 'jad_healer')
    expect(healers.map((h) => h.position)).toEqual([
      [24, 42],
      [25, 41],
      [24, 41],
      [23, 41],
      [25, 42],
      [23, 40],
    ])
  })
})
