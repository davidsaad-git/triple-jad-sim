/**
 * Reach, range and line of sight (scim:, `zx`,
 *, `qx`).
 */
import type { Tile } from '../api'
import type { Arena } from './Arena'
import { Flag } from './collisionFlags'

export type MeleeReach = 'cardinal' | 'diagonal'

/** scim: Chebyshev distance from a point to a square footprint (0 inside). */
export function distanceToBox(px: number, py: number, bx: number, by: number, size: number): number {
  const maxX = bx + size - 1
  const maxY = by + size - 1
  const dx = px < bx ? bx - px : px > maxX ? px - maxX : 0
  const dy = py < by ? by - py : py > maxY ? py - maxY : 0
  return Math.max(dx, dy)
}

/** scim: projectile block mask for the direction of travel. */
function projectileMask(dx: number, dy: number): number {
  return dx === 1
    ? Flag.BLOCK_EAST_PROJECTILE
    : dx === -1
      ? Flag.BLOCK_WEST_PROJECTILE
      : dy === 1
        ? Flag.BLOCK_NORTH_PROJECTILE
        : Flag.BLOCK_SOUTH_PROJECTILE
}

/**
 * scim: 16.16 fixed-point projectile line from (x0,y0) to (x1,y1). True
 * with no collision map or for the same tile; a tile outside the map blocks.
 */
