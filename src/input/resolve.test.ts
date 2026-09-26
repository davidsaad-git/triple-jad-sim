import { describe, expect, it, vi } from 'vitest'
import { parseMenuSwapRules } from './menu'
import { buildViewportMenuParts, firstInteractiveNpc, type PickContext, type PickedNpc, resolveHover, resolveLeftClick } from './resolve'

const JAD = { name: 'JalTok-Jad', actions: [null, 'Attack', null, null, null], combatLevel: 900 }
const HEALER = { name: 'Yt-HurKot', actions: [null, 'Attack', null, null, null], combatLevel: 141 }
const SCENERY = { name: 'Rock', actions: [null, null, null, null, null], combatLevel: 0 }
const TALKER = { name: 'TzHaar-Mej', actions: ['Talk-to', null, null, null, null], combatLevel: 0 }

const jad: PickedNpc = { actorId: 'jad-1', npcTypeId: 7700, position: [24, 36], type: JAD }
const healer: PickedNpc = { actorId: 'healer-1', npcTypeId: 7701, position: [24, 42], type: HEALER }
const rock: PickedNpc = { actorId: 'rock', npcTypeId: 1, position: [0, 0], type: SCENERY }
const talker: PickedNpc = { actorId: 'talk', npcTypeId: 2, position: [1, 1], type: TALKER }
const broken: PickedNpc = { actorId: 'broken', npcTypeId: 3, position: [2, 2], type: null }

function ctx(p: Partial<PickContext> = {}): PickContext {
  return {
    tile: [30, 30],
    npcs: [],
    groundItems: [],
    menuGroundItems: [],
    attackTargetId: null,
    swapRules: [],
    loadItem: () => ({ name: 'Shark', groundActions: [null, null, 'Take', null, null] }),
    ...p,
  }
}

const handlers = () => ({ onWalk: vi.fn(), onAttack: vi.fn(), onTake: vi.fn() })

describe('firstInteractiveNpc', () => {
  it('skips NPCs without actions; remembers the first failed type load as a fallback', () => {
    expect(firstInteractiveNpc([rock, healer, jad])?.npc).toBe(healer)
    expect(firstInteractiveNpc([broken, rock])).toEqual({ npc: broken, type: null })
    expect(firstInteractiveNpc([broken, jad])?.npc).toBe(jad)
    expect(firstInteractiveNpc([rock])).toBeNull()
  })
})

describe('resolveHover', () => {
  it('off the canvas and Shift: no tooltip, yellow, no hovered NPC', () => {
    expect(resolveHover(null, false)).toMatchObject({ key: 'none', tooltip: null, leftClickType: 'yellow', hoveredNpcId: null })
    expect(resolveHover(ctx({ npcs: [jad] }), true)).toMatchObject({ key: 'shift', tooltip: null, leftClickType: 'yellow', hoveredNpcId: null })
  })

  it('attackable NPC: Attack tooltip, red, hovered id; nearest first; click-through for no-action NPCs', () => {
    const r = resolveHover(ctx({ npcs: [rock, jad, healer] }), false)
    expect(r.key).toBe('npc:jad-1:')
    expect(r.leftClickType).toBe('red')
    expect(r.hoveredNpcId).toBe('jad-1')
    expect(r.tooltip!.lines[0]!.spans.map((s) => s.text)).toEqual(['Attack ', 'JalTok-Jad  (level-900)'])
  })

  it('NPC with other actions only: no tooltip, yellow, no hovered NPC; failed type: hovered id but no tooltip', () => {
    expect(resolveHover(ctx({ npcs: [talker] }), false)).toMatchObject({ key: 'npc-no-action:talk', tooltip: null, leftClickType: 'yellow', hoveredNpcId: null })
    expect(resolveHover(ctx({ npcs: [broken] }), false)).toMatchObject({ key: 'npc-no-tooltip:broken', tooltip: null, leftClickType: 'yellow', hoveredNpcId: 'broken' })
  })

  it('ground item: Take tooltip in item colour, red', () => {
    const r = resolveHover(ctx({ groundItems: [{ groundItemId: 'gi-1', itemId: 385, position: [30, 30] }] }), false)
    expect(r.leftClickType).toBe('red')
    expect(r.tooltip!.lines[0]!.spans).toEqual([
      { text: 'Take ', color: '#ffffff' },
      { text: 'Shark', color: '#f5c080' },
    ])
  })

  it('plain tile: nothing', () => {
    expect(resolveHover(ctx(), false)).toMatchObject({ key: 'none', tooltip: null, leftClickType: 'yellow' })
  })

  it('highlight colour for the tooltip when "Color menu and hover text" is on', () => {
    const r = resolveHover(ctx({ npcs: [jad], npcMenuColor: () => '#6fb0ae' }), false)
    expect(r.key).toBe('npc:jad-1:#6fb0ae')
    expect(r.tooltip!.lines[0]!.spans[1]!.color).toBe('#6fb0ae')
  })

  it('custom swaps: walk swap hides the tooltip; an action swap shows it in red', () => {
    const walk = resolveHover(ctx({ npcs: [jad], swapRules: parseMenuSwapRules('walk here,,attack,*') }), false)
    expect(walk).toMatchObject({ key: 'swap:walk', tooltip: null, leftClickType: 'yellow', hoveredNpcId: null })
    const healerSwap = resolveHover(ctx({ npcs: [jad, healer], attackTargetId: 'healer-1', swapRules: parseMenuSwapRules('attack,yt-*') }), false)
    expect(healerSwap.leftClickType).toBe('red')
    expect(healerSwap.hoveredNpcId).toBeNull()
    // The star of the current target is stripped in the tooltip.
    expect(healerSwap.tooltip!.lines[0]!.spans[1]!.text).toBe('Yt-HurKot  (level-141)')
    // A rule that matches nothing falls back to the normal priority.
    expect(resolveHover(ctx({ npcs: [jad], swapRules: parseMenuSwapRules('talk-to,*') }), false).key).toBe('npc:jad-1:')
  })
})

