/**
 * Loc placement rules as scim's LocRenderer applies them: model requests per placement type (`mie`), footprints and
 * decoration displacement, ground height, the placement matrix
 *, ground contouring (`_C`/`jie`) and the arena render filter.
 */
import type { RenderModel } from '../../render/model/RenderModel'

export const LocShape = {
  WALL_STRAIGHT: 0,
  WALL_DIAGONAL_CORNER: 1,
  WALL_CORNER: 2,
  WALL_SQUARE_CORNER: 3,
  WALL_DECORATION_INSIDE: 4,
  WALL_DECORATION_OUTSIDE: 5,
  WALL_DECORATION_DIAGONAL_OUTSIDE: 6,
  WALL_DECORATION_DIAGONAL_INSIDE: 7,
  WALL_DECORATION_DIAGONAL_DOUBLE: 8,
  WALL_DIAGONAL: 9,
  NORMAL: 10,
  NORMAL_DIAGONAL: 11,
  FLOOR_DECORATION: 22,
} as const

export interface ModelRequest {
  modelType: number
  rotation: number
}

/** `mie`: which model(s) a placement type draws. Rotations > 3 mean "+45 degrees". */
export function modelRequests(type: number, rotation: number): ModelRequest[] {
  switch (type) {
    case 2:
      return [
        { modelType: 2, rotation: rotation + 4 },
        { modelType: 2, rotation: (rotation + 1) & 3 },
      ]
    case 4:
    case 5:
      return [{ modelType: 4, rotation }]
    case 6:
      return [{ modelType: 4, rotation: rotation + 4 }]
    case 7:
      return [{ modelType: 4, rotation: ((rotation + 2) & 3) + 4 }]
    case 8:
      return [
        { modelType: 4, rotation: rotation + 4 },
        { modelType: 4, rotation: ((rotation + 2) & 3) + 4 },
      ]
    case 11:
      return [{ modelType: 10, rotation: rotation + 4 }]
    default:
      return [{ modelType: type, rotation }]
  }
}

export interface Footprint {
  sizeX: number
  sizeY: number
}

export interface Placement {
  requests: ModelRequest[]
  terrainFootprint: Footprint
  sceneFootprint: Footprint
  /** OSRS units. */
  offsetX: number
  offsetY: number
}

const DISP_X = [1, 0, -1, 0]
const DISP_Y = [0, -1, 0, 1]
const DIAG_X = [1, -1, -1, 1]
const DIAG_Y = [-1, -1, 1, 1]

/**. */
export function placementFor(type: number, rotation: number, sizeX: number, sizeY: number, boundaryDisplacement: number): Placement {
  const terrainFootprint = rotation & 1 ? { sizeX: sizeY, sizeY: sizeX } : { sizeX, sizeY }
  const sceneFootprint = type === 10 || type === 11 ? terrainFootprint : { sizeX: 1, sizeY: 1 }
  let offsetX = 0
  let offsetY = 0
  if (type === 5) {
    offsetX = boundaryDisplacement * DISP_X[rotation]!
    offsetY = boundaryDisplacement * DISP_Y[rotation]!
  } else if (type === 6 || type === 8) {
    const d = Math.trunc(boundaryDisplacement / 2)
    offsetX = d * DIAG_X[rotation]!
    offsetY = d * DIAG_Y[rotation]!
  }
  return { requests: modelRequests(type, rotation), terrainFootprint, sceneFootprint, offsetX, offsetY }
}

/** Corner-height accessor over a context height plane (`nd`: clamped index). */
export interface HeightPlane {
  size: number
  at(x: number, y: number): number
}

export function planeHeight(plane: HeightPlane, x: number, y: number): number {
  const cx = Math.max(0, Math.min(plane.size - 1, Math.floor(x)))
  const cy = Math.max(0, Math.min(plane.size - 1, Math.floor(y)))
  return plane.at(cx, cy)
}

/**: ground height at the footprint centre (average of 4 corners, >> 2). */
export function footprintGroundHeight(plane: HeightPlane | null, x: number, y: number, fp: Footprint): number {
  if (!plane) return 0
  const n = plane.size - 1
  const x0 = x + fp.sizeX <= n ? x + (fp.sizeX >> 1) : x
  const x1 = x + fp.sizeX <= n ? x + ((fp.sizeX + 1) >> 1) : x + 1
  const y0 = y + fp.sizeY <= n ? y + (fp.sizeY >> 1) : y
  const y1 = y + fp.sizeY <= n ? y + ((fp.sizeY + 1) >> 1) : y + 1
  const at = (a: number, b: number): number => (a >= 0 && a < plane.size && b >= 0 && b < plane.size ? plane.at(a, b) : 0)
  return (at(x0, y1) + at(x0, y0) + at(x1, y0) + at(x1, y1)) >> 2
}

