import type { CacheSystem } from '../../cache/CacheSystem'
import type { SimEngine, SimEvent, Tile } from '../../sim/api'
import { type Settings, settingsStore } from '../settings/settings'
import { FrameScheduler, PausableClock } from './clock'
import { LagQueue, lagDelayMs } from './lag'
import { PresentationOverride } from './presentation'
import { TickStats } from './tickStats'
import type { DispatchInfo, SimClock, SimRuntime, TickSnapshot, TickWindow } from './types'

/**
 * The real-time driver: scim.gg's hook as a plain
 * object. 
 *
 * - Pausable clock + rAF scheduler (`gu` / `_u`): suspended while the tab is
 *   hidden, or while the window is unfocused and "Pause simulator when
 *   unfocused" is on.
 * - Tick loop: `tickMs = 600 / speed`; on every frame
 *   `elapsed = min(now - anchor, tickMs + 50)`; when `elapsed >= tickMs` the
 *   anchor keeps the phase (`anchor = now - elapsed % tickMs`), and if the
 *   engine can advance the lag queue is flushed and exactly one tick runs.
 *   Never more than one tick per frame; a frame later than 50 ms loses time.
 *   The loop (and so the phase) restarts when speed, Auto-Advance, scene
 *   readiness or the intro flag change.
 * - Input lag: `arrival = now + inputLagMs / speed` while
 *   Auto-Advance is on, else `now`; arrival <= now applies immediately.
 * - Restart keeps the loop phase: the first tick of the new
 *   run comes whenever the running tick would have ended.
 */

export type WindowState = 'hidden' | 'unfocused' | 'focused'

/** Everything the runtime needs from the browser; replaced by fakes in tests. */
export interface RuntimeEnv {
  /** Raw monotonic time (performance.now()). */
  now(): number
  requestFrame(callback: (timestamp: number) => void): number
  cancelFrame(id: number): void
  
  getWindowState(): WindowState
  /** focus / blur / visibilitychange. */
  subscribeWindowState(listener: () => void): () => void
  isDocumentHidden(): boolean
}

export type RuntimeSettings = Pick<Settings, 'speedMultiplier' | 'inputLagMs' | 'autoAdvance' | 'pauseWhenUnfocused'>

export interface RuntimeSettingsSource {
  get(): RuntimeSettings
  subscribe(listener: () => void): () => void
}

export interface CreateRuntimeOptions {
  engine: SimEngine
  cache: CacheSystem
  /** Defaults to the global settingsStore. */
  settings?: RuntimeSettingsSource
  env?: Partial<RuntimeEnv>
  /** Runs inside restart() right before engine.reset() (e.g. re-apply the saved loadout). */
  beforeReset?: (engine: SimEngine) => void
  /** Runs inside restart() right after engine.reset(). */
  afterReset?: (engine: SimEngine) => void
}

export interface RuntimeHandle extends SimRuntime {
  /** Begin the tick loop and focus tracking (idempotent). */
  start(): void
  /** Stop the loop, drop focus listeners, clear the lag queue. */
  stop(): void
  readonly scheduler: FrameScheduler
  /** Click-time destination preview; see getDisplayedTargetTile(). */
  readonly targetTilePreview: PresentationOverride<Tile | null>
  /** Inputs waiting in the lag queue. */
  readonly pendingInputs: number
  /** Arrival time of an input made at `clickTime`. */
  arrivalTimeFor(clickTime: number): number
}

