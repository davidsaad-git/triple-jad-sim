/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Per-plane collision flags over a scene-sized grid (flat Int32Array, index =
 * x + y * sizeX). Walls flag both the tile they sit on and the tile on the
 * far side of the wall, exactly like the client.
 */
import { CollisionFlag } from './CollisionFlag'
import { LocModelType } from './LocModelType'

export class CollisionMap {
  readonly sizeX: number
  readonly sizeY: number
  readonly flags: Int32Array

  constructor(sizeX: number, sizeY: number, flags?: Int32Array) {
    this.sizeX = sizeX
    this.sizeY = sizeY
    this.flags = flags ?? new Int32Array(sizeX * sizeY)
  }

  isWithinBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY
  }

  /** Flags at (x, y); tiles outside the map read as fully blocked. */
  getFlag(x: number, y: number): number {
    if (!this.isWithinBounds(x, y)) return -1
    return this.flags[x + y * this.sizeX]!
  }

  hasFlag(x: number, y: number, flag: number): boolean {
    return (this.getFlag(x, y) & flag) !== 0
  }

  setFlag(x: number, y: number, flag: number): void {
    if (this.isWithinBounds(x, y)) this.flags[x + y * this.sizeX] = flag
  }

  flag(x: number, y: number, flag: number): void {
    if (!this.isWithinBounds(x, y)) return
    const i = x + y * this.sizeX
    this.flags[i] = this.flags[i]! | flag
  }

  unflag(x: number, y: number, flag: number): void {
    if (!this.isWithinBounds(x, y)) return
    const i = x + y * this.sizeX
    this.flags[i] = this.flags[i]! & ~flag
  }

  /** Tile blocked by its terrain settings (TileFlag.Blocked). */
  setBlockedByFloor(x: number, y: number): void {
    this.flag(x, y, CollisionFlag.FLOOR)
  }

  /** Tile blocked by a floor decoration with interactType 1. */
  setBlockedByFloorDec(x: number, y: number): void {
    this.flag(x, y, CollisionFlag.FLOOR_DECORATION)
  }

  private static locFlags(blockProjectile: boolean, breakRouteFinding: boolean): number {
    let flag = CollisionFlag.OBJECT
    if (blockProjectile) flag |= CollisionFlag.OBJECT_PROJECTILE_BLOCKER
    if (!breakRouteFinding) flag |= CollisionFlag.OBJECT_ROUTE_BLOCKER
    return flag
  }

  /**
   * Block a sizeX x sizeY footprint (sizes already swapped for rotation).
   * `breakRouteFinding` (loc config opcode 27 / interactType 1) leaves the
   * OBJECT_ROUTE_BLOCKER bit clear so "route blocker" pathing may pass through.
   */
  addLoc(x: number, y: number, sizeX: number, sizeY: number, blockProjectile: boolean, breakRouteFinding = false): void {
    const flag = CollisionMap.locFlags(blockProjectile, breakRouteFinding)
    for (let fx = x; fx < x + sizeX; fx++) {
      for (let fy = y; fy < y + sizeY; fy++) {
        this.flag(fx, fy, flag)
      }
    }
  }

  removeLoc(x: number, y: number, sizeX: number, sizeY: number, blockProjectile: boolean, breakRouteFinding = false): void {
    const flag = CollisionMap.locFlags(blockProjectile, breakRouteFinding)
    for (let fx = x; fx < x + sizeX; fx++) {
      for (let fy = y; fy < y + sizeY; fy++) {
        this.unflag(fx, fy, flag)
      }
    }
  }

  /** Add wall flags for a wall-type loc (types 0..3). */
  addWall(x: number, y: number, type: number, rotation: number, blockProjectile: boolean, breakRouteFinding = false): void {
    const apply = (tx: number, ty: number, f: number): void => this.flag(tx, ty, f)
    this.applyWall(x, y, type, rotation, 0, apply)
    if (blockProjectile) this.applyWall(x, y, type, rotation, 9, apply)
    if (!breakRouteFinding) this.applyWall(x, y, type, rotation, 22, apply)
  }

  removeWall(x: number, y: number, type: number, rotation: number, blockProjectile: boolean, breakRouteFinding = false): void {
    const apply = (tx: number, ty: number, f: number): void => this.unflag(tx, ty, f)
    this.applyWall(x, y, type, rotation, 0, apply)
    if (blockProjectile) this.applyWall(x, y, type, rotation, 9, apply)
    if (!breakRouteFinding) this.applyWall(x, y, type, rotation, 22, apply)
  }

  /**
   * @param s bit shift selecting the flag family: 0 = movement, 9 = projectile
   *          blockers, 22 = route blockers (all three share the same layout).
   */
  private applyWall(
    x: number,
    y: number,
    type: number,
    rotation: number,
    s: number,
    apply: (x: number, y: number, flag: number) => void,
  ): void {
    const NW = CollisionFlag.WALL_NORTH_WEST << s
    const N = CollisionFlag.WALL_NORTH << s
    const NE = CollisionFlag.WALL_NORTH_EAST << s
    const E = CollisionFlag.WALL_EAST << s
    const SE = CollisionFlag.WALL_SOUTH_EAST << s
    const S = CollisionFlag.WALL_SOUTH << s
    const SW = CollisionFlag.WALL_SOUTH_WEST << s
    const W = CollisionFlag.WALL_WEST << s

    if (type === LocModelType.Wall) {
      if (rotation === 0) {
        apply(x, y, W)
        apply(x - 1, y, E)
      } else if (rotation === 1) {
        apply(x, y, N)
        apply(x, y + 1, S)
      } else if (rotation === 2) {
        apply(x, y, E)
        apply(x + 1, y, W)
      } else if (rotation === 3) {
        apply(x, y, S)
        apply(x, y - 1, N)
      }
    } else if (type === LocModelType.WallTriCorner || type === LocModelType.WallRectCorner) {
      if (rotation === 0) {
        apply(x, y, NW)
        apply(x - 1, y + 1, SE)
      } else if (rotation === 1) {
        apply(x, y, NE)
        apply(x + 1, y + 1, SW)
      } else if (rotation === 2) {
        apply(x, y, SE)
        apply(x + 1, y - 1, NW)
      } else if (rotation === 3) {
        apply(x, y, SW)
        apply(x - 1, y - 1, NE)
      }
    } else if (type === LocModelType.WallCorner) {
      if (rotation === 0) {
        apply(x, y, W | N)
        apply(x - 1, y, E)
        apply(x, y + 1, S)
      } else if (rotation === 1) {
        apply(x, y, N | E)
        apply(x, y + 1, S)
        apply(x + 1, y, W)
      } else if (rotation === 2) {
        apply(x, y, E | S)
        apply(x + 1, y, W)
        apply(x, y - 1, N)
      } else if (rotation === 3) {
        apply(x, y, S | W)
        apply(x, y - 1, N)
        apply(x - 1, y, E)
      }
    }
  }

  /**
   * Tile-to-tile line of sight, following RuneLite's `WorldArea.hasLineOfSightTo`
   * (the algorithm the Inferno plugins use): step along the major axis with a
   * 16.16 fixed-point minor coordinate, testing the projectile-blocker flags of
   * each tile entered (the wall on the side we enter from, plus full blockers),
   * and, when the minor coordinate crosses a tile boundary, the tile entered
   * sideways as well. Tiles outside the map count as blocked.
   */
  hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean {
    if (fromX === toX && fromY === toY) return true

    const dx = toX - fromX
    const dy = toY - fromY
    const dxAbs = Math.abs(dx)
    const dyAbs = Math.abs(dy)

    let xFlags: number = CollisionFlag.OBJECT_PROJECTILE_BLOCKER
    let yFlags: number = CollisionFlag.OBJECT_PROJECTILE_BLOCKER
    if (dx < 0) xFlags |= CollisionFlag.WALL_EAST_PROJECTILE_BLOCKER
    else xFlags |= CollisionFlag.WALL_WEST_PROJECTILE_BLOCKER
    if (dy < 0) yFlags |= CollisionFlag.WALL_NORTH_PROJECTILE_BLOCKER
    else yFlags |= CollisionFlag.WALL_SOUTH_PROJECTILE_BLOCKER

    if (dxAbs > dyAbs) {
      let x = fromX
      let yBig = fromY << 16
      const slope = ((dy << 16) / dxAbs) | 0
      yBig += 0x8000
      if (dy < 0) yBig--
      const direction = dx < 0 ? -1 : 1
      while (x !== toX) {
        x += direction
        const y = yBig >>> 16
        if ((this.getFlag(x, y) & xFlags) !== 0) return false
        yBig += slope
        const nextY = yBig >>> 16
        if (nextY !== y && (this.getFlag(x, nextY) & yFlags) !== 0) return false
      }
    } else {
      let y = fromY
      let xBig = fromX << 16
      const slope = ((dx << 16) / dyAbs) | 0
      xBig += 0x8000
      if (dx < 0) xBig--
      const direction = dy < 0 ? -1 : 1
      while (y !== toY) {
        y += direction
        const x = xBig >>> 16
        if ((this.getFlag(x, y) & yFlags) !== 0) return false
        xBig += slope
        const nextX = xBig >>> 16
        if (nextX !== x && (this.getFlag(nextX, y) & xFlags) !== 0) return false
      }
    }
    return true
  }

  /**
   * Line of sight between two rectangular areas (south-west corner + size),
   * using RuneLite's "comparison point" rule: each area is represented by the
   * tile of its footprint closest to the other area.
   */
  hasLineOfSightArea(
    ax: number,
    ay: number,
    aSizeX: number,
    aSizeY: number,
    bx: number,
    by: number,
    bSizeX: number,
    bSizeY: number,
  ): boolean {
    const p1x = comparisonCoord(ax, aSizeX, bx)
    const p1y = comparisonCoord(ay, aSizeY, by)
    const p2x = comparisonCoord(bx, bSizeX, ax)
    const p2y = comparisonCoord(by, bSizeY, ay)
    return this.hasLineOfSight(p1x, p1y, p2x, p2y)
  }
}

/** Coordinate of the tile in [base, base+size) nearest to `other` (RuneLite `getComparisonPoint`). */
function comparisonCoord(base: number, size: number, other: number): number {
  if (other <= base) return base
  if (other >= base + size) return base + size - 1
  return other
}
