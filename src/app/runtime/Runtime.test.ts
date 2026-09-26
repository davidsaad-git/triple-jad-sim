import { describe, expect, it } from 'vitest'
import type { CacheSystem } from '../../cache/CacheSystem'
import type { SimEngine, SimEvent, SimState, Tile } from '../../sim/api'
import { createRuntime, type RuntimeSettings, type WindowState } from './Runtime'
import { PausableClock } from './clock'
import { LagQueue, lagDelayMs } from './lag'
import { PresentationOverride } from './presentation'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeEngine {
  tick = 0
  canAdvanceFlag = true
  introActive = false
  playerPosition: Tile = [31, 33]
  /** [tick, input tile] for every advanceTick call. */
  readonly advances: [number, Tile][] = []
  /** Ops queued since the last tick, and the ops each tick processed. */
  queued: string[] = []
  readonly processed: string[][] = []
  resets = 0
  lastTickEvents: SimEvent[] = []
  private nextEventId = 1

  advanceTick(tile: Tile): void {
    if (!this.canAdvanceFlag) return
    this.tick += 1
    this.advances.push([this.tick, tile])
    this.processed.push(this.queued)
    this.queued = []
    this.lastTickEvents = [{ type: 'actor_died', actorId: `t${this.tick}`, tick: this.tick, eventId: this.nextEventId++ }]
  }
  canAdvance(): boolean {
    return this.canAdvanceFlag
  }
  getState(): SimState {
    return { currentTick: this.tick, playerPosition: this.playerPosition, introActive: this.introActive } as unknown as SimState
  }
  queue(op: string): void {
    this.queued.push(op)
  }
  reset(): void {
    this.resets += 1
    this.tick = 0
    this.queued = []
    this.lastTickEvents = []
    this.nextEventId = 1
  }
}

class FakeHost {
  time = 0
  windowState: WindowState = 'focused'
  private frames = new Map<number, (ts: number) => void>()
  private nextId = 1
  private windowListeners = new Set<() => void>()

  env = {
    now: () => this.time,
    requestFrame: (cb: (ts: number) => void) => {
      const id = this.nextId++
      this.frames.set(id, cb)
      return id
    },
    cancelFrame: (id: number) => {
      this.frames.delete(id)
    },
    getWindowState: () => this.windowState,
    subscribeWindowState: (l: () => void) => {
      this.windowListeners.add(l)
      return () => this.windowListeners.delete(l)
    },
    isDocumentHidden: () => this.windowState === 'hidden',
  }

  get pendingFrames(): number {
    return this.frames.size
  }

  /** Deliver one animation frame at time `t`. */
  frame(t: number): void {
    this.time = t
    const cbs = [...this.frames.values()]
    this.frames.clear()
    for (const cb of cbs) cb(t)
  }

  /** Frames every `step` ms from the current time (exclusive) up to `until` (inclusive). */
  run(until: number, step = 1000 / 60): void {
    const start = this.time
    for (let k = 1; start + k * step <= until + 1e-9; k++) this.frame(start + k * step)
  }

  setWindow(state: WindowState): void {
    this.windowState = state
    for (const l of [...this.windowListeners]) l()
  }
}

class FakeSettings {
  value: RuntimeSettings = { speedMultiplier: 1, inputLagMs: 20, autoAdvance: true, pauseWhenUnfocused: true }
  private listeners = new Set<() => void>()
  get = () => this.value
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  patch(p: Partial<RuntimeSettings>): void {
    this.value = { ...this.value, ...p }
    for (const l of [...this.listeners]) l()
  }
}

function setup(settings: Partial<RuntimeSettings> = {}) {
  const engine = new FakeEngine()
  const host = new FakeHost()
  const store = new FakeSettings()
  store.value = { ...store.value, ...settings }
  const runtime = createRuntime({
    engine: engine as unknown as SimEngine,
    cache: {} as CacheSystem,
    settings: store,
    env: host.env,
  })
  return { engine, host, store, runtime }
}

/** A lagged "prayer click" at time t. */
function clickAt(ctx: ReturnType<typeof setup>, t: number, op: string): void {
  ctx.host.time = t
  ctx.runtime.dispatch((e) => (e as unknown as FakeEngine).queue(op), op)
}

