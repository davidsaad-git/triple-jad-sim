/**
 * Cache-built arena configuration, a re-implementation of scim's
 * `CacheManager.buildArenaConfig` and the per-square
 * analysis / flood fill / bounds.
 */
import type { CacheSystem } from '../../cache/CacheSystem'
import { LocTypeLoader } from '../../cache/config/LocType'
import { RegionLoader } from '../../cache/map/RegionLoader'
import { tileIndex } from '../../cache/map/TerrainDecoder'
import type { ArenaConfig, Bounds } from './Arena'
import { tileKey, unpackTileKey } from './Arena'
import { type CollisionGrid, createCollisionGrid, Flag } from './collisionFlags'

/** Loc shapes. */
const LocShape = {
  WALL: 0,
  WALL_TRI_CORNER: 1,
  WALL_CORNER: 2,
  WALL_RECT_CORNER: 3,
  WALL_DIAGONAL: 9,
  NORMAL: 10,
  NORMAL_DIAGONAL: 11,
  ROOF_SLOPED: 12,
  FLOOR_DECORATION: 22,
} as const

export interface MapSquareOffset {
  readonly dx: number
  readonly dy: number
}

/** Centre square plus N, E, S, W. */
export const INFERNO_MAP_SQUARE = { x: 35, y: 83 } as const
export const INFERNO_MAP_SQUARE_OFFSETS: readonly MapSquareOffset[] = [
  { dx: 0, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: -1, dy: 0 },
]
/** "Ancestral Glyph" static loc, dropped from collision by scim's Zuk arena (`ST`). */
export const INFERNO_EXCLUDED_LOC_IDS: ReadonlySet<number> = new Set([30338])

export interface BuildArenaOptions {
  readonly mapX: number
  readonly mapY: number
  readonly seedX: number
  readonly seedY: number
  readonly mapSquareOffsets?: readonly MapSquareOffset[]
  readonly excludedStaticLocIds?: ReadonlySet<number>
}

interface LocCollisionInfo {
  readonly clipType: number
  readonly sizeX: number
  readonly sizeY: number
  readonly blocksProjectile: boolean
}

interface SquareAnalysis {
  readonly flags: Int32Array
  readonly walkable: [number, number][]
}

function isNormalShape(shape: number): boolean {
  return (
    shape === LocShape.NORMAL ||
    shape === LocShape.NORMAL_DIAGONAL ||
    shape === LocShape.WALL_DIAGONAL ||
    (shape >= LocShape.ROOF_SLOPED && shape < LocShape.FLOOR_DECORATION)
  )
}

/** Wall flags; `s` = 0 movement flags, 9 projectile flags. Writes are clipped to the 64x64 square. */
function applyWall(flags: Int32Array, x: number, y: number, shape: number, rotation: number, projectile: boolean): void {
  const set = (tx: number, ty: number, base: number): void => {
    if (tx < 0 || tx >= 64 || ty < 0 || ty >= 64) return
    const f = projectile ? projectileVariant(base) : base
    flags[tx + ty * 64] = flags[tx + ty * 64]! | f
  }
  if (shape === LocShape.WALL) {
    if (rotation === 0) {
      set(x, y, Flag.WALL_WEST)
      set(x - 1, y, Flag.WALL_EAST)
    } else if (rotation === 1) {
      set(x, y, Flag.WALL_NORTH)
      set(x, y + 1, Flag.WALL_SOUTH)
    } else if (rotation === 2) {
      set(x, y, Flag.WALL_EAST)
      set(x + 1, y, Flag.WALL_WEST)
    } else if (rotation === 3) {
      set(x, y, Flag.WALL_SOUTH)
      set(x, y - 1, Flag.WALL_NORTH)
    }
  }
  if (shape === LocShape.WALL_TRI_CORNER || shape === LocShape.WALL_RECT_CORNER) {
    if (rotation === 0) {
      set(x, y, Flag.WALL_NORTH_WEST)
      set(x - 1, y + 1, Flag.WALL_SOUTH_EAST)
    } else if (rotation === 1) {
      set(x, y, Flag.WALL_NORTH_EAST)
      set(x + 1, y + 1, Flag.WALL_SOUTH_WEST)
    } else if (rotation === 2) {
      set(x, y, Flag.WALL_SOUTH_EAST)
      set(x + 1, y - 1, Flag.WALL_NORTH_WEST)
    } else if (rotation === 3) {
      set(x, y, Flag.WALL_SOUTH_WEST)
      set(x - 1, y - 1, Flag.WALL_NORTH_EAST)
    }
  }
  if (shape === LocShape.WALL_CORNER) {
    if (rotation === 0) {
      set(x, y, Flag.WALL_WEST | Flag.WALL_NORTH)
      set(x - 1, y, Flag.WALL_EAST)
      set(x, y + 1, Flag.WALL_SOUTH)
    } else if (rotation === 1) {
      set(x, y, Flag.WALL_NORTH | Flag.WALL_EAST)
      set(x, y + 1, Flag.WALL_SOUTH)
      set(x + 1, y, Flag.WALL_WEST)
    } else if (rotation === 2) {
      set(x, y, Flag.WALL_EAST | Flag.WALL_SOUTH)
      set(x + 1, y, Flag.WALL_WEST)
      set(x, y - 1, Flag.WALL_NORTH)
    } else if (rotation === 3) {
      set(x, y, Flag.WALL_SOUTH | Flag.WALL_WEST)
      set(x, y - 1, Flag.WALL_NORTH)
      set(x - 1, y, Flag.WALL_EAST)
    }
  }
}

