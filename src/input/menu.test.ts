import { describe, expect, it, vi } from 'vitest'
import {
  buildContextMenu,
  buildGroundItemEntries,
  buildMenuParts,
  buildNpcEntries,
  compileWildcard,
  edgeToLine,
  findSwapIndex,
  groundItemsOnTile,
  type MenuEntry,
  MENU_TARGET_COLORS,
  menuPalette,
  menuScale,
  type NpcTagContext,
  npcTooltip,
  parseColoredName,
  parseMenuSwapRules,
  resolveRightClick,
  resolveSwappedLeftClick,
  swappedEntryTooltip,
  swapTargetKey,
  tooltipScale,
  withAlpha,
} from './menu'

const JAD = { name: 'JalTok-Jad', actions: [null, 'Attack', null, null, null], combatLevel: 900 }
const HEALER = { name: 'Yt-HurKot', actions: [null, 'Attack', null, null, null], combatLevel: 141 }
const TALKER = { name: 'TzHaar-Mej', actions: ['Talk-to', null, 'Trade', null, null], combatLevel: 0 }

const simple = (e: MenuEntry) => [e.action, e.target ?? null, e.targetColor ?? null, e.clickType ?? null]

describe('wildcards', () => {
  it('exact, *, prefix, suffix, contains and general glob', () => {
    expect(compileWildcard('attack')('attack')).toBe(true)
    expect(compileWildcard('attack')('attacks')).toBe(false)
    expect(compileWildcard('*')('anything')).toBe(true)
    expect(compileWildcard('jal*')('jaltok-jad  (level-900)')).toBe(true)
    expect(compileWildcard('jal*')('yt-hurkot')).toBe(false)
    expect(compileWildcard('*900)')('jaltok-jad  (level-900)')).toBe(true)
    expect(compileWildcard('*jad*')('jaltok-jad  (level-900)')).toBe(true)
    expect(compileWildcard('jal*jad*')('jaltok-jad  (level-900)')).toBe(true)
    expect(compileWildcard('j*d')('jad')).toBe(true)
    expect(compileWildcard('j*d')('jade')).toBe(false)
    // Regex metacharacters are literal.
    expect(compileWildcard('a.c*')('abcd')).toBe(false)
    expect(compileWildcard('a.c*')('a.cd')).toBe(true)
  })

  it('an empty field matches only the empty string', () => {
    expect(compileWildcard('')('')).toBe(true)
    expect(compileWildcard('')('x')).toBe(false)
  })
})

describe('swap rules', () => {
  const entries = [
    { action: 'Attack', target: '*JalTok-Jad  (level-900)' },
    { action: 'Attack', target: 'Yt-HurKot  (level-141)' },
    { action: 'Walk here' },
  ]

  it('parses lines, lowercases and trims, skips blank lines; missing top fields match anything', () => {
    const rules = parseMenuSwapRules('  Walk Here , ,Attack,*\n\n\nattack,yt-*')
    expect(rules).toHaveLength(2)
    expect(rules[0]!.option('walk here')).toBe(true)
    expect(rules[0]!.target('')).toBe(true)
    expect(rules[0]!.topOption('attack')).toBe(true)
    expect(rules[1]!.topOption('whatever')).toBe(true)
  })

  it('target key strips the current-target star', () => {
    expect(swapTargetKey({ target: '*JalTok-Jad  (level-900)' })).toBe('jaltok-jad  (level-900)')
    expect(swapTargetKey({})).toBe('')
  })

  it('walk here,,attack,* makes walking the left click over an attackable NPC', () => {
    expect(findSwapIndex(entries, parseMenuSwapRules('walk here,,attack,*'))).toBe(2)
  })

  it('later lines win; ties go to the earlier entry', () => {
    expect(findSwapIndex(entries, parseMenuSwapRules('walk here,\nattack,yt-hurkot*'))).toBe(1)
    expect(findSwapIndex(entries, parseMenuSwapRules('attack,yt-hurkot*\nwalk here,'))).toBe(2)
    // One rule matching two entries: the earlier entry.
    expect(findSwapIndex(entries, parseMenuSwapRules('attack,*'))).toBe(0)
  })

  it('top option/target constrain on the would-be top entry', () => {
    expect(findSwapIndex(entries, parseMenuSwapRules('walk here,,attack,yt-*'))).toBe(-1)
    expect(findSwapIndex(entries, parseMenuSwapRules('walk here,,attack,jaltok-*'))).toBe(2)
  })

  it('returns -1 with no rules or no entries', () => {
    expect(findSwapIndex(entries, [])).toBe(-1)
    expect(findSwapIndex([], parseMenuSwapRules('attack,*'))).toBe(-1)
  })
})

