/**
 * NPC movement primitives:
 * size-N step legality `SE`, actor occupancy `sse`/`ose`, generic chase
 * with approach tile `OD`, point-follow `kse`, and the bound/attack-block
 * helpers.
 */
import type { Tile } from '../api'
import type { RandomFn } from '../core/rng'
import type { Actor, NpcActor, PlayerActor } from '../core/types'
import type { WorldState } from '../core/WorldState'
import type { Arena } from './Arena'
import { Flag } from './collisionFlags'
import { pointInBox, rectReach, tileInsideNpc } from './reach'

interface EdgeMasks {
  single: number
  start: number
  middle: number
  end: number
}
interface DiagonalMasks {
  corner: number
  horizontalStrip: number
  verticalStrip: number
  xIntermediate: number
  yIntermediate: number
}

const WEST: EdgeMasks = { single: Flag.BLOCK_WEST, start: Flag.BLOCK_SOUTH_WEST, middle: Flag.BLOCK_NORTH_AND_SOUTH_EAST, end: Flag.BLOCK_NORTH_WEST }
const EAST: EdgeMasks = { single: Flag.BLOCK_EAST, start: Flag.BLOCK_SOUTH_EAST, middle: Flag.BLOCK_NORTH_AND_SOUTH_WEST, end: Flag.BLOCK_NORTH_EAST }
const SOUTH: EdgeMasks = { single: Flag.BLOCK_SOUTH, start: Flag.BLOCK_SOUTH_WEST, middle: Flag.BLOCK_NORTH_EAST_AND_WEST, end: Flag.BLOCK_SOUTH_EAST }
const NORTH: EdgeMasks = { single: Flag.BLOCK_NORTH, start: Flag.BLOCK_NORTH_WEST, middle: Flag.BLOCK_SOUTH_EAST_AND_WEST, end: Flag.BLOCK_NORTH_EAST }
const SW: DiagonalMasks = { corner: Flag.BLOCK_SOUTH_WEST, horizontalStrip: Flag.BLOCK_NORTH_EAST_AND_WEST, verticalStrip: Flag.BLOCK_NORTH_AND_SOUTH_EAST, xIntermediate: Flag.BLOCK_WEST, yIntermediate: Flag.BLOCK_SOUTH }
const NW: DiagonalMasks = { corner: Flag.BLOCK_NORTH_WEST, horizontalStrip: Flag.BLOCK_SOUTH_EAST_AND_WEST, verticalStrip: Flag.BLOCK_NORTH_AND_SOUTH_EAST, xIntermediate: Flag.BLOCK_WEST, yIntermediate: Flag.BLOCK_NORTH }
const SE_: DiagonalMasks = { corner: Flag.BLOCK_SOUTH_EAST, horizontalStrip: Flag.BLOCK_NORTH_EAST_AND_WEST, verticalStrip: Flag.BLOCK_NORTH_AND_SOUTH_WEST, xIntermediate: Flag.BLOCK_EAST, yIntermediate: Flag.BLOCK_SOUTH }
const NE: DiagonalMasks = { corner: Flag.BLOCK_NORTH_EAST, horizontalStrip: Flag.BLOCK_SOUTH_EAST_AND_WEST, verticalStrip: Flag.BLOCK_NORTH_AND_SOUTH_WEST, xIntermediate: Flag.BLOCK_EAST, yIntermediate: Flag.BLOCK_NORTH }

function edgeMasks(dx: number, dy: number): EdgeMasks | null {
  if (dx === -1 && dy === 0) return WEST
  if (dx === 1 && dy === 0) return EAST
  if (dx === 0 && dy === -1) return SOUTH
  if (dx === 0 && dy === 1) return NORTH
  return null
}

function diagonalMasks(dx: number, dy: number): DiagonalMasks | null {
  if (dx === -1 && dy === -1) return SW
  if (dx === -1 && dy === 1) return NW
  if (dx === 1 && dy === -1) return SE_
  if (dx === 1 && dy === 1) return NE
  return null
}

