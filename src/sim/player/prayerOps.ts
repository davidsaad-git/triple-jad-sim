/**
 * Prayer-slot state machine and
 * the pending-input projection the UI shows.
 */
import type { CooldownTracks, Equipment, Inventory, PrayerId } from '../api'
import type { InputOp, PrayerOp } from '../core/types'
import { prayerCategory } from '../data/prayers'
import { consumableDef, setTrack, trackReady, type ItemEffect } from '../items/consumables'
import { hasEnhancedPrayerRestoration, prayerRestoreAmount } from '../items/itemEffects'
import { consumeInventory } from './inventory'

export interface PrayerSlots {
  protection: PrayerId | null
  offensive: PrayerId | null
  independent: PrayerId[]
  quickPrayersActive: boolean
}

export interface PrayerTransition {
  slot: 'protection' | 'offensive' | 'independent'
  from: PrayerId | null
  to: PrayerId | null
}

export interface PrayerOpResult extends PrayerSlots {
  protectionTouched: boolean
  offensiveTouched: boolean
  independentTouched: boolean
  /** Prayers (re)activated by the ops that are still active afterwards. */
  activated: PrayerId[]
  rejected: PrayerId[]
  transitions: PrayerTransition[]
}

/** scim: split a quick-prayer selection into slots. */
export function splitSelection(selections: readonly PrayerId[]): { protection: PrayerId | null; offensive: PrayerId | null; independent: PrayerId[] } {
  let protection: PrayerId | null = null
  let offensive: PrayerId | null = null
  const independent: PrayerId[] = []
  for (const p of selections) {
    const c = prayerCategory(p)
    if (c === 'protection') protection = p
    else if (c === 'offensive') offensive = p
    else if (!independent.includes(p)) independent.push(p)
  }
  return { protection, offensive, independent }
}

/** scim: apply prayer ops in order, each with its own "has points" flag. */
export function applyPrayerOps(start: PrayerSlots, ops: readonly { action: PrayerOp; hasPrayerPoints: boolean }[]): PrayerOpResult {
  let protection = start.protection
  let offensive = start.offensive
  let independent = [...start.independent]
  let quick = start.quickPrayersActive
  let protectionTouched = false
  let offensiveTouched = false
  let independentTouched = false
  const activated = new Set<PrayerId>()
  const rejected: PrayerId[] = []
  const transitions: PrayerTransition[] = []
  const markActivated = (from: PrayerId | null, to: PrayerId | null): void => {
    if (to !== null && to !== from) activated.add(to)
  }
  const setProtection = (p: PrayerId | null): void => {
    if (protection !== p) {
      transitions.push({ slot: 'protection', from: protection, to: p })
      protection = p
    }
  }
  const setOffensive = (p: PrayerId | null): void => {
    if (offensive !== p) {
      transitions.push({ slot: 'offensive', from: offensive, to: p })
      offensive = p
    }
  }
  const setIndependent = (next: PrayerId[]): void => {
    for (const p of independent) if (!next.includes(p)) transitions.push({ slot: 'independent', from: p, to: null })
    for (const p of next) if (!independent.includes(p)) transitions.push({ slot: 'independent', from: null, to: p })
    independent = [...next]
  }
  for (const { action, hasPrayerPoints } of ops) {
    if (action.type === 'protection') {
      protectionTouched = true
      quick = false
      if (action.prayer === null || action.prayer === protection) setProtection(null)
      else if (hasPrayerPoints) {
        markActivated(protection, action.prayer)
        setProtection(action.prayer)
      } else rejected.push(action.prayer)
      continue
    }
    if (action.type === 'offensive') {
      offensiveTouched = true
      quick = false
      if (action.prayer === null || action.prayer === offensive) setOffensive(null)
      else if (hasPrayerPoints) {
        markActivated(offensive, action.prayer)
        setOffensive(action.prayer)
      } else rejected.push(action.prayer)
      continue
    }
    if (action.type === 'independent') {
      independentTouched = true
      quick = false
      if (independent.includes(action.prayer)) setIndependent(independent.filter((p) => p !== action.prayer))
      else if (hasPrayerPoints) {
        activated.add(action.prayer)
        setIndependent([...independent, action.prayer])
      } else rejected.push(action.prayer)
      continue
    }
    // quickPrayers
    if (quick) {
      protectionTouched = true
      offensiveTouched = true
      independentTouched = true
      quick = false
      setProtection(null)
      setOffensive(null)
      setIndependent([])
      continue
    }
    const sel = splitSelection(action.selections)
    if (sel.protection !== null || sel.offensive !== null || sel.independent.length !== 0) {
      if (!hasPrayerPoints) {
        rejected.push((sel.protection ?? sel.offensive ?? sel.independent[0])!)
        continue
      }
      protectionTouched = true
      offensiveTouched = true
      independentTouched = true
      quick = true
      markActivated(protection, sel.protection)
      markActivated(offensive, sel.offensive)
      for (const p of sel.independent) if (!independent.includes(p)) activated.add(p)
      setProtection(sel.protection)
      setOffensive(sel.offensive)
      setIndependent(sel.independent)
    }
  }
  return {
    protection,
    offensive,
    independent,
    quickPrayersActive: quick,
    protectionTouched,
    offensiveTouched,
    independentTouched,
    activated: [...activated].filter((p) => p === protection || p === offensive || independent.includes(p)),
    rejected,
    transitions,
  }
}