describe('NPC entries', () => {
  it('Jad: Attack (red cross), Examine; target text, level suffix and colour', () => {
    const onAttack = vi.fn()
    const entries = buildNpcEntries({ npcType: JAD, npcTypeId: 7700, color: MENU_TARGET_COLORS.npc, isAttackTarget: false, onAttack })
    expect(entries.map(simple)).toEqual([
      ['Attack', 'JalTok-Jad  (level-900)', '#f8e868', 'red'],
      ['Examine', 'JalTok-Jad  (level-900)', '#f8e868', null],
    ])
    entries[0]!.onClick?.()
    expect(onAttack).toHaveBeenCalledOnce()
    expect(entries[1]!.onClick).toBeUndefined()
  })

  it('marks the current attack target with a leading star', () => {
    const entries = buildNpcEntries({ npcType: JAD, npcTypeId: 7700, color: MENU_TARGET_COLORS.npc, isAttackTarget: true })
    expect(entries[0]!.target).toBe('*JalTok-Jad  (level-900)')
  })

  it('level 0 has no suffix; only Attack gets a handler; actions keep cache order', () => {
    const entries = buildNpcEntries({ npcType: TALKER, npcTypeId: 1, color: MENU_TARGET_COLORS.npc, isAttackTarget: false, onAttack: () => {} })
    expect(entries.map((e) => [e.action, e.target, !!e.onClick])).toEqual([
      ['Talk-to', 'TzHaar-Mej', false],
      ['Trade', 'TzHaar-Mej', false],
      ['Examine', 'TzHaar-Mej', false],
    ])
  })

  it('uses the highlight colour and <col=> names', () => {
    expect(buildNpcEntries({ npcType: HEALER, npcTypeId: 7701, color: '#6fb0ae', isAttackTarget: false })[0]!.targetColor).toBe('#6fb0ae')
    expect(parseColoredName('<col=ff0000>Boss</col>', '#f8e868')).toEqual({ name: 'Boss', color: '#ff0000' })
    expect(parseColoredName('Boss', '#f8e868')).toEqual({ name: 'Boss', color: '#f8e868' })
  })

  it('extended menu adds Tag with the three modes and swatches for tagged ones', () => {
    const toggles: string[] = []
    const picks: string[] = []
    const tag: NpcTagContext = {
      isHighlighted: (_id, mode) => mode === 'trueTile',
      getHighlightColor: (_id, mode) => (mode === 'trueTile' ? '#6fb0ae' : undefined),
      onToggleHighlight: (name, id, mode) => toggles.push(`${name}:${id}:${mode}`),
      onOpenColorPicker: (name, id, mode, color) => picks.push(`${name}:${id}:${mode}:${color}`),
    }
    const entries = buildNpcEntries({ npcType: JAD, npcTypeId: 7700, color: MENU_TARGET_COLORS.npc, isAttackTarget: true, tagContext: tag })
    const tagEntry = entries[2]!
    expect(entries.map((e) => e.action)).toEqual(['Attack', 'Examine', 'Tag'])
    expect(tagEntry.target).toBe('JalTok-Jad  (level-900)')
    expect(tagEntry.submenu!.map((e) => [e.action, e.target ?? null, e.targetColor ?? null])).toEqual([
      ['Untag', 'True Tile', '#f8e868'],
      ['swatch', null, '#6fb0ae'],
      ['Tag', 'SW Tile', '#f8e868'],
      ['Tag', 'Clickbox', '#f8e868'],
    ])
    tagEntry.submenu![0]!.onClick!()
    tagEntry.submenu![1]!.onClick!()
    expect(toggles).toEqual(['JalTok-Jad:7700:trueTile'])
    expect(picks).toEqual(['JalTok-Jad:7700:trueTile:#6fb0ae'])
  })
})

