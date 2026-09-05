// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.

import { IndexId, type CacheSystem } from '../CacheSystem'
import { ModelData } from './ModelData'

/**
 * Loads models from index 7 (one archive per model id, a single file 0).
 * Decoded models are memoised and shared: call `copy()` before mutating one
 * in place, or use `ModelData.merge` which always produces fresh arrays.
 */
export class ModelLoader {
  private readonly cache: CacheSystem
  private readonly models = new Map<number, ModelData | null>()

  constructor(cache: CacheSystem) {
    this.cache = cache
  }

  load(id: number): ModelData | undefined {
    const cached = this.models.get(id)
    if (cached !== undefined) return cached ?? undefined
    const archive = this.cache.getIndex(IndexId.Models).getArchive(id)
    const file = archive?.getFile(0) ?? (archive ? firstFile(archive) : undefined)
    if (!file) {
      this.models.set(id, null)
      return undefined
    }
    const model = ModelData.decode(file)
    this.models.set(id, model)
    return model
  }

  /** Load several ids, skipping missing ones. */
  loadAll(ids: readonly number[]): ModelData[] {
    const out: ModelData[] = []
    for (const id of ids) {
      const m = this.load(id)
      if (m) out.push(m)
    }
    return out
  }

  clear(): void {
    this.models.clear()
  }
}

function firstFile(archive: Iterable<[number, Uint8Array]>): Uint8Array | undefined {
  for (const [, data] of archive) return data
  return undefined
}