export function lineOfSight(arena: Arena, x0: number, y0: number, x1: number, y1: number): boolean {
  const map = arena.collision
  if (!map || (x0 === x1 && y0 === y1)) return true
  const dx = x1 - x0
  const dy = y1 - y0
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  const clear = (x: number, y: number, mx: number, my: number): boolean => {
    const f = map.getFlag(x, y)
    return f !== -1 && (f & projectileMask(mx, my)) === 0
  }
  if (adx > ady) {
    let fy = (y0 << 16) + 32768
    const slope = adx === 0 ? 0 : Math.floor((ady << 16) / adx)
    if (sy < 0) fy -= 1
    let x = x0
    while (x !== x1) {
      x += sx
      const ty = fy >> 16
      if (!clear(x, ty, sx, 0)) return false
      fy += slope * sy
      const ny = fy >> 16
      if (ny !== ty && !clear(x, ny, 0, sy)) return false
    }
    return true
  }
  let fx = (x0 << 16) + 32768
  const slope = Math.floor((adx << 16) / ady)
  if (sx < 0) fx -= 1
  let y = y0
  while (y !== y1) {
    y += sy
    const tx = fx >> 16
    if (!clear(tx, y, 0, sy)) return false
    fx += slope * sx
    const nx = fx >> 16
    if (nx !== tx && !clear(nx, y, sx, 0)) return false
  }
  return true
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * scim: is there a wall between two cardinal neighbours? Only WALL_*
 * movement flags count; no collision map (or a tile outside it) means no wall.
 */
export function wallBetween(arena: Arena, x0: number, y0: number, x1: number, y1: number): boolean {
  const map = arena.collision
  if (!map) return false
  const dx = x1 - x0
  const dy = y1 - y0
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false
  const a = map.getFlag(x0, y0)
  const b = map.getFlag(x1, y1)
  if (a === -1 || b === -1) return false
  if (dx === 1) return (a & Flag.WALL_EAST) !== 0 || (b & Flag.WALL_WEST) !== 0
  if (dx === -1) return (a & Flag.WALL_WEST) !== 0 || (b & Flag.WALL_EAST) !== 0
  if (dy === 1) return (a & Flag.WALL_NORTH) !== 0 || (b & Flag.WALL_SOUTH) !== 0
  return (a & Flag.WALL_SOUTH) !== 0 || (b & Flag.WALL_NORTH) !== 0
}

/**
 * scim: can box A (ax1..ax2, ay1..ay2) reach box B within `range`?
 * See for the rules.
 */
export function canReachBoxes(
  arena: Arena,
  ax1: number,
  ay1: number,
  ax2: number,
  ay2: number,
  bx1: number,
  by1: number,
  bx2: number,
  by2: number,
  range: number,
  checkCollision: boolean,
  reach: MeleeReach = 'cardinal',
): boolean {
  const gapX = ax2 < bx1 ? bx1 - ax2 : bx2 < ax1 ? ax1 - bx2 : 0
  const gapY = ay2 < by1 ? by1 - ay2 : by2 < ay1 ? ay1 - by2 : 0
  if (Math.max(gapX, gapY) > range || (range <= 1 && reach === 'cardinal' && gapX > 0 && gapY > 0)) return false
  if (!checkCollision) return true
  if (range > 1 || reach === 'diagonal') {
    return lineOfSight(arena, clamp(bx1, ax1, ax2), clamp(by1, ay1, ay2), clamp(ax1, bx1, bx2), clamp(ay1, by1, by2))
  }
  if (gapX === 0 && gapY === 0) return true
  if (ax2 < bx1 || bx2 < ax1) {
    const fromX = ax2 < bx1 ? ax2 : ax1
    const toX = ax2 < bx1 ? bx1 : bx2
    const lo = Math.max(ay1, by1)
    const hi = Math.min(ay2, by2)
    for (let y = lo; y <= hi; y++) if (!wallBetween(arena, fromX, y, toX, y)) return true
    return false
  }
  const fromY = ay2 < by1 ? ay2 : ay1
  const toY = ay2 < by1 ? by1 : by2
  const lo = Math.max(ax1, bx1)
  const hi = Math.min(ax2, bx2)
  for (let x = lo; x <= hi; x++) if (!wallBetween(arena, x, fromY, x, toY)) return true
  return false
}

/** scim: 1x1 tile (px,py) vs an NPC box, with collision. */
export function tileCanReachNpc(arena: Arena, px: number, py: number, npcX: number, npcY: number, size: number, range: number): boolean {
  const s = Math.max(1, size)
  return canReachBoxes(arena, px, py, px, py, npcX, npcY, npcX + s - 1, npcY + s - 1, range, true)
}

export interface Rect {
  readonly southWest: Tile
  readonly width: number
  readonly height: number
}


export function rectReach(
  arena: Arena,
  a: Rect,
  b: Rect,
  opts: { attackRange: number; checkCollision?: boolean; meleeReach?: MeleeReach | undefined },
): boolean {
  const aw = Math.max(1, Math.trunc(a.width))
  const ah = Math.max(1, Math.trunc(a.height))
  const bw = Math.max(1, Math.trunc(b.width))
  const bh = Math.max(1, Math.trunc(b.height))
  return canReachBoxes(
    arena,
    a.southWest[0],
    a.southWest[1],
    a.southWest[0] + aw - 1,
    a.southWest[1] + ah - 1,
    b.southWest[0],
    b.southWest[1],
    b.southWest[0] + bw - 1,
    b.southWest[1] + bh - 1,
    opts.attackRange,
    opts.checkCollision ?? false,
    opts.meleeReach ?? 'cardinal',
  )
}

/** scim: player tile vs NPC box within range (collision optional). */
export function playerInRange(arena: Arena, p: Tile, npcPos: Tile, size: number, range: number, collide = false): boolean {
  const s = Math.max(1, size)
  return canReachBoxes(arena, p[0], p[1], p[0], p[1], npcPos[0], npcPos[1], npcPos[0] + s - 1, npcPos[1] + s - 1, range, collide)
}

/** scim: point inside a square footprint. */
export function pointInBox(px: number, py: number, bx: number, by: number, size: number): boolean {
  return px >= bx && px <= bx + size - 1 && py >= by && py <= by + size - 1
}


export function tileInsideNpc(p: Tile, npcPos: Tile, size: number): boolean {
  return pointInBox(p[0], p[1], npcPos[0], npcPos[1], size)
}
