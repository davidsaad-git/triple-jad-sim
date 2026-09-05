import type { CacheSystem } from '../cache/CacheSystem'
import type { PrayerKey } from '../data/prayers'
import { Clock } from '../engine/Clock'
import { routeTo } from '../engine/Movement'
import { PlayerController } from '../engine/PlayerController'
import { LOADOUT_PRESETS, buildLoadout } from '../engine/Loadout'
import { Npc } from '../engine/Npc'
import type { Actor } from '../engine/Actor'
import { Player } from '../engine/Player'
import { InfernoEncounter } from '../engine/inferno/InfernoEncounter'
import { onCombatEvent } from '../engine/inferno/events'
import { WAVE_SPAWN_TICK } from '../data/inferno/waves'
import { World } from '../engine/World'
import { Random } from '../engine/Random'
import type { Renderer } from '../render/Renderer'
import { Arena } from './Arena'
import { addChatMessage } from './ChatState'
import { hudStore, type SideTab, type UiActions } from './HudState'

/**
 * One simulator session: owns the world, the player, the clock and the
 * bridge to the HUD store. The renderer drives it from its frame loop.
 */
export class Session {
  readonly cache: CacheSystem
  readonly arena: Arena
  readonly clock = new Clock()
  readonly world: World
  readonly player: Player
  readonly encounter: InfernoEncounter
  readonly controller: PlayerController
  private unsubscribeFrame: (() => void) | null = null
  /** Debug: frames received from the renderer. */
  frames = 0
  renderer: Renderer | null = null
  private ticker: number | null = null

  private stopTicker(): void {
    if (this.ticker !== null) window.clearInterval(this.ticker)
    this.ticker = null
  }
  private welcomed = false

  constructor(cache: CacheSystem, seed = Random.seedFromString('dev')) {
    this.cache = cache
    this.arena = new Arena(cache)
    this.world = new World(seed, this.arena.collision, this.arena.collision)
    this.player = new Player()
    this.player.setPosition(34, 43)
    this.world.addActor(this.player)
    this.encounter = new InfernoEncounter(
      this.player,
      (state) => {
        if (state.phase === 'waveStarting') addChatMessage('game', `Wave: ${state.wave}`, this.world.tick)
        if (state.phase === 'waveCleared') addChatMessage('game', 'Wave completed!', this.world.tick)
        if (state.phase === 'defeat') addChatMessage('combat', 'Oh dear, you are dead! Press Ctrl+R to restart the wave.', this.world.tick)
        if (state.phase === 'victory') addChatMessage('game', 'You have defeated TzKal-Zuk! The Inferno is complete.', this.world.tick)
        hudStore.update({ wave: state.wave })
      },
      (event) => {
        const text: Record<typeof event, string> = {
          setSpawned: 'A set of Jal-Xil and Jal-Zek has spawned.',
          jadSpawned: 'JalTok-Jad has joined the fight.',
          healersSpawned: 'Jal-MejJak healers have appeared on the lava.',
          enraged: 'TzKal-Zuk is enraged!',
          zukDead: 'TzKal-Zuk has fallen.',
        }
        addChatMessage('game', text[event], this.world.tick)
      },
    )
    this.world.addSystem(this.encounter)
    onCombatEvent(this.world, (e) => {
      if (e.target === this.player && e.damage > 0) {
        addChatMessage('combat', `${e.source.name} hits you for ${e.damage}.`, e.tick)
      }
      if (e.source === this.player && e.target instanceof Npc && e.target.dead) {
        addChatMessage('game', `You have killed ${e.target.name}.`, e.tick)
      }
    })
    this.controller = new PlayerController(this.player, buildLoadout(LOADOUT_PRESETS['Max Tbow']!))
    this.world.addSystem(this.controller)
    this.world.addSystem({
      postTick: () => {
        if (this.infinitePrayer) this.player.prayers.points = this.player.prayers.maxPoints
        this.publishHud()
      },
    })
    this.clock.onTick(() => this.world.step())
  }