export function applyPrayerOpsWithPoints(start: PrayerSlots, ops: readonly PrayerOp[], hasPoints: boolean): PrayerOpResult {
  return applyPrayerOps(
    start,
    ops.map((action) => ({ action, hasPrayerPoints: hasPoints })),
  )
}

function isPrayerOp(op: InputOp): op is PrayerOp {
  return op.type === 'protection' || op.type === 'offensive' || op.type === 'independent' || op.type === 'quickPrayers'
}

export interface PrayerProjectionInput {
  start: PrayerSlots
  hasPrayerPoints: boolean
  ops: readonly InputOp[]
  inventory: Inventory
  equipment: Equipment
  cooldownTracks: CooldownTracks
  prayerLevel: number
  playerHp: number
  inputTick: number
  restoreRules: { allowed: boolean; multiplier?: number }
}

/** scim: does a queued item restore prayer points? */
function restoresPrayer(effects: readonly ItemEffect[], input: PrayerProjectionInput): boolean {
  if (!input.restoreRules.allowed) return false
  const enhanced = hasEnhancedPrayerRestoration(input.equipment, input.inventory)
  const mult = input.restoreRules.multiplier ?? 1
  for (const e of effects) {
    const amount = e.op === 'restore_prayer' ? e.amount : e.op === 'restore_prayer_formula' ? prayerRestoreAmount(e.formula, input.prayerLevel, enhanced) : 0
    if (amount > 0 && Math.floor(amount * mult) > 0) return true
  }
  return false
}

/** scim: project the queued prayer ops (items that restore points unlock later activations). */
export function projectPendingPrayers(input: PrayerProjectionInput): PrayerOpResult {
  let hasPoints = input.hasPrayerPoints
  let inventory = input.inventory
  let tracks = input.cooldownTracks
  let untrackedUsed = false
  const ops: { action: PrayerOp; hasPrayerPoints: boolean }[] = []
  for (const op of input.ops) {
    if (isPrayerOp(op)) {
      ops.push({ action: op, hasPrayerPoints: hasPoints })
      continue
    }
    if (op.type !== 'use_item') continue
    const item = inventory[op.inventoryIndex]
    if (!item) continue
    const def = consumableDef(item.id, op.option)
    if (!def) continue
    const tracked = def.track !== undefined && (def.delayTicks ?? 0) > 0
    if (tracked && !trackReady(tracks, def.track!, input.inputTick)) continue
    if (def.track === undefined && untrackedUsed) continue
    if (def.minHpToUse !== undefined && input.playerHp < def.minHpToUse) continue
    if (!hasPoints && restoresPrayer(def.effects, input)) hasPoints = true
    inventory = consumeInventory(inventory, op.inventoryIndex, def.consume)
    if (tracked) tracks = setTrack(tracks, def.track!, input.inputTick, def.delayTicks ?? 0)
    untrackedUsed ||= def.track === undefined
  }
  return applyPrayerOps(input.start, ops)
}
