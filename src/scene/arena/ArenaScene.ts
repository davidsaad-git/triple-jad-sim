/**
 * Builds the static world of an Inferno-arena encounter the way scim.gg's
 * scene compositor does for Zuk: level-0 terrain meshes
 * for the centre square and its N/E/S/W neighbours (each with a 6-tile
 * context border from the 21 loaded squares), terrain light occlusion from
 * the unfiltered loc list, and the filtered locs (placement, contouring,
 * normal merging, OSRS loc lighting) batched into static meshes, plus
 * animated locs as per-frame meshes.
 *
 * Coordinates: world tile units relative to the centre square's SW corner.
 */
import type { CacheSystem } from '../../cache/CacheSystem'
import { LocTypeLoader, type LocType } from '../../cache/config/LocType'
import { OverlayFloorTypeLoader } from '../../cache/config/OverlayFloorType'
import { SeqTypeLoader, type SeqType } from '../../cache/config/SeqType'
import { UnderlayFloorTypeLoader } from '../../cache/config/UnderlayFloorType'
import { SeqFrameLoader } from '../../cache/anim/SeqLoaders'
import { RegionLoader } from '../../cache/map/RegionLoader'
import type { RegionLoc } from '../../cache/map/LocDecoder'
import type { RegionTerrain } from '../../cache/map/TerrainDecoder'
import { osrsModelMatrix, type MeshCommand } from '../../render/gl/types'
import { buildModelMesh, splitOpaqueTransparent, type MeshArrays, type TextureLayerResolver } from '../../render/model/meshBuild'
import { ModelSource } from '../../render/model/ModelSource'
import type { RenderModel } from '../../render/model/RenderModel'
import {
  CONTEXT_CORNERS,
  CORE_ORIGIN,
  applyLocOcclusion,
  buildContextTerrain,
  type ContextTerrain,
  type OcclusionLoc,
} from './contextTerrain'
import { LocModelFactory } from './locModels'
import {
  contourGround,
  contourHeights,
  filterLoc,
  footprintGroundHeight,
  mergeCategory,
  placementFor,
  placementMatrix,
  type HeightPlane,
  type LocRenderConfig,
} from './locPlacement'
import { mergeLocNormals, type MergeablePart } from './mergeNormals'
import { LOC_LIGHT_X, LOC_LIGHT_Y, LOC_LIGHT_Z, batchStaticLocs, type StaticLocPart } from './staticLocBatch'
import { buildTerrainMesh, type FloorDefs } from './terrainMesh'
import { SurfaceHeightResolver } from './surfaceHeight'

export interface MapSquareOffset {
  dx: number
  dy: number
}

export interface ArenaRenderConfig {
  terrainMapSquare: { x: number; y: number }
  mapSquareOffsets: readonly MapSquareOffset[]
  locRender: LocRenderConfig
}

/** One loc of the 5 offset squares, in centre-square tile coordinates. */
export interface ArenaLoc {
  id: number
  type: number
  rotation: number
  level: number
  localX: number
  localY: number
  /** The square it came from (tile offset of that square). */
  squareOffsetX: number
  squareOffsetY: number
}

export interface AnimatedLocMesh {
  key: string
  seq: SeqType
  /** Per animation frame: the frame's commands (opaque then transparent). */
  frames: MeshCommand[][]
}

export interface ArenaScene {
  terrainCommands: MeshCommand[]
  staticLocCommands: MeshCommand[]
  animatedLocs: AnimatedLocMesh[]
  /** Centre square level-0 corner heights, [x][y] with x, y in 0..64 (row/col 64 are 0, like scim). */
  terrainHeights: Int32Array[]
  /** Tile-shape aware surface height (projectile endpoints). */
  surface: SurfaceHeightResolver
  /** Unfiltered locs of the 5 squares (occlusion input; also useful for menus). */
  mapLocs: ArenaLoc[]
  stats: ArenaStats
}

