import { describe, expect, it } from 'vitest'
import type { Tile } from '../api'
import { Arena, tileKey } from './Arena'
import { boundsOf, floodFill } from './buildArena'
import { createCollisionGrid, Flag } from './collisionFlags'
import { angleFromDelta, angleTowardActor, faceExact, facePlayerToward } from './facing'
import { approachTile, blockedByActorsCheck, canNpcStep } from './npcMovement'
import { findPath, stepToward, stepTowardNpc, takeSteps } from './pathfinding'
import { canReachBoxes, distanceToBox, lineOfSight, playerInRange } from './reach'

/** Open square arena x/y in [lo, hi] with optional blocked (OBJECT) tiles. */
function makeArena(lo = 0, hi = 30, blocked: Tile[] = []): Arena {
  const grid = createCollisionGrid(-64, -64, 192, 192)
  const walkable = new Set<number>()
  for (let x = lo; x <= hi; x++) for (let y = lo; y <= hi; y++) walkable.add(tileKey(x, y))
  for (const [x, y] of blocked) {
    grid.flag(x, y, Flag.OBJECT | Flag.OBJECT_PROJECTILE_BLOCKER)
    walkable.delete(tileKey(x, y))
  }
  return new Arena({ bounds: boundsOf(walkable), walkableTiles: walkable, collisionMap: grid }, false)
}

describe('player pathfinding', () => {
  const arena = makeArena()
  it('straight path: one tile walking, two running', () => {
    expect(findPath(arena, [5, 5], [5, 9])).toEqual([
      [5, 6],
      [5, 7],
      [5, 8],
      [5, 9],
    ])
    expect(stepToward(arena, [5, 5], [5, 9], false).position).toEqual([5, 6])
    expect(stepToward(arena, [5, 5], [5, 9], true)).toEqual({
      position: [5, 7],
      stepTiles: [
        [5, 6],
        [5, 7],
      ],
    })
  })
  it('BFS neighbour order W,E,S,N,SW,SE,NW,NE: cardinal neighbours are expanded first', () => {
    expect(findPath(arena, [5, 5], [8, 7])).toEqual([
      [6, 5],
      [7, 6],
      [8, 7],
    ])
  })
  it('running second step must be Chebyshev 2 from the start (no L-shaped run)', () => {
    expect(takeSteps([5, 5], [
      [6, 6],
      [7, 6],
    ], true).position).toEqual([7, 6])
    expect(takeSteps([5, 5], [
      [6, 5],
      [6, 6],
    ], true)).toEqual({ position: [6, 5], stepTiles: [[6, 5]] })
  })
  it('walks around a blocker', () => {
    const a = makeArena(0, 30, [
      [6, 5],
      [6, 6],
      [6, 4],
    ])
    const path = findPath(a, [5, 5], [7, 5])
    expect(path.at(-1)).toEqual([7, 5])
    for (const [x, y] of path) expect(a.isWalkable(x, y)).toBe(true)
  })
  it('unreachable destination falls back to the closest reachable tile', () => {
    const a = makeArena(0, 10)
    const path = findPath(a, [5, 5], [15, 5])
    expect(path.at(-1)).toEqual([10, 5])
  })
  it('approach path to an NPC stops at cardinal melee reach', () => {
    const r = stepTowardNpc(arena, [5, 5], [10, 10], 5, false)
    expect(r.stepTiles).toHaveLength(1)
    let pos: Tile = [5, 5]
    for (let i = 0; i < 20; i++) pos = stepTowardNpc(arena, pos, [10, 10], 5, true).position
    expect(distanceToBox(pos[0], pos[1], 10, 10, 5)).toBe(1)
    const dx = pos[0] < 10 || pos[0] > 14
    const dy = pos[1] < 10 || pos[1] > 14
    expect(dx && dy).toBe(false)
  })
})

