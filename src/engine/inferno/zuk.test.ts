import { describe, expect, it } from 'vitest'
import { ZUK_FIRST_SET_TICKS } from '../../data/inferno/monsters'
import { PLAYER_START } from '../../data/inferno/waves'
import { LOADOUT_PRESETS, buildLoadout } from '../Loadout'
import { Npc } from '../Npc'
import { Player } from '../Player'
import { PlayerController } from '../PlayerController'
import { GridCollision } from '../testing/GridCollision'
import { World } from '../World'
import { InfernoEncounter } from './InfernoEncounter'
import { ZUK_LAYOUT, playerBehindShield } from './zuk'

function setup(seed = 5) {
  const grid = new GridCollision(64, 64)
  // Zuk's walls.
  for (let y = 52; y <= 63; y++) {
    grid.block(27, y)
    grid.block(35, y)
  }
  const world = new World(seed, grid, grid)
  const player = new Player()
  world.addActor(player)
  const events: string[] = []
  const encounter = new InfernoEncounter(player, undefined, (e) => events.push(e))
  world.addSystem(encounter)
  const controller = new PlayerController(player, buildLoadout(LOADOUT_PRESETS['Max Tbow']!))
  world.addSystem(controller)
  return { world, player, encounter, events, controller }
}

describe('Zuk wave', () => {
  it('spawns Zuk and the shield, and the shield sweeps and reverses', () => {
    const { world, player, encounter } = setup()
    encounter.startWave(world, 69)
    expect(player.x).toBe(PLAYER_START.zuk.x)
    for (let i = 0; i < 16; i++) world.step()
    const zuk = world.actors.find((a): a is Npc => a instanceof Npc && a.def.key === 'zuk')
    const shield = world.actors.find((a): a is Npc => a instanceof Npc && a.def.key === 'ancestralGlyph')
    expect(zuk).toBeDefined()
    expect(shield).toBeDefined()
    const xs = new Set<number>()
    for (let i = 0; i < 80; i++) {
      world.step()
      xs.add(shield!.x)
    }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(ZUK_LAYOUT.shieldMinX)
    expect(Math.max(...xs)).toBeLessThanOrEqual(ZUK_LAYOUT.shieldMaxX)
    expect(xs.size).toBeGreaterThan(10)
  })

  it('Zuk hits the player when exposed and not when behind the shield', () => {
    const { world, player, encounter } = setup(9)
    encounter.startWave(world, 69)
    for (let i = 0; i < 16; i++) world.step()
    const shield = world.actors.find((a): a is Npc => a instanceof Npc && a.def.key === 'ancestralGlyph')!
    // Park the player far outside the shield's span on an exposed row.
    player.setPosition(19, 45)
    player.path = []
    let took = 0
    for (let i = 0; i < 60; i++) {
      player.setPosition(shield.x > 30 ? 18 : 40, 45)
      world.step()
      took = player.maxHitpoints - player.hitpoints
      player.hitpoints = player.maxHitpoints
      if (took > 0) break
    }
    expect(took).toBeGreaterThan(0)
    expect(playerBehindShield({ x: shield.x + 2, y: 45 } as Player, shield)).toBe(true)
    expect(playerBehindShield({ x: shield.x + 2, y: 43 } as Player, shield)).toBe(false)
  })

  it('spawns the first set after the timer, Jad below 480 and healers below 240, and wins on death', () => {
    const { world, player, encounter, events } = setup(2)
    player.invulnerable = true
    encounter.startWave(world, 69)
    for (let i = 0; i < 16 + ZUK_FIRST_SET_TICKS + 12; i++) {
      player.hitpoints = player.maxHitpoints
      world.step()
    }
    expect(events).toContain('setSpawned')
    expect(world.actors.filter((a) => a instanceof Npc && (a.npcId === 7702 || a.npcId === 7703)).length).toBe(2)
    const zuk = world.actors.find((a): a is Npc => a instanceof Npc && a.def.key === 'zuk')!
    zuk.hitpoints = 479
    for (let i = 0; i < 10; i++) {
      player.hitpoints = player.maxHitpoints
      world.step()
    }
    expect(events).toContain('jadSpawned')
    zuk.hitpoints = 239
    for (let i = 0; i < 3; i++) {
      player.hitpoints = player.maxHitpoints
      world.step()
    }
    expect(events).toContain('healersSpawned')
    expect(events).toContain('enraged')
    const hpBefore = zuk.hitpoints
    for (let i = 0; i < 6; i++) {
      player.hitpoints = player.maxHitpoints
      world.step()
    }
    expect(zuk.hitpoints).toBeGreaterThan(hpBefore) // healers healing
    zuk.applyDamage(9999, world.tick)
    world.step()
    world.step()
    expect(events).toContain('zukDead')
    expect(world.actors.filter((a) => a instanceof Npc && !a.dead).length).toBe(0)
    for (let i = 0; i < 10; i++) world.step()
    expect(encounter.state.phase).toBe('victory')
  })
})

describe('Jad waves', () => {
  it('wave 67 spawns one Jad that gains healers at half health', () => {
    const { world, player, encounter } = setup(4)
    encounter.startWave(world, 67)
    for (let i = 0; i < 16; i++) world.step()
    const jads = world.actors.filter((a): a is Npc => a instanceof Npc && a.def.key === 'jad')
    expect(jads.length).toBe(1)
    const jad = jads[0]!
    player.prayers.toggle('protectFromMagic')
    jad.hitpoints = 170
    world.step()
    world.step()
    expect(world.actors.filter((a) => a instanceof Npc && a.def.key === 'jadHealer').length).toBe(5)
  })

  it('wave 68 spawns three Jads', () => {
    const { world, encounter } = setup(4)
    encounter.startWave(world, 68)
    for (let i = 0; i < 16; i++) world.step()
    expect(world.actors.filter((a) => a instanceof Npc && a.def.key === 'jad').length).toBe(3)
  })
})
