import { Store } from './GameStore'

export interface OverlayHitsplat {
  kind: string
  amount: number
  age: number
}

export interface OverlayActor {
  id: number
  name: string
  /** Screen position (CSS px within the viewport) of the actor's head and feet. */
  x: number
  headY: number
  feetY: number
  hitpoints: number
  maxHitpoints: number
  isPlayer: boolean
  inCombat: boolean
  hitsplats: OverlayHitsplat[]
  overhead: string | null
}

export interface OverlaySnapshot {
  actors: OverlayActor[]
  wave: number
  phase: string
  tick: number
  /** Ticks until the current wave spawns, or -1. */
  spawnCountdown: number
  width: number
  height: number
  boss: { name: string; hitpoints: number; maxHitpoints: number } | null
  /** Ticks until the next Zuk set, or -1. */
  setTimerTicks: number
}

export const overlayStore = new Store<OverlaySnapshot>({ actors: [], wave: 0, phase: 'idle', tick: 0, spawnCountdown: -1, width: 0, height: 0, boss: null, setTimerTicks: -1 })
