/**
 * Player pathfinding (scim: `SY` findPath, `CY` backtrack
 * findPathToReach, `DY` takeSteps, `AY`/`MY` step toward a tile, `NY`
 * step toward an NPC/`OY` no-collision fallbacks).
 */
import type { Tile } from '../api'
import type { Arena } from './Arena'
import { Flag } from './collisionFlags'
import { pointInBox, tileCanReachNpc } from './reach'

/** BFS neighbour order W, E, S, N, SW, SE, NW, NE. */
const DIRS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]
const VIA_W = 2
const VIA_E = 8
const VIA_S = 1
const VIA_N = 4
const VIA_START = 99
/** Via codes stored for each direction. */
const VIA_CODES = [VIA_W, VIA_E, VIA_S, VIA_N, 3, 9, 6, 12]
const CARDINAL_BLOCK = [Flag.BLOCK_WEST, Flag.BLOCK_EAST, Flag.BLOCK_SOUTH, Flag.BLOCK_NORTH]
const DIAGONAL_BLOCK: readonly (readonly [number, number, number])[] = [
  [Flag.BLOCK_SOUTH_WEST, Flag.BLOCK_WEST, Flag.BLOCK_SOUTH],
  [Flag.BLOCK_SOUTH_EAST, Flag.BLOCK_EAST, Flag.BLOCK_SOUTH],
  [Flag.BLOCK_NORTH_WEST, Flag.BLOCK_WEST, Flag.BLOCK_NORTH],
  [Flag.BLOCK_NORTH_EAST, Flag.BLOCK_EAST, Flag.BLOCK_NORTH],
]
const ALT_RADIUS = 10
const ALT_MAX_COST = 100
const UNVISITED_COST = 99999999
const GRID = 128
const QUEUE_SIZE = 16384

export interface StepResult {
  position: Tile
  stepTiles: Tile[]
}

type GoalTest = (x: number, y: number) => boolean

interface BfsResult {
  via: Int32Array
  cost: Int32Array
  baseX: number
  baseY: number
  found: boolean
  endX: number
  endY: number
}

function bfs(arena: Arena, start: Tile, goal: GoalTest): BfsResult {
  const [sx, sy] = start
  const baseX = sx - 64
  const baseY = sy - 64
  const via = new Int32Array(GRID * GRID)
  const cost = new Int32Array(GRID * GRID).fill(UNVISITED_COST)
  const qx = new Int32Array(QUEUE_SIZE)
  const qy = new Int32Array(QUEUE_SIZE)
  const mask = QUEUE_SIZE - 1
  via[64 * GRID + 64] = VIA_START
  cost[64 * GRID + 64] = 0
  let tail = 0
  let head = 0
  qx[tail] = sx
  qy[tail] = sy
  tail = (tail + 1) & mask
  let found = false
  let endX = sx
  let endY = sy
  const map = arena.collision
  while (head !== tail) {
    const cx = qx[head]!
    const cy = qy[head]!
    head = (head + 1) & mask
    if (goal(cx, cy)) {
      endX = cx
      endY = cy
      found = true
      break
    }
    const nextCost = cost[(cx - baseX) * GRID + (cy - baseY)]! + 1
    for (let d = 0; d < 8; d++) {
      const [dx, dy] = DIRS[d]!
      const nx = cx + dx
      const ny = cy + dy
      const gx = nx - baseX
      const gy = ny - baseY
      if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) continue
      const gi = gx * GRID + gy
      if (via[gi] !== 0 || !arena.isWalkable(nx, ny)) continue
      let blocked = false
      if (map) {
        if (d < 4) blocked = map.hasFlag(nx, ny, CARDINAL_BLOCK[d]!)
        else {
          const [corner, horizontal, vertical] = DIAGONAL_BLOCK[d - 4]!
          blocked = map.hasFlag(nx, ny, corner) || map.hasFlag(cx + dx, cy, horizontal) || map.hasFlag(cx, cy + dy, vertical)
        }
      }
      if (blocked) continue
      via[gi] = VIA_CODES[d]!
      cost[gi] = nextCost
      qx[tail] = nx
      qy[tail] = ny
      tail = (tail + 1) & mask
    }
  }
  return { via, cost, baseX, baseY, found, endX, endY }
}

/** scim: backtrack from the end to the start; tiles after the start in walking order. */
function backtrack(r: BfsResult, startX: number, startY: number, endX: number, endY: number): Tile[] {
  const out: Tile[] = []
  let x = endX
  let y = endY
  while (x !== startX || y !== startY) {
    out.push([x, y])
    const code = r.via[(x - r.baseX) * GRID + (y - r.baseY)]!
    if (code === 0 || code === VIA_START) break
    if ((code & VIA_W) !== 0) x++
    else if ((code & VIA_E) !== 0) x--
    if ((code & VIA_S) !== 0) y++
    else if ((code & VIA_N) !== 0) y--
  }
  out.reverse()
  return out
}

