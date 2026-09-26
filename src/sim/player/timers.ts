/**
 * Player timer-band helpers: special energy (/`MU`/`NU`),
 * run energy (`PU`/`FU`/`IU`), poison (`RU`), combat timers (/`BU`),
 * death charge (`VU`/`HU`), mark of darkness (`UU`), Preserve (`WU`), stat
 * decay (`GU`) and prayer drain (`YU`).
 */
import type { PlayerStats, PrayerId, PrayerState, RunEnergyState, SpecialAttackState } from '../api'
import type { BoostRecord, CombatTimers, PoisonState } from '../core/types'
import { prayerDrainRate } from '../data/prayers'
import { copyStats } from '../items/itemEffects'

export const MAX_RUN_ENERGY = 10000
export const LIGHTBEARER = 25975


export function initialSpecialAttack(): SpecialAttackState {
  return { energy: 100, regenTickCounter: 50, lightbearerEquipped: false }
}


export function initialCombatTimers(): CombatTimers {
  return {
    vengeanceCooldownTicks: 0,
    vengeanceActive: false,
    saturatedHeartCooldownTicks: 0,
    surgePotionCooldownTicks: 0,
    saturatedHeartActiveTicks: 0,
    markOfDarknessCooldownTicks: 0,
    markOfDarknessActiveTicks: 0,
    deathChargeCooldownTicks: 0,
    deathChargeActiveTicks: 0,
    deathChargeProcsRemaining: 0,
    statBoostDecayTick: 100,
    statBoostDecayExtended: false,
  }
}


export function initialPoisonState(): PoisonState {
  return { poisonVarp: 0, poisonTickCounter: 30, startedTick: null }
}

// --- special attack ------------------------------------------------------------------


function specRegenPeriod(s: SpecialAttackState): number {
  return s.lightbearerEquipped ? 25 : 50
}

/** scim: lightbearer (un)equipped. */
export function updateLightbearer(s: SpecialAttackState, equipped: boolean): SpecialAttackState {
  if (s.lightbearerEquipped === equipped) return s
  if (!equipped) return { ...s, lightbearerEquipped: false, regenTickCounter: 50 }
  return { ...s, lightbearerEquipped: true, regenTickCounter: s.regenTickCounter > 25 ? 25 : s.regenTickCounter }
}

/** scim: +10 every period while below 100 at the start of the tick. */
export function regenerateSpecial(s: SpecialAttackState, energyAtTickStart = s.energy): SpecialAttackState {
  const period = specRegenPeriod(s)
  if (energyAtTickStart >= 100) return s.regenTickCounter === period ? s : { ...s, regenTickCounter: period }
  const counter = s.regenTickCounter - 1
  if (counter <= 0) return { ...s, energy: Math.min(100, s.energy + 10), regenTickCounter: period }
  return { ...s, regenTickCounter: counter }
}


export function fillSpecial(s: SpecialAttackState): SpecialAttackState {
  return { ...s, energy: 100 }
}

// --- run energy ------------------------------------------------------------------------


export function runDrain(weightKg: number, agility: number): number {
  return Math.floor((60 + (67 * Math.max(0, Math.min(64, weightKg))) / 64) * (1 - agility / 300))
}


export function runRegen(agility: number): number {
  return Math.floor(agility / 10) + 15
}


export function updateRunEnergy(e: RunEnergyState, args: { isRunning: boolean; agility: number; weight: number; drainMultiplier: number }): RunEnergyState {
  if (args.isRunning) return { energy: Math.max(0, e.energy - Math.floor(runDrain(args.weight, args.agility) * args.drainMultiplier)) }
  return { energy: Math.min(MAX_RUN_ENERGY, e.energy + runRegen(args.agility)) }
}

// --- poison ------------------------------------------------------------------------------

const VENOM_THRESHOLD = 1_000_000
const VENOM_BASE = 999_997

/** scim: one poison/venom/immunity step. */
export function stepPoison(p: PoisonState): { state: PoisonState; damage: number } {
  if (p.poisonVarp === 0) return { state: { ...p }, damage: 0 }
  if (p.poisonVarp < 0) return { state: { ...p, poisonVarp: Math.min(0, p.poisonVarp + 1) }, damage: 0 }
  if (p.poisonVarp >= VENOM_THRESHOLD) return { state: { ...p, poisonVarp: p.poisonVarp + 1 }, damage: Math.min((p.poisonVarp - VENOM_BASE) * 2, 20) }
  return { state: { ...p, poisonVarp: Math.max(0, p.poisonVarp - 1) }, damage: Math.ceil(p.poisonVarp / 5) }
}

export function isVenomVarp(varp: number): boolean {
  return varp >= VENOM_THRESHOLD
}

// --- combat timers ------------------------------------------------------------------------

function dec(v: number): number {
  return Math.max(0, v - 1)
}


