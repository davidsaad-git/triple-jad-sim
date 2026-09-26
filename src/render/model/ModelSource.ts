/**
 * Loads models from the cache (index 7) as RenderModels, including scim's
 * per-face depth bias. Base models are memoised and must not be mutated:
 * call `copy()` first (as scim's does).
 */
import { IndexId, type CacheSystem } from '../../cache/CacheSystem'
import { decodeModelFaceBias } from '../../cache/model/ModelFaceBias'
import { ModelData } from '../../cache/model/ModelData'
import { RenderModel } from './RenderModel'

export class ModelSource {
  private readonly cache: CacheSystem
  private readonly models = new Map<number, RenderModel | null>()

  constructor(cache: CacheSystem) {
    this.cache = cache
  }

  /** Shared base model (do not mutate). */
  get(id: number): RenderModel | undefined {
    const cached = this.models.get(id)
    if (cached !== undefined) return cached ?? undefined
    let model: RenderModel | null = null
    try {
      const archive = this.cache.getIndex(IndexId.Models).getArchive(id)
      let file = archive?.getFile(0)
      if (!file && archive) {
        for (const [, data] of archive) {
          file = data
          break
        }
      }
      if (file) {
        const data = ModelData.decode(file)
        model = RenderModel.fromData(data, decodeModelFaceBias(file))
      }
    } catch (e) {
      console.warn(`ModelSource: failed to load model ${id}: ${(e as Error).message}`)
      model = null
    }
    this.models.set(id, model)
    return model ?? undefined
  }

  /** A private copy the caller may mutate. */
  copy(id: number): RenderModel | undefined {
    return this.get(id)?.copy()
  }
}
