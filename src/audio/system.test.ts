import { afterEach, describe, expect, it } from 'vitest'
import type { SimRuntime, TickSnapshot } from '../app/runtime/types'
import { settingsStore } from '../app/settings/settings'
import type { SimEvent, SimEventBody, SimState, Tile } from '../sim/api'
import { type AudioSystem, createAudioSystem } from './AudioSystem'
import type { FrameSoundSeq } from './FrameSoundTracker'
import { FakeAudioContext, fakeSource } from './testing'

class FakeRuntime {
  tick = 0
  playerPosition: Tile = [31, 33]
  events: SimEvent[] = []
  suspended = false
  private tickListeners = new Set<(s: TickSnapshot) => void>()
  private suspendListeners = new Set<(s: boolean) => void>()
  private eventId = 0

  readonly clock = {
    now: () => 0,
    tickDurationMs: 600,
    lastTickAt: 0,
    interpolatedTick: () => this.tick,
    onSuspendChange: (l: (s: boolean) => void) => {
      this.suspendListeners.add(l)
      return () => this.suspendListeners.delete(l)
    },
    get suspended(): boolean {
      return false
    },
  }

  snapshot(): TickSnapshot {
    const state = { currentTick: this.tick, playerPosition: this.playerPosition } as unknown as SimState
    return { state, events: this.events, tickTimeMs: this.tick * 600 }
  }

  getSnapshot = (): TickSnapshot => this.snapshot()

  onTick = (l: (s: TickSnapshot) => void): (() => void) => {
    this.tickListeners.add(l)
    return () => this.tickListeners.delete(l)
  }

  /** Advance one tick emitting these events. */
  advance(...bodies: SimEventBody[]): SimEvent[] {
    this.tick++
    this.events = bodies.map((b) => ({ ...b, tick: this.tick, eventId: ++this.eventId }) as SimEvent)
    const snap = this.snapshot()
    for (const l of this.tickListeners) l(snap)
    return this.events
  }

  /** Notify the current snapshot again (e.g. after a command). */
  redeliver(): void {
    const snap = this.snapshot()
    for (const l of this.tickListeners) l(snap)
  }

  /** Engine reset: tick and event ids start over. */
  reset(): void {
    this.tick = 0
    this.eventId = 0
    this.events = []
    const snap = this.snapshot()
    for (const l of this.tickListeners) l(snap)
  }

  setSuspended(s: boolean): void {
    this.suspended = s
    for (const l of this.suspendListeners) l(s)
  }

  asRuntime(): SimRuntime {
    return this as unknown as SimRuntime
  }
}

const SHADOW_SEQ: FrameSoundSeq = { frameSounds: new Map([[1, [{ id: 6412, loops: 1, location: 15, retain: 0 }]]]), looping: false, frameCount: 10 }

function setup() {
  const ctx = new FakeAudioContext()
  const frames: (() => void)[] = []
  let now = 1000
  const system = createAudioSystem(null, {
    source: fakeSource(22050),
    seqLookup: (id) => (id === 9543 ? SHADOW_SEQ : null),
    contextFactory: () => ctx.asContext(),
    requestFrame: (cb) => frames.push(cb),
    now: () => now,
    random: () => 0,
    browser: false,
  })
  const rt = new FakeRuntime()
  const detach = system.attach(rt.asRuntime())
  /** Ids started so far with their start time relative to `ctx.currentTime` when scheduled. */
  const started = () => ctx.sources.map((s) => [idOf(s.buffer), Number(((s.startedAt?.when ?? 0) * 1000).toFixed(0))])
  const ids = new Map<unknown, number>()
  // Tag buffers with their sound id: fakeSource returns a fresh array per id, the engine caches one buffer per id.
  const idOf = (buffer: unknown) => ids.get(buffer) ?? -1
  const origPlay = system.engine.play.bind(system.engine)
  system.engine.play = (id, opts, trigger) => {
    const before = ctx.sources.length
    origPlay(id, opts, trigger)
    const src = ctx.sources[before]
    if (src) ids.set(src.buffer, id)
  }
  return {
    ctx,
    system,
    rt,
    detach,
    started,
    runFrames: () => frames.splice(0).forEach((f) => f()),
    pendingFrames: () => frames.length,
    setNow: (t: number) => {
      now = t
    },
  }
}

