/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Flattens every loc placed on one plane of a scene into the renderer's
 * `MeshData` layout, the way rs-map-viewer's SceneLocs / SdMapDataLoader emit
 * static loc geometry:
 *
 *  - each placement's lit model (already rotated/mirrored/scaled by
 *    `LocModelLoader`) is translated to the placement's centre and height;
 *    wall decorations also get their displacement off the wall (the second
 *    model of a two-model shape does not, like the client);
 *  - configs that contour to the ground (opcodes 21 / 81) get per-vertex
 *    terrain heights from the scene's height map instead of one flat height;
 *  - client coordinates (y down, clockwise-from-above faces) become render
 *    coordinates (y up, counter-clockwise) exactly like the terrain mesh;
 *  - opaque faces come first, then translucent ones, so a single draw of the
 *    buffer blends correctly over what was drawn before it.
 *
 * Per-placement bounding boxes (render space) are returned for picking.
 */
import type { Model } from '../cache/model/Model'
import { buildModelMesh, type ModelMesh } from '../cache/model/ModelMesh'
import type { MeshData } from '../render/Mesh'
import type { LocModelLoader } from './LocModelLoader'
import { TILE_SIZE, TILE_SIZE_SHIFT, type Scene } from './Scene'
import type { SceneLoc } from './SceneTile'

export interface LocMeshOptions {
  /** Scene-tile bounds (inclusive). Default: everything but the border ring. */
  minX?: number
  minY?: number
  maxX?: number
  maxY?: number
  /**
   * World-unit offset added to x / z. Default puts scene tile `borderSize`
   * (the region's south-west tile) at the origin, matching the terrain mesh.
   */
  offsetX?: number
  offsetZ?: number
  /** Whether a texture has translucent texels; such faces go in the alpha part. Default: none. */
  isTextureTransparent?: (textureId: number) => boolean
  /** Placements to leave out (e.g. objects the encounter removes). */
  exclude?: (loc: SceneLoc<Model>) => boolean
}

/** Axis-aligned bounds of one placement in render space (y up). */
export interface LocBounds {
  loc: SceneLoc<Model>
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  /** Triangles emitted for this placement (both models, opaque and alpha). */
  triangles: number
  /** At least one emitted face is textured. */
  textured: boolean
  /** Per-vertex terrain heights were applied. */
  contoured: boolean
}

export interface LocMeshStats {
  /** Placements on the plane inside the bounds (drawn or not). */
  placements: number
  /** Placements that produced geometry. */
  drawn: number
  triangles: number
  alphaTriangles: number
  texturedTriangles: number
  /** Distinct lit models used. */
  models: number
}

export interface LocMeshResult {
  mesh: MeshData
  /** Vertex index where the translucent faces start (== vertexCount when there are none). */
  alphaStart: number
  bounds: LocBounds[]
  stats: LocMeshStats
}

