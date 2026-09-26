import { useCallback, useEffect, useRef } from 'react'

/**
 * Press/drag rules shared by the inventory, prayer and spellbook grids
 * (scim, `fhe`; Anti Drag plugin):
 * a drag starts once BOTH the elapsed time >= threshold and the pointer moved
 * >= 5 px; releasing without a drag performs the click action.
 */

export const DRAG_DISTANCE_PX = 5
export const VANILLA_DRAG_DELAY_MS = 100

export interface AntiDragOptions {
  enabled: boolean
  requireShift: boolean
  ctrlDragImmediately: boolean
  dragDelay: number
}

export interface PressModifiers {
  shift: boolean
  ctrl: boolean
}

export interface PressRules {
  /** Dragging is possible from this press. */
  canDrag: boolean
  /** Inventory only: a release performs "Drop" (Shift held without the Require Shift rule). */
  shiftDrop: boolean
  thresholdMs: number
}

/** Rules for an inventory press. */
export function inventoryPressRules(mods: PressModifiers, anti: AntiDragOptions): PressRules {
  const ctrlOverride = anti.enabled && anti.ctrlDragImmediately && mods.ctrl
  const shiftOnly = anti.enabled && anti.requireShift
  const shiftDrop = mods.shift && !ctrlOverride && !shiftOnly
  const canDrag = !shiftDrop && (ctrlOverride || !(shiftOnly && !mods.shift))
  const thresholdMs = ctrlOverride ? 0 : anti.enabled && !anti.requireShift ? clampDelay(anti.dragDelay) : VANILLA_DRAG_DELAY_MS
  return { canDrag, shiftDrop, thresholdMs }
}

/** Rules for a prayer/spell reorder press (no shift-drop). */
export function reorderPressRules(mods: PressModifiers, anti: AntiDragOptions): PressRules {
  const ctrlOverride = anti.enabled && anti.ctrlDragImmediately && mods.ctrl
  const canDrag = ctrlOverride || !(anti.enabled && anti.requireShift && !mods.shift)
  const thresholdMs = ctrlOverride ? 0 : anti.enabled && !anti.requireShift ? clampDelay(anti.dragDelay) : VANILLA_DRAG_DELAY_MS
  return { canDrag, shiftDrop: false, thresholdMs }
}

function clampDelay(ms: number): number {
  return Number.isFinite(ms) ? Math.max(0, Math.min(2000, ms)) : 300
}

/** Whether a press becomes a drag at time `now` with the pointer at (x, y). */
export function dragStarted(press: { startX: number; startY: number; startTime: number; thresholdMs: number; canDrag: boolean }, x: number, y: number, now: number): boolean {
  if (!press.canDrag) return false
  const dx = x - press.startX
  const dy = y - press.startY
  return Math.max(0, now - press.startTime) >= press.thresholdMs && Math.sqrt(dx * dx + dy * dy) >= DRAG_DISTANCE_PX
}

/**
 * Window-level mouse tracking after a mousedown: moves are
 * coalesced to one callback per animation frame; mouseup, blur, hidden tab or
 * a move with no buttons pressed ends the gesture.
 */
export function useWindowDrag(handlers: {
  onMove: (x: number, y: number, timeStamp: number) => void
  onEnd: (x: number, y: number, timeStamp: number) => void
  cursor?: string
}): { startDrag: (e: { clientX: number; clientY: number; timeStamp: number }) => void; isDragging: () => boolean } {
  const active = useRef(false)
  const frame = useRef(0)
  const last = useRef({ x: 0, y: 0, t: 0 })
  const styleEl = useRef<HTMLStyleElement | null>(null)
  const h = useRef(handlers)
  h.current = handlers

  const removeCursor = useCallback(() => {
    styleEl.current?.remove()
    styleEl.current = null
  }, [])

  const end = useCallback(
    (x: number, y: number, t: number) => {
      if (!active.current) return
      active.current = false
      removeCursor()
      if (frame.current !== 0) {
        cancelAnimationFrame(frame.current)
        frame.current = 0
        h.current.onMove(x, y, t)
      }
      h.current.onEnd(x, y, t)
    },
    [removeCursor],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!active.current) return
      if (e.buttons === 0) {
        end(last.current.x, last.current.y, last.current.t)
        return
      }
      last.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }
      if (frame.current === 0) {
        frame.current = requestAnimationFrame(() => {
          frame.current = 0
          h.current.onMove(last.current.x, last.current.y, last.current.t)
        })
      }
    }
    const onUp = (e: MouseEvent): void => end(e.clientX, e.clientY, e.timeStamp)
    const onBlur = (): void => end(last.current.x, last.current.y, last.current.t)
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') end(last.current.x, last.current.y, last.current.t)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      if (frame.current !== 0) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [end])

  useEffect(
    () => () => {
      active.current = false
      removeCursor()
    },
    [removeCursor],
  )

  const startDrag = useCallback((e: { clientX: number; clientY: number; timeStamp: number }) => {
    if (active.current) return
    active.current = true
    last.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    const cursor = h.current.cursor
    if (cursor && !styleEl.current && typeof document !== 'undefined') {
      const el = document.createElement('style')
      el.setAttribute('data-drag-cursor', '')
      el.textContent = `* { cursor: ${cursor} !important; }`
      document.head.appendChild(el)
      styleEl.current = el
    }
  }, [])

  return { startDrag, isDragging: () => active.current }
}
