/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Single-step movement checks shared by the BFS pathfinder and the "naive"
 * (dumb) pathing NPCs use: try the diagonal towards the target, then the
 * x-axis step, then the y-axis step.
 *
 * All checks read flags on the *destination* tiles of the mover's footprint
 * (a size x size square whose south-west corner is (x, y)).
 */
import { CollisionFlag } from './CollisionFlag'
import { NORMAL_STRATEGY, type CollisionStrategy, type FlagSource } from './CollisionStrategy'

const F = CollisionFlag

/** Mask set: movement flags (default) or the route-blocker family. */
export interface BlockMasks {
  W: number
  E: number
  S: number
  N: number
  SW: number
  SE: number
  NW: number
  NE: number
  N_SE: number
  N_SW: number
  NE_W: number
  SE_W: number
}

export const MOVEMENT_MASKS: BlockMasks = {
  W: F.BLOCK_WEST,
  E: F.BLOCK_EAST,
  S: F.BLOCK_SOUTH,
  N: F.BLOCK_NORTH,
  SW: F.BLOCK_SOUTH_WEST,
  SE: F.BLOCK_SOUTH_EAST,
  NW: F.BLOCK_NORTH_WEST,
  NE: F.BLOCK_NORTH_EAST,
  N_SE: F.BLOCK_NORTH_AND_SOUTH_EAST,
  N_SW: F.BLOCK_NORTH_AND_SOUTH_WEST,
  NE_W: F.BLOCK_NORTH_EAST_AND_WEST,
  SE_W: F.BLOCK_SOUTH_EAST_AND_WEST,
}

export const ROUTE_BLOCKER_MASKS: BlockMasks = {
  W: F.BLOCK_WEST_ROUTE_BLOCKER,
  E: F.BLOCK_EAST_ROUTE_BLOCKER,
  S: F.BLOCK_SOUTH_ROUTE_BLOCKER,
  N: F.BLOCK_NORTH_ROUTE_BLOCKER,
  SW: F.BLOCK_SOUTH_WEST_ROUTE_BLOCKER,
  SE: F.BLOCK_SOUTH_EAST_ROUTE_BLOCKER,
  NW: F.BLOCK_NORTH_WEST_ROUTE_BLOCKER,
  NE: F.BLOCK_NORTH_EAST_ROUTE_BLOCKER,
  N_SE: F.BLOCK_NORTH_AND_SOUTH_EAST_ROUTE_BLOCKER,
  N_SW: F.BLOCK_NORTH_AND_SOUTH_WEST_ROUTE_BLOCKER,
  NE_W: F.BLOCK_NORTH_EAST_AND_WEST_ROUTE_BLOCKER,
  SE_W: F.BLOCK_SOUTH_EAST_AND_WEST_ROUTE_BLOCKER,
}

export interface StepOptions {
  strategy?: CollisionStrategy
  /** Extra bits OR'd into every mask (e.g. CollisionFlag.BLOCK_NPCS). */
  customFlag?: number
  /** Use the route-blocker flag family instead of the movement family. */
  useRouteBlockerFlags?: boolean
}

/**
 * Can a mover of the given size at (x, y) move one tile by (dx, dy), each in
 * {-1, 0, 1}? Mirrors the client's per-direction checks for size 1 and size N.
 */
