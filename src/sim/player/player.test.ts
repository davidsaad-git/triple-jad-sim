import { describe, expect, it } from 'vitest'
import type { PrayerState } from '../api'
import { statsFromLevels, defaultBaseLevels } from './stats'
import { applyPrayerOpsWithPoints } from './prayerOps'
import { decayBoosts, drainPrayer, initialSpecialAttack, regenerateSpecial, runDrain, stepPoison, updateLightbearer, updateRunEnergy } from './timers'

describe('special attack regeneration', () => {
  it('+10 every 50 ticks once below 100, counter reset while full', () => {
    let s = { ...initialSpecialAttack(), energy: 50 }
    for (let i = 0; i < 49; i++) s = regenerateSpecial(s)
    expect(s.energy).toBe(50)
    s = regenerateSpecial(s)
    expect(s.energy).toBe(60)
    expect(s.regenTickCounter).toBe(50)
    const full = regenerateSpecial({ ...initialSpecialAttack(), regenTickCounter: 7 }, 100)
    expect(full.regenTickCounter).toBe(50)
  })
  it('lightbearer halves the period', () => {
    const s = updateLightbearer({ energy: 50, regenTickCounter: 40, lightbearerEquipped: false }, true)
    expect(s).toEqual({ energy: 50, regenTickCounter: 25, lightbearerEquipped: true })
    expect(updateLightbearer(s, false).regenTickCounter).toBe(50)
  })
})

describe('run energy', () => {
  it('40 per running tick at 0 kg, +24 otherwise, stamina x0.3', () => {
    expect(runDrain(0, 99)).toBe(40)
    expect(runDrain(64, 99)).toBe(85)
    expect(updateRunEnergy({ energy: 1000 }, { isRunning: true, agility: 99, weight: 0, drainMultiplier: 1 }).energy).toBe(960)
    expect(updateRunEnergy({ energy: 1000 }, { isRunning: true, agility: 99, weight: 0, drainMultiplier: 0.3 }).energy).toBe(988)
    expect(updateRunEnergy({ energy: 1000 }, { isRunning: false, agility: 99, weight: 0, drainMultiplier: 1 }).energy).toBe(1024)
  })
})

describe('stat boost decay', () => {
  it('decays by one at ticks 101, 201, ... from the boost', () => {
    const stats = statsFromLevels(defaultBaseLevels())
    stats.ranged = { current: 112, max: 99 }
    const boosts = [{ stat: 'ranged' as const, boostAmount: 13, isDivine: false, ticksRemaining: 0 }]
    const notDue = decayBoosts(stats, boosts, 100, 99, false, false)
    expect(notDue.stats.ranged.current).toBe(112)
    const due = decayBoosts(stats, boosts, 100, 100, false, false)
    expect(due.stats.ranged.current).toBe(111)
    expect(due.nextDecayTick).toBe(200)
    const preserved = decayBoosts(stats, boosts, 100, 100, true, false)
    expect(preserved.stats.ranged.current).toBe(112)
    expect(preserved.nextDecayTick).toBe(150)
    expect(preserved.decayExtended).toBe(true)
  })
})

describe('prayer drain', () => {
  it('prayers activated this tick do not drain; counter carries over', () => {
    const st: PrayerState = { points: 10, maxPoints: 99, drainCounter: 0, activePrayers: ['ProtectMagic'], prayerActivationTicks: { ProtectMagic: 5 } }
    expect(drainPrayer(st, 0, 5).state.drainCounter).toBe(0)
    let s = st
    for (let t = 6; t <= 10; t++) s = drainPrayer(s, 0, t).state
    expect(s.points).toBe(9)
    expect(s.drainCounter).toBe(0)
  })
  it('depletion clears the state', () => {
    const r = drainPrayer({ points: 1, maxPoints: 99, drainCounter: 55, activePrayers: ['Rigour'], prayerActivationTicks: {} }, 0, 3)
    expect(r.drained).toBe(true)
    expect(r.state.points).toBe(0)
  })
})

describe('prayer ops', () => {
  const start = { protection: null, offensive: null, independent: [], quickPrayersActive: false }
  it('toggle on, same prayer toggles off, no points rejects', () => {
    const on = applyPrayerOpsWithPoints(start, [{ type: 'protection', prayer: 'ProtectRange' }], true)
    expect(on.protection).toBe('ProtectRange')
    expect(on.activated).toEqual(['ProtectRange'])
    const off = applyPrayerOpsWithPoints({ ...start, protection: 'ProtectRange' }, [{ type: 'protection', prayer: 'ProtectRange' }], true)
    expect(off.protection).toBe(null)
    const rejected = applyPrayerOpsWithPoints(start, [{ type: 'protection', prayer: 'ProtectMagic' }], false)
    expect(rejected.rejected).toEqual(['ProtectMagic'])
    expect(rejected.protection).toBe(null)
  })
  it('switching protection is a single from->to transition', () => {
    const r = applyPrayerOpsWithPoints({ ...start, protection: 'ProtectMagic' }, [{ type: 'protection', prayer: 'ProtectRange' }], true)
    expect(r.transitions).toEqual([{ slot: 'protection', from: 'ProtectMagic', to: 'ProtectRange' }])
  })
})

describe('player poison', () => {
  it('poison, venom and immunity steps', () => {
    expect(stepPoison({ poisonVarp: 6, poisonTickCounter: 30, startedTick: null })).toMatchObject({ damage: 2, state: { poisonVarp: 5 } })
    expect(stepPoison({ poisonVarp: 1_000_000, poisonTickCounter: 30, startedTick: null })).toMatchObject({ damage: 6 })
    expect(stepPoison({ poisonVarp: -3, poisonTickCounter: 30, startedTick: null })).toMatchObject({ damage: 0, state: { poisonVarp: -2 } })
  })
})
