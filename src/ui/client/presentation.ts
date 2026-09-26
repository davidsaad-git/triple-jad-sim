/**
 * Click-time feedback for lagged chrome inputs:
 *
 * - prayers, default mode: only the clicked prayer's icon flips at once
 *   (override bits); the bits are dropped once the tick after the lagged apply
 *   has been displayed (`answeredAtTick`);
 * - prayers, Instant Inventory + Instant prayer: the predicted full slot state
 *   (conflicts cleared at once) until the apply;
 * - run orb, attack style, selected spell: an override until the apply;
 * - spec orb: pending toggles flip the displayed state until applied.
 *
 * One instance per runtime; components subscribe to re-render.
 */
import { PresentationOverride } from '../../app/runtime/presentation'
import type { PrayerId, SimState } from '../../sim/api'

export type PrayerGroup = 'protection' | 'offensive' | 'independent'


export const PRAYER_GROUPS: Readonly<Record<PrayerId, PrayerGroup>> = {
  ProtectMagic: 'protection',
  ProtectRange: 'protection',
  ProtectMelee: 'protection',
  Redemption: 'protection',
  Piety: 'offensive',
  Rigour: 'offensive',
  Augury: 'offensive',
  EagleEye: 'offensive',
  MysticMight: 'offensive',
  Deadeye: 'offensive',
  MysticVigour: 'offensive',
  Preserve: 'independent',
}

export const ALL_PRAYER_IDS = Object.keys(PRAYER_GROUPS) as PrayerId[]

export interface PrayerSlotsView {
  protection: PrayerId | null
  offensive: PrayerId | null
  independent: PrayerId[]
}

export interface PrayerDisplay extends PrayerSlotsView {
  /** Per-prayer lit overrides (default mode). */
  overrides: Readonly<Partial<Record<PrayerId, boolean>>>
  /** Any prayer lit, counting overrides. */
  anyLit: boolean
}

interface OverrideBit {
  lit: boolean
  seq: number
  answeredAtTick: number | null
}

export function isPrayerLit(p: PrayerId, view: PrayerSlotsView, overrides: Readonly<Partial<Record<PrayerId, boolean>>>): boolean {
  const o = overrides[p]
  if (o !== undefined) return o
  const g = PRAYER_GROUPS[p]
  return g === 'protection' ? view.protection === p : g === 'offensive' ? view.offensive === p : view.independent.includes(p)
}

function anyLit(view: PrayerSlotsView, overrides: Readonly<Partial<Record<PrayerId, boolean>>>): boolean {
  const litUnlessOff = (p: PrayerId | null): boolean => p !== null && overrides[p] !== false
  return litUnlessOff(view.protection) || litUnlessOff(view.offensive) || view.independent.some(litUnlessOff) || Object.values(overrides).some((v) => v === true)
}

/** Apply one toggle to slot state (scim rules, ignoring points except for activation). */
export function applyPrayerToggle(view: PrayerSlotsView, prayer: PrayerId, hasPoints: boolean): PrayerSlotsView {
  const g = PRAYER_GROUPS[prayer]
  if (g === 'independent') {
    if (view.independent.includes(prayer)) return { ...view, independent: view.independent.filter((p) => p !== prayer) }
    return hasPoints ? { ...view, independent: [...view.independent, prayer] } : view
  }
  const current = g === 'protection' ? view.protection : view.offensive
  const next = current === prayer ? null : hasPoints ? prayer : current
  return g === 'protection' ? { ...view, protection: next } : { ...view, offensive: next }
}

export class ClientPresentation {
  readonly run = new PresentationOverride<boolean>()
  readonly attackStyle = new PresentationOverride<number>()
  readonly selectedSpell = new PresentationOverride<string | null>()
  private bits = new Map<PrayerId, OverrideBit>()
  private seq = 0
  private predicted: { slots: PrayerSlotsView; seq: number } | null = null
  private predictSeq = 0
  private pendingSpecToggles = 0
  private readonly listeners = new Set<() => void>()
  private version = 0

