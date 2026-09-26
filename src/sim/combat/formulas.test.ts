import { describe, expect, it } from 'vitest'
import { JALTOK_JAD, YT_HURKOT } from '../data/monsters'
import { prayerMultipliers } from '../data/prayers'
import { emptyEquipmentStats } from '../items/itemStats'
import { twistedBowPercent } from './attackPlan'
import {
  baseMaxHit,
  effectiveDefence,
  effectiveMagicDefence,
  effectiveRangedAttack,
  hitChance,
  npcAttackRoll,
  npcDefenceRoll,
  playerDefenceRoll,
  playerMaxHit,
  rollNpcAttack,
  type NpcFormulaView,
  type PlayerFormulaView,
} from './formulas'
import { legacyHitDelay, npcHitDelayFromCycles, playerHitDelayFromCycles, projectileCycles, PROJECTILE_TIMINGS } from './timing'
import { JAD_MAGIC_PROJECTILE } from '../encounters/tripleJad/constants'

const jad: NpcFormulaView = { kind: 'npc', id: 7700, ...JALTOK_JAD.formulaStats }
const hurkot: NpcFormulaView = { kind: 'npc', id: 7701, ...YT_HURKOT.formulaStats }

function player99(stance: PlayerFormulaView['stance'] = 'Other'): PlayerFormulaView {
  return { kind: 'player', levels: { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99 }, stance }
}

describe('NPC attack and defence rolls', () => {
  it('JalTok-Jad attack rolls', () => {
    expect(npcAttackRoll(jad, 'magic')).toBe(85116)
    expect(npcAttackRoll(jad, 'ranged')).toBe(148176)
    expect(npcAttackRoll(jad, 'melee_stab')).toBe(48576)
  })
  it('Yt-HurKot melee roll', () => {
    expect(npcAttackRoll(hurkot, 'melee_crush')).toBe(11136)
  })
  it('defence rolls', () => {
    expect(npcDefenceRoll(jad, 'ranged')).toBe(31296)
    expect(npcDefenceRoll(jad, 'magic')).toBe(33216)
    expect(npcDefenceRoll(hurkot, 'ranged')).toBe(21146)
    expect(npcDefenceRoll(hurkot, 'magic')).toBe(30846)
    expect(npcDefenceRoll(hurkot, 'melee_crush')).toBe(6976)
  })
})

describe('player effective levels', () => {
  it('99 def / 99 magic with Rigour on rapid', () => {
    const pm = prayerMultipliers(null, 'Rigour')
    const p = player99('Other')
    expect(effectiveDefence(p, pm)).toBe(131)
    expect(effectiveMagicDefence(p, pm)).toBe(113)
  })
  it('keeps scim double arithmetic: floor(100 * 1.15) = 114', () => {
    const p: PlayerFormulaView = { ...player99('Other'), levels: { ...player99().levels, ranged: 100 } }
    expect(effectiveRangedAttack(p, prayerMultipliers(null, 'EagleEye'))).toBe(114 + 8)
  })
  it('player defence roll uses the equipment bonus of the style', () => {
    const eq = { ...emptyEquipmentStats(), defenceMagic: 100 }
    const pm = prayerMultipliers(null, 'Rigour')
    expect(playerDefenceRoll(player99('Other'), 'magic', eq, pm)).toBe(113 * 164)
  })
})

describe('hit chance', () => {
  it('matches both branches of GE', () => {
    expect(hitChance(100, 50)).toBeCloseTo(1 - 52 / 202, 12)
    expect(hitChance(50, 100)).toBeCloseTo(50 / 202, 12)
    expect(hitChance(85116, 113 * 164)).toBeCloseTo(1 - (113 * 164 + 2) / (2 * 85117), 12)
  })
})

describe('twisted bow scaling', () => {
  it('vs Jad (magic 510 -> capped 250): 140% / 215%', () => {
    expect(twistedBowPercent(250, true)).toBe(140)
    expect(twistedBowPercent(250, false)).toBe(215)
  })
  it('vs Yt-HurKot (magic 150): 114% / 164%', () => {
    expect(twistedBowPercent(150, true)).toBe(114)
    expect(twistedBowPercent(150, false)).toBe(164)
  })
})

describe('max hits', () => {
  it('baseMaxHit rounding', () => {
    expect(baseMaxHit(120, 100)).toBe(Math.floor((120 * 164 + 320) / 640))
  })
  it('magic max hit applies damage% and prayer in double arithmetic', () => {
    const p: PlayerFormulaView = { ...player99('Other'), magicBaseMaxHit: 34 }
    const eq = { ...emptyEquipmentStats(), magicDamage: 30 }
    expect(playerMaxHit(p, 'magic', eq, prayerMultipliers(null, 'Augury'))).toBe(Math.floor(34 * (1 + 0.3 + (1.04 - 1))))
  })
})

describe('NPC attack resolution', () => {
  it('always draws exactly two numbers: accuracy then damage', () => {
    const draws = [0.1, 0.5]
    let n = 0
    const rng = () => draws[n++] ?? 0
    const r = rollNpcAttack({ attacker: jad, target: player99('Other'), style: 'magic', random: rng, maxHitOverride: 113 })
    expect(n).toBe(2)
    expect(r.accuracySucceeded).toBe(true)
    expect(r.rolledDamage).toBe(Math.floor(0.5 * 114))
    let m = 0
    rollNpcAttack({ attacker: jad, target: player99('Other'), style: 'ranged', random: () => (m++, 0.999), maxHitOverride: 113 })
    expect(m).toBe(2)
  })
})

describe('hit delays', () => {
  it('Jad magic impact = floor((2 + 8d) / 30)', () => {
    const expected: Record<number, number> = { 3: 0, 4: 1, 7: 1, 8: 2, 10: 2, 11: 3, 14: 3, 15: 4 }
    for (const [d, ticks] of Object.entries(expected)) expect(npcHitDelayFromCycles(projectileCycles(JAD_MAGIC_PROJECTILE, Number(d)))).toBe(ticks)
  })
  const table = (t: { delay: number; lengthAdjustment: number; stepMultiplier: number }, n: number): number[] =>
    Array.from({ length: n }, (_, i) => playerHitDelayFromCycles(projectileCycles(t, i + 1)))
  it('arrows / bolts', () => expect(table(PROJECTILE_TIMINGS.arrow, 10)).toEqual([2, 2, 3, 3, 3, 3, 3, 3, 4, 4]))
  it('blowpipe', () => expect(table(PROJECTILE_TIMINGS.thrown, 7)).toEqual([2, 2, 2, 2, 2, 3, 3]))
  it('spells / powered staves', () => expect(table(PROJECTILE_TIMINGS.magic_spell, 10)).toEqual([2, 3, 3, 3, 4, 4, 4, 5, 5, 5]))
  it("Tumeken's shadow", () => expect(table(PROJECTILE_TIMINGS.tumekens_shadow, 10)).toEqual([3, 4, 4, 4, 5, 5, 5, 6, 6, 6]))
  it('legacy delays', () => {
    expect(legacyHitDelay('melee', 1)).toBe(1)
    expect(legacyHitDelay('magic_slow', 2)).toBe(3)
  })
})
