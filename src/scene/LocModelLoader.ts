/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Builds the lit model for a loc config drawn with a given placement type and
 * rotation, the way the client's ObjectDefinition.getModel does:
 *
 *  1. pick the model ids for the shape (`LocType.types` / `models`), merge
 *     several into one, mirroring first when the config says so (or for the
 *     second half of a wall corner, rotation > 3);
 *  2. for diagonal wall decorations (rotation > 3) rotate 45 degrees and nudge
 *     the model off the wall, then apply the 0..3 quarter-turn rotation;
 *  3. recolour / retexture, scale (modelSizeX/Height/Y, 128 = unchanged) and
 *     offset (offsetX/Height/Y);
 *  4. diagonal "normal" locs (rotation > 3) get a further 45 degree turn;
 *  5. light with the config's ambient / contrast on top of the client's
 *     defaults (64 / 768) and the loc light direction (-50, -10, -50).
 *
 * Contour-to-ground is a per-placement operation (it needs the terrain under
 * the loc) and is done by `LocMeshBuilder`; this loader only reports whether
 * the config asks for it. Results are cached by (loc id, type, rotation).
 */
import type { LocType, LocTypeLoader } from '../cache/config/LocType'
import type { VarProvider } from '../cache/config/Type'
import type { Model } from '../cache/model/Model'
import { ModelData } from '../cache/model/ModelData'
import type { ModelLoader } from '../cache/model/ModelLoader'
import { LocModelType } from './LocModelType'
import type { LocModelHook } from './SceneTile'

/** Client defaults added to a loc config's ambient / contrast before lighting. */
export const LOC_AMBIENT = 64
export const LOC_CONTRAST = 768
/** Light direction used for static locs (the client's loc light vector). */
export const LOC_LIGHT_X = -50
export const LOC_LIGHT_Y = -10
export const LOC_LIGHT_Z = -50

/** Offset added to a model id to key its mirrored variant. */
const MIRRORED_KEY_OFFSET = 0x10000

/** Var state used to resolve multi-loc transforms when no game state exists yet: every var is 0. */
const ZERO_VARS: VarProvider = {
  getVarbit: () => 0,
  getVarp: () => 0,
}

/** Cache key for (loc id, placement type 0..22, rotation 0..7). */
export function locModelKey(locId: number, type: number, rotation: number): number {
  return locId * 1024 + type * 8 + rotation
}

export class LocModelLoader {
  readonly locTypes: LocTypeLoader
  readonly models: ModelLoader
  private readonly vars: VarProvider

  /** Raw (optionally mirrored) model data by model id (+ MIRRORED_KEY_OFFSET). */
  private readonly modelDataCache = new Map<number, ModelData | null>()
  /** Lit models by `locModelKey`. */
  private readonly modelCache = new Map<number, Model | null>()
  /** Horizontal radius per lit model, for light occlusion. */
  private readonly xzRadiusCache = new WeakMap<Model, number>()

  constructor(locTypes: LocTypeLoader, models: ModelLoader, vars: VarProvider = ZERO_VARS) {
    this.locTypes = locTypes
    this.models = models
    this.vars = vars
  }

  /**
   * The loc config to draw for `id`: multi-locs are resolved against the var
   * provider; undefined when the transform hides the loc entirely.
   */
  resolveLocType(id: number): LocType | undefined {
    const locType = this.locTypes.load(id)
    if (!locType.transforms) return locType
    return locType.transform(this.vars, this.locTypes)
  }

  /** Adapter for `SceneBuilder`'s `modelHook` option. */
  hook(): LocModelHook<Model> {
    return (locId, type, rotation) => {
      const locType = this.resolveLocType(locId)
      if (!locType) return null
      return this.getModel(locType, type, rotation) ?? null
    }
  }