export function tickCombatTimers(t: CombatTimers): CombatTimers {
  const deathChargeActiveTicks = dec(t.deathChargeActiveTicks)
  return {
    ...t,
    vengeanceCooldownTicks: dec(t.vengeanceCooldownTicks),
    saturatedHeartCooldownTicks: dec(t.saturatedHeartCooldownTicks),
    surgePotionCooldownTicks: dec(t.surgePotionCooldownTicks),
    saturatedHeartActiveTicks: dec(t.saturatedHeartActiveTicks),
    markOfDarknessCooldownTicks: dec(t.markOfDarknessCooldownTicks),
    markOfDarknessActiveTicks: dec(t.markOfDarknessActiveTicks),
    deathChargeCooldownTicks: dec(t.deathChargeCooldownTicks),
    deathChargeActiveTicks,
    deathChargeProcsRemaining: deathChargeActiveTicks === 0 ? 0 : t.deathChargeProcsRemaining,
  }
}

/** scim: cast Death Charge. */
export function castDeathCharge(t: CombatTimers, double: boolean): CombatTimers | null {
  return t.deathChargeCooldownTicks > 0 ? null : { ...t, deathChargeCooldownTicks: 100, deathChargeActiveTicks: 100, deathChargeProcsRemaining: double ? 2 : 1 }
}

/** scim: a Death Charge proc on a kill. */
export function deathChargeProc(s: SpecialAttackState, t: CombatTimers): { special: SpecialAttackState; timers: CombatTimers } | null {
  if (t.deathChargeActiveTicks <= 0 || t.deathChargeProcsRemaining <= 0) return null
  const procs = t.deathChargeProcsRemaining - 1
  return {
    special: { ...s, energy: Math.min(100, s.energy + 15) },
    timers: { ...t, deathChargeProcsRemaining: procs, deathChargeActiveTicks: procs === 0 ? 0 : t.deathChargeActiveTicks },
  }
}

/** scim: Mark of Darkness (x5 with the purging staff). */
export function castMarkOfDarkness(magicMax: number, purgingStaff: boolean, t: CombatTimers): CombatTimers | null {
  if (t.markOfDarknessCooldownTicks > 0) return null
  const base = magicMax * 3
  return { ...t, markOfDarknessCooldownTicks: 10, markOfDarknessActiveTicks: purgingStaff ? base * 5 : base }
}

// --- stat decay ------------------------------------------------------------------------------

/** scim: Preserve active for at least 25 ticks. */
export function preserveReady(prayer: PrayerState, tick: number): boolean {
  if (!prayer.activePrayers.includes('Preserve')) return false
  const at = prayer.prayerActivationTicks.Preserve
  return at !== undefined && tick - at >= 25
}


export function decayBoosts(
  stats: PlayerStats,
  boosts: readonly BoostRecord[],
  decayTick: number,
  prevTick: number,
  preserve: boolean,
  extended: boolean,
): { stats: PlayerStats; potionBoosts: BoostRecord[]; nextDecayTick: number; decayExtended: boolean } {
  const due = prevTick >= decayTick
  const postpone = due && preserve && !extended
  const decayNow = due && !postpone
  const nextDecayTick = postpone ? decayTick + 50 : decayNow ? prevTick + 100 : decayTick
  const decayExtended = postpone ? true : !decayNow && extended
  const s = copyStats(stats)
  const out: BoostRecord[] = []
  for (const b of boosts) {
    if (b.isDivine) {
      const left = dec(b.ticksRemaining)
      if (left > 0) out.push({ ...b, ticksRemaining: left })
      else s[b.stat] = { ...s[b.stat], current: s[b.stat].max }
      continue
    }
    if (!decayNow) {
      out.push({ ...b })
      continue
    }
    if (b.boostAmount <= 0) {
      s[b.stat] = { ...s[b.stat], current: s[b.stat].max }
      continue
    }
    const amount = Math.max(0, b.boostAmount - 1)
    s[b.stat] = { ...s[b.stat], current: s[b.stat].max + amount }
    if (amount > 0) out.push({ ...b, boostAmount: amount })
  }
  return { stats: s, potionBoosts: out, nextDecayTick, decayExtended }
}

// --- prayer drain -----------------------------------------------------------------------------

/** scim: prayers activated this tick do not drain. */
export function drainPrayer(state: PrayerState, prayerBonus: number, tick: number, drainMultiplier?: number): { state: PrayerState; drained: boolean } {
  if (state.activePrayers.length === 0 || state.points <= 0) return { state, drained: false }
  let total = 0
  for (const p of state.activePrayers) {
    const at = state.prayerActivationTicks[p as PrayerId]
    if (at !== undefined && at >= tick) continue
    total += prayerDrainRate(p)
  }
  if (total === 0) return { state, drained: false }
  if (drainMultiplier != null) total = Math.floor(total * drainMultiplier)
  const resistance = 2 * prayerBonus + 60
  let counter = state.drainCounter + total
  let points = state.points
  while (counter >= resistance && points > 0) {
    points -= 1
    counter -= resistance
  }
  if (points <= 0) return { state: { ...state, points: 0, drainCounter: 0, activePrayers: [], prayerActivationTicks: {} }, drained: true }
  return { state: { ...state, points, drainCounter: counter }, drained: false }
}