/** scim: BFS path to `dest`, with the "alternative route" fallback. */
export function findPath(arena: Arena, start: Tile, dest: Tile): Tile[] {
  const [sx, sy] = start
  const [dx, dy] = dest
  if (sx === dx && sy === dy) return []
  const r = bfs(arena, start, (x, y) => x === dx && y === dy)
  let endX = r.endX
  let endY = r.endY
  if (!r.found) {
    let bestDist = Infinity
    let bestCost = Infinity
    for (let x = dx - ALT_RADIUS; x <= dx + ALT_RADIUS; x++) {
      for (let y = dy - ALT_RADIUS; y <= dy + ALT_RADIUS; y++) {
        const gx = x - r.baseX
        const gy = y - r.baseY
        if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue
        const c = r.cost[gx * GRID + gy]!
        if (c >= ALT_MAX_COST) continue
        const ddx = Math.abs(x - dx)
        const ddy = Math.abs(y - dy)
        const dist = ddx * ddx + ddy * ddy
        if (dist < bestDist || (dist === bestDist && c < bestCost)) {
          bestDist = dist
          bestCost = c
          endX = x
          endY = y
        }
      }
    }
    if (bestDist === Infinity) return []
  }
  return endX === sx && endY === sy ? [] : backtrack(r, sx, sy, endX, endY)
}

/**
 * scim: BFS path to a tile that can reach the NPC box within `range`
 * (cardinal, walls) and, when `excludeInside`, is not inside the box.
 */
export function findPathToReach(arena: Arena, start: Tile, npcPos: Tile, size: number, range: number, excludeInside = false): Tile[] {
  const [sx, sy] = start
  const goal: GoalTest = (x, y) =>
    tileCanReachNpc(arena, x, y, npcPos[0], npcPos[1], size, range) &&
    (!excludeInside || !pointInBox(x, y, npcPos[0], npcPos[1], size))
  if (goal(sx, sy)) return []
  const r = bfs(arena, start, goal)
  let endX = r.endX
  let endY = r.endY
  if (!r.found) {
    const maxX = npcPos[0] + size - 1
    const maxY = npcPos[1] + size - 1
    let bestDist = Infinity
    let bestCost = Infinity
    const radius = ALT_RADIUS + size + range
    for (let x = npcPos[0] - radius; x <= maxX + radius; x++) {
      for (let y = npcPos[1] - radius; y <= maxY + radius; y++) {
        const gx = x - r.baseX
        const gy = y - r.baseY
        if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue
        const c = r.cost[gx * GRID + gy]!
        if (c >= ALT_MAX_COST) continue
        const ddx = x < npcPos[0] ? npcPos[0] - x : x > maxX ? x - maxX : 0
        const ddy = y < npcPos[1] ? npcPos[1] - y : y > maxY ? y - maxY : 0
        const dist = ddx * ddx + ddy * ddy
        if (dist < bestDist || (dist === bestDist && c < bestCost)) {
          bestDist = dist
          bestCost = c
          endX = x
          endY = y
        }
      }
    }
    if (bestDist === Infinity) return []
  }
  return endX === sx && endY === sy ? [] : backtrack(r, sx, sy, endX, endY)
}

/** scim: take 1 (walk) or 2 (run) steps; a running 2nd step must end Chebyshev 2 from the start. */
export function takeSteps(start: Tile, path: readonly Tile[], running: boolean): StepResult {
  if (path.length === 0) return { position: [start[0], start[1]], stepTiles: [] }
  const maxSteps = running ? 2 : 1
  const steps: Tile[] = []
  for (let i = 0; i < Math.min(maxSteps, path.length); i++) {
    const [x, y] = path[i]!
    if (i === 1 && running && Math.max(Math.abs(x - start[0]), Math.abs(y - start[1])) !== 2) break
    steps.push([x, y])
  }
  const last = steps[steps.length - 1]
  return { position: last ? [last[0], last[1]] : [start[0], start[1]], stepTiles: steps }
}

/** scim: unit steps for a clamped delta (straight part first, then diagonal). */
function unitSteps(dx: number, dy: number): [number, number][] {
  if (dx === 0 && dy === 0) return []
  const out: [number, number][] = []
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  const straight = Math.abs(ax - ay)
  const diag = Math.min(ax, ay)
  if (ax > ay) for (let i = 0; i < straight; i++) out.push([sx, 0])
  else if (ay > ax) for (let i = 0; i < straight; i++) out.push([0, sy])
  for (let i = 0; i < diag; i++) out.push([sx, sy])
  return out
}

