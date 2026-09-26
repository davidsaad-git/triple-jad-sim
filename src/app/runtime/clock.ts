import type { FrameScheduler as FrameSchedulerContract } from './types'

/**
 * Pausable clock and frame scheduler.
 *
 * `PausableClock.now(t)` is the raw time minus every suspended interval up to
 * `t`, so suspended time never counts toward a tick and a partially elapsed
 * tick resumes where it stopped. `FrameScheduler` wraps requestAnimationFrame:
 * while suspended every pending native frame is cancelled and nothing runs; on
 * resume the pending callbacks are re-requested and the resume listeners fire.
 */

interface PauseInterval {
  startMs: number
  /** Infinity while the pause is open. */
  endMs: number
  /** Total suspended time of every earlier (closed) pause. */
  elapsedBeforeMs: number
}

export class PausableClock {
  private pauses: PauseInterval[] = []
  private readonly rawNow: () => number

  constructor(rawNow: () => number) {
    this.rawNow = rawNow
  }

  /** Raw (performance.now()-like) time source. */
  raw(): number {
    return this.rawNow()
  }

  /** `t` (raw time, default now) minus all suspended time before `t`. */
  now(t: number = this.rawNow()): number {
    for (let i = this.pauses.length - 1; i >= 0; i--) {
      const p = this.pauses[i]!
      if (t >= p.startMs) return t - p.elapsedBeforeMs - (Math.min(t, p.endMs) - p.startMs)
    }
    return t
  }

  get suspended(): boolean {
    return this.pauses.at(-1)?.endMs === Infinity
  }

  /**
   * Named reasons the clock is held (scim only has the window one; the
   * user's Pause button is our addition). The clock is suspended while any
   * reason holds it.
   */
  private readonly holds = new Set<string>()

  setHold(reason: string, on: boolean): void {
    if (on) this.holds.add(reason)
    else this.holds.delete(reason)
    this.setSuspended(this.holds.size > 0)
  }

  isHeld(reason: string): boolean {
    return this.holds.has(reason)
  }

  setSuspended(suspended: boolean): void {
    const last = this.pauses.at(-1)
    if ((last?.endMs === Infinity) === suspended) return
    const t = this.rawNow()
    if (suspended) {
      this.pauses.push({
        startMs: t,
        endMs: Infinity,
        elapsedBeforeMs: last ? last.elapsedBeforeMs + last.endMs - last.startMs : 0,
      })
    } else if (last) {
      last.endMs = t
    }
  }

  reset(): void {
    this.pauses = []
  }
}

/** The native frame source (requestAnimationFrame / cancelAnimationFrame, or a fake in tests). */
export interface FrameHost {
  request(callback: (timestamp: number) => void): number
  cancel(id: number): void
}

interface PendingFrame {
  callback: (timestamp: number) => void
  nativeId: number | null
  generation: number
}

export class FrameScheduler implements FrameSchedulerContract {
  readonly clock: PausableClock
  private readonly host: FrameHost
  private suspendedFlag = false
  private nextId = 0
  private readonly pending = new Map<number, PendingFrame>()
  private readonly resumeListeners = new Set<() => void>()

  constructor(host: FrameHost, clock: PausableClock) {
    this.host = host
    this.clock = clock
  }

  get suspended(): boolean {
    return this.suspendedFlag
  }

  request(callback: (timestamp: number) => void): number {
    const id = ++this.nextId
    const entry: PendingFrame = { callback, nativeId: null, generation: 0 }
    this.pending.set(id, entry)
    if (!this.suspendedFlag) this.schedule(id, entry)
    return id
  }

  cancel(id: number): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    if (entry.nativeId !== null) this.host.cancel(entry.nativeId)
  }

  setSuspended(suspended: boolean): void {
    if (this.suspendedFlag === suspended) return
    this.suspendedFlag = suspended
    this.clock.setHold('window', suspended)
    if (suspended) {
      for (const entry of this.pending.values()) {
        if (entry.nativeId !== null) this.host.cancel(entry.nativeId)
        entry.nativeId = null
      }
    } else {
      for (const [id, entry] of this.pending) this.schedule(id, entry)
      for (const listener of [...this.resumeListeners]) listener()
    }
  }

  subscribeResume(listener: () => void): () => void {
    this.resumeListeners.add(listener)
    return () => {
      this.resumeListeners.delete(listener)
    }
  }

  private schedule(id: number, entry: PendingFrame): void {
    const generation = ++entry.generation
    entry.nativeId = this.host.request((timestamp) => {
      if (this.suspendedFlag || this.pending.get(id) !== entry || entry.generation !== generation) return
      this.pending.delete(id)
      entry.callback(timestamp)
    })
  }
}
