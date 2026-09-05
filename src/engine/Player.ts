import { Actor } from './Actor'
import { Prayers } from './Prayers'

export type SkillKey = 'attack' | 'strength' | 'defence' | 'ranged' | 'magic' | 'prayer' | 'hitpoints'

export interface SkillLevels {
  attack: number
  strength: number
  defence: number
  ranged: number
  magic: number
  prayer: number
  hitpoints: number
}

export interface EquipmentBonuses {
  stabAttack: number
  slashAttack: number
  crushAttack: number
  magicAttack: number
  rangedAttack: number
  stabDefence: number
  slashDefence: number
  crushDefence: number
  magicDefence: number
  rangedDefence: number
  meleeStrength: number
  rangedStrength: number
  magicDamagePercent: number
  prayer: number
}

export const ZERO_BONUSES: EquipmentBonuses = {
  stabAttack: 0,
  slashAttack: 0,
  crushAttack: 0,
  magicAttack: 0,
  rangedAttack: 0,
  stabDefence: 0,
  slashDefence: 0,
  crushDefence: 0,
  magicDefence: 0,
  rangedDefence: 0,
  meleeStrength: 0,
  rangedStrength: 0,
  magicDamagePercent: 0,
  prayer: 0,
}

export const MAX_LEVELS: SkillLevels = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, prayer: 99, hitpoints: 99 }

export class Player extends Actor {
  readonly levels: SkillLevels
  /** Temporary boosts / drains per skill (potions, bat drains). */
  readonly boosts: Record<SkillKey, number> = { attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0, prayer: 0, hitpoints: 0 }
  readonly prayers: Prayers
  bonuses: EquipmentBonuses = { ...ZERO_BONUSES }
  running = true
  /** 0..10000, the client's hundredths of a percent. */
  runEnergy = 10000
  /** 0..100 special attack energy. */
  specialEnergy = 100
  /** Ticks until natural hitpoint regeneration. */
  regenTimer = 100
  target: Actor | null = null
  /** Chosen destination (SW tile) for click-to-move; null when idle. */
  destination: { x: number; y: number } | null = null
  /** Ticks remaining before the next food/potion can be consumed. */
  foodDelay = 0
  potionDelay = 0
  karambwanDelay = 0
  /** Tick of the last repath while chasing a target. */
  memoryRepath = -1

  constructor(levels: SkillLevels = MAX_LEVELS) {
    super()
    this.levels = { ...levels }
    this.prayers = new Prayers(levels.prayer)
    this.maxHitpoints = levels.hitpoints
    this.hitpoints = levels.hitpoints
    this.size = 1
  }

  override get name(): string {
    return 'Player'
  }

  level(skill: SkillKey): number {
    return this.levels[skill] + this.boosts[skill]
  }

  /** Drain a combat stat by `amount` down to a floor of 0 total. */
  drainStat(skill: SkillKey, amount: number): void {
    this.boosts[skill] = Math.max(-this.levels[skill], this.boosts[skill] - amount)
  }

  /** Move the boost toward 0 by one point (the client does this per skill on a 100-tick cycle). */
  tickBoosts(): void {
    for (const k of Object.keys(this.boosts) as SkillKey[]) {
      if (this.boosts[k] > 0) this.boosts[k]--
      else if (this.boosts[k] < 0) this.boosts[k]++
    }
  }
}