describe('ground items', () => {
  it('prepends Take when missing; only Take acts (red); then Examine', () => {
    const take = vi.fn()
    const entries = buildGroundItemEntries(
      [{ groundItemId: 'gi-1', itemId: 385 }],
      () => ({ name: 'Shark', groundActions: [null, null, 'Take', null, null] }),
      take,
    )
    expect(entries.map(simple)).toEqual([
      ['Take', 'Shark', '#f8c070', 'red'],
      ['Examine', 'Shark', '#f8c070', null],
    ])
    entries[0]!.onClick!()
    expect(take).toHaveBeenCalledWith('gi-1')
    const noTake = buildGroundItemEntries([{ groundItemId: 'gi-2', itemId: 1 }], () => ({ name: 'null', groundActions: [null, 'Light', null, null, null] }), take)
    expect(noTake.map((e) => [e.action, e.target])).toEqual([
      ['Take', 'Item'],
      ['Light', 'Item'],
      ['Examine', 'Item'],
    ])
  })

  it('items on a tile, newest drop first (ties: later index first)', () => {
    const items = [
      { id: 'a', position: [1, 1] as const, droppedTick: 5 },
      { id: 'b', position: [1, 1] as const, droppedTick: 9 },
      { id: 'c', position: [2, 1] as const, droppedTick: 9 },
      { id: 'd', position: [1, 1] as const, droppedTick: 5 },
    ]
    expect(groundItemsOnTile(items, [1, 1]).map((i) => i.id)).toEqual(['b', 'd', 'a'])
  })
})