export interface ArenaStats {
  terrainTriangles: number
  staticLocTriangles: number
  renderedLocs: number
  renderedLocParts: number
  mergedNormalParts: number
  animatedLocs: number
  mapLocs: number
}

export interface ArenaBuildOptions {
  smoothTerrain: boolean
  /** Cache texture id -> texture-array layer (1-based), or -1 when missing. */
  textureLayer: (textureId: number) => number
}

function squareKey(x: number, y: number): string {
  return `${x},${y}`
}

/** scim: the offsets expanded by +-1 square, first entry first. */
export function expandedOffsets(offsets: readonly MapSquareOffset[]): MapSquareOffset[] {
  const seen = new Set<string>()
  const out: MapSquareOffset[] = []
  for (const o of offsets) {
    for (let dx = o.dx - 1; dx <= o.dx + 1; dx++) {
      for (let dy = o.dy - 1; dy <= o.dy + 1; dy++) {
        const k = squareKey(dx, dy)
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ dx, dy })
      }
    }
  }
  return out
}

export class ArenaSceneBuilder {
  private readonly config: ArenaRenderConfig
  private readonly regions: RegionLoader
  private readonly squares = new Map<string, RegionTerrain | null>()
  private readonly locTypes: LocTypeLoader
  private readonly seqTypes: SeqTypeLoader
  private readonly frames: SeqFrameLoader
  private readonly models: ModelSource
  private readonly floorDefs: FloorDefs

  constructor(cache: CacheSystem, config: ArenaRenderConfig, models?: ModelSource) {
    this.config = config
    this.regions = new RegionLoader(cache)
    this.locTypes = new LocTypeLoader(cache)
    this.seqTypes = new SeqTypeLoader(cache)
    this.frames = new SeqFrameLoader(cache)
    this.models = models ?? new ModelSource(cache)
    const underlays = new UnderlayFloorTypeLoader(cache)
    const overlays = new OverlayFloorTypeLoader(cache)
    this.floorDefs = {
      underlayRgb: (id) => underlays.load(id).rgbColor,
      overlay: (id) => {
        const o = overlays.load(id)
        return { rgb: o.primaryRgb, texture: o.textureId }
      },
    }
  }

  private square(mapX: number, mapY: number): RegionTerrain | undefined {
    const k = squareKey(mapX, mapY)
    const cached = this.squares.get(k)
    if (cached !== undefined) return cached ?? undefined
    let t: RegionTerrain | undefined
    try {
      t = this.regions.getTerrain(mapX, mapY)
    } catch {
      t = undefined
    }
    this.squares.set(k, t ?? null)
    return t
  }

  loc(id: number): LocType {
    return this.locTypes.load(id)
  }

  /** The unfiltered loc list of the offset squares. */
  loadMapLocs(): ArenaLoc[] {
    const { x: cx, y: cy } = this.config.terrainMapSquare
    const out: ArenaLoc[] = []
    for (const o of this.config.mapSquareOffsets) {
      const mx = cx + o.dx
      const my = cy + o.dy
      if (!this.square(mx, my)) continue
      let locs: RegionLoc[] = []
      try {
        locs = this.regions.getLocs(mx, my)
      } catch {
        locs = []
      }
      for (const l of locs) {
        out.push({
          id: l.id,
          type: l.type,
          rotation: l.rotation,
          level: l.plane,
          localX: l.x + o.dx * 64,
          localY: l.y + o.dy * 64,
          squareOffsetX: o.dx * 64,
          squareOffsetY: o.dy * 64,
        })
      }
    }
    return out
  }

