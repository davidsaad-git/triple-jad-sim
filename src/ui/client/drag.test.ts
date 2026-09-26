import { describe, expect, it } from 'vitest'
import { type AntiDragOptions, dragStarted, inventoryPressRules, reorderPressRules } from './drag'

const OFF: AntiDragOptions = { enabled: false, requireShift: false, ctrlDragImmediately: false, dragDelay: 300 }
const ON: AntiDragOptions = { enabled: true, requireShift: false, ctrlDragImmediately: true, dragDelay: 600 }
const SHIFT_ONLY: AntiDragOptions = { enabled: true, requireShift: true, ctrlDragImmediately: true, dragDelay: 600 }
const none = { shift: false, ctrl: false }

describe('inventory press rules', () => {
  it('uses the vanilla 100 ms delay without Anti Drag', () => {
    expect(inventoryPressRules(none, OFF)).toEqual({ canDrag: true, shiftDrop: false, thresholdMs: 100 })
  })

  it('uses the plugin delay (clamped 0..2000) when enabled', () => {
    expect(inventoryPressRules(none, ON).thresholdMs).toBe(600)
    expect(inventoryPressRules(none, { ...ON, dragDelay: 5000 }).thresholdMs).toBe(2000)
    expect(inventoryPressRules(none, { ...ON, dragDelay: -1 }).thresholdMs).toBe(0)
  })

  it('Ctrl drags immediately when "Ctrl drag immediately" is on', () => {
    expect(inventoryPressRules({ shift: false, ctrl: true }, ON)).toEqual({ canDrag: true, shiftDrop: false, thresholdMs: 0 })
    expect(inventoryPressRules({ shift: false, ctrl: true }, OFF).thresholdMs).toBe(100)
  })

  it('Shift drops unless Require Shift is on', () => {
    expect(inventoryPressRules({ shift: true, ctrl: false }, OFF)).toMatchObject({ canDrag: false, shiftDrop: true })
    expect(inventoryPressRules({ shift: true, ctrl: false }, SHIFT_ONLY)).toMatchObject({ canDrag: true, shiftDrop: false })
    expect(inventoryPressRules(none, SHIFT_ONLY).canDrag).toBe(false)
  })

  it('reorder presses never shift-drop', () => {
    expect(reorderPressRules({ shift: true, ctrl: false }, OFF)).toEqual({ canDrag: true, shiftDrop: false, thresholdMs: 100 })
    expect(reorderPressRules(none, SHIFT_ONLY).canDrag).toBe(false)
    expect(reorderPressRules({ shift: false, ctrl: true }, SHIFT_ONLY)).toEqual({ canDrag: true, shiftDrop: false, thresholdMs: 0 })
  })
})

describe('drag start (time AND 5 px)', () => {
  const press = { startX: 100, startY: 100, startTime: 1000, thresholdMs: 100, canDrag: true }
  it('needs both the delay and the distance', () => {
    expect(dragStarted(press, 110, 100, 1050)).toBe(false)
    expect(dragStarted(press, 103, 103, 1200)).toBe(false)
    expect(dragStarted(press, 103, 104, 1100)).toBe(true)
    expect(dragStarted({ ...press, canDrag: false }, 150, 150, 5000)).toBe(false)
    expect(dragStarted({ ...press, thresholdMs: 0 }, 105, 100, 1000)).toBe(true)
  })
})
