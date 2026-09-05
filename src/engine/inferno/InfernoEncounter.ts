import { MONSTERS } from '../../data/inferno/monsters'
import { FIRST_JAD_WAVE, PILLARS, PLAYER_START, TRIPLE_JAD_WAVE, WAVE_END_DELAY_TICKS, WAVE_SPAWN_TICK, ZUK_WAVE } from '../../data/inferno/waves'
import { Npc } from '../Npc'
import type { Player } from '../Player'
import type { World, WorldSystem } from '../World'
import { behaviourFor, clearGraveyard, recordDeath } from './behaviours'
import { Pillar } from './Pillar'
import { rollWaveSpawns, type SpawnPlan } from './spawns'
import { JadBehaviour } from './jad'
import { ZukScript, type ZukEvent } from './zuk'

export type EncounterPhase = 'idle' | 'waveStarting' | 'fighting' | 'waveCleared' | 'victory' | 'defeat'

export interface EncounterState {
  wave: number
  phase: EncounterPhase
  /** Tick the current wave started on. */
  waveStartTick: number
  spawnPlan: SpawnPlan[]
}

/**
 * Drives the Inferno: wave start, spawns on tick 15, monster deaths, wave
 * clear and the next wave 9 ticks later. Jad and Zuk waves are handled by
 * dedicated scripts (added separately); this system covers waves 1-66 and
 * the shared bookkeeping.
 */
export class InfernoEncounter implements WorldSystem {
  readonly player: Player
  readonly state: EncounterState = { wave: 0, phase: 'idle', waveStartTick: 0, spawnPlan: [] }
  readonly monsters: Npc[] = []
  readonly pillars: Pillar[] = []
  zuk: ZukScript | null = null
  private readonly onZukEvent: ((e: ZukEvent) => void) | undefined
  private readonly onWaveChange: ((state: EncounterState) => void) | undefined

  constructor(player: Player, onWaveChange?: (state: EncounterState) => void, onZukEvent?: (e: ZukEvent) => void) {
    this.player = player
    this.onWaveChange = onWaveChange
    this.onZukEvent = onZukEvent
  }

  /** Reset the arena and begin at the given wave. */
  startWave(world: World, wave: number): void {
    for (const m of this.monsters) world.removeActor(m)
    this.monsters.length = 0
    for (const a of [...world.actors]) if (a instanceof Npc) world.removeActor(a)
    this.zuk = null
    clearGraveyard(world)
    if (this.pillars.length === 0) {
      for (const info of PILLARS) {
        const p = new Pillar(info)
        this.pillars.push(p)
        world.addActor(p)
      }
    }
    if (wave >= FIRST_JAD_WAVE) {
      for (const p of this.pillars) {
        if (!p.dead) {
          p.dead = true
          world.removeActor(p)
        }
      }
    }
    const start = wave === ZUK_WAVE ? PLAYER_START.zuk : wave === 68 ? PLAYER_START.tripleJad : wave === 67 ? PLAYER_START.jad : PLAYER_START.standard
    if (this.state.wave === 0 || wave >= FIRST_JAD_WAVE) {
      this.player.setPosition(start.x, start.y)
      this.player.path = []
    }
    this.state.wave = wave
    this.state.phase = 'waveStarting'
    this.state.waveStartTick = world.tick
    this.state.spawnPlan = wave < FIRST_JAD_WAVE ? rollWaveSpawns(wave, world.rng) : []
    this.onWaveChange?.(this.state)
  }

  npcPhase(world: World): void {
    const s = this.state
    if (s.phase === 'idle' || s.phase === 'victory' || s.phase === 'defeat') return
    if (this.player.dead) {
      s.phase = 'defeat'
      this.onWaveChange?.(s)
      return
    }
    if (s.phase === 'waveStarting' && world.tick - s.waveStartTick >= WAVE_SPAWN_TICK) {
      this.spawnWave(world)
      s.phase = 'fighting'
      this.onWaveChange?.(s)
    }
    if (s.phase === 'fighting') {
      for (const m of this.monsters) {
        if (m.dead) continue
        m.behaviour.onTick(world, m)
      }
      this.reapDead(world)
      if (this.monsters.every((m) => m.dead)) {
        s.phase = 'waveCleared'
        s.waveStartTick = world.tick
        this.onWaveChange?.(s)
      }
    } else if (s.phase === 'waveCleared' && world.tick - s.waveStartTick >= WAVE_END_DELAY_TICKS) {
      if (s.wave >= ZUK_WAVE) {
        s.phase = 'victory'
        this.onWaveChange?.(s)
      } else {
        this.startWave(world, s.wave + 1)
      }
    }
  }

  private spawnWave(world: World): void {
    const wave = this.state.wave
    if (wave === ZUK_WAVE) {
      this.zuk = new ZukScript(this.onZukEvent)
      world.addSystem(this.zuk)
      for (const npc of this.zuk.spawn(world)) this.monsters.push(npc)
      return
    }
    if (wave === FIRST_JAD_WAVE || wave === TRIPLE_JAD_WAVE) {
      const spots = wave === FIRST_JAD_WAVE ? [{ x: 29, y: 33 }] : [{ x: 24, y: 36 }, { x: 34, y: 36 }, { x: 29, y: 25 }]
      const stuns = wave === FIRST_JAD_WAVE ? [1] : world.rng.shuffle([1, 4, 7])
      spots.forEach((spot, i) => {
        const jad = new Npc(MONSTERS.jad, new JadBehaviour({ attackSpeed: wave === FIRST_JAD_WAVE ? 8 : 9, healerCount: wave === FIRST_JAD_WAVE ? 5 : 3, spawnStun: stuns[i] ?? 1 }))
        jad.setPosition(spot.x, spot.y)
        jad.faceTile(this.player.x, this.player.y)
        this.monsters.push(jad)
        world.addActor(jad)
        jad.behaviour.onSpawn?.(world, jad)
      })
      return
    }
    for (const plan of this.state.spawnPlan) {
      const def = MONSTERS[plan.key]
      const npc = new Npc(def, behaviourFor(plan.key, { revives: this.state.wave < ZUK_WAVE }))
      npc.setPosition(plan.x, plan.y)
      npc.faceTile(this.player.x, this.player.y)
      this.monsters.push(npc)
      world.addActor(npc)
      npc.behaviour.onSpawn?.(world, npc)
    }
  }

  private reapDead(world: World): void {
    for (const a of [...world.actors]) {
      if (!(a instanceof Npc) || !a.dead || a.memory.reaped) continue
      a.memory.reaped = 1
      a.behaviour.onDeath?.(world, a)
      recordDeath(world, a)
      if (!this.monsters.includes(a)) this.monsters.push(a)
      // Keep the corpse for the death animation for 3 ticks, then remove.
      world.schedule(3, (w) => {
        if (a.dead) w.removeActor(a)
      })
    }
    // Newly spawned bloblets / revived monsters that are not tracked yet.
    for (const a of world.actors) {
      if (a instanceof Npc && !this.monsters.includes(a)) this.monsters.push(a)
    }
  }
}