  build(opts: ArenaBuildOptions): ArenaScene {
    const { x: cx, y: cy } = this.config.terrainMapSquare
    const lookup = (mx: number, my: number): RegionTerrain | undefined => this.square(mx, my)
    for (const o of expandedOffsets(this.config.mapSquareOffsets)) this.square(cx + o.dx, cy + o.dy)
    const centre = this.square(cx, cy)
    if (!centre) throw new Error(`ArenaSceneBuilder: map square ${cx},${cy} not found`)

    const terrainHeights: Int32Array[] = []
    for (let x = 0; x <= 64; x++) {
      const col = new Int32Array(65)
      if (x < 64) for (let y = 0; y < 64; y++) col[y] = centre.heights[0]![x * 64 + y]!
      terrainHeights.push(col)
    }

    const mapLocs = this.loadMapLocs()
    const contexts = new Map<string, ContextTerrain>()
    const terrainCommands: MeshCommand[] = []
    let terrainTriangles = 0
    const surfaceSquares: { ctx: ContextTerrain; tileOffsetX: number; tileOffsetY: number }[] = []
    for (const o of this.config.mapSquareOffsets) {
      const mx = cx + o.dx
      const my = cy + o.dy
      if (!this.square(mx, my)) continue
      const ctx = buildContextTerrain(mx, my, lookup)
      const ox = o.dx * 64
      const oy = o.dy * 64
      const occl: OcclusionLoc[] = []
      for (const l of mapLocs) {
        if (l.localX >= ox - CORE_ORIGIN && l.localX < ox + 64 + CORE_ORIGIN && l.localY >= oy - CORE_ORIGIN && l.localY < oy + 64 + CORE_ORIGIN) {
          occl.push({ ...l, localX: l.localX - ox + CORE_ORIGIN, localY: l.localY - oy + CORE_ORIGIN })
        }
      }
      applyLocOcclusion(ctx, occl, (id) => {
        const t = this.locTypes.load(id)
        return { clipped: t.clipped, sizeX: t.sizeX, sizeY: t.sizeY }
      })
      contexts.set(squareKey(o.dx, o.dy), ctx)
      surfaceSquares.push({ ctx, tileOffsetX: ox, tileOffsetY: oy })
      const mesh = buildTerrainMesh(ctx, this.floorDefs, { smoothTerrain: opts.smoothTerrain, textureLayer: opts.textureLayer })
      terrainTriangles += mesh.vertexCount / 3
      terrainCommands.push({
        meshId: `terrain-${mx}-${my}-level-0-${opts.smoothTerrain ? 'smooth' : 'flat'}`,
        modelMatrix: osrsModelMatrix(ox, oy, 0),
        positions: mesh.positions,
        hslColors: mesh.hslColors,
        uvs: mesh.uvs,
        textureIds: mesh.textureIds,
        depth: 'readwrite',
        cullFace: 'back',
      })
    }

    const locResult = this.buildLocs(mapLocs, contexts, terrainHeights, opts.textureLayer)
    return {
      terrainCommands,
      staticLocCommands: locResult.staticCommands,
      animatedLocs: locResult.animated,
      terrainHeights,
      surface: new SurfaceHeightResolver(surfaceSquares, terrainHeights),
      mapLocs,
      stats: {
        terrainTriangles,
        staticLocTriangles: locResult.staticCommands.reduce((n, c) => n + c.positions.length / 9, 0),
        renderedLocs: locResult.renderedLocs,
        renderedLocParts: locResult.parts,
        mergedNormalParts: locResult.merged,
        animatedLocs: locResult.animated.length,
        mapLocs: mapLocs.length,
      },
    }
  }