/** scim: footprint at `to` inside the arena bounds (true without bounds). */
function footprintInBounds(arena: Arena, to: Tile, width: number, height: number): boolean {
  const b = arena.bounds
  return !b || (to[0] >= b.minX && to[1] >= b.minY && to[0] + width - 1 <= b.maxX && to[1] + height - 1 <= b.maxY)
}

/** scim: the leading edge of the moved footprint is walkable and unflagged. */
function cardinalEdgeClear(arena: Arena, sw: Tile, width: number, height: number, dx: number, dy: number): boolean {
  const masks = edgeMasks(dx, dy)
  if (!masks) return false
  const horizontal = dy === 0
  const length = horizontal ? height : width
  const startX = dx === 1 ? sw[0] + width - 1 : sw[0]
  const startY = dy === 1 ? sw[1] + height - 1 : sw[1]
  const map = arena.collision
  for (let i = 0; i < length; i++) {
    const x = startX + (horizontal ? 0 : i)
    const y = startY + (horizontal ? i : 0)
    if (!arena.isWalkable(x, y)) return false
    const mask = length === 1 ? masks.single : i === 0 ? masks.start : i === length - 1 ? masks.end : masks.middle
    if (map?.hasFlag(x, y, mask)) return false
  }
  return true
}

/** scim: diagonal step for a 1x1 or NxN footprint. */
function diagonalClear(arena: Arena, from: Tile, sw: Tile, width: number, height: number, dx: number, dy: number): boolean {
  const masks = diagonalMasks(dx, dy)
  if (!masks) return false
  const map = arena.collision
  const ok = (x: number, y: number, mask: number): boolean => arena.isWalkable(x, y) && !map?.hasFlag(x, y, mask)
  if (width === 1 && height === 1) {
    return ok(sw[0], sw[1], masks.corner) && ok(from[0] + dx, from[1], masks.xIntermediate) && ok(from[0], from[1] + dy, masks.yIntermediate)
  }
  const cx = dx > 0 ? sw[0] + width - 1 : sw[0]
  const cy = dy > 0 ? sw[1] + height - 1 : sw[1]
  if (!ok(cx, cy, masks.corner)) return false
  for (let i = 1; i < width; i++) if (!ok(cx - dx * i, cy, masks.horizontalStrip)) return false
  for (let i = 1; i < height; i++) if (!ok(cx, cy - dy * i, masks.verticalStrip)) return false
  return true
}

/** scim: may a width x height NPC step from `from` to `to` (one tile, any direction)? */
export function canNpcStep(arena: Arena, from: Tile, to: Tile, width: number, height: number): boolean {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) return false
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  if ((dx === 0 && dy === 0) || Math.abs(dx) > 1 || Math.abs(dy) > 1 || !footprintInBounds(arena, to, width, height)) return false
  if (dx !== 0 && dy !== 0) return diagonalClear(arena, from, to, width, height, dx, dy)
  if (dx !== 0 && !cardinalEdgeClear(arena, to, width, height, dx, 0)) return false
  if (dy !== 0 && !cardinalEdgeClear(arena, to, width, height, 0, dy)) return false
  return true
}

/** scim: footprints overlap. */
export function boxesOverlap(a: { position: Tile; size: number }, b: { position: Tile; size: number }): boolean {
  return (
    a.position[0] < b.position[0] + b.size &&
    a.position[0] + a.size > b.position[0] &&
    a.position[1] < b.position[1] + b.size &&
    a.position[1] + a.size > b.position[1]
  )
}

export type StepCheck = (from: Tile, to: Tile, size: number) => boolean