let current: AudioSystem | null = null
afterEach(() => {
  current?.dispose()
  current = null
})

const jadMagic = (arrival: number): SimEventBody => ({
  type: 'zuk_attack',
  attack: 'jad_magic',
  sourceId: 'jad-1',
  targetId: 'player',
  sourcePosition: [24, 36],
  targetPosition: [31, 33],
  launchTick: 1,
  impactTick: 4,
  projectileArrivalCycles: arrival,
})

describe('AudioSystem: tick events -> first rendered frame', () => {
  it("plays a tick's sounds on the next frame, with rule delays in real time", () => {
    const t = setup()
    current = t.system
    t.rt.advance(jadMagic(34), { type: 'zuk_jad_cue', sourceId: 'jad-2', style: 'magic' })
    expect(t.ctx.sources.length).toBe(0)
    t.ctx.currentTime = 2
    t.system.frameSoundFeed.onFrame([], { x: 31.5, y: 33.5 }, false)
    expect(t.started()).toEqual([
      [162, 2000],
      [163, 2680],
      [159, 2000],
    ])
    // Sounds go through the settings volumes (scim defaults 0.1 / 0.1 / 0.1).
    expect(t.ctx.buses.master.gain.value).toBe(settingsStore.get().masterVolume)
  })

  it('three Jads casting on the same tick stack three voices (no de-dupe)', () => {
    const t = setup()
    current = t.system
    t.rt.advance(jadMagic(34), jadMagic(26), jadMagic(42))
    t.system.frameSoundFeed.onFrame([], null, false)
    expect(t.started().map(([id]) => id)).toEqual([162, 163, 162, 163, 162, 163])
  })

  it('uses the player tile after the tick as listener', () => {
    const t = setup()
    current = t.system
    t.rt.playerPosition = [20, 33]
    t.rt.advance({
      type: 'hit_applied',
      targetId: 'jad-1',
      targetPosition: [24, 36],
      damage: 0,
      blocked: false,
      attackKind: 'magic_fire',
      prayedCorrectly: null,
      accurate: false,
    })
    t.system.frameSoundFeed.onFrame([], null, false)
    // Manhattan 4 + 3 - 1 = 6 -> (10 - 6) / 10.
    expect(t.ctx.sources[0]!.voiceGain!.gain.value).toBeCloseTo(0.4)
    expect(t.ctx.sources[0]!.voiceGain!.connections).toEqual([t.ctx.buses.area])
  })

  it('never replays an event id, but keeps every tick that happened between frames', () => {
    const t = setup()
    current = t.system
    t.rt.advance({ type: 'actor_died', actorId: 'player' })
    t.rt.advance({ type: 'prayer_depleted' })
    // Re-delivery of the same snapshot (e.g. a command notification) is ignored.
    t.rt.redeliver()
    t.system.frameSoundFeed.onFrame([], null, false)
    t.system.frameSoundFeed.onFrame([], null, false)
    expect(t.started().map(([id]) => id)).toEqual([512, 2672])
  })

  it('keeps at most the last two ticks when frames stall', () => {
    const t = setup()
    current = t.system
    t.rt.advance({ type: 'actor_died', actorId: 'player' })
    t.rt.advance({ type: 'prayer_depleted' })
    t.rt.advance({ type: 'item_consumed', track: 'food', itemId: 385 })
    t.system.frameSoundFeed.onFrame([], null, false)
    expect(t.started().map(([id]) => id)).toEqual([2672, 2393])
  })

  it('falls back to requestAnimationFrame when no renderer feeds frames', () => {
    const t = setup()
    current = t.system
    t.rt.advance({ type: 'actor_died', actorId: 'player' })
    expect(t.pendingFrames()).toBe(1)
    t.runFrames()
    expect(t.started().map(([id]) => id)).toEqual([512])
    // While the renderer is feeding frames it owns the flush.
    t.system.frameSoundFeed.onFrame([], null, false)
    t.rt.advance({ type: 'prayer_depleted' })
    t.runFrames()
    expect(t.ctx.sources.length).toBe(1)
    t.system.frameSoundFeed.onFrame([], null, false)
    expect(t.started().map(([id]) => id)).toEqual([512, 2672])
  })

  it('restart (tick goes back) stops every voice and resets event tracking', () => {
    const t = setup()
    current = t.system
    t.rt.advance({ type: 'actor_died', actorId: 'player' })
    t.system.frameSoundFeed.onFrame([], null, false)
    expect(t.ctx.sources[0]!.stopped).toBe(false)
    t.rt.reset()
    expect(t.ctx.sources[0]!.stopped).toBe(true)
    t.rt.advance({ type: 'prayer_depleted' }) // eventId 1 again
    t.system.frameSoundFeed.onFrame([], null, false)
    expect(t.started().map(([id]) => id)).toEqual([512, 2672])
  })

  it('pauses voices while the runtime clock is suspended and resumes them after', () => {
    const t = setup()
    current = t.system
    t.rt.advance({ type: 'actor_died', actorId: 'player' })
    t.system.frameSoundFeed.onFrame([], null, false)
    t.ctx.currentTime = 0.25
    t.rt.setSuspended(true)
    expect(t.system.engine.isPlaybackPaused).toBe(true)
    expect(t.ctx.sources[0]!.stopped).toBe(true)
    t.ctx.currentTime = 5
    t.rt.setSuspended(false)
    expect(t.ctx.sources[1]!.startedAt).toEqual({ when: 5, offset: 0.25 })
  })

  it('ignores events already present when attaching', () => {
    const ctx = new FakeAudioContext()
    const rt = new FakeRuntime()
    rt.advance({ type: 'actor_died', actorId: 'player' })
    const system = createAudioSystem(null, { source: fakeSource(), contextFactory: () => ctx.asContext(), requestFrame: () => {}, browser: false })
    current = system
    system.attach(rt.asRuntime())
    system.frameSoundFeed.onFrame([], null, false)
    expect(ctx.sources.length).toBe(0)
  })

  it('frame sounds: update when running, silent sync when paused', () => {
    const t = setup()
    current = t.system
    const listener = { x: 31.5, y: 33.5 }
    t.system.frameSoundFeed.onFrame([{ key: 'spotanim:1', seqId: 9543, frame: 0, position: listener }], listener, false)
    t.system.frameSoundFeed.onFrame([{ key: 'spotanim:1', seqId: 9543, frame: 1, position: listener }], listener, true)
    expect(t.ctx.sources.length).toBe(0)
    t.system.frameSoundFeed.onFrame([{ key: 'spotanim:2', seqId: 9543, frame: 0, position: listener }], listener, false)
    t.system.frameSoundFeed.onFrame([{ key: 'spotanim:2', seqId: 9543, frame: 1, position: listener }], listener, false)
    expect(t.started().map(([id]) => id)).toEqual([6412])
    expect(t.ctx.sources[0]!.voiceGain!.connections).toEqual([t.ctx.buses.area])
  })

  it('follows the settings store live', () => {
    const t = setup()
    current = t.system
    const before = settingsStore.get()
    try {
      settingsStore.patch({ sfxVolume: 0.55, areaVolume: 0.25, masterVolume: 0.8 })
      expect([t.system.engine.getMasterVolume(), t.system.engine.getSfxVolume(), t.system.engine.getAreaVolume()]).toEqual([0.8, 0.55, 0.25])
      t.rt.advance({ type: 'actor_died', actorId: 'player' })
      settingsStore.patch({ masterVolume: 0 })
      t.system.frameSoundFeed.onFrame([], null, false)
      expect(t.ctx.sources.length).toBe(0)
    } finally {
      settingsStore.patch({ masterVolume: before.masterVolume, sfxVolume: before.sfxVolume, areaVolume: before.areaVolume })
    }
  })

  it('detach stops listening', () => {
    const t = setup()
    current = t.system
    t.detach()
    t.rt.advance({ type: 'actor_died', actorId: 'player' })
    t.system.frameSoundFeed.onFrame([], null, false)
    expect(t.ctx.sources.length).toBe(0)
  })
})