/** Movement wall bit -> the matching projectile-blocker bit (movement bits 0..7 shifted by 9). */
function projectileVariant(movementBits: number): number {
  return (movementBits & 0xff) << 9
}

/** scim: one map square on level 0. */
function analyseSquare(
  regions: RegionLoader,
  locInfo: (id: number) => LocCollisionInfo | undefined,
  squareX: number,
  squareY: number,
  excluded: ReadonlySet<number> | undefined,
): SquareAnalysis | null {
  const terrain = regions.getTerrain(squareX, squareY)
  if (!terrain) return null
  const flags = new Int32Array(64 * 64)
  const settings0 = terrain.settings[0]!
  for (let x = 0; x < 64; x++) {
    for (let y = 0; y < 64; y++) {
      // Level 0: the bridge test never applies (scim only redirects for level > 0).
      if ((settings0[tileIndex(x, y)]! & 1) === 1) flags[x + y * 64] = flags[x + y * 64]! | Flag.FLOOR
    }
  }
  for (const loc of regions.getLocs(squareX, squareY)) {
    if (loc.plane !== 0 || excluded?.has(loc.id)) continue
    const info = locInfo(loc.id)
    if (!info) continue
    const shape = loc.type
    if (shape === LocShape.FLOOR_DECORATION) {
      if (info.clipType === 1) flags[loc.x + loc.y * 64] = flags[loc.x + loc.y * 64]! | Flag.FLOOR_DECORATION
    } else if (isNormalShape(shape)) {
      if (info.clipType !== 0) {
        const sx = loc.rotation & 1 ? info.sizeY : info.sizeX
        const sy = loc.rotation & 1 ? info.sizeX : info.sizeY
        const mask = Flag.OBJECT | (info.blocksProjectile ? Flag.OBJECT_PROJECTILE_BLOCKER : 0)
        for (let dx = 0; dx < sx; dx++) {
          for (let dy = 0; dy < sy; dy++) {
            const tx = loc.x + dx
            const ty = loc.y + dy
            if (tx >= 0 && tx < 64 && ty >= 0 && ty < 64) flags[tx + ty * 64] = flags[tx + ty * 64]! | mask
          }
        }
      }
    } else if (
      (shape === LocShape.WALL ||
        shape === LocShape.WALL_TRI_CORNER ||
        shape === LocShape.WALL_CORNER ||
        shape === LocShape.WALL_RECT_CORNER) &&
      info.clipType !== 0
    ) {
      applyWall(flags, loc.x, loc.y, shape, loc.rotation, false)
      if (info.blocksProjectile) applyWall(flags, loc.x, loc.y, shape, loc.rotation, true)
    }
  }
  const underlays0 = terrain.underlayIds[0]!
  const walkable: [number, number][] = []
  for (let x = 0; x < 64; x++) {
    for (let y = 0; y < 64; y++) {
      const hasUnderlay = underlays0[tileIndex(x, y)]! > 0
      const blocked = (flags[x + y * 64]! & (Flag.FLOOR_BLOCKED | Flag.OBJECT)) !== 0
      if (hasUnderlay && !blocked) walkable.push([x, y])
    }
  }
  return { flags, walkable }
}

