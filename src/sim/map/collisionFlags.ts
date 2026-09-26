/**
 * Collision flag layout. Same bits as the OSRS
 * client; the composite BLOCK_* masks describe which flags on the destination
 * tile forbid entering it while moving in the named direction.
 */
const WALL_NORTH_WEST = 0x1
const WALL_NORTH = 0x2
const WALL_NORTH_EAST = 0x4
const WALL_EAST = 0x8
const WALL_SOUTH_EAST = 0x10
const WALL_SOUTH = 0x20
const WALL_SOUTH_WEST = 0x40
const WALL_WEST = 0x80
const OBJECT = 0x100
const WALL_NORTH_WEST_PROJECTILE_BLOCKER = 0x200
const WALL_NORTH_PROJECTILE_BLOCKER = 0x400
const WALL_NORTH_EAST_PROJECTILE_BLOCKER = 0x800
const WALL_EAST_PROJECTILE_BLOCKER = 0x1000
const WALL_SOUTH_EAST_PROJECTILE_BLOCKER = 0x2000
const WALL_SOUTH_PROJECTILE_BLOCKER = 0x4000
const WALL_SOUTH_WEST_PROJECTILE_BLOCKER = 0x8000
const WALL_WEST_PROJECTILE_BLOCKER = 0x10000
const OBJECT_PROJECTILE_BLOCKER = 0x20000
const FLOOR_DECORATION = 0x40000
const FLOOR = 0x200000
const FLOOR_BLOCKED = FLOOR | FLOOR_DECORATION

export const Flag = {
  WALL_NORTH_WEST,
  WALL_NORTH,
  WALL_NORTH_EAST,
  WALL_EAST,
  WALL_SOUTH_EAST,
  WALL_SOUTH,
  WALL_SOUTH_WEST,
  WALL_WEST,
  OBJECT,
  WALL_NORTH_WEST_PROJECTILE_BLOCKER,
  WALL_NORTH_PROJECTILE_BLOCKER,
  WALL_NORTH_EAST_PROJECTILE_BLOCKER,
  WALL_EAST_PROJECTILE_BLOCKER,
  WALL_SOUTH_EAST_PROJECTILE_BLOCKER,
  WALL_SOUTH_PROJECTILE_BLOCKER,
  WALL_SOUTH_WEST_PROJECTILE_BLOCKER,
  WALL_WEST_PROJECTILE_BLOCKER,
  OBJECT_PROJECTILE_BLOCKER,
  FLOOR_DECORATION,
  FLOOR,
  FLOOR_BLOCKED,

  BLOCK_WEST: WALL_EAST | OBJECT | FLOOR_BLOCKED,
  BLOCK_EAST: WALL_WEST | OBJECT | FLOOR_BLOCKED,
  BLOCK_SOUTH: WALL_NORTH | OBJECT | FLOOR_BLOCKED,
  BLOCK_NORTH: WALL_SOUTH | OBJECT | FLOOR_BLOCKED,
  BLOCK_SOUTH_WEST: WALL_NORTH | WALL_NORTH_EAST | WALL_EAST | OBJECT | FLOOR_BLOCKED,
  BLOCK_SOUTH_EAST: WALL_NORTH_WEST | WALL_NORTH | WALL_WEST | OBJECT | FLOOR_BLOCKED,
  BLOCK_NORTH_WEST: WALL_EAST | WALL_SOUTH_EAST | WALL_SOUTH | OBJECT | FLOOR_BLOCKED,
  BLOCK_NORTH_EAST: WALL_SOUTH | WALL_SOUTH_WEST | WALL_WEST | OBJECT | FLOOR_BLOCKED,
  BLOCK_NORTH_AND_SOUTH_EAST:
    WALL_NORTH | WALL_NORTH_EAST | WALL_EAST | WALL_SOUTH_EAST | WALL_SOUTH | OBJECT | FLOOR_BLOCKED,
  BLOCK_NORTH_AND_SOUTH_WEST:
    WALL_NORTH_WEST | WALL_NORTH | WALL_SOUTH | WALL_SOUTH_WEST | WALL_WEST | OBJECT | FLOOR_BLOCKED,
  BLOCK_NORTH_EAST_AND_WEST:
    WALL_NORTH_WEST | WALL_NORTH | WALL_NORTH_EAST | WALL_EAST | WALL_WEST | OBJECT | FLOOR_BLOCKED,
  BLOCK_SOUTH_EAST_AND_WEST:
    WALL_EAST | WALL_SOUTH_EAST | WALL_SOUTH | WALL_SOUTH_WEST | WALL_WEST | OBJECT | FLOOR_BLOCKED,

  BLOCK_WEST_PROJECTILE: WALL_EAST_PROJECTILE_BLOCKER | OBJECT_PROJECTILE_BLOCKER,
  BLOCK_EAST_PROJECTILE: WALL_WEST_PROJECTILE_BLOCKER | OBJECT_PROJECTILE_BLOCKER,
  BLOCK_SOUTH_PROJECTILE: WALL_NORTH_PROJECTILE_BLOCKER | OBJECT_PROJECTILE_BLOCKER,
  BLOCK_NORTH_PROJECTILE: WALL_SOUTH_PROJECTILE_BLOCKER | OBJECT_PROJECTILE_BLOCKER,
} as const

/** Collision grid over an arbitrary tile window; `getFlag` returns -1 outside it. */
export interface CollisionGrid {
  readonly originX: number
  readonly originY: number
  readonly sizeX: number
  readonly sizeY: number
  readonly flags: Int32Array
  getFlag(x: number, y: number): number
  /** False outside the grid (a -1 read never matches). */
  hasFlag(x: number, y: number, mask: number): boolean
  flag(x: number, y: number, mask: number): void
}

/**
 * A grid whose tile (originX, originY) is index 0. scim uses a 64x64 grid per
 * map square and a (2r+1)*64 square centred on the arena square for the
 * merged map (origin -64 for r = 1).
 */
export function createCollisionGrid(originX: number, originY: number, sizeX: number, sizeY: number): CollisionGrid {
  const flags = new Int32Array(sizeX * sizeY)
  const index = (x: number, y: number): number => {
    const lx = x - originX
    const ly = y - originY
    return lx >= 0 && lx < sizeX && ly >= 0 && ly < sizeY ? lx + ly * sizeX : -1
  }
  return {
    originX,
    originY,
    sizeX,
    sizeY,
    flags,
    getFlag(x, y) {
      const i = index(x, y)
      return i < 0 ? -1 : flags[i]!
    },
    hasFlag(x, y, mask) {
      const i = index(x, y)
      return i >= 0 && (flags[i]! & mask) !== 0
    },
    flag(x, y, mask) {
      const i = index(x, y)
      if (i >= 0) flags[i] = flags[i]! | mask
    },
  }
}
