import { afterEach, describe, expect, it } from 'vitest'
import { PresentationOverride } from '../app/runtime/presentation'
import type { SimRuntime } from '../app/runtime/types'
import type { SimEngine, SimState, Tile } from '../sim/api'
import { handleTakeGroundItem, handleTileClick } from './actions'
import { getArmedSpell, setArmedSpell } from './armedSpell'

/** A runtime whose dispatch queues applies until `flush()` (like the lag queue). */
function fakeRuntime(autoAdvance = true) {
  const log: string[] = []
  const pending: (() => void)[] = []
  let target: Tile | null = null
  const preview = new PresentationOverride<Tile | null>()
  const engine = {
    setCtrlClickOverride: (ctrl: boolean) => log.push(`ctrl:${ctrl}`),
    applyAction: (a: { attackTarget: string | null; manualCastSpell?: string | null }) =>
      log.push(`attack:${a.attackTarget}${a.manualCastSpell ? `:${a.manualCastSpell}` : ''}`),
    queuePickupGroundItem: (id: string) => log.push(`pickup:${id}`),
  } as unknown as SimEngine
  const state = { groundItems: [{ id: 'gi-3', itemId: 385, quantity: 1, position: [12, 34], droppedTick: 7 }], playerPosition: [31, 33] } as unknown as SimState
  const runtime = {
    engine,
    targetTilePreview: preview,
    getSnapshot: () => ({ state, events: [], tickTimeMs: 0 }),
    dispatch: (apply: (e: SimEngine) => void, label?: string) => {
      log.push(`dispatch:${label}`)
      pending.push(() => apply(engine))
    },
    setTargetTile: (t: Tile | null) => {
      target = t
      log.push(`target:${t ? t.join(',') : 'null'}`)
    },
    getTargetTile: () => target,
    stepOnce: () => log.push(autoAdvance ? 'step:noop' : 'step'),
  } as unknown as SimRuntime
  return {
    runtime,
    log,
    preview,
    flush() {
      while (pending.length) pending.shift()!()
    },
  }
}

afterEach(() => setArmedSpell(null))

describe('handleTileClick', () => {
  it('walk: preview the tile at click time; at apply: ctrl override, target tile, retire preview, attackTarget null, step', () => {
    const f = fakeRuntime()
    handleTileClick(f.runtime, [20, 40], true, null)
    expect(f.preview.get()).toEqual([20, 40])
    expect(f.log).toEqual(['dispatch:walk'])
    f.flush()
    expect(f.log).toEqual(['dispatch:walk', 'ctrl:true', 'target:20,40', 'attack:null', 'step:noop'])
    expect(f.preview.get()).toBeUndefined()
  })

  it('attack: preview null (destination hidden at once); at apply: ctrl override, target null, attack op', () => {
    const f = fakeRuntime()
    handleTileClick(f.runtime, [24, 36], false, 'jad-1')
    expect(f.preview.get()).toBeNull()
    f.flush()
    expect(f.log).toEqual(['dispatch:attack', 'ctrl:false', 'target:null', 'attack:jad-1', 'step:noop'])
  })

  it('an armed spell becomes a manual cast on NPC clicks and is disarmed by any click', () => {
    const f = fakeRuntime()
    setArmedSpell('Ice Barrage')
    handleTileClick(f.runtime, [24, 36], false, 'jad-1')
    expect(getArmedSpell()).toBeNull()
    f.flush()
    expect(f.log).toContain('attack:jad-1:Ice Barrage')
    setArmedSpell('Ice Barrage')
    handleTileClick(f.runtime, [1, 1], false, null)
    expect(getArmedSpell()).toBeNull()
  })

  it('a newer click keeps its own preview when an older apply retires', () => {
    const f = fakeRuntime()
    handleTileClick(f.runtime, [1, 1], false, null)
    handleTileClick(f.runtime, [2, 2], false, null)
    expect(f.preview.get()).toEqual([2, 2])
    f.flush()
    expect(f.preview.get()).toBeUndefined()
  })

  it('Auto-Advance off: the apply steps one tick', () => {
    const f = fakeRuntime(false)
    handleTileClick(f.runtime, [1, 1], false, null)
    f.flush()
    expect(f.log.at(-1)).toBe('step')
  })
})

describe('handleTakeGroundItem', () => {
  it('walks to the item tile with the run override off, stops attacking and queues the pickup', () => {
    const f = fakeRuntime()
    handleTakeGroundItem(f.runtime, 'gi-3')
    expect(f.preview.get()).toEqual([12, 34])
    f.flush()
    expect(f.log).toEqual(['dispatch:take', 'ctrl:false', 'target:12,34', 'attack:null', 'pickup:gi-3', 'step:noop'])
  })

  it('ignores unknown items', () => {
    const f = fakeRuntime()
    handleTakeGroundItem(f.runtime, 'nope')
    expect(f.log).toEqual([])
  })
})
