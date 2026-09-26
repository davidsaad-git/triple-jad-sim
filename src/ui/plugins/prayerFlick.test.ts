import { beforeEach, describe, expect, it } from 'vitest'
import { buildFlickBars, markGeometry, orbSweepGeometry, orbSweepVisible, prayerClickKind, prayerFlickRecorder, pruneClicks, tickFraction, type FlickClick } from './prayerFlick'

const W = { tick: 10, startTime: 6000, durationMs: 600 }

function click(id: number, kind: 'on' | 'off', clickTime: number, arrivalTime: number): FlickClick {
  return { id, kind, clickTime, arrivalTime }
}

describe('Prayer Flick Helper geometry', () => {
  it('maps times onto ticks relative to the latest window', () => {
    expect(tickFraction(6300, W)).toEqual({ tick: 10, fraction: 0.5 })
    expect(tickFraction(5700, W)).toEqual({ tick: 9, fraction: 0.5 })
    expect(tickFraction(6900, W).tick).toBe(11)
    expect(tickFraction(1, { tick: 3, startTime: 0, durationMs: 0 })).toEqual({ tick: 3, fraction: 0 })
  })

  it('shows three bars, newest first, with marks in their tick', () => {
    const r = buildFlickBars([click(1, 'on', 6060, 6180), click(2, 'off', 5460, 5520)], W)
    expect(r.bars.map((b) => b.tick)).toEqual([10, 9, 8])
    expect(r.bars[0]!.current).toBe(true)
    expect(r.bars[0]!.marks).toHaveLength(1)
    const m = r.bars[0]!.marks[0]!
    expect(m.clickFraction).toBeCloseTo(0.1)
    expect(m.arrivalFraction).toBeCloseTo(0.3)
    expect(r.bars[1]!.marks[0]!.kind).toBe('off')
    expect(r.clickCount).toBe(2)
    expect(r.slippedCount).toBe(0)
  })

  it('splits clicks that arrive on a later tick', () => {
    const r = buildFlickBars([click(1, 'on', 5940, 6030)], W) // click in tick 9 at 0.9, arrival in tick 10 at 0.05
    expect(r.slippedCount).toBe(1)
    expect(r.clickCount).toBe(1)
    const out = r.bars[1]!.marks[0]!
    const inb = r.bars[0]!.marks[0]!
    expect(out.arrivalFraction).toBeNull()
    expect(out.clickFraction).toBeCloseTo(0.9)
    expect(inb.clickFraction).toBeNull()
    expect(inb.arrivalFraction).toBeCloseTo(0.05)
    expect(markGeometry(out).width).toBeCloseTo(0.1)
    expect(markGeometry(inb).left).toBe(0)
  })

  it('ignores clicks outside the last three ticks and marks instant clicks', () => {
    const r = buildFlickBars([click(1, 'on', 3000, 3010), click(2, 'on', 6100, 6105)], W)
    expect(r.clickCount).toBe(1)
    expect(markGeometry(r.bars[0]!.marks[0]!).instant).toBe(true)
  })

  it('returns placeholder bars without a window', () => {
    const r = buildFlickBars([], null)
    expect(r.bars).toHaveLength(3)
    expect(r.clickCount).toBe(0)
    expect(r.durationMs).toBe(0)
  })

  it('prunes to 64 clicks and drops ones that arrived before the oldest bar', () => {
    const many = Array.from({ length: 70 }, (_, i) => click(i, 'on', 6000 + i, 6000 + i))
    expect(pruneClicks(many, null)).toHaveLength(64)
    expect(pruneClicks([click(1, 'on', 100, 200), click(2, 'on', 6000, 6010)], W).map((c) => c.id)).toEqual([2])
  })
})

describe('prayer flick recorder', () => {
  beforeEach(() => prayerFlickRecorder.reset())
  it('records windows and clicks (arrival never before the click)', () => {
    prayerFlickRecorder.recordTickWindow(10, 6000, 600)
    prayerFlickRecorder.recordClick('on', 6100, 6050)
    const s = prayerFlickRecorder.get()
    expect(s.window).toEqual(W)
    expect(s.clicks[0]!.arrivalTime).toBe(6100)
    prayerFlickRecorder.reset()
    expect(prayerFlickRecorder.get().clicks).toHaveLength(0)
  })
  it('parses prayer dispatch labels', () => {
    expect(prayerClickKind('prayer:on')).toBe('on')
    expect(prayerClickKind('prayer:off:ProtectMagic')).toBe('off')
    expect(prayerClickKind('quick-prayer:on')).toBe('on')
    expect(prayerClickKind('walk')).toBeNull()
    expect(prayerClickKind('prayer:online')).toBeNull()
    expect(prayerClickKind(undefined)).toBeNull()
  })
})

describe('prayer orb sweep', () => {
  it('traces the circle once per tick', () => {
    expect(orbSweepGeometry(0)).toEqual({ x: 0, y: 13, height: 0 })
    expect(orbSweepGeometry(0.5)).toEqual({ x: 13, y: 0, height: 26 })
    const q = orbSweepGeometry(0.25) // cos = sin = 0.7071
    expect(q.height).toBe(18)
    expect(q.x).toBe(Math.trunc(-0.70710678 * 13) + 13)
    expect(q.y).toBe(13 - 9)
    expect(orbSweepGeometry(0.999).x).toBe(25)
  })
  it('shows only with the plugin and an active prayer (or never-hide)', () => {
    const base = { prayerEnabled: true, flickOrbEnabled: true, alwaysOn: false, prayersCommitted: false, prayersPredicted: false }
    expect(orbSweepVisible(base)).toBe(false)
    expect(orbSweepVisible({ ...base, prayersCommitted: true })).toBe(true)
    expect(orbSweepVisible({ ...base, prayersPredicted: true })).toBe(true)
    expect(orbSweepVisible({ ...base, alwaysOn: true })).toBe(true)
    expect(orbSweepVisible({ ...base, alwaysOn: true, flickOrbEnabled: false })).toBe(false)
    expect(orbSweepVisible({ ...base, prayersCommitted: true, prayerEnabled: false })).toBe(false)
  })
})