// ---------------------------------------------------------------------------

describe('lag helpers', () => {
  it('lagDelayMs scales with speed and ignores non-positive lag', () => {
    expect(lagDelayMs(20, 1)).toBe(20)
    expect(lagDelayMs(20, 2)).toBe(10)
    expect(lagDelayMs(20, 0.5)).toBe(40)
    expect(lagDelayMs(0, 1)).toBe(0)
    expect(lagDelayMs(-5, 1)).toBe(0)
    expect(lagDelayMs(Number.NaN, 1)).toBe(0)
  })

  it('LagQueue flushes due entries in push order and keeps the rest', () => {
    const q = new LagQueue()
    const out: string[] = []
    q.push(10, () => out.push('a'))
    q.push(30, () => out.push('b'))
    q.push(5, () => out.push('c'))
    q.flush(10)
    expect(out).toEqual(['a', 'c'])
    expect(q.pending).toBe(1)
    q.flush(30)
    expect(out).toEqual(['a', 'c', 'b'])
    expect(q.pending).toBe(0)
  })

  it('entries pushed during a flush go after the kept ones', () => {
    const q = new LagQueue()
    const out: string[] = []
    q.push(50, () => out.push('late'))
    q.push(10, () => q.push(20, () => out.push('pushed')))
    q.flush(10)
    q.flush(100)
    expect(out).toEqual(['late', 'pushed'])
  })
})

describe('PausableClock', () => {
  it('subtracts suspended intervals', () => {
    let raw = 0
    const clock = new PausableClock(() => raw)
    raw = 100
    clock.setSuspended(true)
    raw = 400
    expect(clock.now()).toBe(100)
    clock.setSuspended(false)
    raw = 500
    expect(clock.now()).toBe(200)
    // Times inside / before the pause map correctly.
    expect(clock.now(50)).toBe(50)
    expect(clock.now(250)).toBe(100)
    raw = 600
    clock.setSuspended(true)
    raw = 1000
    clock.setSuspended(false)
    expect(clock.now(1100)).toBe(1100 - 300 - 400)
  })

  it('ignores redundant suspend calls', () => {
    let raw = 0
    const clock = new PausableClock(() => raw)
    clock.setSuspended(false)
    raw = 10
    clock.setSuspended(true)
    raw = 20
    clock.setSuspended(true)
    raw = 30
    clock.setSuspended(false)
    expect(clock.now(40)).toBe(20)
  })
})

describe('PresentationOverride', () => {
  it('a newer show wins; an older retire is a no-op', () => {
    const o = new PresentationOverride<number | null>()
    const r1 = o.show(1)
    const r2 = o.show(null)
    r1()
    expect(o.get()).toBeNull()
    r2()
    expect(o.get()).toBeUndefined()
  })
})

