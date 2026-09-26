/**
 * Sound effects rendered from cache index 4 with the client's synthesiser
 * (src/cache/sound), cached as float PCM by id.
 *
 * scim.gg ships the same ids as pre-rendered Vorbis files:
 * 22050 Hz mono, exactly `floor(durationMs * 22050 / 1000)` samples, no gain
 * change, and the leading silence kept in the file (the client's
 * `calculateDelay` trim is not applied). We therefore render the untrimmed
 * effect and play it immediately, which gives the same onset.
 */
import type { CacheSystem } from '../cache/CacheSystem'
import { SAMPLE_RATE, SoundEffectLoader } from '../cache/sound'
import type { SoundSource } from './AudioEngine'

type Scheduler = (task: () => void) => void

function defaultScheduler(): Scheduler {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  if (typeof g.requestIdleCallback === 'function') {
    const ric = g.requestIdleCallback.bind(globalThis)
    return (task) => ric(task, { timeout: 250 })
  }
  return (task) => setTimeout(task, 0)
}

export class CacheSoundBank implements SoundSource {
  readonly sampleRate = SAMPLE_RATE
  private readonly cache: CacheSystem
  private loader: SoundEffectLoader | null | undefined
  private readonly pcm = new Map<number, Float32Array | null>()
  private readonly schedule: Scheduler

  constructor(cache: CacheSystem, schedule: Scheduler = defaultScheduler()) {
    this.cache = cache
    this.schedule = schedule
  }

  private getLoader(): SoundEffectLoader | null {
    if (this.loader === undefined) {
      try {
        this.loader = new SoundEffectLoader(this.cache)
      } catch {
        this.loader = null
      }
    }
    return this.loader
  }

  /** Render (or return the cached render of) a sound; null when the id is missing or broken. */
  getPcm(id: number): Float32Array | null {
    const cached = this.pcm.get(id)
    if (cached !== undefined) return cached
    let out: Float32Array | null = null
    try {
      const effect = this.getLoader()?.load(id) ?? null
      if (effect) out = effect.toPcm()
    } catch (err) {
      console.warn(`[SoundBank] failed to synthesise sound ${id}`, err)
      out = null
    }
    this.pcm.set(id, out)
    return out
  }

  /** Render the given ids one per idle slot, in order. */
  preload(ids: readonly number[]): Promise<void> {
    const queue = ids.filter((id, i) => ids.indexOf(id) === i && !this.pcm.has(id))
    return new Promise((resolve) => {
      const step = () => {
        const id = queue.shift()
        if (id === undefined) {
          resolve()
          return
        }
        this.getPcm(id)
        this.schedule(step)
      }
      this.schedule(step)
    })
  }
}
