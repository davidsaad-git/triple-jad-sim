/**
 * Loc model assembly as scim's LocModelLoader (`getLocModelData`, bundle
 *): pick the model list for the model type, mirror when the
 * loc is rotated or is the first half of an L-wall, merge, recolour,
 * retexture, the 45-degree wall-decoration turn, quarter turns, scale and
 * offset. Plus the extra 45-degree turn for type 10 rotations > 3.
 */
import type { LocType } from '../../cache/config/LocType'
import { RenderModel } from '../../render/model/RenderModel'
import type { ModelSource } from '../../render/model/ModelSource'

const WALL_CORNER = 2
const WALL_DECORATION_INSIDE = 4
const NORMAL = 10

export class LocModelFactory {
  private readonly models: ModelSource
  private readonly mirrored = new Map<number, RenderModel | null>()

  constructor(models: ModelSource) {
    this.models = models
  }

  private base(id: number, mirror: boolean): RenderModel | undefined {
    if (!mirror) return this.models.get(id)
    const cached = this.mirrored.get(id)
    if (cached !== undefined) return cached ?? undefined
    const m = this.models.copy(id)
    if (m) m.mirror()
    this.mirrored.set(id, m ?? null)
    return m
  }

  /**
   * A fresh model for (loc, model type, rotation), or undefined when the loc
   * has none. `diagonalTurn` adds the extra 45-degree turn scim applies to
   * type-10 models with rotation > 3 on the static path; the
   * animated path applies it after posing instead.
   */
  build(loc: LocType, modelType: number, rotation: number, diagonalTurn = true): RenderModel | undefined {
    const mirror = loc.isRotated || (modelType === WALL_CORNER && rotation > 3)
    if (!loc.models || loc.models.length === 0) return undefined
    let ids: number[] | undefined
    if (loc.types) {
      const i = loc.types.indexOf(modelType)
      if (i === -1) return undefined
      ids = loc.models[i]
    } else {
      if (modelType !== NORMAL) return undefined
      ids = loc.models[0]
    }
    if (!ids || ids.length === 0) return undefined
    const parts: RenderModel[] = []
    for (const id of ids) {
      const m = this.base(id, mirror)
      if (!m) return undefined
      parts.push(m)
    }
    const model = parts.length === 1 ? parts[0]!.copy() : RenderModel.merge(parts)
    for (let i = 0; i < loc.recolorFrom.length; i++) model.recolor(loc.recolorFrom[i]!, loc.recolorTo[i]!)
    for (let i = 0; i < loc.retextureFrom.length; i++) model.retexture(loc.retextureFrom[i]!, loc.retextureTo[i]!)
    if (modelType === WALL_DECORATION_INSIDE && rotation > 3) {
      model.rotate(256)
      model.translate(45, 0, -45)
    }
    const quarter = rotation & 3
    if (quarter === 1) model.rotate90()
    else if (quarter === 2) model.rotate180()
    else if (quarter === 3) model.rotate270()
    if (loc.modelSizeX !== 128 || loc.modelSizeHeight !== 128 || loc.modelSizeY !== 128) {
      model.resize(loc.modelSizeX, loc.modelSizeHeight, loc.modelSizeY)
    }
    if (loc.offsetX !== 0 || loc.offsetHeight !== 0 || loc.offsetY !== 0) {
      model.translate(loc.offsetX, loc.offsetHeight, loc.offsetY)
    }
    if (diagonalTurn && modelType === NORMAL && rotation > 3) model.rotate(256)
    return model
  }
}
