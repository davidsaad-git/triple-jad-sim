import { describe, expect, it } from 'vitest'
import type { SimEvent } from '../../sim/api'
import { XpDropSampler, xpDropOpacity, xpDropText, xpDropY } from './xpDrops'

let nextEventId = 1
function drop(tick: number, skills: [string, number][], predictedHit = 0): SimEvent {
  return {
    type: 'xp_drop',
    tick,
    eventId: nextEventId++,
    predictedHit,
    skills: skills.map(([skill, amount]) => ({ skill: skill as 'ranged', amount })),
  }
}

describe('XP drop motion', () => {
  it('holds full opacity until 80% of the 2 s life, then fades linearly', () => {
    expect(xpDropOpacity(0)).toBe(1)
    expect(xpDropOpacity(1600)).toBe(1)
    expect(xpDropOpacity(1800)).toBeCloseTo(0.5)
    expect(xpDropOpacity(2000)).toBeCloseTo(0)
    expect(xpDropOpacity(2500)).toBe(0)
  })

  it('rises at speed px/s', () => {
    const s = new XpDropSampler({ grouped: true, speed: 44 })
    s.ingest([drop(10, [['ranged', 200], ['hitpoints', 66]], 50)])
    const [d] = s.sample(10 * 600 + 500)
    expect(d).toBeDefined()
    expect(xpDropY(d!, 500, 44)).toBeCloseTo(-22)
    expect(xpDropText(d!, true)).toBe('266 (50)')
    expect(xpDropText(d!, false)).toBe('266')
  })

  it('groups one drop per attack, or one per skill with 400 ms stagger', () => {
    const grouped = new XpDropSampler({ grouped: true, speed: 44 })
    grouped.ingest([drop(10, [['ranged', 200], ['hitpoints', 66]], 50)])
    expect(grouped.sample(6000 + 1000)).toHaveLength(1)
    const split = new XpDropSampler({ grouped: false, speed: 44 })
    split.ingest([drop(10, [['ranged', 200], ['hitpoints', 66]], 50)])
    const list = split.sample(6000 + 1000)
    expect(list.map((d) => d.bornAtMs)).toEqual([6000, 6400])
    expect(list.map((d) => d.predictedHit)).toEqual([50, 0])
  })

  it('stacks a drop born within 2 s 26 px below the previous one', () => {
    const s = new XpDropSampler({ grouped: true, speed: 44 })
    s.ingest([drop(10, [['ranged', 100]])])
    s.ingest([drop(11, [['ranged', 100]])])
    const [a, b] = s.sample(6600)
    expect(a!.startOffsetPx).toBe(0)
    // previous moved up 0.6 s * 44 = 26.4 px; 26 px below that is -0.4, clamped at 0
    expect(b!.startOffsetPx).toBe(0)
    s.ingest([drop(11, [['ranged', 1]])])
    const c = s.sample(6600)[2]!
    expect(c.startOffsetPx).toBe(26)
  })

  it('ignores zero-xp drops, duplicates and expires after 2 s', () => {
    const s = new XpDropSampler({ grouped: true, speed: 44 })
    const e = drop(10, [['ranged', 100]])
    s.ingest([e, e, drop(10, [['ranged', 0]])])
    expect(s.sample(6000)).toHaveLength(1)
    expect(s.sample(8000)).toHaveLength(0)
    expect(s.sample(5999)).toHaveLength(0)
  })

  it('formats xp with en-US grouping', () => {
    const s = new XpDropSampler({ grouped: true, speed: 44 })
    s.ingest([drop(1, [['ranged', 12345]])])
    expect(xpDropText(s.sample(600)[0]!, true)).toBe('12,345')
  })
})
