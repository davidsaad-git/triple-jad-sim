import { describe, expect, it } from 'vitest'
import type { DamageHistoryEntry, SimState } from '../../sim/api'
import { deathReason, deathRows, fightRecord, selectOutcome, splitTitle } from './outcome'

function entry(p: Partial<DamageHistoryEntry>): DamageHistoryEntry {
  return {
    tick: 1,
    source: 'PlayerAttack',
    targetId: 'jad1',
    baseDamage: 0,
    attackType: 'range',
    activePrayer: null,
    prayedCorrectly: null,
    effectiveDamage: 0,
    hpBefore: 350,
    hpAfter: 350,
    ...p,
  }
}

describe('outcome selection', () => {
  it('prefers death, then victory', () => {
    expect(selectOutcome({ playerFailed: true, outcomePhase: 'victory', isReplaying: false, hasVictoryDescriptor: true })).toBe('death')
    expect(selectOutcome({ playerFailed: false, outcomePhase: 'victory', isReplaying: false, hasVictoryDescriptor: true })).toBe('victory')
    expect(selectOutcome({ playerFailed: false, outcomePhase: 'resolving', isReplaying: false, hasVictoryDescriptor: true })).toBe('none')
    expect(selectOutcome({ playerFailed: false, outcomePhase: 'victory', isReplaying: true, hasVictoryDescriptor: true })).toBe('none')
  })
})

describe('fight record', () => {
  it('sums damage on the completion actors and damage taken', () => {
    const s = {
      currentTick: 210,
      playerHP: 61,
      maxHP: 99,
      prayerState: { points: 40, maxPoints: 99 },
      encounterOutcome: { phase: 'victory', decisiveTick: 205, completionActorIds: ['jad1', 'jad2', 'jad3'] },
      damageHistory: [
        entry({ targetId: 'jad1', hpBefore: 350, hpAfter: 300 }),
        entry({ targetId: 'jad2', hpBefore: 20, hpAfter: 0 }),
        entry({ targetId: 'healer1', hpBefore: 45, hpAfter: 0 }),
        entry({ targetId: 'player', source: 'JadMagic', effectiveDamage: 38 }),
      ],
    } as unknown as SimState
    expect(fightRecord(s)).toEqual({ killTime: '2:03', damageDealt: 70, damageTaken: 38, hpRemaining: '61 / 99', prayerRemaining: '40 / 99' })
    expect(fightRecord({ ...s, encounterOutcome: { phase: 'active' } } as SimState)).toBeNull()
  })
})

describe('death screen', () => {
  it('lists the last 10 hits on the player, newest first', () => {
    const hist = Array.from({ length: 12 }, (_, i) =>
      entry({ tick: i, targetId: 'player', source: 'JadMagic', sourceNpcTypeId: 7700, attackType: 'magic', effectiveDamage: i, activePrayer: i % 2 ? 'ProtectMagic' : null, prayedCorrectly: i % 2 ? true : false }),
    )
    const rows = deathRows(hist)
    expect(rows).toHaveLength(10)
    expect(rows[0]).toMatchObject({ tick: 11, source: 'JalTok-Jad', style: 'magic', amount: 11, prayer: 'Mage', wrong: false })
    expect(rows[1]).toMatchObject({ tick: 10, prayer: 'None', wrong: true, unprayed: false })
  })
  it('labels typeless and unprayed hits', () => {
    const [typeless] = deathRows([entry({ targetId: 'player', source: 'LocatorOrb', attackType: 'typeless' })])
    expect(typeless).toMatchObject({ source: 'Locator Orb', prayer: '—', unprayed: false })
    const [none] = deathRows([entry({ targetId: 'player', source: 'Melee', attackType: 'melee' })])
    expect(none).toMatchObject({ prayer: 'None', unprayed: true, style: 'melee' })
  })
  it('explains the death', () => {
    expect(deathReason('Death')).toBe('Slain in combat')
    expect(deathReason(null)).toBe('Slain in combat')
    expect(deathReason('RunEnergyDepleted')).toBe('Run Energy Depleted')
  })
})

describe('title card', () => {
  it('splits the hero name and subtitle', () => {
    expect(splitTitle('Triple Jads', null)).toEqual({ heroName: 'Triple Jads', subtitle: null })
    expect(splitTitle('Yama - Phase 3', 'Tutorial Mode')).toEqual({ heroName: 'Yama', subtitle: 'Phase 3 · Tutorial Mode' })
  })
})
