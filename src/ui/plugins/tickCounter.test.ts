import { describe, expect, it } from 'vitest'
import { defaultTickColor, resetTickColor, setAllTickColors, setTickColor, tickColor, tickCounterInfobox, tickCounterValue, tickRange, uniformTickColor } from './tickCounter'

describe('Tick Counter', () => {
  it('counts ((tick - 1) mod max) + 1', () => {
    expect([1, 2, 3, 4, 5, 6, 8, 9].map((t) => tickCounterValue(t, 4))).toEqual([1, 2, 3, 4, 1, 2, 4, 1])
    expect(tickCounterValue(0, 4)).toBe(4)
    expect(tickCounterValue(7, 3)).toBe(1)
  })

  it('uses scim default 4-tick colours', () => {
    expect([1, 2, 3, 4].map((t) => defaultTickColor(t, 4))).toEqual(['#d2bea0', '#d4a84b', '#dc8c33', '#d67c7c'])
  })

  it('interpolates the gradient for other cycle lengths', () => {
    expect(defaultTickColor(1, 2)).toBe('#d2bea0')
    expect(defaultTickColor(2, 2)).toBe('#d67c7c')
    expect(defaultTickColor(1, 1)).toBe('#c8aa6e')
    const c = defaultTickColor(3, 5) // p = 0.5, between 0.33 and 0.66
    expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('prefers per-tick overrides', () => {
    expect(tickColor(2, 4, { '2': '#ff0000' })).toBe('#ff0000')
    expect(tickColor(3, 4, { '2': '#ff0000' })).toBe('#dc8c33')
  })

  it('edits the colour map like scim chips', () => {
    expect(tickRange(4)).toEqual([1, 2, 3, 4])
    expect(tickRange(25)).toHaveLength(20)
    const all = setAllTickColors(3, '#123456')
    expect(all).toEqual({ '1': '#123456', '2': '#123456', '3': '#123456' })
    expect(uniformTickColor(3, all)).toBe('#123456')
    const one = setTickColor(all, 2, '#000000')
    expect(uniformTickColor(3, one)).toBeNull()
    const reset = resetTickColor(one, 2)
    expect(reset['2']).toBeUndefined()
    expect(resetTickColor(reset, 2)).toBe(reset)
  })

  it('builds the infobox tile', () => {
    const cfg = { showTickCounter: true, showTickCounterInfobox: true, tickCounterMax: 4, tickCounterColors: {} }
    expect(tickCounterInfobox(6, cfg)).toEqual({ id: 'tick-counter', text: '2', textColor: '#d4a84b', tooltipTitle: 'Tick Counter', tooltipDetail: 'Tick 2 of 4' })
    expect(tickCounterInfobox(6, { ...cfg, showTickCounterInfobox: false })).toBeNull()
    expect(tickCounterInfobox(6, { ...cfg, showTickCounter: false })).toBeNull()
  })
})
