/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Breadth-first pathfinder over a graphSize x graphSize window centred on the
 * source tile, using OSRS collision semantics for movers of size 1, 2 and N.
 * When the destination is unreachable an "alternative" tile near the
 * destination is chosen exactly the way the client does.
 */
import { type CollisionStrategy, type FlagSource, NORMAL_STRATEGY } from './CollisionStrategy'
import { DirectionFlag } from './DirectionFlag'
import { canStep, type StepOptions } from './NaivePathing'
import type { RouteStrategy } from './RouteStrategy'

const DEFAULT_GRAPH_SIZE = 128
const DEFAULT_DISTANCE = 99999999
const ALTERNATIVE_ROUTE_MAX_DISTANCE = 100
const ALTERNATIVE_ROUTE_RANGE = 10

export interface Waypoint {
  x: number
  y: number
}

export interface PathResult {
  /** Turn points from the source (exclusive) to the end tile (inclusive), in walking order. */
  readonly waypoints: Waypoint[]
  /** Number of single-tile steps to the end tile. */
  readonly distance: number
  readonly endX: number
  readonly endY: number
  /** True when the destination was unreachable and a nearby tile was chosen instead. */
  readonly alternative: boolean
}

export interface FindPathOptions extends StepOptions {
  collision?: CollisionStrategy
  /** Accept a nearby tile when the destination is unreachable (client default true). */
  findAlternative?: boolean
}

export class Pathfinder {
  readonly graphSize: number
  private readonly directions: Int32Array
  private readonly distances: Int32Array
  private readonly clip: Int32Array
  private readonly queueSize: number
  private readonly bufferX: Int32Array
  private readonly bufferY: Int32Array
  private exitX = -1
  private exitY = -1

  constructor(graphSize: number = DEFAULT_GRAPH_SIZE) {
    if ((graphSize & (graphSize - 1)) !== 0) {
      throw new Error('Pathfinder graph size must be a power of two')
    }
    this.graphSize = graphSize
    this.directions = new Int32Array(graphSize * graphSize)
    this.distances = new Int32Array(graphSize * graphSize)
    this.clip = new Int32Array(graphSize * graphSize)
    this.queueSize = (graphSize * graphSize) / 4
    this.bufferX = new Int32Array(this.queueSize)
    this.bufferY = new Int32Array(this.queueSize)
  }

  private reset(): void {
    this.directions.fill(0)
    this.distances.fill(DEFAULT_DISTANCE)
  }

  /**
   * Find a path for a `srcSize` x `srcSize` mover from (srcX, srcY).
   * Coordinates are in the FlagSource's space (e.g. scene tiles).
   */
  findPath(
    flags: FlagSource,
    srcX: number,
    srcY: number,
    srcSize: number,
    plane: number,
    route: RouteStrategy,
    options: FindPathOptions = {},
  ): PathResult | null {
    const G = this.graphSize
    const half = G >> 1
    const graphBaseX = srcX - half
    const graphBaseY = srcY - half
    const findAlternative = options.findAlternative ?? true

    this.reset()
    // Snapshot the flags into the graph window (out of window = fully blocked).
    const clip = this.clip
    for (let gx = 0; gx < G; gx++) {
      for (let gy = 0; gy < G; gy++) {
        clip[gx * G + gy] = flags.getFlag(graphBaseX + gx, graphBaseY + gy)
      }
    }
    const clipSource: FlagSource = {
      getFlag: (gx, gy) => (gx < 0 || gy < 0 || gx >= G || gy >= G ? -1 : clip[gx * G + gy]!),
    }
    const stepOptions: StepOptions = {
      strategy: options.collision ?? options.strategy ?? NORMAL_STRATEGY,
      customFlag: options.customFlag ?? 0,
      useRouteBlockerFlags: options.useRouteBlockerFlags ?? false,
    }

    const found = this.search(clipSource, srcX, srcY, srcSize, plane, graphBaseX, graphBaseY, route, stepOptions)
    if (!found && !findAlternative) {
      return null
    }

    let endX = this.exitX
    let endY = this.exitY
    let alternative = false
    if (!found) {
      // Search the destination +- ALTERNATIVE_ROUTE_RANGE for the reachable tile
      // that is closest to the (sized) destination, preferring fewer steps on ties.
      let lowestCost = Number.MAX_SAFE_INTEGER
      let lowestDistance = Number.MAX_SAFE_INTEGER
      const approxDestX = route.approxDestX
      const approxDestY = route.approxDestY
      for (let checkX = approxDestX - ALTERNATIVE_ROUTE_RANGE; checkX <= approxDestX + ALTERNATIVE_ROUTE_RANGE; checkX++) {
        for (let checkY = approxDestY - ALTERNATIVE_ROUTE_RANGE; checkY <= approxDestY + ALTERNATIVE_ROUTE_RANGE; checkY++) {
          const gx = checkX - graphBaseX
          const gy = checkY - graphBaseY
          if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue
          const dist = this.distances[gx * G + gy]!
          if (dist >= ALTERNATIVE_ROUTE_MAX_DISTANCE) continue

          let deltaX: number
          let deltaY: number
          if (approxDestX <= checkX) {
            deltaX = 1 - approxDestX - (route.destSizeX - checkX)
          } else {
            deltaX = approxDestX - checkX
          }
          if (approxDestY <= checkY) {
            deltaY = 1 - approxDestY - (route.destSizeY - checkY)
          } else {
            deltaY = approxDestY - checkY
          }
          const cost = deltaX * deltaX + deltaY * deltaY
          if (cost < lowestCost || (cost <= lowestCost && dist < lowestDistance)) {
            lowestCost = cost
            lowestDistance = dist
            endX = checkX
            endY = checkY
          }
        }
      }
      if (lowestCost === Number.MAX_SAFE_INTEGER || lowestDistance === Number.MAX_SAFE_INTEGER) {
        return null
      }
      alternative = true
    }

    if (endX === srcX && endY === srcY) {
      return { waypoints: [], distance: 0, endX, endY, alternative }
    }

    // Trace back from the end tile, emitting a waypoint at every direction change.
    const reversed: Waypoint[] = []
    let traceX = endX
    let traceY = endY
    let direction = this.directions[(traceX - graphBaseX) * G + (traceY - graphBaseY)]!
    let lastDirection = direction
    reversed.push({ x: traceX, y: traceY })
    while (traceX !== srcX || traceY !== srcY) {
      if (lastDirection !== direction) {
        reversed.push({ x: traceX, y: traceY })
        lastDirection = direction
      }
      if ((direction & DirectionFlag.EAST) !== 0) traceX++
      else if ((direction & DirectionFlag.WEST) !== 0) traceX--
      if ((direction & DirectionFlag.NORTH) !== 0) traceY++
      else if ((direction & DirectionFlag.SOUTH) !== 0) traceY--
      direction = this.directions[(traceX - graphBaseX) * G + (traceY - graphBaseY)]!
    }
    reversed.reverse()

    return {
      waypoints: reversed,
      distance: this.distances[(endX - graphBaseX) * G + (endY - graphBaseY)]!,
      endX,
      endY,
      alternative,
    }
  }

