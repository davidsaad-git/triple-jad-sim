/**
 * Loads sound effects from cache index 4. The client (`SoundCache`) addresses
 * them as group `id`, file 0 (or group 0, file `id` when the index has a
 * single group). Decoded definitions are memoised; rendering is up to the caller.
 */
import { type CacheIndex, type CacheSystem, IndexId } from '../CacheSystem'
import { SoundEffect } from './SoundEffect'

export class SoundEffectLoader {
  private readonly index: CacheIndex
  private readonly effects = new Map<number, SoundEffect | null>()

  constructor(cache: CacheSystem) {
    this.index = cache.getIndex(IndexId.SoundEffects)
  }

  get ids(): number[] {
    if (this.index.archiveIds.length === 1) return this.index.getArchive(this.index.archiveIds[0]!)?.fileIds ?? []
    return this.index.archiveIds
  }

  has(id: number): boolean {
    return this.raw(id) !== undefined
  }

  raw(id: number): Uint8Array | undefined {
    if (this.index.archiveIds.length === 1) return this.index.getFile(this.index.archiveIds[0]!, id)
    return this.index.hasArchive(id) ? this.index.getFile(id, 0) : undefined
  }

  /** Decoded definition, or null when the id does not exist. */
  load(id: number): SoundEffect | null {
    const cached = this.effects.get(id)
    if (cached !== undefined) return cached
    const data = this.raw(id)
    const effect = data ? SoundEffect.decode(data) : null
    this.effects.set(id, effect)
    return effect
  }
}
