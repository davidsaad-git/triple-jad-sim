/** Length of one game tick in milliseconds. */
export const TICK_MS = 600

/**
 * Fixed-step tick clock driven from requestAnimationFrame. Supports pause,
 * playback speed and single-stepping, and exposes the fractional progress
 * through the current tick for render interpolation.
 */
export class Clock {
  tick = 0
  speed = 1
  paused = false
  private accumulator = 0
  private readonly listeners: ((tick: number) => void)[] = []

  onTick(fn: (tick: number) => void): () => void {
    this.listeners.push(fn)
    return () => {
      const i = this.listeners.indexOf(fn)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  /** Advance by wall-clock seconds; fires zero or more ticks. */
  advance(dtSeconds: number): void {
    if (this.paused) return
    this.accumulator += dtSeconds * 1000 * this.speed
    let guard = 0
    while (this.accumulator >= TICK_MS && guard++ < 50) {
      this.accumulator -= TICK_MS
      this.step()
    }
  }

  /** Run exactly one tick regardless of pause state. */
  step(): void {
    this.tick++
    for (const fn of this.listeners) fn(this.tick)
  }

  /** 0..1 progress through the current tick, for interpolating movement and animation. */
  get alpha(): number {
    return Math.min(1, this.accumulator / TICK_MS)
  }

  reset(): void {
    this.tick = 0
    this.accumulator = 0
  }
}