/** scim: the new leading row/column must not enter any other alive actor (player included). */
export function blockedByActorsCheck(moverId: string, actors: readonly Actor[]): StepCheck {
  return (from, to, size) => {
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    if ((dx === 0 && dy === 0) || Math.abs(dx) > 1 || Math.abs(dy) > 1) return false
    const free = (x: number, y: number): boolean =>
      !actors.some((a) => a.id !== moverId && a.alive && pointInBox(x, y, a.position[0], a.position[1], a.size))
    if (dx !== 0) {
      const x = dx > 0 ? to[0] + size - 1 : to[0]
      for (let i = 0; i < size; i++) if (!free(x, to[1] + i)) return false
    }
    if (dy !== 0) {
      const y = dy > 0 ? to[1] + size - 1 : to[1]
      for (let i = 0; i < size; i++) if (!free(to[0] + i, y)) return false
    }
    return size === 1 && dx !== 0 && dy !== 0 ? free(to[0], from[1]) && free(from[0], to[1]) : true
  }
}

/** scim: the moved footprint (and diagonal intermediates) must not overlap a blocking NPC. */
export function blockedByNpcsCheck(moverId: string, npcs: readonly NpcActor[], blocksNpc: (npc: NpcActor) => boolean): StepCheck {
  return (from, to, size) => {
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    if ((dx === 0 && dy === 0) || Math.abs(dx) > 1 || Math.abs(dy) > 1) return false
    const moved = { position: to, size }
    for (const npc of npcs) {
      if (npc.id === moverId || !blocksNpc(npc)) continue
      if (boxesOverlap(moved, npc)) return false
      if (dx !== 0 && dy !== 0) {
        if (boxesOverlap({ position: [to[0], from[1]], size }, npc) || boxesOverlap({ position: [from[0], to[1]], size }, npc)) return false
      }
    }
    return true
  }
}

/** scim: bound (frozen) this tick. */
export function isBound(npc: NpcActor, tick: number): boolean {
  const d = npc.debuffs
  return d?.boundUntilTick !== undefined && tick >= (d.boundFromTick ?? 0) && tick < d.boundUntilTick
}

/** scim: within the freeze-immunity window (bound until + 5). */
export function isFreezeImmune(npc: NpcActor, tick: number): boolean {
  const until = npc.debuffs?.boundUntilTick
  return until !== undefined && tick < until + 5
}

/** scim: the player may attack this NPC now. */
export function isAttackable(npc: NpcActor, tick: number): boolean {
  return npc.attackBlockedUntilTick === undefined || tick >= npc.attackBlockedUntilTick
}

/** scim: movement vetoed (bound, or the attacking player stands inside the NPC). */
export function npcMovementVetoed(npc: NpcActor, player: PlayerActor | null, tick: number): boolean {
  return (
    isBound(npc, tick) ||
    (player !== null && player.attackTarget === npc.id && player.attackInteractionActive && tileInsideNpc(player.position, npc.position, npc.size))
  )
}

/** scim: in range with line of sight and not overlapping. */
export function npcInReach(arena: Arena, npc: NpcActor, target: Actor, range: number): boolean {
  if (range <= 0 || boxesOverlap(npc, target)) return false
  return rectReach(
    arena,
    { southWest: target.position, width: target.size, height: target.size },
    { southWest: npc.position, width: npc.size, height: npc.size },
    { attackRange: range, checkCollision: true, meleeReach: npc.combat.meleeReach },
  )
}

/** scim: cardinal melee reach with walls. */
export function cardinalMeleeReach(arena: Arena, a: { position: Tile; size: number }, b: { position: Tile; size: number }): boolean {
  return rectReach(
    arena,
    { southWest: a.position, width: a.size, height: a.size },
    { southWest: b.position, width: b.size, height: b.size },
    { attackRange: 1, checkCollision: true },
  )
}

