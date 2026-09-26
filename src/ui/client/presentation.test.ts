import { describe, expect, it } from 'vitest'
import type { SimState } from '../../sim/api'
import { applyPrayerToggle, ClientPresentation, isPrayerLit } from './presentation'

function state(p: Partial<SimState> = {}): SimState {
  return {
    currentTick: 10,
    activePrayer: null,
    offensivePrayer: null,
    independentPrayers: [],
    pendingProtectionPrayer: [false, null],
    pendingOffensivePrayer: [false, null],
    pendingIndependentPrayers: [false, []],
    prayerState: { points: 50 },
    isSpecialAttackActive: false,
    pendingSpecialAttackActive: false,
    ...p,
  } as unknown as SimState
}

describe('prayer slot rules', () => {
  it('replaces within a group and toggles independents', () => {
    const v = { protection: 'ProtectMagic' as const, offensive: null, independent: [] }
    expect(applyPrayerToggle(v, 'ProtectRange', true).protection).toBe('ProtectRange')
    expect(applyPrayerToggle(v, 'ProtectMagic', true).protection).toBeNull()
    expect(applyPrayerToggle(v, 'ProtectRange', false).protection).toBe('ProtectMagic')
  })
})

describe('click-time prayer overrides', () => {
  it('lights a prayer on press and retires the bit one tick after the lagged apply', () => {
    const p = new ClientPresentation()
    const s = state()
    const press = p.pressPrayer(s, 'ProtectMagic', false)
    expect(press.activates).toBe(true)
    expect(isPrayerLit('ProtectMagic', p.prayerDisplay(s, false), p.prayerDisplay(s, false).overrides)).toBe(true)
    expect(p.prayerDisplay(s, false).anyLit).toBe(true)
    press.retire(12)
    p.onTick(state({ currentTick: 12 }))
    expect(p.prayerDisplay(s, false).overrides.ProtectMagic).toBe(true)
    p.onTick(state({ currentTick: 13, activePrayer: 'ProtectMagic' }))
    expect(p.prayerDisplay(s, false).overrides.ProtectMagic).toBeUndefined()
  })

  it('a second press flips the override off (deactivation label)', () => {
    const p = new ClientPresentation()
    const s = state()
    p.pressPrayer(s, 'ProtectMagic', false)
    const second = p.pressPrayer(s, 'ProtectMagic', false)
    expect(second.activates).toBe(false)
    expect(p.prayerDisplay(s, false).overrides.ProtectMagic).toBe(false)
  })

  it('does nothing without prayer points', () => {
    const p = new ClientPresentation()
    const s = state({ prayerState: { points: 0 } as SimState['prayerState'] })
    expect(p.pressPrayer(s, 'ProtectMagic', false).activates).toBe(false)
    expect(p.prayerDisplay(s, false).anyLit).toBe(false)
  })

  it('instant prayer predicts the slots until the apply retires them', () => {
    const p = new ClientPresentation()
    const s = state({ activePrayer: 'ProtectRange' })
    const press = p.pressPrayer(s, 'ProtectMagic', true)
    expect(p.prayerDisplay(s, true).protection).toBe('ProtectMagic')
    press.retire(0)
    expect(p.prayerDisplay(s, true).protection).toBe('ProtectRange')
  })
})

describe('special attack projection', () => {
  it('flips the displayed state per pending toggle', () => {
    const p = new ClientPresentation()
    const s = state()
    const done1 = p.pressSpecial()
    expect(p.specialActive(s)).toBe(true)
    const done2 = p.pressSpecial()
    expect(p.specialActive(s)).toBe(false)
    done1()
    done1()
    expect(p.specialActive(s)).toBe(true)
    done2()
    expect(p.specialActive(s)).toBe(false)
  })
})
