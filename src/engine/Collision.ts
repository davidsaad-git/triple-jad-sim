/**
 * What the engine needs from the scene's collision map. The scene layer
 * provides an implementation backed by client collision flags; tests can use
 * a simple grid.
 */
export interface Tile {
  x: number
  y: number
}

export interface CollisionQuery {
  /** True when an actor of the given size with its south-west corner at (x, y) can stand there. */
  canStand(x: number, y: number, size: number): boolean
  /** True when an actor of `size` at (x, y) can step by (dx, dy) in {-1, 0, 1}. */
  canStep(x: number, y: number, size: number, dx: number, dy: number): boolean
  /** Tile-to-tile line of sight for projectiles and ranged attacks. */
  hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean
}

export interface PathFinder {
  /**
   * Path for an actor of `size` from its current SW corner to a destination.
   * Returns the list of tiles to move through (excluding the start), or an
   * empty list when already there / unreachable (the client walks as close as
   * possible; implementations should mimic that).
   */
  findPath(fromX: number, fromY: number, size: number, destX: number, destY: number, destSize?: number): Tile[]
}

/** Chebyshev distance between two tiles. */
export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by))
}

/**
 * Distance from a point-sized actor to the nearest tile of an actor of `size`
 * whose SW corner is at (bx, by). Used for "in range" checks.
 */
export function distanceToActor(ax: number, ay: number, bx: number, by: number, size: number): number {
  const dx = ax < bx ? bx - ax : ax >= bx + size ? ax - (bx + size - 1) : 0
  const dy = ay < by ? by - ay : ay >= by + size ? ay - (by + size - 1) : 0
  return Math.max(dx, dy)
}

/** True when the 1x1 actor at (ax, ay) is orthogonally adjacent (not diagonal) to the actor at (bx, by) of `size`. */
export function isAdjacentOrthogonal(ax: number, ay: number, bx: number, by: number, size: number): boolean {
  const inX = ax >= bx && ax < bx + size
  const inY = ay >= by && ay < by + size
  if (inX && (ay === by - 1 || ay === by + size)) return true
  if (inY && (ax === bx - 1 || ax === bx + size)) return true
  return false
}

/** True when within 1 tile including diagonals. */
export function isAdjacent(ax: number, ay: number, bx: number, by: number, size: number): boolean {
  return distanceToActor(ax, ay, bx, by, size) === 1
}