  /** BFS in graph space. Sets exitX/exitY to the arrival tile (or the last tile visited). */
  private search(
    clip: FlagSource,
    srcX: number,
    srcY: number,
    size: number,
    plane: number,
    graphBaseX: number,
    graphBaseY: number,
    route: RouteStrategy,
    step: StepOptions,
  ): boolean {
    const G = this.graphSize
    const directions = this.directions
    const distances = this.distances
    const bufferX = this.bufferX
    const bufferY = this.bufferY
    const mask = this.queueSize - 1

    let currentX = srcX
    let currentY = srcY
    let gx = srcX - graphBaseX
    let gy = srcY - graphBaseY
    distances[gx * G + gy] = 0
    directions[gx * G + gy] = 99

    let read = 0
    let write = 0
    bufferX[write] = currentX
    bufferY[write] = currentY
    write = (write + 1) & mask

    // Direction the mover travels, and the back-pointer written on the new tile.
    const moves: ReadonlyArray<readonly [number, number, number]> = [
      [-1, 0, DirectionFlag.EAST],
      [1, 0, DirectionFlag.WEST],
      [0, -1, DirectionFlag.NORTH],
      [0, 1, DirectionFlag.SOUTH],
      [-1, -1, DirectionFlag.NORTH_EAST],
      [1, -1, DirectionFlag.NORTH_WEST],
      [-1, 1, DirectionFlag.SOUTH_EAST],
      [1, 1, DirectionFlag.SOUTH_WEST],
    ]

    while (read !== write) {
      currentX = bufferX[read]!
      currentY = bufferY[read]!
      read = (read + 1) & mask
      gx = currentX - graphBaseX
      gy = currentY - graphBaseY

      if (route.hasArrived(currentX, currentY, plane)) {
        this.exitX = currentX
        this.exitY = currentY
        return true
      }

      const nextDistance = distances[gx * G + gy]! + 1
      for (const [dx, dy, back] of moves) {
        const nx = gx + dx
        const ny = gy + dy
        // The mover's footprint (size x size) must stay inside the graph.
        if (nx < 0 || ny < 0 || nx > G - size || ny > G - size) continue
        const ni = nx * G + ny
        if (directions[ni] !== 0) continue
        if (!canStep(clip, gx, gy, size, dx, dy, step)) continue
        bufferX[write] = currentX + dx
        bufferY[write] = currentY + dy
        write = (write + 1) & mask
        directions[ni] = back
        distances[ni] = nextDistance
      }
    }

    this.exitX = currentX
    this.exitY = currentY
    return false
  }

  /** Step count recorded for a tile by the last search (DEFAULT_DISTANCE when unvisited). */
  distanceTo(srcX: number, srcY: number, x: number, y: number): number {
    const G = this.graphSize
    const gx = x - (srcX - (G >> 1))
    const gy = y - (srcY - (G >> 1))
    if (gx < 0 || gy < 0 || gx >= G || gy >= G) return DEFAULT_DISTANCE
    return this.distances[gx * G + gy]!
  }
}

/** Expand turn-point waypoints into every intermediate tile (queen moves). */
export function expandWaypoints(srcX: number, srcY: number, waypoints: readonly Waypoint[]): Waypoint[] {
  const steps: Waypoint[] = []
  let x = srcX
  let y = srcY
  for (const wp of waypoints) {
    while (x !== wp.x || y !== wp.y) {
      x += Math.sign(wp.x - x)
      y += Math.sign(wp.y - y)
      steps.push({ x, y })
    }
  }
  return steps
}
