import { describe, expect, it } from 'vitest'
import { Prayers } from './Prayers'

describe('Prayers', () => {
  it('applies toggles at the next tick and drains per tick', () => {
    const p = new Prayers(99)
    p.toggle('protectFromMagic')
    expect(p.active.size).toBe(0)
    p.applyQueued()
    expect(p.overhead).toBe('protectFromMagic')
    // Protect prayers drain 12/tick; with +0 bonus a point goes every 6 ticks.
    for (let i = 0; i < 5; i++) p.drain(0)
    expect(p.points).toBe(99)
    p.drain(0)
    expect(p.points).toBe(98)
  })

  it('a 1-tick flick costs nothing', () => {
    const p = new Prayers(99)
    for (let tick = 0; tick < 100; tick++) {
      p.applyQueued()
      p.drain(0)
      // Off then on within the same tick.
      p.toggle('rigour')
      p.toggle('rigour')
    }
    expect(p.points).toBe(99)
    expect(p.active.has('rigour')).toBe(false)
  })

  it('switching overheads replaces the previous one and rigour clears eagle eye', () => {
    const p = new Prayers(99)
    p.toggle('protectFromMelee')
    p.toggle('eagleEye')
    p.applyQueued()
    p.toggle('protectFromMissiles')
    p.toggle('rigour')
    p.applyQueued()
    expect([...p.active].sort()).toEqual(['protectFromMissiles', 'rigour'])
    expect(p.multiplier('rangedStrength')).toBe(1.23)
    expect(p.multiplier('defence')).toBe(1.25)
  })

  it('cannot activate above prayer level or with 0 points', () => {
    const p = new Prayers(50)
    p.toggle('rigour')
    p.applyQueued()
    expect(p.active.size).toBe(0)
    p.points = 0
    p.toggle('protectFromMelee')
    p.applyQueued()
    expect(p.active.size).toBe(0)
  })
})