function defaultEnv(): RuntimeEnv {
  const hasWindow = typeof window !== 'undefined'
  const hasDocument = typeof document !== 'undefined'
  // Dev-only escape hatch (`?devNoSuspend`) for automated checks in a hidden preview pane.
  const devNoSuspend = import.meta.env.DEV && hasWindow && new URLSearchParams(window.location.search).has('devNoSuspend')
  return {
    now: () => performance.now(),
    requestFrame: (cb) => {
      if (!hasWindow) return setTimeout(() => cb(performance.now()), 16) as unknown as number
      if (!import.meta.env.DEV) return window.requestAnimationFrame(cb)
      return starvedFrameFallback.request(cb)
    },
    cancelFrame: (id) => {
      if (!hasWindow) clearTimeout(id)
      else if (!import.meta.env.DEV) window.cancelAnimationFrame(id)
      else starvedFrameFallback.cancel(id)
    },
    getWindowState: () => {
      if (!hasDocument) return 'focused'
      if (devNoSuspend) return 'focused'
      if (document.visibilityState === 'hidden') return 'hidden'
      return document.hasFocus() ? 'focused' : 'unfocused'
    },
    subscribeWindowState: (listener) => {
      if (!hasWindow || !hasDocument) return () => {}
      window.addEventListener('focus', listener)
      window.addEventListener('blur', listener)
      document.addEventListener('visibilitychange', listener)
      return () => {
        window.removeEventListener('focus', listener)
        window.removeEventListener('blur', listener)
        document.removeEventListener('visibilitychange', listener)
      }
    },
    isDocumentHidden: () => !devNoSuspend && hasDocument && document.visibilityState === 'hidden',
  }
}

/**
 * Dev-only: embedded preview panes stop firing requestAnimationFrame while
 * they are not displayed even though the document reports "visible". There a
 * 100 ms timer stands in for the missing frame so the sim keeps running for
 * automated checks. Production builds use plain rAF, exactly like scim.
 */
const starvedFrameFallback = (() => {
  let nextId = 1
  const pending = new Map<number, { raf: number; timer: ReturnType<typeof setTimeout> }>()
  return {
    request(cb: (timestamp: number) => void): number {
      const id = nextId++
      const fire = (t: number): void => {
        const entry = pending.get(id)
        if (!entry) return
        pending.delete(id)
        window.cancelAnimationFrame(entry.raf)
        clearTimeout(entry.timer)
        cb(t)
      }
      pending.set(id, { raf: window.requestAnimationFrame(fire), timer: setTimeout(() => fire(performance.now()), 100) })
      return id
    },
    cancel(id: number): void {
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      window.cancelAnimationFrame(entry.raf)
      clearTimeout(entry.timer)
    },
  }
})()

function maxEventId(events: readonly SimEvent[]): number {
  let max = -Infinity
  for (const e of events) if (typeof e.eventId === 'number' && e.eventId > max) max = e.eventId
  return max
}

interface TickLoop {
  alive: boolean
  frameId: number | null
  anchor: number
  tickMs: number
  unsubscribeResume: () => void
}

function emit<A extends unknown[]>(listeners: Set<(...args: A) => void>, ...args: A): void {
  for (const listener of [...listeners]) {
    try {
      listener(...args)
    } catch (err) {
      console.error('[runtime] listener failed', err)
    }
  }
}

