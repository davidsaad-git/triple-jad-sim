/**
 * Input lag.
 *
 * Each UI input is shifted later by `inputLagMs / speed` of real time (only
 * while Auto-Advance is on). Inputs whose arrival time has passed are applied
 * in push order right before `advanceTick` on a tick-boundary frame; the rest
 * stay queued, in order, for the next boundary. Inputs never fire mid-tick.
 */

/** Real-time lag for an input: `inputLagMs / speed`, 0 when the lag is 0 or not finite. */
export function lagDelayMs(inputLagMs: number, speedMultiplier: number): number {
  if (!Number.isFinite(inputLagMs) || inputLagMs <= 0) return 0
  return speedMultiplier > 0 ? inputLagMs / speedMultiplier : inputLagMs
}

interface LagEntry {
  arrivalTime: number
  apply: () => void
}

export class LagQueue {
  private queue: LagEntry[] = []

  get pending(): number {
    return this.queue.length
  }

  push(arrivalTime: number, apply: () => void): void {
    this.queue.push({ arrivalTime, apply })
  }

  /** Run every entry with `arrivalTime <= now`, in push order; keep the rest. */
  flush(now: number): void {
    if (this.queue.length === 0) return
    const kept: LagEntry[] = []
    const entries = this.queue
    this.queue = []
    for (const entry of entries) {
      if (entry.arrivalTime <= now) entry.apply()
      else kept.push(entry)
    }
    // Entries pushed while applying go after the kept ones.
    if (kept.length > 0) this.queue = this.queue.length > 0 ? [...kept, ...this.queue] : kept
  }

  clear(): void {
    this.queue = []
  }
}
