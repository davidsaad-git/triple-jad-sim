/**
 * Seedable RNG (mulberry32) so a wave can be replayed exactly. Every random
 * decision in the engine must come from a World's RNG, never Math.random.
 */
export class Random {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1)
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list')
    return items[this.int(items.length)]!
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      const tmp = items[i]!
      items[i] = items[j]!
      items[j] = tmp
    }
    return items
  }

  static seedFromString(s: string): number {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }
}
