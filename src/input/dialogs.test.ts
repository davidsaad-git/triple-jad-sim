import { describe, expect, it } from 'vitest'
import { getContextMenu, hideContextMenu, showContextMenu, subscribeContextMenu } from './contextMenuStore'
import { COLOR_SWATCHES, hexToHsv, hsvToHex, normalizeHex } from './dialogs'

describe('colour picker maths', () => {
  it('normalizes hex input', () => {
    expect(normalizeHex('3ba9ff')).toBe('#3BA9FF')
    expect(normalizeHex(' #3Ba9fF ')).toBe('#3BA9FF')
    expect(normalizeHex('#3ba9f')).toBeNull()
    expect(normalizeHex('zzzzzz')).toBeNull()
  })

  it('round-trips every preset swatch through HSV', () => {
    for (const s of COLOR_SWATCHES) {
      const hsv = hexToHsv(s.color)
      expect(hsvToHex(hsv.h, hsv.s, hsv.v)).toBe(s.color.toUpperCase())
    }
  })

  it('pure hues and greys', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#FF0000')
    expect(hsvToHex(120, 1, 1)).toBe('#00FF00')
    expect(hsvToHex(240, 1, 1)).toBe('#0000FF')
    expect(hsvToHex(0, 0, 0.5)).toBe('#808080')
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 })
  })
})

describe('context menu store', () => {
  it('opens with entries only and notifies on open/close', () => {
    let n = 0
    const off = subscribeContextMenu(() => n++)
    showContextMenu({ entries: [] }, 1, 2)
    expect(getContextMenu()).toBeNull()
    showContextMenu({ entries: [{ action: 'Cancel' }] }, 10, 20)
    expect(getContextMenu()).toMatchObject({ x: 10, y: 20 })
    hideContextMenu()
    hideContextMenu()
    off()
    expect(getContextMenu()).toBeNull()
    expect(n).toBe(2)
  })
})
