/**
 * Item effect interpreter plus
 * prayer restore formulas and the saturated
 * heart / boost helpers (`KU`).
 */
import type { CooldownTracks, Equipment, Inventory, PlayerStats, PrayerState, RunEnergyState, SkillName, SpecialAttackState } from '../api'
import type { ActiveEffect, BoostRecord, CombatTimers, PoisonState } from '../core/types'
import type { ItemEffect, PrayerRestoreFormula } from './consumables'

export interface ItemActionState {
  playerHP: number
  maxHP: number
  stats: PlayerStats
  poisonState: PoisonState
  potionBoosts: BoostRecord[]
  prayerState: PrayerState
  runEnergy: RunEnergyState
  specialAttack: SpecialAttackState
  combatTimers: CombatTimers
  cooldownTracks: CooldownTracks
  activeEffects: ActiveEffect[]
  currentTick: number
}

export interface EffectModifiers {
  healing?: number | undefined
  prayerRestore?: number | undefined
  blockOverheal?: boolean | undefined
  enhancedPrayerRestoration?: boolean | undefined
}

const VENOM_THRESHOLD = 1_000_000
const VENOM_BASE = 999_997

/** scim: copy every skill record. */
export function copyStats(s: PlayerStats): PlayerStats {
  return {
    attack: { ...s.attack },
    strength: { ...s.strength },
    defence: { ...s.defence },
    ranged: { ...s.ranged },
    magic: { ...s.magic },
    prayer: { ...s.prayer },
    hitpoints: { ...s.hitpoints },
  }
}


function scaleBy(v: number, m: number | undefined): number {
  return m === undefined ? v : Math.floor(v * m)
}

// --- prayer restore formulas ------------------------------------------------------

const RESTORE_FORMULAS: Readonly<Record<PrayerRestoreFormula, { basePercent: number; enhancedPercent: number; flat: number }>> = {
  super_restore: { basePercent: 0.25, enhancedPercent: 0.27, flat: 8 },
  sanfew: { basePercent: 0.3, enhancedPercent: 0.32, flat: 4 },
  prayer_potion: { basePercent: 0.25, enhancedPercent: 0.27, flat: 7 },
}


export function prayerRestoreAmount(formula: PrayerRestoreFormula, prayerLevel: number, enhanced: boolean): number {
  const f = RESTORE_FORMULAS[formula]
  return Math.floor(prayerLevel * (enhanced ? f.enhancedPercent : f.basePercent)) + f.flat
}

const HOLY_WRENCH = 6714
const ENHANCING_RINGS = [13202, 25252, 26764]
const PRAYER_CAPES = [9759, 9760, 13280, 13342]

/** scim: ring of the gods (i), prayer/max capes or a holy wrench enhance restores. */
export function hasEnhancedPrayerRestoration(equipment: Equipment, inventory: Inventory): boolean {
  if (ENHANCING_RINGS.some((r) => r === equipment.ring)) return true
  if (equipment.cape !== undefined && PRAYER_CAPES.includes(equipment.cape)) return true
  return inventory.some((i) => i !== null && (i.id === HOLY_WRENCH || PRAYER_CAPES.includes(i.id)))
}

// --- boosts ------------------------------------------------------------------------

/** scim: a boost sets current = max + amount. */
export function boostStat(stats: PlayerStats, stat: SkillName, amount: number, isDivine = false, ticks?: number): { stats: PlayerStats; boost: BoostRecord } {
  const s = copyStats(stats)
  s[stat] = { ...s[stat], current: s[stat].max + amount }
  return { stats: s, boost: { stat, boostAmount: amount, isDivine, ticksRemaining: isDivine ? (ticks ?? 500) : 0 } }
}

/** scim: saturated heart (needs both heart timers at 0). */
export function saturatedHeart(stats: PlayerStats, timers: CombatTimers): { stats: PlayerStats; timers: CombatTimers } | null {
  if (timers.saturatedHeartCooldownTicks > 0 || timers.saturatedHeartActiveTicks > 0) return null
  const amount = 4 + Math.floor(stats.magic.max * 0.1)
  const s = copyStats(stats)
  s.magic = { ...s.magic, current: stats.magic.max + amount }
  return { stats: s, timers: { ...timers, saturatedHeartCooldownTicks: 500, saturatedHeartActiveTicks: 500 } }
}