  private buildLocs(
    mapLocs: readonly ArenaLoc[],
    contexts: Map<string, ContextTerrain>,
    centreHeights: Int32Array[],
    textureLayer: TextureLayerResolver,
  ): { staticCommands: MeshCommand[]; animated: AnimatedLocMesh[]; renderedLocs: number; parts: number; merged: number } {
    const factory = new LocModelFactory(this.models)
    const cfg = this.config.locRender
    // Wall decoration displacement from the wall on the same tile (`hie`).
    const displacement = new Map<string, number>()
    for (const l of mapLocs) {
      if (l.type < 0 || l.type > 3) continue
      displacement.set(`${l.level},${l.localX},${l.localY}`, this.locTypes.load(l.id).decorDisplacement)
    }
    const planeFor = (l: ArenaLoc): HeightPlane | null => {
      if (l.level !== 0) return null
      const ctx = contexts.get(squareKey(l.squareOffsetX / 64, l.squareOffsetY / 64))
      if (ctx) return { size: CONTEXT_CORNERS, at: (x, y) => ctx.heights[x * CONTEXT_CORNERS + y]! }
      return { size: 65, at: (x, y) => centreHeights[x]?.[y] ?? 0 }
    }
    const staticParts: StaticLocPart[] = []
    const mergeParts: MergeStaticPart[] = []
    const animated: AnimatedLocMesh[] = []
    const modelCache = new Map<string, RenderModel>()
    let renderedLocs = 0
    let partCount = 0
    mapLocs.forEach((raw, objectIndex) => {
      const filtered = filterLoc(raw, cfg)
      if (!filtered) return
      if (raw.type < 0 || raw.type > 22 || filtered.rotation < 0 || filtered.rotation > 3) return
      const locType = this.locTypes.load(filtered.id)
      renderedLocs++
      const plane = planeFor(raw)
      const terrainX = raw.localX - raw.squareOffsetX + CORE_ORIGIN
      const terrainY = raw.localY - raw.squareOffsetY + CORE_ORIGIN
      const disp = displacement.get(`${raw.level},${raw.localX},${raw.localY}`) ?? 16
      const placement = placementFor(raw.type, filtered.rotation, locType.sizeX, locType.sizeY, disp)
      const category = mergeCategory(raw.type)
      const isAnimated = locType.seqId !== -1
      const ground = footprintGroundHeight(plane, terrainX, terrainY, placement.terrainFootprint)
      placement.requests.forEach((req, partIndex) => {
        const locKey = `loc-${filtered.id}-${raw.level}-${raw.localX}-${raw.localY}-source-${raw.type}-model-${req.modelType}-rotation-${req.rotation}-part-${partIndex}`
        let heightOffset = 0
        if (isAnimated) {
          const anim = this.buildAnimatedLoc(factory, locType, req.modelType, req.rotation, textureLayer)
          if (anim && anim.meshes.length > 0) {
            const matrix = placementMatrix(placement, raw.localX, raw.localY, ground, anim.seq.heightOffset)
            const frames = anim.meshes.map((m, i) => {
              let positions = m.mesh.positions
              if (locType.contouredGround >= 0) {
                const n = positions.length / 3
                const xs = new Float64Array(n)
                const ys = new Float64Array(n)
                const zs = new Float64Array(n)
                for (let k = 0; k < n; k++) {
                  xs[k] = positions[k * 3]!
                  ys[k] = positions[k * 3 + 1]!
                  zs[k] = positions[k * 3 + 2]!
                }
                const cy = contourHeights(xs, ys, zs, n, m.modelHeight, plane, terrainX, terrainY, placement.terrainFootprint, locType.contouredGround)
                if (cy) {
                  positions = new Float32Array(positions)
                  for (let k = 0; k < n; k++) positions[k * 3 + 1] = cy[k]!
                }
              }
              return frameCommands(`${locKey}-frame-${i}`, { ...m.mesh, positions }, matrix)
            })
            animated.push({ key: locKey, seq: anim.seq, frames })
            partCount++
            return
          }
          heightOffset = anim?.seq.heightOffset ?? this.seqTypes.load(locType.seqId).heightOffset
        }
        const matrix = placementMatrix(placement, raw.localX, raw.localY, ground, heightOffset)
        const merges = !!(locType.mergeNormals && !isAnimated && category)
        const cacheKey = !merges && locType.contouredGround < 0 ? `${filtered.id}:${req.modelType}:${req.rotation}` : null
        let model = cacheKey ? modelCache.get(cacheKey) : undefined
        if (!model) {
          model = factory.build(locType, req.modelType, req.rotation)
          if (!model) return
          if (cacheKey) modelCache.set(cacheKey, model)
        }
        const contoured = contourGround(model, plane, terrainX, terrainY, placement.terrainFootprint, locType.contouredGround)
        if (contoured) {
          model.contourVerticesY = contoured
          model.invalidate()
        }
        partCount++
        const part: StaticLocPart = { model, modelMatrix: matrix, ambient: locType.ambient + 64, contrast: locType.contrast + 768 }
        if (merges && category) {
          mergeParts.push({
            ...part,
            objectIndex,
            category,
            level: raw.level,
            tileX: raw.localX,
            tileY: raw.localY,
            sizeX: placement.sceneFootprint.sizeX,
            sizeY: placement.sceneFootprint.sizeY,
            sceneOffsetX: placement.offsetX,
            sceneOffsetY: placement.offsetY,
            plane,
            planeOffsetX: -raw.squareOffsetX + CORE_ORIGIN,
            planeOffsetY: -raw.squareOffsetY + CORE_ORIGIN,
          })
          return
        }
        staticParts.push(part)
      })
    })
    mergeLocNormals(mergeParts)
    staticParts.push(...mergeParts)
    return {
      staticCommands: batchStaticLocs(staticParts, textureLayer),
      animated,
      renderedLocs,
      parts: partCount,
      merged: mergeParts.length,
    }
  }