  attach(renderer: Renderer): void {
    if (import.meta.env.DEV) (globalThis as unknown as { __zuk: Session }).__zuk = this
    this.renderer = renderer
    if (!this.welcomed) {
      this.welcomed = true
      addChatMessage('system', 'Welcome to the Inferno simulator.')
      this.publishHud()
    }
    // The clock runs on a real-time interval so the simulation keeps ticking
    // when the page is hidden and animation frames stop.
    this.stopTicker()
    let last = performance.now()
    this.ticker = window.setInterval(() => {
      const now = performance.now()
      this.clock.advance((now - last) / 1000)
      last = now
    }, 50)
    this.unsubscribeFrame = renderer.addFrameListener(() => {
      this.frames++
      const compass = renderer.camera.compass
      if (compass !== hudStore.get().compass) hudStore.update({ compass })
    })
  }

  detach(): void {
    this.stopTicker()
    this.unsubscribeFrame?.()
    this.unsubscribeFrame = null
  }

  readonly actions: UiActions = {
    togglePrayer: (key: PrayerKey) => this.player.prayers.toggle(key),
    toggleQuickPrayers: () => this.player.prayers.toggleQuickPrayers(),
    toggleRun: () => {
      this.player.running = !this.player.running
      this.publishHud()
    },
    setTab: (tab: SideTab) => hudStore.update({ activeTab: tab }),
    clickInventory: () => {},
    clickEquipment: () => {},
  }

  presetName = 'Max Tbow'
  infinitePrayer = false

  startWave(wave: number): void {
    this.resetPlayer()
    this.encounter.startWave(this.world, wave)
    this.publishHud()
  }

  restartWave(): void {
    this.startWave(Math.max(1, this.encounter.state.wave))
  }

  applyConfig(config: { wave: number; preset: string; infiniteHealth: boolean; infinitePrayer: boolean }): void {
    const preset = LOADOUT_PRESETS[config.preset]
    if (preset) {
      this.presetName = config.preset
      this.controller.setLoadout(buildLoadout(preset))
    }
    this.player.invulnerable = config.infiniteHealth
    this.infinitePrayer = config.infinitePrayer
    this.startWave(config.wave)
  }

  /** Restore hitpoints, prayer and stats for a fresh attempt. */
  resetPlayer(): void {
    const p = this.player
    p.dead = false
    p.hitpoints = p.maxHitpoints
    p.prayers.points = p.prayers.maxPoints
    p.prayers.clearAll()
    p.prayers.applyQueued()
    for (const k of Object.keys(p.boosts) as (keyof typeof p.boosts)[]) p.boosts[k] = 0
    p.runEnergy = 10000
    p.specialEnergy = 100
    p.target = null
    p.path = []
    p.hitsplats.length = 0
  }

  get bossInfo(): { name: string; hitpoints: number; maxHitpoints: number } | null {
    const zuk = this.encounter.zuk?.zuk
    if (!zuk || zuk.dead) return null
    return { name: zuk.name, hitpoints: zuk.hitpoints, maxHitpoints: zuk.maxHitpoints }
  }

  get setTimerTicks(): number {
    const z = this.encounter.zuk
    return z && z.zuk && !z.zuk.dead ? z.ticksUntilSet : -1
  }

  get spawnCountdown(): number {
    const s = this.encounter.state
    if (s.phase !== 'waveStarting') return -1
    return Math.max(0, WAVE_SPAWN_TICK - (this.world.tick - s.waveStartTick))
  }

  attack(target: Actor): void {
    if (!(target instanceof Npc) || target.dead) return
    this.player.target = target
    this.player.path = []
  }

  /** Queue a walk to a tile (applied immediately; the path is followed on following ticks). */
  walkTo(x: number, y: number): void {
    this.player.target = null
    routeTo(this.player, this.world, x, y)
  }

  publishHud(): void {
    const p = this.player
    hudStore.update({
      tick: this.world.tick,
      hitpoints: p.hitpoints,
      maxHitpoints: p.maxHitpoints,
      prayerPoints: p.prayers.points,
      maxPrayerPoints: p.prayers.maxPoints,
      runEnergy: p.runEnergy / 100,
      running: p.running,
      specialEnergy: p.specialEnergy,
      activePrayers: [...p.prayers.active],
      overhead: p.prayers.overhead,
      targetName: p.target && !p.target.dead ? p.target.name : null,
      targetHitpoints: p.target?.hitpoints ?? 0,
      targetMaxHitpoints: p.target?.maxHitpoints ?? 0,
      equipment: Object.fromEntries(
        Object.entries(this.controller.loadout.equipment).map(([slot, item]) => [slot, item ? { id: item.id, name: item.name, quantity: 1 } : null]),
      ),
    })
  }
}