// --- single effects ------------------------------------------------------------------

function applyBoost(st: ItemActionState, stat: SkillName, amount: number): ItemActionState {
  const { stats, boost } = boostStat(st.stats, stat, amount)
  const idx = st.potionBoosts.findIndex((b) => b.stat === stat)
  const boosts = [...st.potionBoosts]
  if (idx >= 0) boosts[idx] = boost
  else boosts.push(boost)
  return { ...st, stats, potionBoosts: boosts }
}

function applyDrain(st: ItemActionState, stat: SkillName, amount: number): ItemActionState {
  const s = copyStats(st.stats)
  s[stat] = { ...s[stat], current: Math.max(0, st.stats[stat].current - amount) }
  return { ...st, stats: s }
}

function restorePrayer(st: ItemActionState, amount: number): ItemActionState {
  return { ...st, prayerState: { ...st.prayerState, points: Math.min(st.prayerState.maxPoints, st.prayerState.points + amount) } }
}

/** scim: restore all non-HP stats by floor(max * 0.25) + 8. */
function restoreAllStats(st: ItemActionState, prayerMult: number | undefined): ItemActionState {
  const s = copyStats(st.stats)
  for (const k of ['attack', 'strength', 'defence', 'ranged', 'magic', 'prayer'] as const) {
    const cur = s[k].current
    const max = s[k].max
    if (cur < max) {
      const base = Math.floor(max * 0.25) + 8
      const amt = k === 'prayer' ? scaleBy(base, prayerMult) : base
      s[k] = { ...s[k], current: Math.min(max, cur + amt) }
    }
  }
  return { ...st, stats: s }
}

/** Venom as an equivalent poison severity. */
function venomAsPoison(varp: number): number {
  return Math.min((varp - VENOM_BASE) * 2, 20) * 5
}