/** Flattened model plus the client-space extents `contourGround` needs. */
interface CachedModelMesh {
  mesh: ModelMesh
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

interface ContourInfo {
  type: number
  param: number
}

/** Per-vertex arrays for one bucket (opaque or alpha) of the output. */
class Bucket {
  readonly positions: number[] = []
  readonly colors: number[] = []
  readonly priorities: number[] = []
  readonly texcoords: number[] = []
  triangles = 0
}

/** Build the loc mesh for `level` (see the module comment). */
export function buildLocMesh(
  scene: Scene<Model>,
  level: number,
  options: LocMeshOptions,
  loader: LocModelLoader,
): LocMeshResult {
  const minX = options.minX ?? scene.borderSize
  const minY = options.minY ?? scene.borderSize
  const maxX = options.maxX ?? scene.sizeX - 1 - scene.borderSize
  const maxY = options.maxY ?? scene.sizeY - 1 - scene.borderSize
  const offsetX = options.offsetX ?? -scene.borderSize * TILE_SIZE
  const offsetZ = options.offsetZ ?? -scene.borderSize * TILE_SIZE
  const isTextureTransparent = options.isTextureTransparent

  const opaque = new Bucket()
  const alpha = new Bucket()
  const bounds: LocBounds[] = []
  const meshCache = new Map<Model, CachedModelMesh>()
  let textured = false
  let texturedTriangles = 0
  let placements = 0

  for (const loc of scene.locs) {
    if (loc.level !== level) continue
    if (loc.x < minX || loc.x > maxX || loc.y < minY || loc.y > maxY) continue
    placements++
    if (!loc.model && !loc.secondaryModel) continue
    if (options.exclude && options.exclude(loc)) continue

    const locType = loader.resolveLocType(loc.id)
    const contour: ContourInfo | null =
      locType && locType.contourGroundType !== 0
        ? { type: locType.contourGroundType, param: locType.contourGroundParam }
        : null

    const box: LocBounds = {
      loc,
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
      triangles: 0,
      textured: false,
      contoured: false,
    }

    // The primary model carries the wall-decoration displacement; the secondary (the
    // inside half of a double diagonal decoration, the second half of a corner) does not.
    const instances: [Model | null, number, number][] = [
      [loc.model, loc.offsetX, loc.offsetZ],
      [loc.secondaryModel, 0, 0],
    ]
    for (const [model, dispX, dispZ] of instances) {
      if (!model) continue
      let cached = meshCache.get(model)
      if (!cached) {
        cached = cacheModelMesh(model)
        meshCache.set(model, cached)
      }
      const mm = cached.mesh
      if (mm.vertexCount === 0) continue

      const contourY = contour ? contourHeights(scene, loc, cached, contour) : null
      if (contourY) box.contoured = true
      if (mm.texcoords) {
        textured = true
        box.textured = true
      }

      const baseX = loc.centerX + dispX + offsetX
      const baseZ = loc.centerZ + dispZ + offsetZ
      const pos = mm.positions
      const col = mm.colors
      const pri = mm.priorities
      const tex = mm.texcoords

      for (let corner = 0; corner < mm.vertexCount; corner += 3) {
        // Fully transparent faces are never drawn (the client skips alpha 0 / 1).
        const faceAlpha = col[corner * 4 + 3]!
        if (faceAlpha <= 1) continue
        const textureId = tex ? tex[corner * 3 + 2]! : -1
        const translucent = faceAlpha < 255 || (textureId !== -1 && isTextureTransparent?.(textureId) === true)
        const bucket = translucent ? alpha : opaque
        if (textureId !== -1) texturedTriangles++

        // Client faces wind clockwise from above; after the y flip the renderer wants CCW.
        for (const k of [0, 2, 1]) {
          const v = corner + k
          const o = v * 3
          const x = pos[o]! + baseX
          const clientY = contourY ? contourY[v]! : pos[o + 1]! + loc.height
          const z = pos[o + 2]! + baseZ
          const y = -clientY
          bucket.positions.push(x, y, z)
          const co = v * 4
          bucket.colors.push(col[co]!, col[co + 1]!, col[co + 2]!, col[co + 3]!)
          bucket.priorities.push(pri[v]!)
          if (tex) {
            bucket.texcoords.push(tex[o]!, tex[o + 1]!, tex[o + 2]!)
          } else {
            bucket.texcoords.push(0, 0, -1)
          }
          if (x < box.minX) box.minX = x
          if (x > box.maxX) box.maxX = x
          if (y < box.minY) box.minY = y
          if (y > box.maxY) box.maxY = y
          if (z < box.minZ) box.minZ = z
          if (z > box.maxZ) box.maxZ = z
        }
        bucket.triangles++
        box.triangles++
      }
    }

    if (box.triangles > 0) bounds.push(box)
  }

  const vertexCount = (opaque.positions.length + alpha.positions.length) / 3
  const positions = new Float32Array(vertexCount * 3)
  positions.set(opaque.positions, 0)
  positions.set(alpha.positions, opaque.positions.length)
  const colors = new Uint8Array(vertexCount * 4)
  colors.set(opaque.colors, 0)
  colors.set(alpha.colors, opaque.colors.length)
  const priorities = new Float32Array(vertexCount)
  priorities.set(opaque.priorities, 0)
  priorities.set(alpha.priorities, opaque.priorities.length)
  let texcoords: Float32Array | null = null
  if (textured) {
    texcoords = new Float32Array(vertexCount * 3)
    texcoords.set(opaque.texcoords, 0)
    texcoords.set(alpha.texcoords, opaque.texcoords.length)
  }

  return {
    mesh: { positions, colors, priorities, texcoords, vertexCount },
    alphaStart: opaque.positions.length / 3,
    bounds,
    stats: {
      placements,
      drawn: bounds.length,
      triangles: opaque.triangles + alpha.triangles,
      alphaTriangles: alpha.triangles,
      texturedTriangles,
      models: meshCache.size,
    },
  }
}

function cacheModelMesh(model: Model): CachedModelMesh {
  const mesh = buildModelMesh(model)
  const c: CachedModelMesh = {
    mesh,
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  }
  // Extents over the vertices faces actually use, like the client's calculateBounds.
  const p = mesh.positions
  for (let v = 0; v < mesh.vertexCount; v++) {
    const x = p[v * 3]!
    const y = p[v * 3 + 1]!
    const z = p[v * 3 + 2]!
    if (x < c.minX) c.minX = x
    if (x > c.maxX) c.maxX = x
    if (y < c.minY) c.minY = y
    if (y > c.maxY) c.maxY = y
    if (z < c.minZ) c.minZ = z
    if (z > c.maxZ) c.maxZ = z
  }
  return c
}

/**
 * The client's Model.contourGround for types 1 (opcode 21: every vertex
 * follows the terrain) and 2 (opcode 81: only the lower `param / 65536` of
 * the model follows it). Returns final client-space y per mesh corner, or
 * null when the model is left flat: outside the height map, or standing on
 * a tile whose four corners already sit at the placement height.
 */
function contourHeights(
  scene: Scene<Model>,
  loc: SceneLoc<Model>,
  cached: CachedModelMesh,
  contour: ContourInfo,
): Float32Array | null {
  if (contour.type !== 1 && contour.type !== 2) return null
  const mesh = cached.mesh
  const sceneX = loc.centerX
  const sceneZ = loc.centerZ
  const sceneHeight = loc.height
  const level = loc.level

  const startX = sceneX + cached.minX
  const endX = sceneX + cached.maxX
  const startZ = sceneZ + cached.minZ
  const endZ = sceneZ + cached.maxZ
  // The height map has sizeX + 1 columns; every sampled tile needs its north-east corner too.
  if (
    startX < 0 ||
    (endX + TILE_SIZE) >> TILE_SIZE_SHIFT >= scene.sizeX + 1 ||
    startZ < 0 ||
    (endZ + TILE_SIZE) >> TILE_SIZE_SHIFT >= scene.sizeY + 1
  ) {
    return null
  }
  const tileStartX = startX >> TILE_SIZE_SHIFT
  const tileEndX = (endX + TILE_SIZE - 1) >> TILE_SIZE_SHIFT
  const tileStartZ = startZ >> TILE_SIZE_SHIFT
  const tileEndZ = (endZ + TILE_SIZE - 1) >> TILE_SIZE_SHIFT
  if (
    scene.getHeight(level, tileStartX, tileStartZ) === sceneHeight &&
    scene.getHeight(level, tileEndX, tileStartZ) === sceneHeight &&
    scene.getHeight(level, tileStartX, tileEndZ) === sceneHeight &&
    scene.getHeight(level, tileEndX, tileEndZ) === sceneHeight
  ) {
    return null
  }

  const out = new Float32Array(mesh.vertexCount)
  const p = mesh.positions
  if (contour.type === 1) {
    for (let v = 0; v < mesh.vertexCount; v++) {
      const vx = p[v * 3]! + sceneX
      const vy = p[v * 3 + 1]!
      const vz = p[v * 3 + 2]! + sceneZ
      out[v] = vy + scene.getHeightInterpolated(level, vx, vz)
    }
  } else {
    const minY = cached.minY
    const param = contour.param
    for (let v = 0; v < mesh.vertexCount; v++) {
      const vy = p[v * 3 + 1]!
      // Share of the model's height this vertex sits at (0 at the base, 65536 at the top).
      const yRatio = minY === 0 ? 0 : ((vy << 16) / minY) | 0
      if (yRatio < param) {
        const vx = p[v * 3]! + sceneX
        const vz = p[v * 3 + 2]! + sceneZ
        const height = scene.getHeightInterpolated(level, vx, vz)
        out[v] = vy + sceneHeight + ((height - sceneHeight) * (param - yRatio)) / param
      } else {
        out[v] = vy + sceneHeight
      }
    }
  }
  return out
}
