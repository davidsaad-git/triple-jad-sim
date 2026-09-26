import type { CacheSystem } from '../../cache/CacheSystem'
import type { SimEngine, SimEvent, SimState, Tile } from '../../sim/api'

/**
 * The live session every presentation layer talks to (renderer, audio, UI,
 * input). It owns the engine, the real-time tick loop and the input-lag
 * queue, mirroring scim.gg's hook.
 *
 * Contract rules:
 * - Only the runtime calls `engine.advanceTick`.
 * - UI commands go through `dispatch` so they get scim's input lag
 *   (inputLagMs / speed, applied at the next tick boundary). The only
 *   exceptions are inventory drag-swaps and practice/debug commands, which use
 *   `dispatchImmediate`.
 * - Presentation reads `state`/`events` and `clock`; it never mutates them.
 */
export interface TickSnapshot {
  state: SimState
  /** Events of the tick that produced `state` (engine.lastTickEvents). */
  events: readonly SimEvent[]
  /** performance.now()-based (pausable clock) time at which this tick fired. */
  tickTimeMs: number
}

export interface SimClock {
  /** Pausable clock: performance.now() minus all suspended time. */
  now(): number
  /** 600 / speedMultiplier. */
  readonly tickDurationMs: number
  /** Pausable-clock time of the last tick boundary. */
  readonly lastTickAt: number
  /**
   * currentTick + min((now - lastTickAt) / tickDurationMs, 1): the
   * interpolated tick every animation, projectile and overlay runs on
   *. Clamped, never extrapolated.
   */
  interpolatedTick(now?: number): number
  /** True while suspended (hidden tab, or unfocused with pauseWhenUnfocused). */
  readonly suspended: boolean
  /** Register for suspend/resume changes. */
  onSuspendChange(listener: (suspended: boolean) => void): () => void
}

export interface FrameScheduler {
  request(callback: (timestamp: number) => void): number
  cancel(handle: number): void
}

export interface DispatchInfo {
  label: string | undefined
  /** Pausable-clock time of the click. */
  clickTime: number
  /** Pausable-clock time the input becomes due (click + inputLagMs / speed). */
  arrivalTime: number
}

export interface TickWindow {
  tick: number
  /** Pausable-clock time the tick fired. */
  startTime: number
  durationMs: number
}

export interface TickTimingStats {
  expectedMs: number
  lastMs: number | null
  avgMs: number | null
  minMs: number | null
  maxMs: number | null
  stddevMs: number | null
  maxJitterMs: number | null
  samples: number
  recent: number[]
}

export interface SimRuntime {
  readonly engine: SimEngine
  readonly clock: SimClock
  readonly cache: CacheSystem

  /** Latest tick snapshot. */
  getSnapshot(): TickSnapshot
  /** Called after every tick (and after reset/commands that emit events). */
  onTick(listener: (snapshot: TickSnapshot) => void): () => void

  /**
   * Queue a UI command with input lag. `apply` runs right before the next
   * tick boundary whose time is >= click time + inputLagMs / speed.
   */
  dispatch(apply: (engine: SimEngine) => void, label?: string): void
  /** Apply immediately (drag-swaps, practice/debug commands). */
  dispatchImmediate(apply: (engine: SimEngine) => void, label?: string): void

  /** Click-to-move destination passed to every advanceTick. */
  setTargetTile(tile: Tile | null): void
  getTargetTile(): Tile | null
  /**
   * What the Destination Tile indicator shows: the click-time preview (scim
   * `previewTargetTile`: set at mousedown, null on NPC click, retired when the
   * lagged apply runs), falling back to the applied target tile.
   */
  getDisplayedTargetTile(): Tile | null
  onTargetTileChange(listener: (tile: Tile | null) => void): () => void

  /** Pausable rAF scheduler: render loops must use it so rendering freezes with the clock. */
  readonly scheduler: FrameScheduler
  /** Gate the tick loop until the WebGL scene is ready (default true). */
  setSceneReady(ready: boolean): void

  /** Every dispatched input: click time and lagged arrival time (Prayer Flick Helper). */
  onDispatch(listener: (info: DispatchInfo) => void): () => void
  /** Each tick boundary's window start and duration (Prayer Flick Helper). */
  onTickWindow(listener: (window: TickWindow) => void): () => void
  /** Called after restart(). */
  onRestart(listener: () => void): () => void
  /** Tick timing statistics (Tick Timing debug overlay). */
  readonly tickStats: { getStats(): TickTimingStats }

  /**
   * User pause (our addition; scim has none): freezes the sim clock, so ticks,
   * animations and projectiles stop while frames (camera) keep running.
   * Restart clears it.
   */
  setPaused(paused: boolean): void
  isPaused(): boolean
  togglePause(): void
  onPauseChange(listener: (paused: boolean) => void): () => void

  /** Ctrl+R: reset the engine, clear queues and the target tile. */
  restart(): void
  /** Auto-Advance off: advance exactly one tick now. */
  stepOnce(): void
}