/** scim: the tile on the target's near side the chaser walks toward. */
export function approachTile(npc: { position: Tile; size: number }, target: { position: Tile; size: number }): Tile {
  const N = npc.size
  const T = target.size
  const dx = npc.position[0] - target.position[0]
  const dy = npc.position[1] - target.position[1]
  const s = dx + dy
  const d = dx - dy
  const [tx, ty] = target.position
  const west = d < 0
  const northish = s >= T - N
  const east = d > 0
  const southish = s <= T - N
  if (west && !northish) {
    const off = s >= -N ? Math.min(s + N, T - 1) : d > -N ? -(N + d) : 0
    return [tx - N, ty + off]
  }
  if (northish && !east) {
    const off = d >= -T ? Math.min(d + T, T - 1) : s < T ? Math.max(s - T, -(N - 1)) : 0
    return [tx + off, ty + T]
  }
  if (east && !southish) {
    const off = d <= T ? T - d : s < T ? Math.max(s - T, -(N - 1)) : 0
    return [tx + T, ty + off]
  }
  const off = s > -N ? Math.min(s + N, T - 1) : d < N ? Math.max(d - N, -(N - 1)) : 0
  return [tx + off, ty - N]
}

export interface NpcMove {
  npcId: string
  path: Tile[]
}

export interface ChaseContext {
  tick: number
  world: WorldState
  random: RandomFn
  arena: Arena
}

/** scim: the default one-tile chase step. */
export function genericChase(npc: NpcActor, ctx: ChaseContext): NpcMove[] {
  if (!npc.alive || (npc.spawnTick !== undefined && npc.spawnTick > ctx.tick) || npc.combat.attackRange <= 0) return []
  const target = npc.combat.targetId === null ? undefined : ctx.world.actors.get(npc.combat.targetId)
  if (!target?.alive || npcMovementVetoed(npc, ctx.world.getPlayer(), ctx.tick)) return []
  const overlapping = boxesOverlap(npc, target)
  if (!overlapping && npcInReach(ctx.arena, npc, target, npc.combat.attackRange)) return []
  const actorsCheck = blockedByActorsCheck(npc.id, [...ctx.world.actors.values()])
  const canStep = (to: Tile): boolean =>
    canNpcStep(ctx.arena, npc.position, to, npc.size, npc.size) && (npc.passThruNpcs === true || actorsCheck(npc.position, to, npc.size))
  if (overlapping) {
    const r = ctx.random()
    const dir: Tile = r < 0.25 ? [0, -1] : r < 0.5 ? [0, 1] : r < 0.75 ? [-1, 0] : [1, 0]
    const to: Tile = [npc.position[0] + dir[0], npc.position[1] + dir[1]]
    return canStep(to) ? [{ npcId: npc.id, path: [to] }] : []
  }
  const goal = approachTile(npc, target)
  const sx = Math.sign(goal[0] - npc.position[0])
  const sy = Math.sign(goal[1] - npc.position[1])
  const candidates: Tile[] = [
    [npc.position[0] + sx, npc.position[1] + sy],
    [npc.position[0] + sx, npc.position[1]],
    [npc.position[0], npc.position[1] + sy],
  ]
  const step = candidates.find(canStep)
  return step ? [{ npcId: npc.id, path: [step] }] : []
}

/** scim: walk one tile toward a point until it is within Manhattan 1 of the footprint. */
export function stepTowardPoint(
  arena: Arena,
  npc: NpcActor,
  goal: Tile,
  opts: { canOccupy: (t: Tile, size: number) => boolean; canStep?: StepCheck },
): NpcMove[] {
  if (!npc.alive) return []
  const [px, py] = npc.position
  const size = npc.size
  const dx = goal[0] - Math.max(px, Math.min(goal[0], px + size - 1))
  const dy = goal[1] - Math.max(py, Math.min(goal[1], py + size - 1))
  if (Math.abs(dx) + Math.abs(dy) <= 1) return []
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  const candidates: Tile[] = []
  if (sx !== 0 && sy !== 0) candidates.push([px + sx, py + sy])
  if (sx !== 0) candidates.push([px + sx, py])
  if (sy !== 0) candidates.push([px, py + sy])
  for (const c of candidates) {
    if (
      !pointInBox(goal[0], goal[1], c[0], c[1], size) &&
      opts.canOccupy(c, size) &&
      canNpcStep(arena, npc.position, c, size, size) &&
      opts.canStep?.(npc.position, c, size) !== false
    ) {
      return [{ npcId: npc.id, path: [c] }]
    }
  }
  return []
}
