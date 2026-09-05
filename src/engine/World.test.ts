import { describe, expect, it } from 'vitest'
import { routeTo, stepAlongPath } from './Movement'
import { Player } from './Player'
import { GridCollision } from './testing/GridCollision'
import { World } from './World'

function makeWorld(): { world: World; grid: GridCollision } {
  const grid = new GridCollision(64, 64)
  const world = new World(1, grid, grid)
  return { world, grid }
}

describe('World movement', () => {
  it('walks one tile per tick and runs two', () => {
    const { world } = makeWorld()
    const player = new Player()
    player.setPosition(10, 10)
    world.addActor(player)
    world.addSystem({ playerPhase: (w) => stepAlongPath(player, w, player.running) })

    routeTo(player, world, 10, 20)
    expect(player.path.length).toBe(10)
    world.step()
    expect(player.y).toBe(12)
    expect(player.prevY).toBe(10)
    player.running = false
    world.step()
    expect(player.y).toBe(13)
  })

  it('routes around a wall without cutting corners', () => {
    const { world, grid } = makeWorld()
    for (let x = 5; x <= 15; x++) grid.block(x, 12)
    const player = new Player()
    player.setPosition(10, 10)
    world.addActor(player)
    routeTo(player, world, 10, 14)
    expect(player.path.length).toBeGreaterThan(4)
    for (const t of player.path) expect(t.y === 12 && t.x >= 5 && t.x <= 15).toBe(false)
  })

  it('runs delayed actions on the right tick and lands projectiles', () => {
    const { world } = makeWorld()
    const log: string[] = []
    world.schedule(2, () => log.push(`delayed@${world.tick}`))
    world.launchProjectile({ graphicId: 0, fromX: 0, fromY: 0, toX: 1, toY: 1, startTick: world.tick, landTick: world.tick + 3, onLand: () => log.push(`landed@${world.tick}`) })
    world.step()
    world.step()
    world.step()
    expect(log).toEqual(['delayed@2', 'landed@3'])
  })

  it('is deterministic for a given seed', () => {
    const a = makeWorld().world
    const b = makeWorld().world
    const va = Array.from({ length: 5 }, () => a.rng.int(1000))
    const vb = Array.from({ length: 5 }, () => b.rng.int(1000))
    expect(va).toEqual(vb)
  })
})
