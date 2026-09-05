import { PRAYERS, PRAYER_BY_KEY, type OverheadKey, type PrayerDef, type PrayerKey } from '../data/prayers'
import { prayerDrainResistance } from './combat/formulas'

/**
 * A player's prayer state with client-accurate semantics: toggles made
 * during a tick are queued and take effect at the start of the next tick;
 * drain is applied per tick for prayers active at that point; a prayer
 * switched off and on within the same tick (a "1-tick flick") costs nothing.
 */
export class Prayers {
  points: number
  maxPoints: number
  prayerLevel: number
  /** Prayers active at the start of the current tick. */
  readonly active = new Set<PrayerKey>()
  /** Pending toggles requested during this tick, applied on the next pre-tick. */
  private readonly queued: PrayerKey[] = []
  private drainCounter = 0
  quickPrayers: PrayerKey[] = []

  constructor(prayerLevel: number) {
    this.prayerLevel = prayerLevel
    this.points = prayerLevel
    this.maxPoints = prayerLevel
  }

  /** Request a toggle (from UI); applied at next tick start. */
  toggle(key: PrayerKey): void {
    this.queued.push(key)
  }

  toggleQuickPrayers(): void {
    const allOn = this.quickPrayers.every((k) => this.active.has(k))
    for (const k of this.quickPrayers) {
      if (allOn === this.active.has(k)) this.queued.push(k)
    }
  }

  clearAll(): void {
    for (const k of this.active) this.queued.push(k)
  }

  /** Apply queued toggles. Called at the start of every tick before drain. */
  applyQueued(): void {
    for (const key of this.queued) {
      if (this.active.has(key)) {
        this.active.delete(key)
        continue
      }
      const def = PRAYER_BY_KEY[key]
      if (this.points <= 0 || def.level > this.prayerLevel) continue
      for (const other of [...this.active]) {
        if (conflicts(def, PRAYER_BY_KEY[other])) this.active.delete(other)
      }
      this.active.add(key)
    }
    this.queued.length = 0
  }

  /** Drain for the prayers active this tick. */
  drain(prayerBonus: number): void {
    if (this.active.size === 0) return
    let effect = 0
    for (const k of this.active) effect += PRAYER_BY_KEY[k].drain
    this.drainCounter += effect
    const resistance = prayerDrainResistance(prayerBonus)
    while (this.drainCounter > resistance && this.points > 0) {
      this.drainCounter -= resistance
      this.points--
    }
    if (this.points <= 0) {
      this.points = 0
      this.active.clear()
      this.drainCounter = 0
    }
  }

  get overhead(): OverheadKey | null {
    for (const k of this.active) {
      const def = PRAYER_BY_KEY[k]
      if (def.overhead) return k as OverheadKey
    }
    return null
  }

  multiplier(stat: keyof Pick<PrayerDef, 'attack' | 'strength' | 'defence' | 'rangedAttack' | 'rangedStrength' | 'magicAttack'>): number {
    let m = 1
    for (const k of this.active) {
      const v = PRAYER_BY_KEY[k][stat]
      if (v !== undefined && v > m) m = v
    }
    return m
  }

  magicDamagePercent(): number {
    let best = 0
    for (const k of this.active) {
      const v = PRAYER_BY_KEY[k].magicDamagePercent
      if (v !== undefined && v > best) best = v
    }
    return best
  }

  restore(amount: number): void {
    this.points = Math.min(this.maxPoints, this.points + amount)
  }

  static all(): readonly PrayerDef[] {
    return PRAYERS
  }
}

function conflicts(a: PrayerDef, b: PrayerDef): boolean {
  if (a.key === b.key) return false
  for (const g of a.groups) if (b.groups.includes(g)) return true
  return false
}