describe('tick loop', () => {
  it('fires the first tick one full tickMs after start, on the first frame at or after it', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.run(599, 1)
    expect(ctx.engine.tick).toBe(0)
    ctx.host.frame(600)
    expect(ctx.engine.tick).toBe(1)
  })

  it('keeps the phase: boundaries average exactly tickMs even when frames land late', () => {
    const ctx = setup()
    ctx.runtime.start()
    const step = 1000 / 60
    ctx.host.run(6000 + 5, step)
    // 10 ticks in 6 s (frame quantisation shifts single boundaries, not the average).
    expect(ctx.engine.tick).toBe(10)
    const tickTimes: number[] = []
    const off = ctx.runtime.onTick((s) => tickTimes.push(s.tickTimeMs))
    ctx.host.run(12000 + 5, step)
    off()
    expect(tickTimes.length).toBe(10)
    for (let i = 0; i < tickTimes.length; i++) {
      const boundary = 6600 + i * 600
      expect(tickTimes[i]!).toBeGreaterThanOrEqual(boundary - 1e-6)
      expect(tickTimes[i]!).toBeLessThan(boundary + step)
    }
  })

  it('never runs more than one tick per frame and drops time from frames later than 50 ms', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.frame(2000) // 2000 ms late frame: one tick, anchor = 2000 - 50
    expect(ctx.engine.tick).toBe(1)
    ctx.host.frame(2549)
    expect(ctx.engine.tick).toBe(1)
    ctx.host.frame(2550)
    expect(ctx.engine.tick).toBe(2)
  })

  it('keeps phase for a frame less than 50 ms late', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.frame(640) // 40 ms late: anchor = 600
    expect(ctx.engine.tick).toBe(1)
    ctx.host.frame(1199)
    expect(ctx.engine.tick).toBe(1)
    ctx.host.frame(1200)
    expect(ctx.engine.tick).toBe(2)
  })

  it('passes the target tile to every advanceTick, falling back to the player position', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.frame(600)
    ctx.runtime.setTargetTile([20, 40])
    ctx.host.frame(1200)
    ctx.host.frame(1800)
    ctx.runtime.setTargetTile(null)
    ctx.host.frame(2400)
    expect(ctx.engine.advances).toEqual([
      [1, [31, 33]],
      [2, [20, 40]],
      [3, [20, 40]],
      [4, [31, 33]],
    ])
  })

  it('does not tick or flush while the engine cannot advance; queued inputs wait', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.engine.canAdvanceFlag = false
    clickAt(ctx, 100, 'prayer')
    ctx.host.run(3000, 10)
    expect(ctx.engine.tick).toBe(0)
    expect(ctx.runtime.pendingInputs).toBe(1)
    ctx.engine.canAdvanceFlag = true
    ctx.host.run(3600, 10)
    expect(ctx.engine.tick).toBe(1)
    expect(ctx.engine.processed[0]).toEqual(['prayer'])
  })

  it('publishes a snapshot with the tick events after every tick', () => {
    const ctx = setup()
    const seen: number[] = []
    ctx.runtime.onTick((s) => seen.push(s.state.currentTick, s.events.length))
    ctx.runtime.start()
    ctx.host.frame(600)
    ctx.host.frame(1200)
    expect(seen).toEqual([1, 1, 2, 1])
    expect(ctx.runtime.getSnapshot().tickTimeMs).toBe(1200)
  })

  it('emits tick windows with the phase-corrected start', () => {
    const ctx = setup()
    const windows: { tick: number; startTime: number; durationMs: number }[] = []
    ctx.runtime.onTickWindow((w) => windows.push(w))
    ctx.runtime.start()
    ctx.host.frame(610)
    expect(windows).toEqual([{ tick: 1, startTime: 600, durationMs: 600 }])
  })
})

describe('input lag boundaries', () => {
  /** Anchor at 0; boundaries every tickMs; returns the tick that processed `op`. */
  function tickOf(speed: 0.5 | 1 | 2, lag: number, clickTime: number): number {
    const ctx = setup({ speedMultiplier: speed, inputLagMs: lag })
    ctx.runtime.start()
    const tickMs = 600 / speed
    // Advance to just before the click, then click, then run 3 more ticks.
    ctx.host.run(clickTime, 1)
    clickAt(ctx, clickTime, 'op')
    ctx.host.run(clickTime + 3 * tickMs, 1)
    const idx = ctx.engine.processed.findIndex((ops) => ops.includes('op'))
    return idx + 1
  }

  it('1x, 20 ms: B-25 makes the tick at B, B-15 slips to B+600, B-20 exactly is in', () => {
    // Boundary B = 1200 is tick 2.
    expect(tickOf(1, 20, 1175)).toBe(2)
    expect(tickOf(1, 20, 1180)).toBe(2)
    expect(tickOf(1, 20, 1185)).toBe(3)
  })

  it('2x, 20 ms: window is 10 ms real time', () => {
    // tickMs 300; boundary 600 is tick 2.
    expect(tickOf(2, 20, 589)).toBe(2)
    expect(tickOf(2, 20, 590)).toBe(2)
    expect(tickOf(2, 20, 591)).toBe(3)
  })

  it('0.5x, 20 ms: window is 40 ms real time', () => {
    // tickMs 1200; boundary 2400 is tick 2.
    expect(tickOf(0.5, 20, 2359)).toBe(2)
    expect(tickOf(0.5, 20, 2360)).toBe(2)
    expect(tickOf(0.5, 20, 2361)).toBe(3)
  })

  it('lag 0 applies at once (into the engine queue), processed by the next tick', () => {
    const ctx = setup({ inputLagMs: 0 })
    ctx.runtime.start()
    ctx.host.run(599.5, 1)
    clickAt(ctx, 599.5, 'op')
    expect(ctx.engine.queued).toEqual(['op'])
    ctx.host.frame(600)
    expect(ctx.engine.processed[0]).toEqual(['op'])
  })

  it('reports click and arrival times to dispatch listeners', () => {
    const ctx = setup({ speedMultiplier: 2 })
    const infos: unknown[] = []
    ctx.runtime.onDispatch((i) => infos.push(i))
    ctx.runtime.start()
    clickAt(ctx, 100, 'prayer:on')
    expect(infos).toEqual([{ label: 'prayer:on', clickTime: 100, arrivalTime: 110 }])
  })

  it('a later lag setting only affects later inputs', () => {
    const ctx = setup({ inputLagMs: 0 })
    ctx.runtime.start()
    clickAt(ctx, 100, 'a')
    ctx.store.patch({ inputLagMs: 1000 })
    clickAt(ctx, 110, 'b')
    ctx.host.run(700, 5)
    expect(ctx.engine.processed[0]).toEqual(['a'])
    ctx.host.run(1300, 5)
    expect(ctx.engine.processed[1]).toEqual(['b'])
  })
})