  /** `loadAnimatedLocMeshFrames`: one pre-lit mesh per animation frame. */
  private buildAnimatedLoc(
    factory: LocModelFactory,
    locType: LocType,
    modelType: number,
    rotation: number,
    textureLayer: TextureLayerResolver,
  ): { seq: SeqType; meshes: { mesh: MeshArrays; modelHeight: number }[] } | null {
    const seq = this.seqTypes.load(locType.seqId)
    const base = factory.build(locType, modelType, rotation, false)
    if (!base) return null
    base.computeAnimationTables()
    const ambient = locType.ambient + 64
    const contrast = locType.contrast + 768
    const meshes: { mesh: MeshArrays; modelHeight: number }[] = []
    const finish = (m: RenderModel): void => {
      if (modelType === 10 && rotation > 3) m.rotate(256)
      const lit = m.computeLitColors(ambient, contrast, LOC_LIGHT_X, LOC_LIGHT_Y, LOC_LIGHT_Z)
      m.calculateBounds()
      meshes.push({ mesh: buildModelMesh(m, lit, { resolveTextureLayer: textureLayer }), modelHeight: m.height })
    }
    if (!seq.frameIds || seq.frameIds.length === 0) {
      finish(base)
      return { seq, meshes }
    }
    const q = rotation & 3
    for (let i = 0; i < seq.frameIds.length; i++) {
      const frame = this.frames.load(seq.frameIds[i]!)
      const m = base.copy()
      if (frame) {
        if (q === 1) m.rotate270()
        else if (q === 2) m.rotate180()
        else if (q === 3) m.rotate90()
        m.animate(frame)
        if (q === 1) m.rotate90()
        else if (q === 2) m.rotate180()
        else if (q === 3) m.rotate270()
      }
      finish(m)
    }
    return { seq, meshes }
  }
}

type MergeStaticPart = MergeablePart & StaticLocPart

function frameCommands(key: string, mesh: MeshArrays, matrix: Float32Array): MeshCommand[] {
  const split = splitOpaqueTransparent(mesh)
  const out: MeshCommand[] = []
  if (split.opaque) {
    out.push({
      meshId: `${key}-opaque`,
      modelMatrix: matrix,
      positions: split.opaque.positions,
      hslColors: split.opaque.hslColors,
      alphas: split.opaque.alphas,
      faceBias: split.opaque.faceBias,
      uvs: split.opaque.uvs,
      textureIds: split.opaque.textureIds,
      cullFace: 'back',
    })
  }
  if (split.transparent) {
    out.push({
      meshId: `${key}-transparent`,
      modelMatrix: matrix,
      positions: split.transparent.positions,
      hslColors: split.transparent.hslColors,
      alphas: split.transparent.alphas,
      faceBias: split.transparent.faceBias,
      uvs: split.transparent.uvs,
      textureIds: split.transparent.textureIds,
      depth: 'read',
      blend: 'normal',
      cullFace: 'back',
    })
  }
  return out
}