export function canStep(
  flags: FlagSource,
  x: number,
  y: number,
  size: number,
  dx: number,
  dy: number,
  options: StepOptions = {},
): boolean {
  const strategy = options.strategy ?? NORMAL_STRATEGY
  const c = options.customFlag ?? 0
  const m = options.useRouteBlockerFlags ? ROUTE_BLOCKER_MASKS : MOVEMENT_MASKS
  const can = (tx: number, ty: number, mask: number): boolean => strategy.canMove(flags.getFlag(tx, ty), mask | c)

  if (dx === 0 && dy === 0) return true

  if (size === 1) {
    if (dx === -1 && dy === 0) return can(x - 1, y, m.W)
    if (dx === 1 && dy === 0) return can(x + 1, y, m.E)
    if (dx === 0 && dy === -1) return can(x, y - 1, m.S)
    if (dx === 0 && dy === 1) return can(x, y + 1, m.N)
    if (dx === -1 && dy === -1) return can(x - 1, y - 1, m.SW) && can(x - 1, y, m.W) && can(x, y - 1, m.S)
    if (dx === 1 && dy === -1) return can(x + 1, y - 1, m.SE) && can(x + 1, y, m.E) && can(x, y - 1, m.S)
    if (dx === -1 && dy === 1) return can(x - 1, y + 1, m.NW) && can(x - 1, y, m.W) && can(x, y + 1, m.N)
    return can(x + 1, y + 1, m.NE) && can(x + 1, y, m.E) && can(x, y + 1, m.N)
  }

  const s = size
  if (dx === -1 && dy === 0) {
    if (!can(x - 1, y, m.SW) || !can(x - 1, y + s - 1, m.NW)) return false
    for (let i = 1; i < s - 1; i++) if (!can(x - 1, y + i, m.N_SW)) return false
    return true
  }
  if (dx === 1 && dy === 0) {
    if (!can(x + s, y, m.SE) || !can(x + s, y + s - 1, m.NE)) return false
    for (let i = 1; i < s - 1; i++) if (!can(x + s, y + i, m.N_SE)) return false
    return true
  }
  if (dx === 0 && dy === -1) {
    if (!can(x, y - 1, m.SW) || !can(x + s - 1, y - 1, m.SE)) return false
    for (let i = 1; i < s - 1; i++) if (!can(x + i, y - 1, m.NE_W)) return false
    return true
  }
  if (dx === 0 && dy === 1) {
    if (!can(x, y + s, m.NW) || !can(x + s - 1, y + s, m.NE)) return false
    for (let i = 1; i < s - 1; i++) if (!can(x + i, y + s, m.SE_W)) return false
    return true
  }
  if (dx === -1 && dy === -1) {
    if (!can(x - 1, y - 1, m.SW)) return false
    for (let i = 1; i < s; i++) {
      if (!can(x - 1, y + i - 1, m.N_SE) || !can(x + i - 1, y - 1, m.NE_W)) return false
    }
    return true
  }
  if (dx === 1 && dy === -1) {
    if (!can(x + s, y - 1, m.SE)) return false
    for (let i = 1; i < s; i++) {
      if (!can(x + s, y + i - 1, m.N_SW) || !can(x + i, y - 1, m.NE_W)) return false
    }
    return true
  }
  if (dx === -1 && dy === 1) {
    if (!can(x - 1, y + s, m.NW)) return false
    for (let i = 1; i < s; i++) {
      if (!can(x - 1, y + i, m.N_SE) || !can(x + i - 1, y + s, m.SE_W)) return false
    }
    return true
  }
  // north-east
  if (!can(x + s, y + s, m.NE)) return false
  for (let i = 1; i < s; i++) {
    if (!can(x + i, y + s, m.SE_W) || !can(x + s, y + i, m.N_SW)) return false
  }
  return true
}

export interface Step {
  x: number
  y: number
}

/**
 * One tick of "naive" NPC movement towards (destX, destY): prefer the
 * diagonal, then the horizontal step, then the vertical step. Returns the new
 * south-west tile or null when no step is possible.
 */
export function naiveStep(
  flags: FlagSource,
  x: number,
  y: number,
  size: number,
  destX: number,
  destY: number,
  options: StepOptions = {},
): Step | null {
  const dx = Math.sign(destX - x)
  const dy = Math.sign(destY - y)
  if (dx === 0 && dy === 0) return null
  if (dx !== 0 && dy !== 0 && canStep(flags, x, y, size, dx, dy, options)) {
    return { x: x + dx, y: y + dy }
  }
  if (dx !== 0 && canStep(flags, x, y, size, dx, 0, options)) {
    return { x: x + dx, y }
  }
  if (dy !== 0 && canStep(flags, x, y, size, 0, dy, options)) {
    return { x, y: y + dy }
  }
  return null
}