describe('suspension', () => {
  it('pauses the clock and frames while unfocused (setting on) and keeps the partial tick', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.run(400, 10) // 400 ms into tick 1
    ctx.host.setWindow('unfocused')
    expect(ctx.runtime.clock.suspended).toBe(true)
    expect(ctx.host.pendingFrames).toBe(0)
    ctx.host.time = 10_000
    ctx.host.frame(10_000) // nothing is scheduled
    expect(ctx.engine.tick).toBe(0)
    ctx.host.setWindow('focused')
    expect(ctx.runtime.clock.suspended).toBe(false)
    expect(ctx.runtime.clock.now()).toBe(400)
    // 200 ms of tick 1 remain.
    ctx.host.run(10_190, 10)
    expect(ctx.engine.tick).toBe(0)
    ctx.host.run(10_200, 10)
    expect(ctx.engine.tick).toBe(1)
  })

  it('keeps ticking while unfocused when pauseWhenUnfocused is off', () => {
    const ctx = setup({ pauseWhenUnfocused: false })
    ctx.runtime.start()
    ctx.host.setWindow('unfocused')
    expect(ctx.runtime.clock.suspended).toBe(false)
    ctx.host.run(600, 10)
    expect(ctx.engine.tick).toBe(1)
  })

  it('always pauses while hidden, even with the setting off', () => {
    const ctx = setup({ pauseWhenUnfocused: false })
    ctx.runtime.start()
    ctx.host.setWindow('hidden')
    expect(ctx.runtime.clock.suspended).toBe(true)
  })

  it('toggling the setting while unfocused resumes / suspends', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.setWindow('unfocused')
    expect(ctx.runtime.clock.suspended).toBe(true)
    ctx.store.patch({ pauseWhenUnfocused: false })
    expect(ctx.runtime.clock.suspended).toBe(false)
  })

  it('inputs keep their arrival time in pausable-clock time across a pause', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.run(590, 10)
    clickAt(ctx, 590, 'op') // arrival 610 > boundary 600
    ctx.host.setWindow('unfocused')
    ctx.host.time = 5000
    ctx.host.setWindow('focused')
    ctx.host.run(5010, 10) // pausable time 600: tick 1 without the op
    expect(ctx.engine.tick).toBe(1)
    expect(ctx.engine.processed[0]).toEqual([])
    ctx.host.run(5610, 10)
    expect(ctx.engine.processed[1]).toEqual(['op'])
  })

  it('notifies suspend listeners', () => {
    const ctx = setup()
    const seen: boolean[] = []
    ctx.runtime.clock.onSuspendChange((s) => seen.push(s))
    ctx.runtime.start()
    ctx.host.setWindow('hidden')
    ctx.host.setWindow('focused')
    expect(seen).toEqual([true, false])
  })
})

