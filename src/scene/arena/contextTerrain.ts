/**
 * Map-square terrain in scim's layout and the 76x76 "context" window it
 * builds around each rendered square: a 6-tile border
 * taken from the neighbouring squares, 77x77 corner heights and light
 * occlusions. Plus the loc light-occlusion pass.
 *
 * Only level 0 is kept (scim renders levels [0] for the Inferno).
 */
import type { RegionTerrain } from '../../cache/map/TerrainDecoder'

export const CORE_ORIGIN = 6
export const CONTEXT_TILES = 76
export const CONTEXT_CORNERS = 77

export interface ContextTerrain {
  mapX: number
  mapY: number
  /** 77x77 corner heights, index x * 77 + y (context coords). */
  heights: Int32Array
  /** 77x77 light occlusion, index x * 77 + y. */
  occlusion: Uint8Array
  /** 76x76 per-tile data, index x * 76 + y. 0 = none, else config id + 1. */
  underlays: Uint16Array
  overlays: Uint16Array
  shapes: Uint8Array
  rotations: Uint8Array
  flags: Uint8Array
}

export type SquareLookup = (mapX: number, mapY: number) => RegionTerrain | undefined

/** `jc`: assemble the context window of square (mapX, mapY) at level 0. */
export function buildContextTerrain(mapX: number, mapY: number, lookup: SquareLookup): ContextTerrain {
  const heights = new Int32Array(CONTEXT_CORNERS * CONTEXT_CORNERS)
  const occlusion = new Uint8Array(CONTEXT_CORNERS * CONTEXT_CORNERS)
  const underlays = new Uint16Array(CONTEXT_TILES * CONTEXT_TILES)
  const overlays = new Uint16Array(CONTEXT_TILES * CONTEXT_TILES)
  const shapes = new Uint8Array(CONTEXT_TILES * CONTEXT_TILES)
  const rotations = new Uint8Array(CONTEXT_TILES * CONTEXT_TILES)
  const flags = new Uint8Array(CONTEXT_TILES * CONTEXT_TILES)
  for (let cx = 0; cx < CONTEXT_TILES; cx++) {
    const gx = cx - CORE_ORIGIN
    const sx = Math.floor(gx / 64)
    const lx = gx - sx * 64
    for (let cy = 0; cy < CONTEXT_TILES; cy++) {
      const gy = cy - CORE_ORIGIN
      const sy = Math.floor(gy / 64)
      const ly = gy - sy * 64
      const sq = lookup(mapX + sx, mapY + sy)
      if (!sq) continue
      const src = lx * 64 + ly
      const dst = cx * CONTEXT_TILES + cy
      underlays[dst] = sq.underlayIds[0]![src]!
      overlays[dst] = sq.overlayIds[0]![src]!
      shapes[dst] = sq.overlayShapes[0]![src]!
      rotations[dst] = sq.overlayRotations[0]![src]!
      flags[dst] = sq.settings[0]![src]!
    }
  }
  for (let cx = 0; cx < CONTEXT_CORNERS; cx++) {
    const gx = cx - CORE_ORIGIN
    const sx = Math.floor(gx / 64)
    const lx = gx - sx * 64
    for (let cy = 0; cy < CONTEXT_CORNERS; cy++) {
      const gy = cy - CORE_ORIGIN
      const sy = Math.floor(gy / 64)
      const ly = gy - sy * 64
      const sq = lookup(mapX + sx, mapY + sy)
      if (!sq) continue
      heights[cx * CONTEXT_CORNERS + cy] = sq.heights[0]![lx * 64 + ly]!
      // Map squares carry no occlusion of their own (scim zero-fills it).
    }
  }
  return { mapX, mapY, heights, occlusion, underlays, overlays, shapes, rotations, flags }
}

export function contextHeight(ctx: ContextTerrain, x: number, y: number): number {
  return ctx.heights[x * CONTEXT_CORNERS + y] ?? 0
}

/** A loc as the occlusion pass sees it (context coordinates). */
export interface OcclusionLoc {
  id: number
  type: number
  rotation: number
  localX: number
  localY: number
  level: number
}

export interface OcclusionLocType {
  clipped: boolean
  sizeX: number
  sizeY: number
}

/**: raise corner occlusion for clipped walls and objects. */
export function applyLocOcclusion(
  ctx: ContextTerrain,
  locs: readonly OcclusionLoc[],
  typeOf: (id: number) => OcclusionLocType | undefined,
): void {
  const occ = ctx.occlusion
  const raise = (x: number, y: number, v: number): void => {
    if (x < 0 || x >= CONTEXT_CORNERS || y < 0 || y >= CONTEXT_CORNERS) return
    const i = x * CONTEXT_CORNERS + y
    if (v > occ[i]!) occ[i] = v
  }
  for (const loc of locs) {
    const t = typeOf(loc.id)
    if (!t || !t.clipped) continue
    if (loc.level !== 0) continue
    const x = loc.localX
    const y = loc.localY
    if (x < 0 || x >= CONTEXT_CORNERS - 1 || y < 0 || y >= CONTEXT_CORNERS - 1) continue
    const r = loc.rotation
    if (loc.type === 0) {
      if (r === 0) {
        raise(x, y, 50)
        raise(x, y + 1, 50)
      } else if (r === 1) {
        raise(x, y + 1, 50)
        raise(x + 1, y + 1, 50)
      } else if (r === 2) {
        raise(x + 1, y, 50)
        raise(x + 1, y + 1, 50)
      } else if (r === 3) {
        raise(x, y, 50)
        raise(x + 1, y, 50)
      }
    } else if (loc.type === 1 || loc.type === 3) {
      if (r === 0) raise(x, y + 1, 50)
      else if (r === 1) raise(x + 1, y + 1, 50)
      else if (r === 2) raise(x + 1, y, 50)
      else if (r === 3) raise(x, y, 50)
    } else if (loc.type >= 10 && loc.type <= 11) {
      for (let tx = x; tx <= x + t.sizeX; tx++) for (let ty = y; ty <= y + t.sizeY; ty++) raise(tx, ty, 15)
    }
  }
}
