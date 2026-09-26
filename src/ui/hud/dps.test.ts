import { describe, expect, it } from 'vitest'
import type { DamageHistoryEntry } from '../../sim/api'
import { dpsLuckClass, hpBarColor, hudCompactMode, hudDps, hudToolsLayout, targetLabel } from './dps'

function hit(tick: number, targetId: string, dmg: number, expected?: number, source = 'PlayerAttack'): DamageHistoryEntry {
  return {
    tick,
    source,
    targetId,
    baseDamage: dmg,
    attackType: 'range',
    activePrayer: null,
    prayedCorrectly: null,
    effectiveDamage: dmg,
    hpBefore: 350,
    hpAfter: 350 - dmg,
    ...(expected === undefined ? {} : { expectedHit: expected }),
  }
}

describe('HUD DPS', () => {
  it('is null before the first player hit on the target', () => {
    expect(hudDps([], 'jad1', 10)).toBeNull()
    expect(hudDps([hit(5, 'jad2', 30, 20)], 'jad1', 10)).toBeNull()
    expect(hudDps([hit(5, 'jad1', 30, 20)], undefined, 10)).toBeNull()
  })

  it('divides damage and expected damage by the seconds since the first hit', () => {
    const h = [hit(10, 'jad1', 40, 25), hit(15, 'jad1', 0, 25), hit(12, 'player', 50, undefined, 'JadMagic'), hit(20, 'jad1', 60, 25)]
    const d = hudDps(h, 'jad1', 30)!
    // 20 ticks * 0.6 s = 12 s
    expect(d.actual).toBeCloseTo(100 / 12)
    expect(d.expected).toBeCloseTo(75 / 12)
    expect(d.actual.toFixed(2)).toBe('8.33')
  })

  it('reports 0 on the tick of the first hit', () => {
    expect(hudDps([hit(10, 'jad1', 40, 25)], 'jad1', 10)).toEqual({ actual: 0, expected: 0 })
  })

  it('colours lucky >= 1.05x and unlucky < 0.9x expected', () => {
    expect(dpsLuckClass({ actual: 10.5, expected: 10 })).toBe('hud-dps-lucky')
    expect(dpsLuckClass({ actual: 10.49, expected: 10 })).toBe('')
    expect(dpsLuckClass({ actual: 9, expected: 10 })).toBe('')
    expect(dpsLuckClass({ actual: 8.99, expected: 10 })).toBe('hud-dps-unlucky')
    expect(dpsLuckClass({ actual: 5, expected: 0 })).toBe('')
    expect(dpsLuckClass(null)).toBe('')
  })

  it('uses scim hp thresholds', () => {
    expect(hpBarColor(32.9)).toBe('#d46a60')
    expect(hpBarColor(33)).toBe('#d4a848')
    expect(hpBarColor(65.9)).toBe('#d4a848')
    expect(hpBarColor(66)).toBe('#6dba6d')
  })

  it('labels the target from its archetype id', () => {
    const npc = { archetypeId: 'zuk_jad' } as Parameters<typeof targetLabel>[0]
    expect(targetLabel(npc)).toBe('Zuk_jad')
    expect(targetLabel({ archetypeId: 'jalTokJad' } as Parameters<typeof targetLabel>[0])).toBe('Jal Tok Jad')
    expect(targetLabel(undefined)).toBe('Target')
  })
})

describe('HUD tool layout', () => {
  it('stacks vertically at 216 px on tall viewports', () => {
    expect(hudToolsLayout({ width: 700, height: 900, horizontal: false })).toEqual({ horizontal: false, hudWidth: 216, practiceWidth: 216, width: 216, height: 900 })
  })
  it('goes side by side when horizontal and large enough', () => {
    const l = hudToolsLayout({ width: 900, height: 500, horizontal: true })
    expect(l.horizontal).toBe(true)
    expect(l.hudWidth).toBe(300)
    expect(l.practiceWidth).toBe(596)
    expect(l.width).toBe(900)
    expect(l.height).toBe(176)
  })
  it('clamps the HUD width to 224..332', () => {
    expect(hudToolsLayout({ width: 420, height: 200, horizontal: true }).hudWidth).toBe(224)
    expect(hudToolsLayout({ width: 1500, height: 200, horizontal: true }).hudWidth).toBe(332)
    expect(hudToolsLayout({ width: 415, height: 200, horizontal: true }).horizontal).toBe(false)
  })
  it('picks the compact HUD mode by width', () => {
    expect(hudCompactMode(false, 216)).toBe('column')
    expect(hudCompactMode(true, 332)).toBe('row')
    expect(hudCompactMode(true, 300)).toBe('row-tight')
    expect(hudCompactMode(true, 250)).toBe('narrow')
  })
})
