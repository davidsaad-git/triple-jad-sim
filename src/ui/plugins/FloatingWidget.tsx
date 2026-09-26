/**
 * Draggable container for the floating plugin widgets: fixed scale 1, pointer events pass
 * through, Alt + drag moves it (dashed secondary outline with 12 px corner
 * marks while Alt is held), Alt + right-click resets it. Positions are stored
 * as `{x, y, anchorX, anchorY}` and keep their anchors when moved.
 */
import './widgets.css'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getModifiers, onModifiersChange } from '../../input/hotkeys'

export interface WidgetPosition {
  x: number
  y: number
  anchorX: 'left' | 'right'
  anchorY: 'top' | 'bottom'
}

/** scim: position -> left/top. */
export function positionToOffset(p: WidgetPosition, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  return { left: p.anchorX === 'left' ? p.x : vw - w - p.x, top: p.anchorY === 'top' ? p.y : vh - h - p.y }
}

/** scim: clamp inside the viewport with an edge inset. */
export function clampOffset(left: number, top: number, w: number, h: number, vw: number, vh: number, inset = 0): { left: number; top: number } {
  return { left: Math.max(inset, Math.min(left, vw - w - inset)), top: Math.max(inset, Math.min(top, vh - h - inset)) }
}

/** scim: left/top -> position with the given anchors. */
export function offsetToPosition(left: number, top: number, w: number, h: number, vw: number, vh: number, anchorX: WidgetPosition['anchorX'], anchorY: WidgetPosition['anchorY']): WidgetPosition {
  return { x: Math.max(0, anchorX === 'left' ? left : vw - w - left), y: Math.max(0, anchorY === 'top' ? top : vh - h - top), anchorX, anchorY }
}

function useAltHeld(): boolean {
  const [alt, setAlt] = useState(() => {
    try {
      return getModifiers().alt
    } catch {
      return false
    }
  })
  useEffect(() => onModifiersChange((m) => setAlt(m.alt)), [])
  return alt
}

export interface FloatingWidgetProps {
  defaultPosition: WidgetPosition
  position: WidgetPosition | null | undefined
  onPositionChange: (p: WidgetPosition | null) => void
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  altHintLabel: string
  pointerPassthrough?: boolean
  zIndex?: number
  dataTutorial?: string
  children: ReactNode
}

export function FloatingWidget({
  defaultPosition,
  position,
  onPositionChange,
  width,
  height,
  viewportWidth,
  viewportHeight,
  altHintLabel,
  pointerPassthrough = true,
  zIndex = 10,
  dataTutorial,
  children,
}: FloatingWidgetProps) {
  const alt = useAltHeld()
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; left: number; top: number; cur: { left: number; top: number } } | null>(null)
  const pos = position ?? defaultPosition
  const base = positionToOffset(pos, width, height, viewportWidth, viewportHeight)
  const clamped = clampOffset(base.left, base.top, width, height, viewportWidth, viewportHeight)
  const at = drag ?? clamped

  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      d.cur = clampOffset(d.left + e.clientX - d.startX, d.top + e.clientY - d.startY, width, height, viewportWidth, viewportHeight)
      setDrag(d.cur)
    }
    const up = () => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      document.documentElement.removeAttribute('data-panel-dragging')
      if (d) onPositionChange(offsetToPosition(d.cur.left, d.cur.top, width, height, viewportWidth, viewportHeight, pos.anchorX, pos.anchorY))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drag !== null, width, height, viewportWidth, viewportHeight, pos.anchorX, pos.anchorY, onPositionChange]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = alt || drag !== null
  return (
    <div
      role="presentation"
      className={active ? 'dp-alt-move' : undefined}
      data-tutorial={dataTutorial}
      style={{ position: 'absolute', left: 0, top: 0, transform: `translate3d(${at.left}px, ${at.top}px, 0)`, width, height, userSelect: 'none', zIndex, overflow: 'visible', pointerEvents: 'none' }}
      onMouseDownCapture={(e) => {
        if (!e.altKey || e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        dragRef.current = { startX: e.clientX, startY: e.clientY, left: at.left, top: at.top, cur: { left: at.left, top: at.top } }
        document.documentElement.setAttribute('data-panel-dragging', '')
        setDrag({ left: at.left, top: at.top })
      }}
      onContextMenuCapture={(e) => {
        if (!e.altKey) return
        e.preventDefault()
        e.stopPropagation()
        onPositionChange(null)
      }}
    >
      <div style={{ width, height }}>
        <div role="presentation" style={{ width: '100%', height: '100%', pointerEvents: pointerPassthrough && !active ? 'none' : 'auto' }}>
          {children}
        </div>
      </div>
      <div className={`dp-move-affordance${drag ? ' dp-move-affordance--active' : ''}`} data-visible={active || undefined} aria-hidden="true">
        <span className="dp-move-affordance__corner dp-move-affordance__corner--tl" />
        <span className="dp-move-affordance__corner dp-move-affordance__corner--tr" />
        <span className="dp-move-affordance__corner dp-move-affordance__corner--bl" />
        <span className="dp-move-affordance__corner dp-move-affordance__corner--br" />
        <span className="dp-move-affordance__label">{altHintLabel}</span>
      </div>
    </div>
  )
}