describe('Auto-Advance off', () => {
  it('does not run the loop; dispatch applies immediately; stepOnce advances one tick with the target tile', () => {
    const ctx = setup({ autoAdvance: false })
    ctx.runtime.start()
    ctx.host.run(3000, 10)
    expect(ctx.engine.tick).toBe(0)
    clickAt(ctx, 3000, 'prayer')
    expect(ctx.engine.queued).toEqual(['prayer'])
    ctx.runtime.setTargetTile([25, 30])
    ctx.runtime.stepOnce()
    expect(ctx.engine.advances).toEqual([[1, [25, 30]]])
    expect(ctx.engine.processed[0]).toEqual(['prayer'])
  })

  it('stepOnce is a no-op while Auto-Advance is on', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.runtime.stepOnce()
    expect(ctx.engine.tick).toBe(0)
  })

  it('turning Auto-Advance back on restarts the phase', () => {
    const ctx = setup({ autoAdvance: false })
    ctx.runtime.start()
    ctx.host.run(1000, 10)
    ctx.store.patch({ autoAdvance: true })
    ctx.host.run(1590, 10)
    expect(ctx.engine.tick).toBe(0)
    ctx.host.run(1600, 10)
    expect(ctx.engine.tick).toBe(1)
  })
})

describe('speed changes', () => {
  it('restart the phase: the next tick comes one full new tickMs later', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.run(500, 10)
    ctx.store.patch({ speedMultiplier: 2 })
    expect(ctx.runtime.clock.tickDurationMs).toBe(300)
    ctx.host.run(790, 10)
    expect(ctx.engine.tick).toBe(0)
    ctx.host.run(800, 10)
    expect(ctx.engine.tick).toBe(1)
    ctx.host.run(1100, 10)
    expect(ctx.engine.tick).toBe(2)
  })
})

describe('restart', () => {
  it('resets the engine, clears the lag queue, sets the target to the start tile and keeps the phase', () => {
    const ctx = setup()
    let restarts = 0
    ctx.runtime.onRestart(() => restarts++)
    ctx.runtime.start()
    ctx.host.run(1300, 10) // tick 2 fired at 1200
    ctx.runtime.setTargetTile([10, 10])
    clickAt(ctx, 1790, 'op') // arrival 1810, would land in the tick at 2400
    ctx.runtime.restart()
    expect(ctx.engine.resets).toBe(1)
    expect(restarts).toBe(1)
    expect(ctx.runtime.pendingInputs).toBe(0)
    expect(ctx.runtime.getTargetTile()).toEqual([31, 33])
    expect(ctx.runtime.getSnapshot().state.currentTick).toBe(0)
    // Phase kept: the first tick of the new run is at the old 1800 boundary.
    ctx.host.run(1800, 10)
    expect(ctx.engine.tick).toBe(1)
    expect(ctx.engine.processed.at(-1)).toEqual([])
  })

  it('does nothing while an intro is active', () => {
    const ctx = setup()
    ctx.engine.introActive = true
    ctx.runtime.restart()
    expect(ctx.engine.resets).toBe(0)
  })
})

describe('scene readiness and intro gate the loop', () => {
  it('waits for setSceneReady(true), then ticks one tickMs later', () => {
    const ctx = setup()
    ctx.runtime.setSceneReady(false)
    ctx.runtime.start()
    ctx.host.run(2000, 10)
    expect(ctx.engine.tick).toBe(0)
    ctx.runtime.setSceneReady(true)
    ctx.host.run(2590, 10)
    expect(ctx.engine.tick).toBe(0)
    ctx.host.run(2600, 10)
    expect(ctx.engine.tick).toBe(1)
  })
})

describe('target tile display', () => {
  it('prefers the click-time preview (null hides) and falls back to the applied target', () => {
    const ctx = setup()
    const seen: (Tile | null)[] = []
    ctx.runtime.onTargetTileChange((t) => seen.push(t))
    const retire = ctx.runtime.targetTilePreview.show([5, 5])
    expect(ctx.runtime.getDisplayedTargetTile()).toEqual([5, 5])
    ctx.runtime.setTargetTile([5, 5])
    retire()
    expect(ctx.runtime.getDisplayedTargetTile()).toEqual([5, 5])
    const retire2 = ctx.runtime.targetTilePreview.show(null)
    expect(ctx.runtime.getDisplayedTargetTile()).toBeNull()
    ctx.runtime.setTargetTile(null)
    retire2()
    expect(seen).toEqual([[5, 5], [5, 5], [5, 5], null, null, null])
  })
})