/** scim: may the flood fill step from (fx, fy) to (tx, ty)? */
export function floodStepAllowed(map: CollisionGrid, fx: number, fy: number, tx: number, ty: number): boolean {
  const dx = tx - fx
  const dy = ty - fy
  if (dy === 0) {
    if (dx === -1) return !map.hasFlag(tx, ty, Flag.BLOCK_WEST)
    if (dx === 1) return !map.hasFlag(tx, ty, Flag.BLOCK_EAST)
  }
  if (dx === 0) {
    if (dy === -1) return !map.hasFlag(tx, ty, Flag.BLOCK_SOUTH)
    if (dy === 1) return !map.hasFlag(tx, ty, Flag.BLOCK_NORTH)
  }
  if (dx === -1 && dy === -1)
    return (
      !map.hasFlag(tx, ty, Flag.BLOCK_SOUTH_WEST) &&
      !map.hasFlag(fx - 1, fy, Flag.BLOCK_WEST) &&
      !map.hasFlag(fx, fy - 1, Flag.BLOCK_SOUTH)
    )
  if (dx === 1 && dy === -1)
    return (
      !map.hasFlag(tx, ty, Flag.BLOCK_SOUTH_EAST) &&
      !map.hasFlag(fx + 1, fy, Flag.BLOCK_EAST) &&
      !map.hasFlag(fx, fy - 1, Flag.BLOCK_SOUTH)
    )
  if (dx === -1 && dy === 1)
    return (
      !map.hasFlag(tx, ty, Flag.BLOCK_NORTH_WEST) &&
      !map.hasFlag(fx - 1, fy, Flag.BLOCK_WEST) &&
      !map.hasFlag(fx, fy + 1, Flag.BLOCK_NORTH)
    )
  return (
    dx === 1 &&
    dy === 1 &&
    !map.hasFlag(tx, ty, Flag.BLOCK_NORTH_EAST) &&
    !map.hasFlag(fx + 1, fy, Flag.BLOCK_EAST) &&
    !map.hasFlag(fx, fy + 1, Flag.BLOCK_NORTH)
  )
}

/** scim: 8-neighbour BFS from the seed over walkable tiles (FIFO, W E S N SW SE NW NE). */
export function floodFill(
  walkable: ReadonlySet<number>,
  seedX: number,
  seedY: number,
  map: CollisionGrid | null,
): Set<number> {
  const reached = new Set<number>()
  if (!walkable.has(tileKey(seedX, seedY))) return reached
  const queue: [number, number][] = [[seedX, seedY]]
  const seen = new Set<number>()
  let head = 0
  while (head < queue.length) {
    const [x, y] = queue[head++]!
    const key = tileKey(x, y)
    if (seen.has(key)) continue
    seen.add(key)
    if (!walkable.has(key)) continue
    reached.add(key)
    const neighbours: [number, number][] = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
      [x - 1, y - 1],
      [x + 1, y - 1],
      [x - 1, y + 1],
      [x + 1, y + 1],
    ]
    for (const [nx, ny] of neighbours) {
      const nk = tileKey(nx, ny)
      const allowed = !map || floodStepAllowed(map, x, y, nx, ny)
      if (!seen.has(nk) && walkable.has(nk) && allowed) queue.push([nx, ny])
    }
  }
  return reached
}


export function boundsOf(tiles: ReadonlySet<number>): Bounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const key of tiles) {
    const [x, y] = unpackTileKey(key)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (minX === Infinity) return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 1, height: 1 }
  return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * Build the arena configuration from the cache exactly like scim: analyse every
 * offset square on level 0, merge flags and walkable tiles into one grid in
 * centre-square coordinates, flood-fill from the seed and bound the result.
 * Returns the empty config when the seed is not walkable.
 */
export function buildArenaConfig(cache: CacheSystem, options: BuildArenaOptions): ArenaConfig {
  const regions = new RegionLoader(cache)
  const locTypes = new LocTypeLoader(cache)
  const locInfo = (id: number): LocCollisionInfo | undefined => {
    if (!locTypes.has(id)) return undefined
    const t = locTypes.load(id)
    return { clipType: t.clipType, sizeX: t.sizeX, sizeY: t.sizeY, blocksProjectile: t.blocksProjectile }
  }
  const offsets = options.mapSquareOffsets ?? [{ dx: 0, dy: 0 }]
  const radius = Math.max(0, ...offsets.flatMap((o) => [Math.abs(o.dx), Math.abs(o.dy)]))
  const span = (radius * 2 + 1) * 64
  const grid = createCollisionGrid(-radius * 64, -radius * 64, span, span)
  const walkable = new Set<number>()
  for (const { dx, dy } of offsets) {
    const analysis = analyseSquare(regions, locInfo, options.mapX + dx, options.mapY + dy, options.excludedStaticLocIds)
    if (!analysis) continue
    const ox = dx * 64
    const oy = dy * 64
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        const f = analysis.flags[x + y * 64]!
        if (f !== 0) grid.flag(x + ox, y + oy, f)
      }
    }
    for (const [x, y] of analysis.walkable) walkable.add(tileKey(x + ox, y + oy))
  }
  const reachable = floodFill(walkable, options.seedX, options.seedY, grid)
  if (reachable.size === 0) return { bounds: null, walkableTiles: null, collisionMap: null }
  return { bounds: boundsOf(reachable), walkableTiles: reachable, collisionMap: grid }
}
