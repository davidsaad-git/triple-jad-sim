import { describe, expect, it } from 'vitest'
import {
  bowHitDelay,
  effectiveLevel,
  hitChance,
  magicMaxHit,
  meleeMaxHit,
  npcMaxHit,
  rangedMaxHit,
  spellHitDelay,
  thrownHitDelay,
  twistedBowMultipliers,
} from './formulas'

describe('npcMaxHit', () => {
  it('reproduces the Inferno monsters listed on the wiki', () => {
    expect(npcMaxHit(600, 200)).toBe(251) // Zuk theoretical melee
    expect(npcMaxHit(400, 200)).toBe(169) // Zuk ranged component
    expect(npcMaxHit(150, 450)).toBe(128) // Zuk magic component
    expect(npcMaxHit(300, 80)).toBe(70) // Jal-Zek magic
    expect(npcMaxHit(510, 0)).toBe(52) // Jal-Zek melee
    expect(npcMaxHit(250, 50)).toBe(46) // Jal-Xil ranged
    expect(npcMaxHit(290, 40)).toBe(49) // Jal-ImKot
    expect(npcMaxHit(160, 45)).toBe(29) // Jal-Ak
    expect(npcMaxHit(120, 30)).toBe(19) // Jal-MejRah
  })
})

describe('player max hits', () => {
  it('melee: 99 strength, piety, aggressive, +120 strength bonus', () => {
    const eff = effectiveLevel({ level: 99, boost: 0, prayerMultiplier: 1.23, styleBonus: 3, voidMultiplier: 1 })
    expect(eff).toBe(132)
    expect(meleeMaxHit(eff, 120)).toBe(38)
  })

  it('ranged: 99 ranged, rigour, rapid, +100 ranged strength', () => {
    const eff = effectiveLevel({ level: 99, boost: 0, prayerMultiplier: 1.23, styleBonus: 0, voidMultiplier: 1 })
    expect(eff).toBe(129)
    expect(rangedMaxHit(eff, 100)).toBe(33)
  })

  it('magic: ice barrage with 25% damage bonus and slayer helm', () => {
    expect(magicMaxHit(30, 25)).toBe(37)
    expect(magicMaxHit(30, 25, 1.15)).toBe(42)
  })
})

describe('hitChance', () => {
  it('is symmetric around equal rolls', () => {
    expect(hitChance(1000, 1000)).toBeCloseTo(1000 / 2002, 6)
    expect(hitChance(2000, 1000)).toBeCloseTo(1 - 1002 / 4002, 6)
    expect(hitChance(0, 0)).toBe(0)
  })
})

describe('twistedBowMultipliers', () => {
  it('caps at 250 magic outside CoX', () => {
    const zuk = twistedBowMultipliers(150, 550)
    expect(zuk.accuracy).toBe(1.4)
    expect(zuk.damage).toBe(2.15)
  })
  it('scales down for low magic targets', () => {
    const low = twistedBowMultipliers(1, 0)
    expect(low.accuracy).toBe(0.39)
    expect(low.damage).toBe(0.53)
  })
})

describe('hit delays', () => {
  it('follows the wiki tables', () => {
    expect(bowHitDelay(1)).toBe(1)
    expect(bowHitDelay(3)).toBe(2)
    expect(bowHitDelay(9)).toBe(3)
    expect(thrownHitDelay(5)).toBe(1)
    expect(thrownHitDelay(6)).toBe(2)
    expect(spellHitDelay(1)).toBe(1)
    expect(spellHitDelay(2)).toBe(2)
    expect(spellHitDelay(8)).toBe(4)
  })
})