describe('interpolatedTick', () => {
  it('is currentTick + clamped progress since the last tick', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.frame(600)
    expect(ctx.runtime.clock.interpolatedTick(900)).toBeCloseTo(1.5)
    expect(ctx.runtime.clock.interpolatedTick(5000)).toBe(2)
    expect(ctx.runtime.clock.interpolatedTick(500)).toBe(1)
  })
})

describe('command publishing', () => {
  it('an immediate apply republishes the state without replaying the last tick events', () => {
    const ctx = setup({ inputLagMs: 0 })
    ctx.runtime.start()
    ctx.host.frame(600)
    const seen: number[] = []
    ctx.runtime.onTick((s) => seen.push(s.events.length))
    clickAt(ctx, 700, 'prayer')
    expect(seen).toEqual([0])
    expect(ctx.runtime.getSnapshot().tickTimeMs).toBe(600)
  })

  it('dispatchImmediate publishes new events a command produced', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.frame(600)
    const seen: string[] = []
    ctx.runtime.onTick((s) => seen.push(s.events.map((e) => e.type).join(',')))
    ctx.runtime.dispatchImmediate((e) => {
      const fake = e as unknown as FakeEngine
      fake.lastTickEvents = [{ type: 'intro_completed', tick: 1, eventId: 99 }]
    }, 'debug')
    expect(seen).toEqual(['intro_completed'])
  })

  it('lagged applies are not published separately: the tick publish follows', () => {
    const ctx = setup()
    ctx.runtime.start()
    let publishes = 0
    ctx.runtime.onTick(() => publishes++)
    clickAt(ctx, 100, 'op')
    expect(publishes).toBe(0)
    ctx.host.frame(600)
    expect(publishes).toBe(1)
  })

  it('restart listeners run after the reset snapshot is published', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.frame(600)
    let tickAtRestart = -1
    ctx.runtime.onRestart(() => {
      tickAtRestart = ctx.runtime.getSnapshot().state.currentTick
    })
    ctx.runtime.restart()
    expect(tickAtRestart).toBe(0)
  })
})

describe('tick stats', () => {
  it('records boundary deltas', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.frame(600)
    ctx.host.frame(1210)
    ctx.host.frame(1800)
    const stats = ctx.runtime.tickStats.getStats()
    expect(stats.samples).toBe(2)
    expect(stats.lastMs).toBe(590)
    expect(stats.maxJitterMs).toBe(10)
  })
})

describe('user pause (our addition)', () => {
  it('freezes ticks and the interpolated clock while frames keep running, then resumes the partial tick', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.host.run(700)
    expect(ctx.engine.tick).toBe(1)
    ctx.host.run(900) // 300 ms into tick 2's window
    const interpBefore = ctx.runtime.clock.interpolatedTick()
    ctx.runtime.setPaused(true)
    expect(ctx.runtime.isPaused()).toBe(true)
    expect(ctx.runtime.clock.suspended).toBe(true)
    ctx.host.run(5000)
    expect(ctx.engine.tick).toBe(1)
    expect(ctx.runtime.clock.interpolatedTick()).toBeCloseTo(interpBefore, 6)
    // frames are still delivered (camera keeps moving)
    expect(ctx.host.pendingFrames).toBeGreaterThan(0)
    ctx.runtime.togglePause()
    expect(ctx.runtime.isPaused()).toBe(false)
    // the remaining ~300 ms of the partial tick elapse after resuming
    ctx.host.run(5000 + 250)
    expect(ctx.engine.tick).toBe(1)
    ctx.host.run(5000 + 350)
    expect(ctx.engine.tick).toBe(2)
  })

  it('restart clears the pause', () => {
    const ctx = setup()
    ctx.runtime.start()
    ctx.runtime.setPaused(true)
    ctx.runtime.restart()
    expect(ctx.runtime.isPaused()).toBe(false)
  })
})