/** scim: clamp a delta to a 2-tile running move. */
function clampRunDelta(dx: number, dy: number): [number, number] {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  const m = Math.max(ax, ay)
  if (m <= 2) return [dx, dy]
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  if (m <= 4) {
    let major = ax
    let minor = ay
    let smaj = sx
    let smin = sy
    let swapped = false
    if (minor > major) {
      ;[major, minor] = [minor, major]
      ;[smaj, smin] = [smin, smaj]
      swapped = true
    }
    let a: number
    let b: number
    if (minor <= 1) {
      a = 2
      b = 0
    } else if (minor === 2) {
      if (major === 3) {
        a = 2
        b = 1
      } else {
        a = 2
        b = 0
      }
    } else if (major === minor) {
      a = 2
      b = 2
    } else if (major === minor + 1) {
      a = 2
      b = 1
    } else {
      a = 2
      b = 0
    }
    let rx = smaj * a
    let ry = smin * b
    if (swapped) [rx, ry] = [ry, rx]
    return [rx, ry]
  }
  const diff = Math.abs(ax - ay)
  if (diff >= 2) return ax > ay ? [sx * 2, 0] : [0, sy * 2]
  if (diff === 1) return ax > ay ? [sx * 2, sy * 1] : [sx * 1, sy * 2]
  return [sx * 2, sy * 2]
}

/** scim: movement without any collision data. */
function stepWithoutCollision(arena: Arena, start: Tile, dest: Tile, running: boolean): StepResult {
  const steps: Tile[] = []
  let [x, y] = start
  const [tx, ty] = dest
  if (x !== tx || y !== ty) {
    const dx = tx - x
    const dy = ty - y
    if (running) {
      const [cx, cy] = clampRunDelta(dx, dy)
      for (const [ux, uy] of unitSteps(cx, cy)) {
        const nx = x + ux
        const ny = y + uy
        if (!arena.isWalkable(nx, ny)) break
        x = nx
        y = ny
        steps.push([x, y])
      }
    } else {
      const nx = x + Math.sign(dx)
      const ny = y + Math.sign(dy)
      if (arena.isWalkable(nx, ny)) {
        x = nx
        y = ny
        steps.push([x, y])
      }
    }
  }
  const last = steps[steps.length - 1]
  return { position: last ? [last[0], last[1]] : [start[0], start[1]], stepTiles: steps }
}

/** scim: one tick of movement toward a clicked tile. */
export function stepToward(arena: Arena, start: Tile, dest: Tile, running = true): StepResult {
  if (arena.collision !== null || arena.walkableTiles !== null) return takeSteps(start, findPath(arena, start, dest), running)
  return stepWithoutCollision(arena, start, dest, running)
}

/** scim: one tick of movement toward an NPC (approach to melee reach). */
export function stepTowardNpc(arena: Arena, start: Tile, npcPos: Tile, size: number, running = true): StepResult {
  if (arena.collision !== null || arena.walkableTiles !== null) {
    return takeSteps(start, findPathToReach(arena, start, npcPos, size, 1, true), running)
  }
  const minX = npcPos[0]
  const minY = npcPos[1]
  const maxX = npcPos[0] + size - 1
  const maxY = npcPos[1] + size - 1
  let cx = Math.max(minX - 1, Math.min(start[0], minX + size))
  let cy = Math.max(minY - 1, Math.min(start[1], minY + size))
  if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
    const west = cx - minX
    const east = maxX - cx
    const south = cy - minY
    const north = maxY - cy
    const m = Math.min(west, east, south, north)
    if (m === west) cx = minX - 1
    else if (m === east) cx = maxX + 1
    else cy = m === south ? minY - 1 : maxY + 1
  }
  const gx = cx < minX ? minX - cx : cx > maxX ? cx - maxX : 0
  const gy = cy < minY ? minY - cy : cy > maxY ? cy - maxY : 0
  if (gx > 0 && gy > 0) {
    const a: Tile = [cx, cy < minY ? minY : maxY]
    const b: Tile = [cx < minX ? minX : maxX, cy]
    const da = Math.abs(start[0] - a[0]) + Math.abs(start[1] - a[1])
    const db = Math.abs(start[0] - b[0]) + Math.abs(start[1] - b[1])
    ;[cx, cy] = da <= db ? a : b
  }
  return stepToward(arena, start, [cx, cy], running)
}