describe('reach and line of sight', () => {
  const arena = makeArena(0, 30, [[10, 5]])
  it('an object blocks the projectile line', () => {
    expect(lineOfSight(arena, 5, 5, 15, 5)).toBe(false)
    expect(lineOfSight(arena, 5, 6, 15, 6)).toBe(true)
  })
  it('melee reach is cardinal only', () => {
    expect(canReachBoxes(arena, 4, 4, 4, 4, 5, 5, 9, 9, 1, true)).toBe(false)
    expect(canReachBoxes(arena, 4, 5, 4, 5, 5, 5, 9, 9, 1, true)).toBe(true)
  })
  it('player range check to a 5x5 box', () => {
    expect(playerInRange(arena, [20, 20], [21, 10], 5, 10, true)).toBe(true)
    expect(playerInRange(arena, [20, 26], [21, 10], 5, 10, true)).toBe(false)
  })
})

describe('NPC steps', () => {
  const arena = makeArena(0, 30)
  it('a 5x5 footprint must stay inside the bounds', () => {
    expect(canNpcStep(arena, [25, 10], [26, 10], 5, 5)).toBe(true)
    expect(canNpcStep(arena, [26, 10], [27, 10], 5, 5)).toBe(false)
  })
  it('diagonal needs the leading corner and strips clear', () => {
    const a = makeArena(0, 30, [[15, 15]])
    expect(canNpcStep(a, [10, 10], [11, 11], 5, 5)).toBe(false)
    expect(canNpcStep(a, [9, 9], [10, 10], 5, 5)).toBe(true)
  })
  it('actors block the leading edge', () => {
    const check = blockedByActorsCheck('npc', [
      { id: 'player', alive: true, position: [16, 12], size: 1 } as never,
    ])
    expect(check([11, 10], [12, 10], 5)).toBe(false)
    expect(check([11, 10], [11, 11], 5)).toBe(true)
  })
  it('approach tile sides', () => {
    // Player far north-east of a 5x5 NPC: south side of the player, offset 0.
    expect(approachTile({ position: [10, 10], size: 5 }, { position: [20, 30], size: 1 })).toEqual([20, 25])
    // Directly west.
    expect(approachTile({ position: [0, 10], size: 5 }, { position: [20, 12], size: 1 })).toEqual([15, 12])
  })
})

describe('facing', () => {
  it('8-way deltas', () => {
    expect(angleFromDelta(0, 1, 7)).toBe(1024)
    expect(angleFromDelta(0, -1, 7)).toBe(0)
    expect(angleFromDelta(1, 0, 7)).toBe(1536)
    expect(angleFromDelta(-1, 0, 7)).toBe(512)
    expect(angleFromDelta(1, 1, 7)).toBe(1280)
    expect(angleFromDelta(-1, -1, 7)).toBe(256)
    expect(angleFromDelta(0, 0, 7)).toBe(7)
  })
  it('stationary NPC faces the clamped target centre', () => {
    expect(angleTowardActor({ position: [10, 10], size: 5, facing: 0 }, { position: [12, 20], size: 1 })).toBe(1024)
  })
  it('exact facing (RO / xJ)', () => {
    const a = { position: [10, 10] as Tile, size: 1, facing: 0 }
    faceExact(a, { position: [10, 20], size: 1 })
    expect(a.facing).toBe(1024)
    const p = { position: [10, 10] as Tile, facing: 0 }
    facePlayerToward(p, { position: [20, 10], size: 1 })
    expect(p.facing).toBe(1536)
  })
})

describe('flood fill', () => {
  it('stops at walls between tiles', () => {
    const grid = createCollisionGrid(0, 0, 10, 10)
    const walkable = new Set<number>()
    for (let x = 0; x < 4; x++) walkable.add(tileKey(x, 0))
    grid.flag(2, 0, Flag.WALL_WEST)
    grid.flag(1, 0, Flag.WALL_EAST)
    expect(floodFill(walkable, 0, 0, grid).size).toBe(2)
  })
})
