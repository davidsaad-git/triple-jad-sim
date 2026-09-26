import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../app/settings/settings'
import type { SimState } from '../../sim/api'
import { collectInfoboxes, effectivePinTarget, formatTicks, formatTimer, interpolatedSeconds, readTranslate, registerInfoboxProvider, ticksToSeconds } from './Infoboxes'

function state(p: Partial<SimState> = {}): SimState {
  const lv = (n: number) => ({ current: n, max: n })
  return {
    currentTick: 7,
    poisonVarp: 0,
    poisonTickCounter: 30,
    combatTimers: {},
    stats: { attack: lv(99), strength: lv(99), defence: lv(99), ranged: lv(99), magic: lv(99), prayer: lv(99), hitpoints: lv(99) },
    ...p,
  } as unknown as SimState
}

const settings: Settings = { ...DEFAULT_SETTINGS, showTickCounter: true, showTickCounterInfobox: true, tickCounterMax: 4 }

describe('timers', () => {
  it('formats ticks as m:ss rounding seconds up', () => {
    expect(ticksToSeconds(1)).toBe(1)
    expect(ticksToSeconds(100)).toBe(60)
    expect(formatTimer(61)).toBe('1:01')
    expect(formatTicks(500)).toBe('5:00')
    expect(formatTicks(0)).toBe('0:00')
  })

  it('interpolates within the sampled tick', () => {
    expect(interpolatedSeconds(10, 5, 5)).toBe(6)
    expect(interpolatedSeconds(10, 5, 5.5)).toBe(ticksToSeconds(9.5))
    expect(interpolatedSeconds(10, 5, 9)).toBe(ticksToSeconds(9))
  })
})

describe('built-in infoboxes', () => {
  it('shows only the tick counter when nothing is active', () => {
    const boxes = collectInfoboxes(state(), settings)
    expect(boxes.map((b) => b.id)).toEqual(['tick-counter'])
    expect(boxes[0]!.text).toBe('3')
    expect(boxes[0]!.tooltipDetail).toBe('Tick 3 of 4')
  })

  it('lists timers, antipoison and stat changes in scim order', () => {
    const s = state({
      combatTimers: { saturatedHeartActiveTicks: 100, markOfDarknessActiveTicks: 50, deathChargeActiveTicks: 0, deathChargeCooldownTicks: 20, surgePotionCooldownTicks: 500 },
      poisonVarp: -2,
      poisonTickCounter: 10,
      stats: {
        attack: { current: 99, max: 99 },
        strength: { current: 99, max: 99 },
        defence: { current: 90, max: 99 },
        ranged: { current: 112, max: 99 },
        magic: { current: 99, max: 99 },
        prayer: { current: 99, max: 99 },
        hitpoints: { current: 99, max: 99 },
      } as SimState['stats'],
    })
    const boxes = collectInfoboxes(s, { ...settings, showTickCounterInfobox: false })
    expect(boxes.map((b) => b.id)).toEqual(['saturated-heart', 'mark-of-darkness', 'death-charge-cooldown', 'antipoison', 'surge-potion-cooldown', 'stat-defence', 'stat-ranged'])
    const heart = boxes[0]!
    expect(heart.itemId).toBe(27641)
    expect(heart.tooltipDetail).toBe('Magic +13 (1:00 remaining)')
    const anti = boxes[3]!
    expect(anti.ticksRemaining).toBe(40)
    expect(boxes[5]).toMatchObject({ text: '90', tone: 'drain', tooltipDetail: 'Defence: 90/99 (-9)' })
    expect(boxes[6]).toMatchObject({ text: '112', tone: 'boost', tooltipDetail: 'Ranged: 112/99 (+13)' })
  })

  it('lets other modules add and replace providers', () => {
    const off = registerInfoboxProvider('test-box', () => ({ id: 'test-box', text: 'x', tooltipTitle: 'T', tooltipDetail: 'D' }), 5)
    expect(collectInfoboxes(state(), settings).map((b) => b.id)).toEqual(['tick-counter', 'test-box'])
    const offTick = registerInfoboxProvider('tick-counter', () => null, 0)
    expect(collectInfoboxes(state(), settings).map((b) => b.id)).toEqual(['test-box'])
    offTick()
    off()
    expect(collectInfoboxes(state(), settings).map((b) => b.id)).toEqual(['tick-counter'])
  })
})

describe('pinning', () => {
  it('falls back from Inventory to HUD in fixed mode', () => {
    expect(effectivePinTarget('inventory', 'fixed')).toBe('hud')
    expect(effectivePinTarget('inventory', 'modern')).toBe('inventory')
    expect(effectivePinTarget('free', 'fixed')).toBe('free')
  })

  it('reads a panel translate3d', () => {
    expect(readTranslate('translate3d(784px, 601.5px, 0)')).toEqual({ left: 784, top: 601.5 })
    expect(readTranslate('none')).toBeNull()
  })
})