  constructor() {
    for (const o of [this.run, this.attackStyle, this.selectedSpell]) o.subscribe(() => this.emit())
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getVersion(): number {
    return this.version
  }

  private emit(): void {
    this.version++
    for (const l of [...this.listeners]) l()
  }

  /** Drop overrides answered by the displayed tick. Call on every tick. */
  onTick(state: SimState): void {
    let changed = false
    for (const [p, bit] of this.bits) {
      if (bit.answeredAtTick !== null && state.currentTick >= bit.answeredAtTick) {
        this.bits.delete(p)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  reset(): void {
    this.bits.clear()
    this.predicted = null
    this.pendingSpecToggles = 0
    this.run.reset()
    this.attackStyle.reset()
    this.selectedSpell.reset()
    this.emit()
  }

  // --- prayers -------------------------------------------------------------

  committedSlots(state: SimState): PrayerSlotsView {
    return { protection: state.activePrayer, offensive: state.offensivePrayer, independent: state.independentPrayers ?? [] }
  }

  /** What the prayer book and orb show now. */
  prayerDisplay(state: SimState, instantPrayer: boolean): PrayerDisplay {
    if (instantPrayer) {
      const base = this.predicted?.slots
      const view: PrayerSlotsView = {
        protection: base ? base.protection : state.pendingProtectionPrayer[0] ? state.pendingProtectionPrayer[1] : state.activePrayer,
        offensive: base ? base.offensive : state.pendingOffensivePrayer[0] ? state.pendingOffensivePrayer[1] : state.offensivePrayer,
        independent: base ? base.independent : state.pendingIndependentPrayers[0] ? state.pendingIndependentPrayers[1] : (state.independentPrayers ?? []),
      }
      return { ...view, overrides: {}, anyLit: anyLit(view, {}) }
    }
    const overrides: Partial<Record<PrayerId, boolean>> = {}
    for (const [p, bit] of this.bits) overrides[p] = bit.lit
    const view = this.committedSlots(state)
    return { ...view, overrides, anyLit: anyLit(view, overrides) }
  }

  /**
   * A prayer icon was pressed. Returns whether the click turns the prayer on
   * (for the dispatch label) and a `retire` to call inside the lagged apply
   * with the engine's current tick.
   */
  pressPrayer(state: SimState, prayer: PrayerId, instantPrayer: boolean): { activates: boolean; retire: (engineTick: number) => void } {
    const hasPoints = state.prayerState.points > 0
    const display = this.prayerDisplay(state, instantPrayer)
    const wasLit = isPrayerLit(prayer, display, display.overrides)
    const activates = !wasLit && hasPoints
    if (instantPrayer) {
      const seq = ++this.predictSeq
      this.predicted = { slots: applyPrayerToggle(display, prayer, hasPoints), seq }
      this.emit()
      return {
        activates,
        retire: () => {
          if (this.predicted?.seq === seq) {
            this.predicted = null
            this.emit()
          }
        },
      }
    }
    if (!wasLit && !hasPoints) return { activates: false, retire: () => {} }
    const seq = ++this.seq
    this.bits.set(prayer, { lit: !wasLit, seq, answeredAtTick: null })
    this.emit()
    return {
      activates,
      retire: (engineTick: number) => {
        const bit = this.bits.get(prayer)
        if (bit && bit.seq === seq) bit.answeredAtTick = engineTick + 1
      },
    }
  }

  // --- special attack ------------------------------------------------------

  pressSpecial(): () => void {
    this.pendingSpecToggles++
    this.emit()
    let done = false
    return () => {
      if (done) return
      done = true
      this.pendingSpecToggles = Math.max(0, this.pendingSpecToggles - 1)
      this.emit()
    }
  }

  /** Displayed "armed" state of the special attack (scim, spec projection). */
  specialActive(state: SimState): boolean {
    const base = state.pendingSpecialAttackActive ?? state.isSpecialAttackActive
    return this.pendingSpecToggles % 2 === 1 ? !base : base
  }
}