describe('whole menu', () => {
  const walk = vi.fn()
  const jad = buildNpcEntries({ npcType: JAD, npcTypeId: 7700, color: MENU_TARGET_COLORS.npc, isAttackTarget: false, onAttack: () => {} })
  const healer = buildNpcEntries({ npcType: HEALER, npcTypeId: 7701, color: MENU_TARGET_COLORS.npc, isAttackTarget: false, onAttack: () => {} })
  const shark = buildGroundItemEntries([{ groundItemId: 'gi-1', itemId: 385 }], () => ({ name: 'Shark', groundActions: [null, null, 'Take', null, null] }), () => {})

  it('order: NPC actions (nearest first), item actions, Walk here, examines, Cancel', () => {
    const parts = buildMenuParts({ tile: [30, 30], npcEntries: [healer, jad], groundItemEntries: shark, onWalk: walk, swapRules: [] })
    const { content } = buildContextMenu([30, 30], parts)
    expect(content!.entries.map((e) => [e.action, e.target ?? null])).toEqual([
      ['Attack', 'Yt-HurKot  (level-141)'],
      ['Attack', 'JalTok-Jad  (level-900)'],
      ['Take', 'Shark'],
      ['Walk here', null],
      ['Examine', 'Yt-HurKot  (level-141)'],
      ['Examine', 'JalTok-Jad  (level-900)'],
      ['Examine', 'Shark'],
      ['Cancel', null],
    ])
    const walkEntry = content!.entries[3]!
    expect(walkEntry.clickType).toBe('yellow')
    walkEntry.onClick!()
    expect(walk).toHaveBeenCalledWith([30, 30])
    expect(content!.entries[7]!.onClick).toBeUndefined()
  })

  it('over terrain with nothing picked: Walk here, Cancel; over the sky: no menu', () => {
    const parts = buildMenuParts({ tile: [5, 5], npcEntries: [], groundItemEntries: [], onWalk: walk, swapRules: [] })
    expect(buildContextMenu([5, 5], parts).content!.entries.map((e) => e.action)).toEqual(['Walk here', 'Cancel'])
    const sky = buildMenuParts({ tile: null, npcEntries: [], groundItemEntries: [], onWalk: walk, swapRules: [] })
    expect(buildContextMenu(null, sky).content).toBeNull()
    expect(resolveRightClick(null, sky, {}, false)).toEqual({ kind: 'none' })
  })

  it('NPC over the sky still opens a menu (no Walk here)', () => {
    const parts = buildMenuParts({ tile: null, npcEntries: [jad], groundItemEntries: [], onWalk: walk, swapRules: [] })
    expect(buildContextMenu(null, parts).content!.entries.map((e) => e.action)).toEqual(['Attack', 'Examine', 'Cancel'])
  })

  it('extended entries go between actions and Walk here, in loc colour', () => {
    const parts = buildMenuParts({ tile: [5, 5], npcEntries: [jad], groundItemEntries: [], onWalk: walk, swapRules: [] })
    const ext = {
      tileMarkers: { hasMarker: () => false, onMark: vi.fn(), onUnmark: vi.fn(), onLabel: vi.fn(), onColor: vi.fn() },
      lineMarkers: { edge: { x: 5, y: 5, edge: 'north' as const }, hasEdge: () => true, onMark: vi.fn(), onUnmark: vi.fn(), onLabel: vi.fn(), onColor: vi.fn() },
    }
    const { content, hasActionEntries } = buildContextMenu([5, 5], parts, ext)
    expect(hasActionEntries).toBe(true)
    expect(content!.entries.map((e) => [e.action, e.target ?? null, e.targetColor ?? null])).toEqual([
      ['Attack', 'JalTok-Jad  (level-900)', '#f8e868'],
      ['Mark', 'tile', '#78e8e0'],
      ['Unmark', 'North line', '#78e8e0'],
      ['Label', 'North line', '#78e8e0'],
      ['Color', 'North line', '#78e8e0'],
      ['Walk here', null, null],
      ['Examine', 'JalTok-Jad  (level-900)', '#f8e868'],
      ['Cancel', null, null],
    ])
    const marked = buildContextMenu([5, 5], parts, { tileMarkers: { ...ext.tileMarkers, hasMarker: () => true } })
    expect(marked.content!.entries.slice(1, 4).map((e) => `${e.action} ${e.target}`)).toEqual(['Unmark tile', 'Label tile', 'Color tile'])
  })

  it('a swapped entry trades places with entry 0 in the menu, and becomes the left click', () => {
    const rules = parseMenuSwapRules('walk here,,attack,*')
    const parts = buildMenuParts({ tile: [5, 5], npcEntries: [jad], groundItemEntries: [], onWalk: walk, swapRules: rules })
    expect(parts.swapIndex).toBe(1)
    expect(buildContextMenu([5, 5], parts).content!.entries.map((e) => e.action)).toEqual(['Walk here', 'Attack', 'Examine', 'Cancel'])
    expect(resolveSwappedLeftClick(parts)?.kind).toBe('walk')
    const healerFirst = buildMenuParts({ tile: [5, 5], npcEntries: [jad, healer], groundItemEntries: [], onWalk: walk, swapRules: parseMenuSwapRules('attack,yt-*') })
    const swapped = resolveSwappedLeftClick(healerFirst)!
    expect(swapped.kind).toBe('action')
    expect(swapped.entry.target).toBe('Yt-HurKot  (level-141)')
    expect(buildContextMenu([5, 5], healerFirst).content!.entries.slice(0, 2).map((e) => e.target)).toEqual(['Yt-HurKot  (level-141)', 'JalTok-Jad  (level-900)'])
  })

  it('with "right click moves camera": menu only when there are action entries', () => {
    const plain = buildMenuParts({ tile: [5, 5], npcEntries: [], groundItemEntries: [], onWalk: walk, swapRules: [] })
    expect(resolveRightClick([5, 5], plain, {}, true)).toEqual({ kind: 'camera-drag' })
    expect(resolveRightClick([5, 5], plain, {}, false).kind).toBe('menu')
    const withNpc = buildMenuParts({ tile: [5, 5], npcEntries: [jad], groundItemEntries: [], onWalk: walk, swapRules: [] })
    expect(resolveRightClick([5, 5], withNpc, {}, true).kind).toBe('menu')
  })
})