export function createRuntime(opts: CreateRuntimeOptions): RuntimeHandle {
  const { engine, cache } = opts
  const env: RuntimeEnv = { ...defaultEnv(), ...opts.env }
  const settings: RuntimeSettingsSource = opts.settings ?? settingsStore

  const clock = new PausableClock(() => env.now())
  const scheduler = new FrameScheduler({ request: (cb) => env.requestFrame(cb), cancel: (id) => env.cancelFrame(id) }, clock)
  const lagQueue = new LagQueue()
  const tickStats = new TickStats(() => env.now())
  const targetTilePreview = new PresentationOverride<Tile | null>()

  const tickListeners = new Set<(snapshot: TickSnapshot) => void>()
  const suspendListeners = new Set<(suspended: boolean) => void>()
  const targetListeners = new Set<(tile: Tile | null) => void>()
  const dispatchListeners = new Set<(info: DispatchInfo) => void>()
  const windowListeners = new Set<(window: TickWindow) => void>()
  const restartListeners = new Set<() => void>()

  let started = false
  let sceneReady = true
  let loop: TickLoop | null = null
  let loopKey = ''
  let unsubscribeWindow: (() => void) | null = null
  let targetTile: Tile | null = null
  let lastTickAt = clock.now()
  let lastPublishedMaxEventId = maxEventId(engine.lastTickEvents)
  let snapshot: TickSnapshot = { state: engine.getState(), events: engine.lastTickEvents, tickTimeMs: lastTickAt }

  const current = (): RuntimeSettings => settings.get()
  const tickMsFor = (s: RuntimeSettings): number => 600 / s.speedMultiplier

  // ---- publishing -------------------------------------------------------

  function publish(events: readonly SimEvent[]): void {
    snapshot = { state: engine.getState(), events, tickTimeMs: lastTickAt }
    const max = maxEventId(events)
    if (max > lastPublishedMaxEventId) lastPublishedMaxEventId = max
    emit(tickListeners, snapshot)
    // The intro flag is one of the loop's dependencies.
    syncLoop()
  }

  /** Publish after a command: only events newer than the last published ones. */
  function publishCommandResult(): void {
    const events = engine.lastTickEvents
    publish(events.length > 0 && maxEventId(events) > lastPublishedMaxEventId ? events : [])
  }

  // ---- suspension ---------------------------------------------------------

  // The user's Pause (our addition; scim has no pause button) holds only the
  // clock: ticks and animations stop, frames keep running so the camera moves.
  let userPaused = false
  const pauseListeners = new Set<(paused: boolean) => void>()
  const clockSuspended = (): boolean => scheduler.suspended || userPaused

  function updateSuspension(): void {
    const state = env.getWindowState()
    const suspended = state === 'hidden' || (current().pauseWhenUnfocused && state === 'unfocused')
    if (suspended === scheduler.suspended) return
    const before = clockSuspended()
    scheduler.setSuspended(suspended)
    if (clockSuspended() !== before) emit(suspendListeners, clockSuspended())
  }

  function setPaused(paused: boolean): void {
    if (paused === userPaused) return
    const before = clockSuspended()
    userPaused = paused
    clock.setHold('user', paused)
    emit(pauseListeners, paused)
    if (clockSuspended() !== before) emit(suspendListeners, clockSuspended())
  }

  // ---- tick loop ----------------------------------------------------------

  function advance(input: Tile, now: number): void {
    engine.advanceTick(input)
    lastTickAt = now
    publish(engine.lastTickEvents)
  }

  function stopLoop(): void {
    if (!loop) return
    loop.alive = false
    loop.unsubscribeResume()
    if (loop.frameId !== null) scheduler.cancel(loop.frameId)
    loop = null
  }

  function startLoop(): void {
    const tickMs = tickMsFor(current())
    tickStats.setExpectedMs(tickMs)
    tickStats.reset()
    const l: TickLoop = {
      alive: true,
      frameId: null,
      anchor: clock.now(),
      tickMs,
      unsubscribeResume: scheduler.subscribeResume(() => tickStats.reset()),
    }
    const frame = (timestamp: number): void => {
      if (!l.alive) return
      l.frameId = null
      try {
        if (env.isDocumentHidden()) return
        const now = clock.now(timestamp)
        const elapsed = Math.min(now - l.anchor, tickMs + 50)
        if (elapsed < tickMs) return
        tickStats.recordTick()
        l.anchor = now - (elapsed % tickMs)
        if (!engine.canAdvance()) return
        lagQueue.flush(now)
        const input = targetTile ?? engine.getState().playerPosition
        const tick = engine.getState().currentTick
        advance(input, now)
        const fired = engine.getState().currentTick
        if (fired !== tick) emit(windowListeners, { tick: fired, startTime: l.anchor, durationMs: tickMs })
      } finally {
        if (l.alive && l.frameId === null) l.frameId = scheduler.request(frame)
      }
    }
    loop = l
    l.frameId = scheduler.request(frame)
  }

  function syncLoop(): void {
    const s = current()
    const introActive = snapshot.state.introActive === true
    const shouldRun = started && s.autoAdvance && sceneReady && !introActive
    const key = shouldRun ? `run:${s.speedMultiplier}` : 'stopped'
    if (key === loopKey) return
    loopKey = key
    stopLoop()
    if (shouldRun) startLoop()
  }

  let lastSettings = current()
  settings.subscribe(() => {
    const next = current()
    const prev = lastSettings
    lastSettings = next
    if (next.pauseWhenUnfocused !== prev.pauseWhenUnfocused && started) updateSuspension()
    if (next.speedMultiplier !== prev.speedMultiplier || next.autoAdvance !== prev.autoAdvance) {
      if (next.speedMultiplier !== prev.speedMultiplier) loopKey = '' // speed change restarts the phase
      syncLoop()
    }
  })

  // ---- target tile ----------------------------------------------------------

  function displayedTargetTile(): Tile | null {
    const preview = targetTilePreview.get()
    return preview !== undefined ? preview : targetTile
  }
  targetTilePreview.subscribe(() => emit(targetListeners, displayedTargetTile()))

  function arrivalTimeFor(clickTime: number): number {
    const s = current()
    return s.autoAdvance ? clickTime + lagDelayMs(s.inputLagMs, s.speedMultiplier) : clickTime
  }

  // ---- public object --------------------------------------------------------

  const simClock: SimClock = {
    now: () => clock.now(),
    get tickDurationMs() {
      return tickMsFor(current())
    },
    get lastTickAt() {
      return lastTickAt
    },
    interpolatedTick(now?: number) {
      const t = now ?? clock.now()
      const progress = (t - lastTickAt) / tickMsFor(current())
      return snapshot.state.currentTick + Math.min(Math.max(progress, 0), 1)
    },
    get suspended() {
      return clockSuspended()
    },
    onSuspendChange(listener) {
      suspendListeners.add(listener)
      return () => {
        suspendListeners.delete(listener)
      }
    },
  }

  const runtime: RuntimeHandle = {
    engine,
    cache,
    clock: simClock,
    scheduler,
    targetTilePreview,
    tickStats,

    get pendingInputs() {
      return lagQueue.pending
    },

    getSnapshot: () => snapshot,

    onTick(listener) {
      tickListeners.add(listener)
      return () => {
        tickListeners.delete(listener)
      }
    },

    dispatch(apply, label) {
      const clickTime = clock.now()
      const arrivalTime = arrivalTimeFor(clickTime)
      emit(dispatchListeners, { label, clickTime, arrivalTime })
      if (arrivalTime <= clickTime) {
        apply(engine)
        publishCommandResult()
        return
      }
      lagQueue.push(arrivalTime, () => apply(engine))
    },

    dispatchImmediate(apply) {
      apply(engine)
      publishCommandResult()
    },

    setTargetTile(tile) {
      targetTile = tile
      emit(targetListeners, displayedTargetTile())
    },
    getTargetTile: () => targetTile,
    getDisplayedTargetTile: displayedTargetTile,
    onTargetTileChange(listener) {
      targetListeners.add(listener)
      return () => {
        targetListeners.delete(listener)
      }
    },

    setSceneReady(ready) {
      sceneReady = ready
      syncLoop()
    },

    onDispatch(listener) {
      dispatchListeners.add(listener)
      return () => {
        dispatchListeners.delete(listener)
      }
    },
    onTickWindow(listener) {
      windowListeners.add(listener)
      return () => {
        windowListeners.delete(listener)
      }
    },
    setPaused,
    isPaused: () => userPaused,
    togglePause() {
      setPaused(!userPaused)
    },
    onPauseChange(listener) {
      pauseListeners.add(listener)
      return () => {
        pauseListeners.delete(listener)
      }
    },

    onRestart(listener) {
      restartListeners.add(listener)
      return () => {
        restartListeners.delete(listener)
      }
    },

    arrivalTimeFor,

    restart() {
      if (engine.getState().introActive) return
      setPaused(false)
      tickStats.reset()
      lagQueue.clear()
      opts.beforeReset?.(engine)
      engine.reset()
      opts.afterReset?.(engine)
      const state = engine.getState()
      // scim sets the target tile (state and ref) to the start position.
      targetTile = state.playerPosition
      targetTilePreview.reset()
      // The renderer stamps a new tick-seen time when the tick changes.
      lastTickAt = clock.now()
      lastPublishedMaxEventId = -Infinity
      emit(targetListeners, displayedTargetTile())
      publish(engine.lastTickEvents)
      emit(restartListeners)
    },

    stepOnce() {
      if (current().autoAdvance || !engine.canAdvance()) return
      const input = targetTile ?? engine.getState().playerPosition
      advance(input, clock.now())
    },

    start() {
      if (started) return
      started = true
      unsubscribeWindow = env.subscribeWindowState(updateSuspension)
      updateSuspension()
      syncLoop()
    },

    stop() {
      if (!started) return
      started = false
      unsubscribeWindow?.()
      unsubscribeWindow = null
      syncLoop()
      lagQueue.clear()
      if (scheduler.suspended) {
        scheduler.setSuspended(false)
        emit(suspendListeners, false)
      }
    },
  }
  return runtime
}
