import type { TickTimingStats } from './types'

/**
 * Tick jitter statistics for the "Tick timing" debug overlay. Deltas are measured with the raw performance.now()
 * (not the pausable clock), over a window of the last 50 boundaries. The
 * runtime resets it whenever the tick loop (re)starts, on resume and on
 * restart.
 */
export class TickStats {
  static readonly WINDOW_SIZE = 50
  private deltas: number[] = []
  private lastTickTime = 0
  private expectedMs = 600
  private readonly rawNow: () => number

  constructor(rawNow: () => number) {
    this.rawNow = rawNow
  }

  setExpectedMs(ms: number): void {
    this.expectedMs = ms
  }

  recordTick(): void {
    const t = this.rawNow()
    if (this.lastTickTime > 0) {
      this.deltas.push(t - this.lastTickTime)
      if (this.deltas.length > TickStats.WINDOW_SIZE) this.deltas.shift()
    }
    this.lastTickTime = t
  }

  reset(): void {
    this.deltas = []
    this.lastTickTime = 0
  }

  getStats(): TickTimingStats {
    const n = this.deltas.length
    if (n === 0) {
      return {
        expectedMs: this.expectedMs,
        lastMs: null,
        avgMs: null,
        minMs: null,
        maxMs: null,
        stddevMs: null,
        maxJitterMs: null,
        samples: 0,
        recent: [],
      }
    }
    let sum = 0
    let min = Infinity
    let max = -Infinity
    let maxJitter = 0
    for (const d of this.deltas) {
      sum += d
      if (d < min) min = d
      if (d > max) max = d
      const jitter = Math.abs(d - this.expectedMs)
      if (jitter > maxJitter) maxJitter = jitter
    }
    const avg = sum / n
    let variance = 0
    for (const d of this.deltas) variance += (d - avg) * (d - avg)
    return {
      expectedMs: this.expectedMs,
      lastMs: this.deltas[n - 1]!,
      avgMs: avg,
      minMs: min,
      maxMs: max,
      stddevMs: Math.sqrt(variance / n),
      maxJitterMs: maxJitter,
      samples: n,
      recent: [...this.deltas],
    }
  }
}
