/**
 * Adapter that exposes a scene's client-style collision map through the
 * engine's `CollisionQuery` / `PathFinder` interfaces (src/engine/Collision.ts).
 *
 * Coordinates are whatever space the CollisionMap is in (scene tiles); use
 * `offsetX`/`offsetY` to accept region-local or world tiles instead.
 */
import type { CollisionQuery, PathFinder, Tile } from '../engine/Collision'
import { CollisionFlag } from './CollisionFlag'
import type { CollisionMap } from './CollisionMap'
import { NORMAL_STRATEGY, type CollisionStrategy, type FlagSource } from './CollisionStrategy'
import { canStep, type StepOptions } from './NaivePathing'
import { Pathfinder, expandWaypoints } from './Pathfinder'
import { ExactRouteStrategy, RectangleRouteStrategy, type RouteStrategy } from './RouteStrategy'

export interface SceneCollisionOptions {
  /** Added to incoming x / y before reading the map (e.g. the scene border for region-local coordinates). */
  offsetX?: number
  offsetY?: number
  strategy?: CollisionStrategy
  /** Extra bits every step must avoid (e.g. CollisionFlag.BLOCK_NPCS). */
  customFlag?: number
  useRouteBlockerFlags?: boolean
  /** Pathfinder window (power of two, default 128). */
  graphSize?: number
}

const STAND_BLOCKED = CollisionFlag.OBJECT | CollisionFlag.FLOOR_BLOCKED

export class SceneCollision implements CollisionQuery, PathFinder {
  readonly map: CollisionMap
  readonly offsetX: number
  readonly offsetY: number
  private readonly flags: FlagSource
  private readonly stepOptions: StepOptions
  private readonly pathfinder: Pathfinder

  constructor(map: CollisionMap, options: SceneCollisionOptions = {}) {
    this.map = map
    this.offsetX = options.offsetX ?? 0
    this.offsetY = options.offsetY ?? 0
    const ox = this.offsetX
    const oy = this.offsetY
    this.flags = { getFlag: (x, y) => map.getFlag(x + ox, y + oy) }
    this.stepOptions = {
      strategy: options.strategy ?? NORMAL_STRATEGY,
      customFlag: options.customFlag ?? 0,
      useRouteBlockerFlags: options.useRouteBlockerFlags ?? false,
    }
    this.pathfinder = new Pathfinder(options.graphSize)
  }

  /** Flags at (x, y) in the adapter's coordinate space. */
  getFlag(x: number, y: number): number {
    return this.flags.getFlag(x, y)
  }

  canStand(x: number, y: number, size: number): boolean {
    const custom = this.stepOptions.customFlag ?? 0
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        const flag = this.flags.getFlag(x + dx, y + dy)
        if (flag === -1 || (flag & (STAND_BLOCKED | custom)) !== 0) return false
      }
    }
    return true
  }

  canStep(x: number, y: number, size: number, dx: number, dy: number): boolean {
    return canStep(this.flags, x, y, size, dx, dy, this.stepOptions)
  }

  hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean {
    return this.map.hasLineOfSight(fromX + this.offsetX, fromY + this.offsetY, toX + this.offsetX, toY + this.offsetY)
  }

  /** Line of sight between two square actors (south-west corner + size). */
  hasLineOfSightActors(ax: number, ay: number, aSize: number, bx: number, by: number, bSize: number): boolean {
    const ox = this.offsetX
    const oy = this.offsetY
    return this.map.hasLineOfSightArea(ax + ox, ay + oy, aSize, aSize, bx + ox, by + oy, bSize, bSize)
  }

  /**
   * Client pathfinding. `destSize` <= 1 walks onto the destination tile;
   * larger values walk up to (adjacent to) a destSize x destSize footprint
   * whose south-west tile is the destination. When the destination is
   * unreachable the closest reachable tile is used, like the client.
   */
  findPath(fromX: number, fromY: number, size: number, destX: number, destY: number, destSize = 1): Tile[] {
    const route: RouteStrategy =
      destSize <= 1
        ? new ExactRouteStrategy(destX, destY)
        : new RectangleRouteStrategy(this.flags, destX, destY, destSize, destSize, size)
    return this.findPathTo(fromX, fromY, size, route)
  }

  /** Path towards an arbitrary route strategy (e.g. a loc footprint with blocked sides). */
  findPathTo(fromX: number, fromY: number, size: number, route: RouteStrategy): Tile[] {
    const result = this.pathfinder.findPath(this.flags, fromX, fromY, size, 0, route, {
      ...this.stepOptions,
      findAlternative: true,
    })
    if (!result) return []
    return expandWaypoints(fromX, fromY, result.waypoints)
  }
}