/**: placement matrix (scene angle is always 0 for scim). */
export function placementMatrix(
  placement: Placement,
  localX: number,
  localY: number,
  groundHeight: number,
  animationHeightOffset: number,
): Float32Array {
  const s = 1 / 128
  const cx = localX + placement.sceneFootprint.sizeX * 0.5 + placement.offsetX * s
  const cy = localY + placement.sceneFootprint.sizeY * 0.5 + placement.offsetY * s
  const cz = (-groundHeight + animationHeightOffset) * s
  return new Float32Array([s, 0, 0, 0, 0, 0, -s, 0, 0, s, 0, 0, cx, cy, cz, 1])
}

/**
 * `_C`/`jie`: contour a model to the terrain. Returns the
 * contoured Y array, or null when nothing changes (flat footprint or no
 * contouring). `modelHeight` is the model's upward extent (`height`).
 */
export function contourGround(
  model: RenderModel,
  plane: HeightPlane | null,
  terrainX: number,
  terrainY: number,
  fp: Footprint,
  contouredGround: number,
): Int32Array | null {
  if (contouredGround < 0 || !plane) return null
  model.calculateBounds()
  return contourHeights(
    model.verticesX,
    model.verticesY,
    model.verticesZ,
    model.usedVertexCount,
    model.height,
    plane,
    terrainX,
    terrainY,
    fp,
    contouredGround,
  )
}

/** The array form of `_C`: contoured Y values for `count` vertices, or null when the footprint is flat. */
export function contourHeights(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  zs: ArrayLike<number>,
  count: number,
  modelHeight: number,
  plane: HeightPlane | null,
  terrainX: number,
  terrainY: number,
  fp: Footprint,
  contouredGround: number,
): Int32Array | null {
  if (contouredGround < 0 || !plane) return null
  const centre = footprintGroundHeight(plane, terrainX, terrainY, fp)
  const h0 = planeHeight(plane, terrainX, terrainY)
  const h1 = planeHeight(plane, terrainX + fp.sizeX, terrainY)
  const h2 = planeHeight(plane, terrainX + fp.sizeX, terrainY + fp.sizeY)
  const h3 = planeHeight(plane, terrainX, terrainY + fp.sizeY)
  if (centre === h0 && centre === h1 && centre === h2 && centre === h3) return null
  const baseX = terrainX * 128 + fp.sizeX * 64
  const baseZ = terrainY * 128 + fp.sizeY * 64
  const out = new Int32Array(count)
  for (let v = 0; v < count; v++) {
    const x = xs[v]!
    const y = ys[v]!
    const z = zs[v]!
    out[v] = y
    const frac = ((y << 16) / -modelHeight) | 0
    if (contouredGround > 0 && frac >= contouredGround) continue
    const ax = baseX + x
    const az = baseZ + z
    const tx = ax >> 7
    const tz = az >> 7
    const fx = ax & 127
    const fz = az & 127
    const south = (planeHeight(plane, tx, tz) * (128 - fx) + planeHeight(plane, tx + 1, tz) * fx) >> 7
    const north = (planeHeight(plane, tx, tz + 1) * (128 - fx) + planeHeight(plane, tx + 1, tz + 1) * fx) >> 7
    const terrain = (south * (128 - fz) + north * fz) >> 7
    out[v] =
      contouredGround === 0 ? y + terrain - centre : (y + ((terrain - centre) * (contouredGround - frac)) / contouredGround) | 0
  }
  return out
}

/** Loc placement kind for normal merging. */
export function mergeCategory(type: number): 'boundary' | 'large' | 'floor' | null {
  if (type >= 0 && type <= 3) return 'boundary'
  if (type >= 4 && type <= 8) return null
  if (type >= 9 && type <= 21) return 'large'
  if (type === 22) return 'floor'
  return null
}

// ---------------------------------------------------------------- render filter

export interface LocRegion {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface LocReplacement {
  localX: number
  localY: number
  sourceLocId: number
  targetLocId: number
  targetRotation: number
}

export interface LocRenderConfig {
  levels: readonly number[]
  excludedLocIds: readonly number[]
  excludedRegions: readonly LocRegion[]
  replacements: readonly LocReplacement[]
}

export interface FilterableLoc {
  id: number
  localX: number
  localY: number
  level: number
  rotation: number
}

/**
 * with the bounds `tw` gives multi-square encounters (x, y in
 * [-64, 127], margin 0). Returns the (possibly replaced) id/rotation, or
 * null when the loc is not rendered.
 */
export function filterLoc(loc: FilterableLoc, cfg: LocRenderConfig): { id: number; rotation: number } | null {
  if (!cfg.levels.includes(loc.level)) return null
  if (cfg.excludedLocIds.includes(loc.id)) return null
  if (loc.localX < -64 || loc.localX > 127 || loc.localY < -64 || loc.localY > 127) return null
  for (const r of cfg.excludedRegions) {
    if (loc.localX >= r.minX && loc.localX <= r.maxX && loc.localY >= r.minY && loc.localY <= r.maxY) return null
  }
  for (const r of cfg.replacements) {
    if (r.localX === loc.localX && r.localY === loc.localY && r.sourceLocId === loc.id) {
      return { id: r.targetLocId, rotation: r.targetRotation }
    }
  }
  return { id: loc.id, rotation: loc.rotation }
}
