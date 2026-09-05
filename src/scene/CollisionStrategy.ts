/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * How a mover interprets collision flags: normal walking, "blocked-only"
 * movement (e.g. entities that may only walk on FLOOR-flagged tiles), and
 * flying/projectile line-of-sight which uses the projectile-blocker bits.
 */
import { CollisionFlag } from './CollisionFlag'

/** Anything that can answer "what are the collision flags at (x, y)". */
export interface FlagSource {
  /** Flags at (x, y); out-of-range tiles should report -1 (all bits set). */
  getFlag(x: number, y: number): number
}

export interface CollisionStrategy {
  canMove(tileFlag: number, blockFlag: number): boolean
}

const BLOCK_MOVEMENT =
  CollisionFlag.WALL_NORTH_WEST |
  CollisionFlag.WALL_NORTH |
  CollisionFlag.WALL_NORTH_EAST |
  CollisionFlag.WALL_EAST |
  CollisionFlag.WALL_SOUTH_EAST |
  CollisionFlag.WALL_SOUTH |
  CollisionFlag.WALL_SOUTH_WEST |
  CollisionFlag.WALL_WEST |
  CollisionFlag.OBJECT

const BLOCK_ROUTE =
  CollisionFlag.WALL_NORTH_WEST_ROUTE_BLOCKER |
  CollisionFlag.WALL_NORTH_ROUTE_BLOCKER |
  CollisionFlag.WALL_NORTH_EAST_ROUTE_BLOCKER |
  CollisionFlag.WALL_EAST_ROUTE_BLOCKER |
  CollisionFlag.WALL_SOUTH_EAST_ROUTE_BLOCKER |
  CollisionFlag.WALL_SOUTH_ROUTE_BLOCKER |
  CollisionFlag.WALL_SOUTH_WEST_ROUTE_BLOCKER |
  CollisionFlag.WALL_WEST_ROUTE_BLOCKER |
  CollisionFlag.OBJECT_ROUTE_BLOCKER

/** Standard walking: any blocking bit in the mask forbids the move. */
export const NORMAL_STRATEGY: CollisionStrategy = {
  canMove(tileFlag, blockFlag) {
    return (tileFlag & blockFlag) === 0
  },
}

/** Only tiles flagged FLOOR are walkable (inverse of normal for the floor bit). */
export const BLOCKED_STRATEGY: CollisionStrategy = {
  canMove(tileFlag, blockFlag) {
    const flag = blockFlag & ~CollisionFlag.FLOOR
    return (tileFlag & flag) === 0 && (tileFlag & CollisionFlag.FLOOR) !== 0
  },
}

/** Projectile / flying movement: tests the projectile-blocker bits instead. */
export const FLY_STRATEGY: CollisionStrategy = {
  canMove(tileFlag, blockFlag) {
    const movementFlags = (blockFlag & BLOCK_MOVEMENT) << 9
    const routeFlags = (blockFlag & BLOCK_ROUTE) >> 13
    return (tileFlag & (movementFlags | routeFlags)) === 0
  },
}

/** A FlagSource restricted to a rectangle (everything outside reads as blocked). */
export function boundedFlags(source: FlagSource, minX: number, minY: number, maxX: number, maxY: number): FlagSource {
  return {
    getFlag(x, y) {
      if (x < minX || y < minY || x > maxX || y > maxY) return -1
      return source.getFlag(x, y)
    },
  }
}
