import { describe, expect, it } from 'vitest'
import { PLAYER_START, WAVE_SPAWN_TICK } from '../../data/inferno/waves'
import { Npc } from '../Npc'
import { Player } from '../Player'
import { GridCollision } from '../testing/GridCollision'
import { World } from '../World'
import { InfernoEncounter } from './InfernoEncounter'
import { Pillar } from './Pillar'
import { rollWaveSpawns } from './spawns'
import { Random } from '../Random'

function setup(seed = 7) {
  const grid = new GridCollision(64, 64)
  const world = new World(seed, grid, grid)
  const player = new Player()
  world.addActor(player)
  const encounter = new InfernoEncounter(player)
  world.addSystem(encounter)
  world.addSystem({ preTick: () => player.prayers.applyQueued(), playerPhase: () => player.prayers.drain(0) })
  return { world, player, encounter }
}

describe('spawn rolls', () => {
  it('uses distinct spawn tiles and the right counts', () => {
    const rng = new Random(1)
    const plan = rollWaveSpawns(62, rng) // 3 nib, 2 bat, 1 blob, 1 meleer, 1 ranger, 1 mager
    const keys = plan.map((p) => p.key)
    expect(keys.filter((k) => k === 'nibbler').length).toBe(3)
    expect(keys.filter((k) => k === 'bat').length).toBe(2)
    expect(new Set(plan.map((p) => `${p.x},${p.y}`)).size).toBe(plan.length)
  })

  it('is deterministic for a seed', () => {
    expect(rollWaveSpawns(30, new Random(5))).toEqual(rollWaveSpawns(30, new Random(5)))
  })
})

describe('InfernoEncounter', () => {
  it('spawns wave 1 on tick 15 with pillars present and the player at the start tile', () => {
    const { world, player, encounter } = setup()
    encounter.startWave(world, 1)
    expect(player.x).toBe(PLAYER_START.standard.x)
    expect(world.actors.filter((a) => a instanceof Pillar).length).toBe(3)
    for (let i = 0; i < WAVE_SPAWN_TICK - 1; i++) world.step()
    expect(world.actors.filter((a) => a instanceof Npc).length).toBe(0)
    world.step()
    const npcs = world.actors.filter((a): a is Npc => a instanceof Npc)
    expect(npcs.length).toBe(4)
    expect(encounter.state.phase).toBe('fighting')
  })

  it('nibblers attack pillars, not the player', () => {
    const { world, player, encounter } = setup()
    encounter.startWave(world, 3) // 6 nibblers
    for (let i = 0; i < 80; i++) world.step()
    const pillars = world.actors.filter((a): a is Pillar => a instanceof Pillar)
    const damaged = pillars.some((p) => p.hitpoints < p.maxHitpoints)
    expect(damaged).toBe(true)
    expect(player.hitpoints).toBe(player.maxHitpoints)
  })

  it('advances to the next wave 9 ticks after the last monster dies', () => {
    const { world, encounter } = setup()
    encounter.startWave(world, 1)
    for (let i = 0; i < 16; i++) world.step()
    for (const a of world.actors) if (a instanceof Npc) a.applyDamage(999, world.tick)
    world.step()
    expect(encounter.state.phase).toBe('waveCleared')
    for (let i = 0; i < 9; i++) world.step()
    expect(encounter.state.wave).toBe(2)
    expect(encounter.state.phase).toBe('waveStarting')
  })

  it('a ranger eventually hits an unprayed player and never hits through Protect from Missiles', () => {
    const { world, player, encounter } = setup(3)
    encounter.startWave(world, 18) // 3 nibblers + 1 ranger
    for (let i = 0; i < 120; i++) world.step()
    const unprayedDamage = player.maxHitpoints - player.hitpoints
    expect(unprayedDamage).toBeGreaterThan(0)

    const s2 = setup(3)
    s2.encounter.startWave(s2.world, 18)
    s2.player.prayers.toggle('protectFromMissiles')
    s2.player.levels.prayer = 99
    for (let i = 0; i < 120; i++) s2.world.step()
    expect(s2.player.hitpoints).toBe(s2.player.maxHitpoints)
  })

  it('blobs split into three bloblets on death', () => {
    const { world, encounter } = setup()
    encounter.startWave(world, 4) // 3 nibblers + 1 blob
    for (let i = 0; i < 16; i++) world.step()
    const blob = world.actors.find((a): a is Npc => a instanceof Npc && a.def.key === 'blob')!
    blob.applyDamage(999, world.tick)
    world.step()
    const bloblets = world.actors.filter((a): a is Npc => a instanceof Npc && a.def.key.startsWith('bloblet'))
    expect(bloblets.length).toBe(3)
  })
})
