/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Destination tests for the pathfinder. `ExactRouteStrategy` requires landing
 * on the tile; `RectangleRouteStrategy` is the client's "reach rectangle"
 * used to walk up to an NPC / loc footprint (arrive on any adjacent tile whose
 * shared edge has no wall).
 */
import { CollisionFlag } from './CollisionFlag'
import type { FlagSource } from './CollisionStrategy'

export interface RouteStrategy {
  /** Tile the alternative-route search aims for when the exact target is unreachable. */
  readonly approxDestX: number
  readonly approxDestY: number
  readonly destSizeX: number
  readonly destSizeY: number
  hasArrived(tileX: number, tileY: number, plane: number): boolean
}

export class ExactRouteStrategy implements RouteStrategy {
  readonly approxDestX: number
  readonly approxDestY: number
  readonly destSizeX = 1
  readonly destSizeY = 1

  constructor(destX: number, destY: number) {
    this.approxDestX = destX
    this.approxDestY = destY
  }

  hasArrived(tileX: number, tileY: number): boolean {
    return tileX === this.approxDestX && tileY === this.approxDestY
  }
}

/** Bits of `blockAccessFlags`: sides of the target that may not be approached from. */
export const BlockAccess = {
  North: 0x1,
  East: 0x2,
  South: 0x4,
  West: 0x8,
} as const

/**
 * Arrive adjacent to (or overlapping) a destWidth x destHeight rectangle with
 * a srcSize x srcSize mover. Wall flags on the mover's edge tiles are checked
 * so a fence between the two blocks arrival.
 */
export class RectangleRouteStrategy implements RouteStrategy {
  readonly approxDestX: number
  readonly approxDestY: number
  readonly destSizeX: number
  readonly destSizeY: number
  readonly srcSize: number
  readonly blockAccessFlags: number
  private readonly flags: FlagSource

  constructor(
    flags: FlagSource,
    destX: number,
    destY: number,
    destWidth: number,
    destHeight: number,
    srcSize = 1,
    blockAccessFlags = 0,
  ) {
    this.flags = flags
    this.approxDestX = destX
    this.approxDestY = destY
    this.destSizeX = destWidth
    this.destSizeY = destHeight
    this.srcSize = srcSize
    this.blockAccessFlags = blockAccessFlags
  }

  hasArrived(srcX: number, srcY: number): boolean {
    const size = this.srcSize
    const destX = this.approxDestX
    const destY = this.approxDestY
    const destEast = destX + this.destSizeX - 1
    const destNorth = destY + this.destSizeY - 1
    const srcEast = srcX + size - 1
    const srcNorth = srcY + size - 1
    const access = this.blockAccessFlags

    // Overlapping the target counts as reached.
    if (srcX <= destEast && srcEast >= destX && srcY <= destNorth && srcNorth >= destY) {
      return true
    }

    const yOverlap = srcY <= destNorth && srcNorth >= destY
    const xOverlap = srcX <= destEast && srcEast >= destX

    if (srcEast === destX - 1 && yOverlap && (access & BlockAccess.West) === 0) {
      const y0 = Math.max(srcY, destY)
      const y1 = Math.min(srcNorth, destNorth)
      let ok = true
      for (let y = y0; y <= y1; y++) {
        if ((this.flags.getFlag(srcEast, y) & CollisionFlag.WALL_EAST) !== 0) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
    if (srcX === destEast + 1 && yOverlap && (access & BlockAccess.East) === 0) {
      const y0 = Math.max(srcY, destY)
      const y1 = Math.min(srcNorth, destNorth)
      let ok = true
      for (let y = y0; y <= y1; y++) {
        if ((this.flags.getFlag(srcX, y) & CollisionFlag.WALL_WEST) !== 0) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
    if (srcNorth === destY - 1 && xOverlap && (access & BlockAccess.South) === 0) {
      const x0 = Math.max(srcX, destX)
      const x1 = Math.min(srcEast, destEast)
      let ok = true
      for (let x = x0; x <= x1; x++) {
        if ((this.flags.getFlag(x, srcNorth) & CollisionFlag.WALL_NORTH) !== 0) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
    if (srcY === destNorth + 1 && xOverlap && (access & BlockAccess.North) === 0) {
      const x0 = Math.max(srcX, destX)
      const x1 = Math.min(srcEast, destEast)
      let ok = true
      for (let x = x0; x <= x1; x++) {
        if ((this.flags.getFlag(x, srcY) & CollisionFlag.WALL_SOUTH) !== 0) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
    return false
  }
}
