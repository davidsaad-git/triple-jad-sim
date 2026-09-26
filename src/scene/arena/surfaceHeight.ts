/**
 * Exact terrain surface height including overlay tile shapes. Used for projectile endpoints only. Floor
 * decoration `raise` is always 0 here: every floor decoration inside the
 * arena is excluded from rendering ( open question 8).
 */
import { CONTEXT_CORNERS, CONTEXT_TILES, CORE_ORIGIN, type ContextTerrain } from './contextTerrain'
import { shapeGeometry, shapeSurfaceHeight, type ShapeGeometry } from './tileShapes'

export interface SurfaceSquare {
  ctx: ContextTerrain
  tileOffsetX: number
  tileOffsetY: number
}

interface TileSurface {
  heights: [number, number, number, number]
  surface: ShapeGeometry | undefined
}

/** Bilinear corner-height lookup on a [x][y] grid, cells clamped to 0..63. */
export function bilinearHeight(h: readonly ArrayLike<number>[] | null, x: number, y: number): number {
  if (!h) return 0
  const ix = Math.max(0, Math.min(63, Math.floor(x)))
  const iy = Math.max(0, Math.min(63, Math.floor(y)))
  const fx = Math.max(0, Math.min(1, x - ix))
  const fy = Math.max(0, Math.min(1, y - iy))
  const a = h[ix]?.[iy] ?? 0
  const b = h[ix + 1]?.[iy] ?? 0
  const c = h[ix]?.[iy + 1] ?? 0
  const d = h[ix + 1]?.[iy + 1] ?? 0
  const s = a + (b - a) * fx
  return s + (c + (d - c) * fx - s) * fy
}

/** Corner height with clamped integer indices. */
export function cornerHeight(h: readonly ArrayLike<number>[] | null, x: number, y: number): number {
  if (!h) return 0
  const col = h[Math.max(0, Math.min(h.length - 1, Math.floor(x)))]
  if (!col) return 0
  return col[Math.max(0, Math.min(col.length - 1, Math.floor(y)))] ?? 0
}

/** Footprint ground z in tiles: minus the average of the 4 outer corners / 128. */
export function footprintGroundZ(h: readonly ArrayLike<number>[] | null, x: number, y: number, sx: number, sy: number): number {
  if (!h) return 0
  const a = cornerHeight(h, x, y)
  const b = cornerHeight(h, x + sx, y)
  const c = cornerHeight(h, x + sx, y + sy)
  const d = cornerHeight(h, x, y + sy)
  return -((a + b + c + d) / 4) / 128
}

export class SurfaceHeightResolver {
  private readonly squares: SurfaceSquare[]
  private readonly fallback: readonly ArrayLike<number>[] | null
  private readonly tiles = new Map<string, TileSurface>()

  constructor(squares: SurfaceSquare[], fallback: readonly ArrayLike<number>[] | null) {
    this.squares = squares
    this.fallback = fallback
  }

  get hasTerrain(): boolean {
    return this.squares.length > 0
  }

  /** OSRS height (negative up) at world tile position (x, y). */
  resolve(x: number, y: number): number {
    if (!this.hasTerrain) return bilinearHeight(this.fallback, x, y)
    const ux = Math.trunc(x * 128)
    const uy = Math.trunc(y * 128)
    const tx = Math.floor(ux / 128)
    const ty = Math.floor(uy / 128)
    const sq = this.squares.find((s) => tx >= s.tileOffsetX && tx < s.tileOffsetX + 64 && ty >= s.tileOffsetY && ty < s.tileOffsetY + 64)
    if (!sq) return 0
    const cx = tx - sq.tileOffsetX + CORE_ORIGIN
    const cy = ty - sq.tileOffsetY + CORE_ORIGIN
    const key = `${sq.tileOffsetX},${sq.tileOffsetY},${cx},${cy}`
    let tile = this.tiles.get(key)
    if (!tile) {
      const ctx = sq.ctx
      const H = (a: number, b: number): number => ctx.heights[a * CONTEXT_CORNERS + b] ?? 0
      const heights: [number, number, number, number] = [H(cx, cy), H(cx + 1, cy), H(cx + 1, cy + 1), H(cx, cy + 1)]
      const t = cx * CONTEXT_TILES + cy
      const overlay = ctx.overlays[t] ?? 0
      const underlay = ctx.underlays[t] ?? 0
      const shape = overlay === 0 ? 0 : (ctx.shapes[t] ?? 0) + 1
      const rotation = overlay === 0 ? 0 : (ctx.rotations[t] ?? 0)
      tile = { heights, surface: underlay === 0 && overlay === 0 ? undefined : shapeGeometry(shape, rotation, heights) }
      this.tiles.set(key, tile)
    }
    const fx = ux - tx * 128
    const fy = uy - ty * 128
    let h = tile.surface ? shapeSurfaceHeight(tile.surface, fx, fy) : undefined
    if (h === undefined) {
      const [a, b, c, d] = tile.heights
      const south = (a * (128 - fx) + b * fx) >> 7
      const north = (d * (128 - fx) + c * fx) >> 7
      h = (south * (128 - fy) + north * fy) >> 7
    }
    return h
  }
}