export function applyItemEffect(e: ItemEffect, st: ItemActionState, m: EffectModifiers | undefined): ItemActionState {
  switch (e.op) {
    case 'heal': {
      const amt = scaleBy(e.amount, m?.healing)
      return { ...st, playerHP: Math.max(st.playerHP, Math.min(st.maxHP, st.playerHP + amt)) }
    }
    case 'heal_formula': {
      const lvl = st.stats[e.scaleStat].max
      const formula = Math.floor(lvl / 10) + 2 * Math.floor(lvl / 25) + 5 * Math.floor(lvl / 93) + 2
      const amt = scaleBy(Math.max(formula, e.baseAmount), m?.healing)
      const cap = m?.blockOverheal ? st.maxHP : st.maxHP + amt
      return { ...st, playerHP: Math.min(cap, st.playerHP + amt) }
    }
    case 'overheal': {
      const amt = scaleBy(e.amount, m?.healing)
      return { ...st, playerHP: Math.min(m?.blockOverheal ? st.maxHP : st.maxHP + amt, st.playerHP + amt) }
    }
    case 'overheal_formula': {
      const amt = scaleBy(Math.floor(st.stats[e.scaleStat].max * e.percent) + e.flat, m?.healing)
      return { ...st, playerHP: Math.min(m?.blockOverheal ? st.maxHP : st.maxHP + amt, st.playerHP + amt) }
    }
    case 'delayed_heal': {
      const amount = scaleBy(e.amount, m?.healing)
      const effects = e.group ? st.activeEffects.filter((x) => x.data?.group !== e.group) : st.activeEffects
      const effect: ActiveEffect = {
        id: `delayed_heal_${st.currentTick}_${amount}_${e.delayTicks}`,
        type: 'delayed_heal',
        ticksRemaining: e.delayTicks,
        tickDuration: e.delayTicks,
        startedTick: st.currentTick,
        data: { amount, group: e.group },
      }
      return { ...st, activeEffects: [...effects, effect] }
    }
    case 'boost':
      return applyBoost(st, e.stat, e.amount)
    case 'boost_formula':
      return applyBoost(st, e.stat, Math.floor(st.stats[e.scaleStat].max * e.percent) + e.flat)
    case 'drain':
      return applyDrain(st, e.stat, e.amount)
    case 'drain_formula':
      return applyDrain(st, e.stat, Math.floor(st.stats[e.stat].current * e.percent) + e.flat)
    case 'restore_prayer':
      return restorePrayer(st, scaleBy(e.amount, m?.prayerRestore))
    case 'restore_prayer_formula':
      return restorePrayer(st, scaleBy(prayerRestoreAmount(e.formula, st.stats.prayer.max, m?.enhancedPrayerRestoration ?? false), m?.prayerRestore))
    case 'restore_all_stats':
      return restoreAllStats(st, m?.prayerRestore)
    case 'restore_run':
      return { ...st, runEnergy: { energy: Math.min(10000, st.runEnergy.energy + e.amount) } }
    case 'surge':
      return {
        ...st,
        specialAttack: { ...st.specialAttack, energy: Math.min(100, st.specialAttack.energy + e.percent) },
        combatTimers: { ...st.combatTimers, surgePotionCooldownTicks: 500 },
      }
    case 'cure_poison': {
      const base = st.poisonState.poisonVarp >= VENOM_THRESHOLD ? { ...st, poisonState: { ...st.poisonState, poisonVarp: venomAsPoison(st.poisonState.poisonVarp) } } : st
      return { ...base, poisonState: { ...base.poisonState, poisonVarp: -Math.ceil(e.immunityTicks / 30), poisonTickCounter: 30, startedTick: base.currentTick } }
    }
    case 'reduce_poison': {
      const v = st.poisonState.poisonVarp
      if (v <= 0) return st
      const next = v >= VENOM_THRESHOLD ? Math.max(0, venomAsPoison(v) - e.amount) : Math.max(0, v - e.amount)
      return { ...st, poisonState: { ...st.poisonState, poisonVarp: next } }
    }
    case 'saturated_heart': {
      const r = saturatedHeart(st.stats, st.combatTimers)
      if (!r) return st
      const boost: BoostRecord = { stat: 'magic', boostAmount: 4 + Math.floor(st.stats.magic.max * 0.1), isDivine: true, ticksRemaining: 500 }
      return { ...st, stats: r.stats, combatTimers: r.timers, potionBoosts: [...st.potionBoosts.filter((b) => !(b.stat === 'magic' && b.isDivine)), boost] }
    }
    case 'apply_timed_effect': {
      const effect: ActiveEffect = {
        id: `${e.effectType}_${st.currentTick}`,
        type: e.effectType,
        ticksRemaining: e.durationTicks,
        tickDuration: e.durationTicks,
        startedTick: st.currentTick,
      }
      return { ...st, activeEffects: [...st.activeEffects.filter((x) => x.type !== e.effectType), effect] }
    }
    case 'self_damage':
      return { ...st, playerHP: Math.max(1, st.playerHP - e.amount) }
    case 'self_damage_formula':
      return { ...st, playerHP: Math.max(1, st.playerHP - (Math.floor(st.playerHP * e.percent) + e.flat)) }
  }
}

/** scim +: apply effects in order, then sync the hitpoints stat. */
export function applyItemEffects(effects: readonly ItemEffect[], state: ItemActionState, m?: EffectModifiers): ItemActionState {
  let st = state
  for (const e of effects) st = applyItemEffect(e, st, m)
  if (st.playerHP === st.stats.hitpoints.current) return st
  const s = copyStats(st.stats)
  s.hitpoints = { ...s.hitpoints, current: st.playerHP }
  return { ...st, stats: s }
}

/** scim: surge blocked (cooldown running or spec full). */
export function surgeBlocked(effects: readonly ItemEffect[], st: ItemActionState): boolean {
  return effects.some((e) => e.op === 'surge' && (st.combatTimers.surgePotionCooldownTicks > 0 || st.specialAttack.energy >= 100))
}
