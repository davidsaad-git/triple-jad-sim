import { describe, expect, it } from 'vitest'
import { clampOffset, offsetToPosition, positionToOffset } from './FloatingWidget'
import { exportGroundMarkers, formatMarkerColor, importGroundMarkers, INFERNO_REGION_ID, mergeMarkers, parseMarkerColor } from './groundMarkers'
import { attackCooldownRatio, ATTACK_COOLDOWN_TICKS_COLOR, overheadNumbers, stackedBarY } from './overhead'

describe('attack timer metronome', () => {
  it('shows 1, 2/3, 1/3, 0 for a 4-tick weapon and hides on the attack tick', () => {
    expect([10, 11, 12, 13, 14].map((t) => attackCooldownRatio(14, 4, t))).toEqual([1, 2 / 3, 1 / 3, 0, null])
    expect(attackCooldownRatio(undefined, 4, 1)).toBeNull()
    expect(attackCooldownRatio(20, 1, 19)).toBe(0)
  })
  it('stacks bars under the health bar', () => {
    expect(stackedBarY(100, 1)).toBe(116)
    expect(stackedBarY(100, 2)).toBe(125)
  })
})

describe('overhead numbers', () => {
  const place = { fontSize: 24, abovePrayerIcon: false, offsetX: 0, offsetY: 0 }
  it('fills the prayer-icon slot by default', () => {
    const [n] = overheadNumbers({ x: 200, y: 100 }, false, 6, { tickCounter: { ...place, max: 4, colors: {} } })
    expect(n).toMatchObject({ text: '2', color: '#d4a84b', x: 200, y: 100 - 12.5, fontSize: 24 })
  })
  it('lifts above the prayer icon when asked and applies offsets', () => {
    const [n] = overheadNumbers({ x: 200, y: 100 }, true, 6, { tickCounter: { ...place, abovePrayerIcon: true, offsetX: 5, offsetY: 10, max: 4, colors: {} } })
    expect(n!.x).toBe(205)
    expect(n!.y).toBe(100 - 25 - 12 - 2 - 10)
  })
  it('stacks the cooldown number 2 px above the tick counter', () => {
    const list = overheadNumbers({ x: 0, y: 100 }, false, 10, { tickCounter: { ...place, max: 4, colors: {} }, attackCooldown: { ...place, nextAttackTick: 13 } })
    const tick = list.find((n) => n.key === 'player-tick-counter')!
    const cd = list.find((n) => n.key === 'player-attack-cooldown-ticks')!
    expect(cd.text).toBe('3')
    expect(cd.color).toBe(ATTACK_COOLDOWN_TICKS_COLOR)
    expect(tick.y).toBe(87.5)
    expect(cd.y).toBe(87.5 - 12 - 2 - 12)
  })
  it('hides the cooldown number once the timer is done', () => {
    expect(overheadNumbers({ x: 0, y: 0 }, false, 13, { attackCooldown: { ...place, nextAttackTick: 13 } })).toEqual([])
  })
})

describe('floating widget positions', () => {
  it('converts anchors both ways', () => {
    expect(positionToOffset({ x: 235, y: 96, anchorX: 'right', anchorY: 'top' }, 170, 130, 1000, 800)).toEqual({ left: 595, top: 96 })
    expect(offsetToPosition(595, 96, 170, 130, 1000, 800, 'right', 'top')).toEqual({ x: 235, y: 96, anchorX: 'right', anchorY: 'top' })
    expect(offsetToPosition(10, 700, 100, 50, 1000, 800, 'left', 'bottom')).toEqual({ x: 10, y: 50, anchorX: 'left', anchorY: 'bottom' })
  })
  it('clamps into the viewport', () => {
    expect(clampOffset(-20, 900, 100, 50, 1000, 800)).toEqual({ left: 0, top: 750 })
  })
})

describe('ground markers import/export', () => {
  it('formats colours as #AARRGGBB and back', () => {
    expect(formatMarkerColor('#3ba9ff', 1)).toBe('#FF3BA9FF')
    expect(formatMarkerColor('#00BFA5', 0.8)).toBe('#CC00BFA5')
    expect(parseMarkerColor('#CC00BFA5')).toEqual({ color: '#00BFA5', opacity: 0.8 })
    expect(parseMarkerColor('ff0000')).toEqual({ color: '#FF0000', opacity: 1 })
    expect(parseMarkerColor('bad')).toEqual({ color: '#3BA9FF', opacity: 1 })
  })
  it('round-trips markers of the Inferno region only', () => {
    const json = exportGroundMarkers([{ x: 31, y: 33, color: '#3BA9FF', opacity: 1, label: 'start' }])
    expect(JSON.parse(json)).toEqual([{ regionId: INFERNO_REGION_ID, regionX: 31, regionY: 33, z: 0, color: '#FF3BA9FF', label: 'start' }])
    expect(importGroundMarkers(json)).toEqual([{ x: 31, y: 33, color: '#3BA9FF', opacity: 1, label: 'start' }])
    expect(importGroundMarkers(JSON.stringify([{ regionId: 1, regionX: 1, regionY: 1 }]))).toEqual([])
    expect(importGroundMarkers('nope')).toBeNull()
    expect(INFERNO_REGION_ID).toBe(9043)
  })
  it('lets imported markers replace existing ones on the same tile', () => {
    const merged = mergeMarkers([{ x: 1, y: 1, color: '#000000', opacity: 1 }, { x: 2, y: 2, color: '#000000', opacity: 1 }], [{ x: 1, y: 1, color: '#FFFFFF', opacity: 0.5 }])
    expect(merged).toEqual([{ x: 2, y: 2, color: '#000000', opacity: 1 }, { x: 1, y: 1, color: '#FFFFFF', opacity: 0.5 }])
  })
})