describe('resolveLeftClick', () => {
  it('Shift always walks (without clearing the hovered NPC)', () => {
    expect(resolveLeftClick(ctx({ npcs: [jad] }), true, handlers())).toEqual({ kind: 'walk', clearHoveredNpc: false })
  })

  it('nearest attackable NPC attacks', () => {
    expect(resolveLeftClick(ctx({ npcs: [rock, healer, jad] }), false, handlers())).toEqual({ kind: 'attack', npc: healer })
  })

  it('NPC with actions but no Attack (or failed type) walks and clears the hovered NPC', () => {
    expect(resolveLeftClick(ctx({ npcs: [talker] }), false, handlers())).toEqual({ kind: 'walk', clearHoveredNpc: true })
    expect(resolveLeftClick(ctx({ npcs: [broken] }), false, handlers())).toEqual({ kind: 'walk', clearHoveredNpc: true })
  })

  it('ground item takes; plain tile walks', () => {
    expect(resolveLeftClick(ctx({ groundItems: [{ groundItemId: 'gi-1', itemId: 385, position: [30, 30] }] }), false, handlers())).toEqual({ kind: 'take', groundItemId: 'gi-1' })
    expect(resolveLeftClick(ctx(), false, handlers())).toEqual({ kind: 'walk', clearHoveredNpc: false })
  })

  it('swaps: walk swap walks and clears; action swap returns the entry wired to the handlers', () => {
    expect(resolveLeftClick(ctx({ npcs: [jad], swapRules: parseMenuSwapRules('walk here,') }), false, handlers())).toEqual({ kind: 'walk', clearHoveredNpc: true })
    const h = handlers()
    const res = resolveLeftClick(ctx({ npcs: [jad, healer], swapRules: parseMenuSwapRules('attack,yt-*') }), false, h)
    expect(res.kind).toBe('entry')
    if (res.kind === 'entry') res.entry.onClick?.()
    expect(h.onAttack).toHaveBeenCalledWith(healer)
    // A swap onto an entry without a handler still counts as handled.
    const exam = resolveLeftClick(ctx({ npcs: [talker], swapRules: parseMenuSwapRules('talk-to,*') }), false, h)
    expect(exam.kind).toBe('entry')
  })
})

describe('buildViewportMenuParts', () => {
  it('marks the attack target, wires Attack / Take / Walk and lists items on the tile', () => {
    const h = handlers()
    const parts = buildViewportMenuParts(
      ctx({ npcs: [jad, healer], attackTargetId: 'jad-1', menuGroundItems: [{ groundItemId: 'gi-1', itemId: 385 }] }),
      h,
    )
    expect(parts.actions.map((e) => `${e.action}|${e.target}`)).toEqual(['Attack|*JalTok-Jad  (level-900)', 'Attack|Yt-HurKot  (level-141)', 'Take|Shark'])
    parts.actions[1]!.onClick!()
    parts.actions[2]!.onClick!()
    parts.walkHere!.onClick!()
    expect(h.onAttack).toHaveBeenCalledWith(healer)
    expect(h.onTake).toHaveBeenCalledWith('gi-1')
    expect(h.onWalk).toHaveBeenCalledWith([30, 30])
    expect(parts.examines).toHaveLength(3)
  })
})
