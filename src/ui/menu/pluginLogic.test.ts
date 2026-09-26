import { describe, expect, it } from 'vitest'
import { filterCatalog } from './ItemPicker'
import type { CatalogItem } from './itemCatalog'
import { orderByDependency, partitionToggles } from './MechanicsEditor'
import { DEFAULT_ORB_ORDER, groupNpcHighlights, isDefaultOrbOrder, orbSlotClick, swapOrbs, UI_SCALES } from './pluginLogic'

describe('Compact Orbs order', () => {
  it('swaps two positions', () => {
    expect(swapOrbs(DEFAULT_ORB_ORDER, 0, 3)).toEqual(['special', 'prayer', 'run', 'hitpoints'])
    expect(swapOrbs(DEFAULT_ORB_ORDER, 0, 9)).toEqual(DEFAULT_ORB_ORDER)
    expect(isDefaultOrbOrder(DEFAULT_ORB_ORDER)).toBe(true)
    expect(isDefaultOrbOrder(['prayer', 'hitpoints', 'run', 'special'])).toBe(false)
  })
  it('selects on the first click, swaps on the second, unselects on the same orb', () => {
    let r = orbSlotClick(DEFAULT_ORB_ORDER, null, 'prayer')
    expect(r).toEqual({ order: DEFAULT_ORB_ORDER, selected: 'prayer' })
    expect(orbSlotClick(r.order, 'prayer', 'prayer').selected).toBeNull()
    r = orbSlotClick(r.order, 'prayer', 'special')
    expect(r).toEqual({ order: ['hitpoints', 'special', 'run', 'prayer'], selected: null })
  })
  it('offers scim stretched-mode scales', () => {
    expect(UI_SCALES.map((v) => Math.round(v * 100))).toEqual([100, 117, 133, 150, 167, 183, 200, 217, 233, 250, 267, 283, 300])
  })
})

describe('NPC highlight grouping', () => {
  it('groups modes by NPC type', () => {
    const g = groupNpcHighlights([
      { npcName: 'JalTok-Jad', npcTypeId: 7700, mode: 'trueTile', color: '#6fb0ae' },
      { npcName: 'Yt-HurKot', npcTypeId: 7701, mode: 'trueTile', color: '#6fb0ae' },
      { npcName: 'JalTok-Jad', npcTypeId: 7700, mode: 'clickbox', color: '#ff0000' },
    ])
    expect(g.map((x) => [x.npcTypeId, x.entries.map((e) => e.mode)])).toEqual([
      [7700, ['trueTile', 'clickbox']],
      [7701, ['trueTile']],
    ])
  })
})

describe('item picker filtering', () => {
  const items: CatalogItem[] = [
    { id: 3024, name: 'Super restore(4)', verified: true, category: 'potions' },
    { id: 3026, name: 'Super restore(3)', verified: true, category: 'potions' },
    { id: 6685, name: 'Saradomin brew(4)', verified: true, category: 'potions' },
    { id: 13441, name: 'Anglerfish', verified: true, category: 'food' },
    { id: 1, name: 'Abyssal thing', verified: false, category: 'gear' },
    { id: 2, name: 'Bronze dagger', verified: true, category: 'gear' },
  ]
  it('pins scim favourites first with no search, hides unverified', () => {
    const r = filterCatalog(items, '', 'all', false, true)
    expect(r.shown.map((i) => i.id)).toEqual([13441, 6685, 3024, 2, 3026])
  })
  it('sorts potion doses descending and filters by category', () => {
    const r = filterCatalog(items, 'super', 'potions', false, true)
    expect(r.shown.map((i) => i.name)).toEqual(['Super restore(4)', 'Super restore(3)'])
  })
  it('counts hidden unverified matches', () => {
    const r = filterCatalog(items, 'abyss', 'all', false, true)
    expect(r.shown).toHaveLength(0)
    expect(r.hiddenUnverified).toBe(1)
    expect(filterCatalog(items, 'abyss', 'all', true, true).shown).toHaveLength(1)
  })
})

describe('mechanics partitioning', () => {
  it('sends aids (and their dependants) to Practice Aids and setup rows to Fight Setup', () => {
    const p = partitionToggles([
      { key: 'autoPrepot', label: 'Auto-Prepot', group: 'aid', setup: true },
      { key: 'jadAttacks', label: 'Jad Attacks' },
      { key: 'stagger', label: 'Stagger', setup: true },
      { key: 'infiniteHealth', label: 'Infinite Health', group: 'aid' },
      { key: 'child', label: 'Child', dependsOn: 'infiniteHealth' },
    ])
    expect(p.setup.map((t) => t.key)).toEqual(['stagger'])
    expect(p.mechanics.map((t) => t.key)).toEqual(['jadAttacks'])
    expect(p.aids.map((t) => t.key)).toEqual(['autoPrepot', 'infiniteHealth', 'child'])
  })
  it('puts dependants right after their parent', () => {
    const o = orderByDependency([
      { key: 'b', label: 'b', dependsOn: 'a' },
      { key: 'c', label: 'c' },
      { key: 'a', label: 'a' },
    ])
    expect(o.map((t) => t.key)).toEqual(['c', 'a', 'b'])
  })
})