  /** Cached lit model for a config / placement type / rotation, undefined when there is nothing to draw. */
  getModel(locType: LocType, type: number, rotation: number): Model | undefined {
    const key = locModelKey(locType.id, type, rotation)
    const cached = this.modelCache.get(key)
    if (cached !== undefined) return cached ?? undefined

    const modelData = this.getLocModelData(locType, type, rotation)
    let model: Model | null = null
    if (modelData) {
      // Diagonal "normal" locs: the client turns the model a further 45 degrees before lighting.
      if (type === LocModelType.Normal && rotation > 3) {
        modelData.rotate(256)
      }
      model = modelData.light(
        locType.ambient + LOC_AMBIENT,
        locType.contrast + LOC_CONTRAST,
        LOC_LIGHT_X,
        LOC_LIGHT_Y,
        LOC_LIGHT_Z,
      )
    }
    this.modelCache.set(key, model)
    return model ?? undefined
  }

  /**
   * Unlit, fully transformed geometry for a placement (a fresh copy every
   * call; the caller may mutate it).
   */
  getLocModelData(locType: LocType, type: number, rotation: number): ModelData | undefined {
    const isMirrored = locType.isRotated || (type === LocModelType.WallCorner && rotation > 3)

    let modelIds: readonly number[]
    if (!locType.types) {
      // Shape-less configs (opcode 5) only ever draw as a normal loc.
      if (type !== LocModelType.Normal) return undefined
      modelIds = locType.models[0] ?? []
    } else {
      modelIds = locType.getModelIds(type)
    }
    if (modelIds.length === 0) return undefined

    const parts: ModelData[] = []
    for (const modelId of modelIds) {
      const part = this.getModelData(modelId, isMirrored)
      if (!part) return undefined
      parts.push(part)
    }

    const model = parts.length === 1 ? parts[0]!.copy() : ModelData.merge(parts)

    if (type === LocModelType.WallDecorationInside && rotation > 3) {
      model.rotate(256)
      model.translate(45, 0, -45)
    }

    const quarterTurns = rotation & 3
    if (quarterTurns === 1) {
      model.rotate90()
    } else if (quarterTurns === 2) {
      model.rotate180()
    } else if (quarterTurns === 3) {
      model.rotate270()
    }

    if (locType.recolorFrom.length > 0) {
      model.replaceColors(locType.recolorFrom, locType.recolorTo)
    }
    if (locType.retextureFrom.length > 0) {
      model.replaceTextures(locType.retextureFrom, locType.retextureTo)
    }

    if (locType.modelSizeX !== 128 || locType.modelSizeHeight !== 128 || locType.modelSizeY !== 128) {
      model.scale(locType.modelSizeX, locType.modelSizeHeight, locType.modelSizeY)
    }
    if (locType.offsetX !== 0 || locType.offsetHeight !== 0 || locType.offsetY !== 0) {
      model.translate(locType.offsetX, locType.offsetHeight, locType.offsetY)
    }

    return model
  }

  /** Shared, memoised raw model (mirrored variants are kept separately). Do not mutate. */
  private getModelData(modelId: number, mirrored: boolean): ModelData | undefined {
    const key = mirrored ? modelId + MIRRORED_KEY_OFFSET : modelId
    const cached = this.modelDataCache.get(key)
    if (cached !== undefined) return cached ?? undefined

    let model: ModelData | undefined = this.models.load(modelId)
    if (model && mirrored) {
      model = model.copy()
      model.mirror()
    }
    this.modelDataCache.set(key, model ?? null)
    return model
  }

  /**
   * The client's `xzRadius`: the model's horizontal extent from its origin,
   * rounded up. Used by `SceneBuilder` to size a loc's light occlusion.
   */
  xzRadius(model: Model): number {
    const cached = this.xzRadiusCache.get(model)
    if (cached !== undefined) return cached
    let maxSq = 0
    for (let i = 0; i < model.usedVertexCount; i++) {
      const x = model.verticesX[i]!
      const z = model.verticesZ[i]!
      const sq = x * x + z * z
      if (sq > maxSq) maxSq = sq
    }
    const radius = (Math.sqrt(maxSq) + 0.99) | 0
    this.xzRadiusCache.set(model, radius)
    return radius
  }

  /** Number of distinct lit models built so far (including misses). */
  get cachedModelCount(): number {
    return this.modelCache.size
  }

  clear(): void {
    this.modelDataCache.clear()
    this.modelCache.clear()
  }
}