describe('edges -> stored lines', () => {
  it('south/north horizontal, west/east vertical', () => {
    expect(edgeToLine({ x: 3, y: 4, edge: 'south' })).toEqual({ x: 3, y: 4, orientation: 'horizontal' })
    expect(edgeToLine({ x: 3, y: 4, edge: 'north' })).toEqual({ x: 3, y: 5, orientation: 'horizontal' })
    expect(edgeToLine({ x: 3, y: 4, edge: 'west' })).toEqual({ x: 3, y: 4, orientation: 'vertical' })
    expect(edgeToLine({ x: 3, y: 4, edge: 'east' })).toEqual({ x: 4, y: 4, orientation: 'vertical' })
  })
})

describe('colours, fonts and scale', () => {
  it('Brown pack palette (default) matches scim theme tokens', () => {
    expect(menuPalette('pack-browntown')).toMatchObject({
      action: '#ffffff',
      target: '#dfc06a',
      background: 'rgb(30, 24, 18)',
      backgroundHover: 'rgba(212, 165, 74, 0.15)',
      border: 'rgba(56, 48, 35, 0.5)',
      headerText: '#c8aa6e',
      headerBackground: '#14100c',
      separator: 'rgba(56, 48, 35, 0.3)',
      disabled: '#8a7a5c',
    })
    expect(menuPalette('nope').background).toBe('rgb(30, 24, 18)')
    expect(menuPalette('pack-vanilla').target).toBe('#ffac4d')
    expect(withAlpha('#383023', 0.5)).toBe('rgba(56, 48, 35, 0.5)')
  })

  it('menu scale 0.85 at uiScale 1 (15 px text), tooltip scale 1 (18 px)', () => {
    expect(menuScale(1)).toBeCloseTo(0.85)
    expect(Math.round(18 * menuScale(1))).toBe(15)
    expect(Math.round(15 * menuScale(1))).toBe(13)
    expect(Math.round(14 * menuScale(1))).toBe(12)
    expect(Math.round(18 * tooltipScale(1))).toBe(18)
    expect(menuScale(2)).toBeCloseTo(1.19)
  })

  it('tooltips: NPC in #f5ec78 with two-space level suffix; swapped entries drop the star', () => {
    expect(npcTooltip(JAD)).toEqual({
      lines: [
        {
          spans: [
            { text: 'Attack ', color: '#ffffff' },
            { text: 'JalTok-Jad  (level-900)', color: '#f5ec78' },
          ],
        },
      ],
    })
    expect(npcTooltip(JAD, '#6fb0ae')!.lines[0]!.spans[1]!.color).toBe('#6fb0ae')
    expect(npcTooltip({ name: 'Rock', actions: [null, null], combatLevel: 0 })).toBeNull()
    const t = swappedEntryTooltip({ action: 'Attack', target: '*JalTok-Jad  (level-900)', targetColor: '#f8e868' })!
    expect(t.lines[0]!.spans[1]).toEqual({ text: 'JalTok-Jad  (level-900)', color: '#f8e868' })
    expect(swappedEntryTooltip({ action: 'Walk here' })).toBeNull()
  })
})
