import { describe, expect, it } from 'vitest'
import { MONSTERS } from '../data/inferno/monsters'
import { MonsterBehaviour } from './inferno/MonsterBehaviour'
import { LOADOUT_PRESETS, buildLoadout } from './Loadout'
import { Npc } from './Npc'
import { Player } from './Player'
import { PlayerController } from './PlayerController'
import { GridCollision } from './testing/GridCollision'
import { World } from './World'

describe('PlayerController', () => {
  it('kills a Jal-MejRah with a twisted bow within a reasonable number of ticks', () => {
    const grid = new GridCollision(64, 64)
    const world = new World(11, grid, grid)
    const player = new Player()
    player.setPosition(30, 30)
    world.addActor(player)
    const loadout = buildLoadout(LOADOUT_PRESETS['Max Tbow']!)
    expect(loadout.weapon.kind).toBe('ranged')
    expect(loadout.bonuses.rangedAttack).toBeGreaterThan(150)
    const controller = new PlayerController(player, loadout)
    world.addSystem(controller)
    const bat = new Npc(MONSTERS.bat, new MonsterBehaviour())
    bat.setPosition(36, 30)
    world.addActor(bat)
    player.prayers.toggle('protectFromMissiles')
    player.prayers.toggle('rigour')
    player.target = bat
    let ticks = 0
    while (!bat.dead && ticks < 200) {
      world.step()
      ticks++
    }
    expect(bat.dead).toBe(true)
    expect(ticks).toBeLessThan(120)
    expect(player.hitpoints).toBe(player.maxHitpoints)
  })

  it('walks into range before attacking with a blowpipe', () => {
    const grid = new GridCollision(64, 64)
    const world = new World(2, grid, grid)
    const player = new Player()
    player.setPosition(10, 10)
    world.addActor(player)
    const controller = new PlayerController(player, buildLoadout(LOADOUT_PRESETS['Max Blowpipe']!))
    world.addSystem(controller)
    const ranger = new Npc(MONSTERS.ranger, { onTick: () => {} })
    ranger.setPosition(10, 30)
    world.addActor(ranger)
    player.target = ranger
    world.step()
    expect(player.y).toBeGreaterThan(10)
    for (let i = 0; i < 30; i++) world.step()
    expect(ranger.hitpoints).toBeLessThan(ranger.maxHitpoints)
  })
})
