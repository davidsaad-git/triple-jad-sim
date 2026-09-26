import { createContext, type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PanelPosition } from '../../app/settings/settings'
import { onModifiersChange } from '../../input/modifiers'
import { useWindowDrag } from './drag'
import { useAltHeld } from './hooks'
import {
  anchoredToLeftTop,
  avoidExclusions,
  type Box,
  clampToFrame,
  leftTopToAnchored,
  rescaleOnResize,
  type SnapContact,
  type SnapEngagement,
  snapToSiblings,
  type SnapTarget,
  stepScale,
  UI_SCALE_STEPS,
} from './layout'
import { PanelScaleContext } from './sprites/scale'

/**
 * Movable client panel: positioned by anchor offsets inside the frame, content
 * scaled with CSS `zoom`, edited with Alt + drag / wheel / right click /
 * middle click, Alt + Shift snaps to sibling panels.
 */

// ---------------------------------------------------------------------------
// Snap registry shared by the panels of one frame
// ---------------------------------------------------------------------------

export interface SnapState {
  active: boolean
  engagement: SnapEngagement | null
}

interface SnapRegistry {
  register(id: string, getRect: () => SnapTarget | null): () => void
  siblings(exceptId: string): SnapTarget[]
  setState(state: SnapState): void
  subscribe(listener: () => void): () => void
  getState(): SnapState
}

const IDLE: SnapState = { active: false, engagement: null }

function createSnapRegistry(): SnapRegistry {
  const panels = new Map<string, () => SnapTarget | null>()
  const listeners = new Set<() => void>()
  let state: SnapState = IDLE
  return {
    register(id, getRect) {
      panels.set(id, getRect)
      return () => {
        panels.delete(id)
      }
    },
    siblings(exceptId) {
      const out: SnapTarget[] = []
      for (const [id, get] of panels) {
        if (id === exceptId) continue
        const rect = get()
        if (rect) out.push(rect)
      }
      return out
    },
    setState(next) {
      state = next
      for (const l of [...listeners]) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getState: () => state,
  }
}

const SnapContext = createContext<SnapRegistry | null>(null)

export function PanelSnapProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(createSnapRegistry, [])
  return <SnapContext.Provider value={registry}>{children}</SnapContext.Provider>
}

/** Snap guide markers for the frame overlay. */
export function SnapGuides() {
  const registry = useContext(SnapContext)
  const [state, setState] = useState<SnapState>(IDLE)
  useEffect(() => {
    if (!registry) return
    return registry.subscribe(() => setState(registry.getState()))
  }, [registry])
  const e = state.engagement
  if (!state.active || !e) return null
  const m = e.marker
  const vertical = e.contact === 'right-to-left' || e.contact === 'left-to-right'
  const len = Math.min(28, vertical ? m.height : m.width)
  const marker = vertical
    ? { left: m.x + 1, top: m.y + (m.height - len) / 2, width: m.width - 2, height: len }
    : { left: m.x + (m.width - len) / 2, top: m.y + 1, width: len, height: m.height - 2 }
  return (
    <div className="snap-guide-overlay" aria-hidden>
      <span className={`snap-gap-marker ${e.state === 'engaged' ? 'is-engaged' : 'is-preview'}`} style={marker} />
      {e.state === 'engaged' &&
        (vertical ? (
          <>
            <span className="snap-edge-tick" style={{ left: m.x, top: m.y, width: 1, height: m.height }} />
            <span className="snap-edge-tick" style={{ left: m.x + m.width - 1, top: m.y, width: 1, height: m.height }} />
          </>
        ) : (
          <>
            <span className="snap-edge-tick" style={{ left: m.x, top: m.y, width: m.width, height: 1 }} />
            <span className="snap-edge-tick" style={{ left: m.x, top: m.y + m.height - 1, width: m.width, height: 1 }} />
          </>
        ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Global panel-drag counter: html[data-panel-dragging]
// ---------------------------------------------------------------------------

/** Window events around a panel drag; the Alt hint bar stays up while dragging. */
export const PANEL_DRAG_START_EVENT = 'panel:drag-start'
export const PANEL_DRAG_END_EVENT = 'panel:drag-end'

let draggingCount = 0
function beginPanelDrag(): void {
  draggingCount++
  if (draggingCount === 1 && typeof document !== 'undefined') document.documentElement.setAttribute('data-panel-dragging', '')
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PANEL_DRAG_START_EVENT))
}
function endPanelDrag(): void {
  draggingCount = Math.max(0, draggingCount - 1)
  if (draggingCount === 0 && typeof document !== 'undefined') document.documentElement.removeAttribute('data-panel-dragging')
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PANEL_DRAG_END_EVENT))
}
export function isAnyPanelDragging(): boolean {
  return draggingCount > 0
}

/** Panel-moved notification: infobox pinning follows the game panel live. */
export const PANEL_MOVED_EVENT = 'tutorial:panel-moved'

/** The wheel sequence owner so only one panel scales per Alt+wheel gesture. */
let wheelOwner: string | null = null

const FLIP = { duration: 120, easing: 'cubic-bezier(0, 0, 0.2, 1)' }
let lastResizeAt = -Infinity

export interface DraggablePanelProps {
  children: ReactNode
  defaultPosition: PanelPosition
  /** Controlled position (persisted); falls back to the default. */
  position?: PanelPosition | null
  scale: number
  width: number
  height: number
  minScale?: number
  maxScale?: number
  zIndex?: number
  exclusionRects?: readonly Box[]
  frameWidth: number
  frameHeight: number
  onPositionChange?: (pos: PanelPosition) => void
  onScaleChange?: (scale: number) => void
  dataTutorial?: string
  edgeInset?: number
  /** Pointer events pass through the panel box (only its interactive children take input). */
  pointerPassthrough?: boolean
  scaleEnabled?: boolean
  /** Fixed layout: no Alt editing. */
  locked?: boolean
  altHintLabel?: string
  /** Extra factor the panel's own content uses (infoboxes). */
  contentScale?: number
  /** Position driven from outside every frame (infoboxes pinned to the panel/HUD). */
  externallyPositioned?: boolean
  /** Fixed layout: exact physical box (edge-snapped rect); content scale = max(phys / size). */
  physicalSize?: { width: number; height: number }
  className?: string
}

export function DraggablePanel({
  children,
  defaultPosition,
  position,
  scale,
  width,
  height,
  minScale = 1,
  maxScale = 3,
  zIndex = 10,
  exclusionRects,
  frameWidth,
  frameHeight,
  onPositionChange,
  onScaleChange,
  dataTutorial,
  edgeInset = 0,
  pointerPassthrough = false,
  scaleEnabled = true,
  locked = false,
  altHintLabel,
  contentScale = 1,
  externallyPositioned = false,
  physicalSize,
  className,
}: DraggablePanelProps) {
  const id = useId()
  const registry = useContext(SnapContext)
  const altHeld = useAltHeld()
  const [pos, setPos] = useState<PanelPosition>(position ?? defaultPosition)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const outerRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const posRef = useRef(pos)
  posRef.current = pos
  const onPositionChangeRef = useRef(onPositionChange)
  onPositionChangeRef.current = onPositionChange
  const onScaleChangeRef = useRef(onScaleChange)
  onScaleChangeRef.current = onScaleChange

  const outerW = physicalSize ? physicalSize.width : width * scale
  const outerH = physicalSize ? physicalSize.height : height * scale
  const zoom = physicalSize ? Math.max(physicalSize.width / width, physicalSize.height / height) : scale

  // Controlled position: adopt prop changes when not dragging (derived-state pattern).
  const [prevProp, setPrevProp] = useState(position)
  const propChanged = position !== prevProp
  if (propChanged) {
    setPrevProp(position)
    const next = position ?? defaultPosition
    if (!dragging && (next.x !== pos.x || next.y !== pos.y || next.anchorX !== pos.anchorX || next.anchorY !== pos.anchorY)) setPos(next)
  }

  // Positions set here (drag end, reset, resize, scale ratio) are reported after commit.
  const emitNext = useRef(false)
  const commit = useCallback((next: PanelPosition) => {
    const prev = posRef.current
    if (prev.x === next.x && prev.y === next.y && prev.anchorX === next.anchorX && prev.anchorY === next.anchorY) return
    emitNext.current = true
    setPos(next)
  }, [])
  useEffect(() => {
    if (!emitNext.current) return
    emitNext.current = false
    onPositionChangeRef.current?.(pos)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PANEL_MOVED_EVENT))
  }, [pos])

  // Scale change: keep the relative spot (positions away from the anchor corner scale with it).
  const [prevScale, setPrevScale] = useState(scale)
  if (scale !== prevScale) {
    setPrevScale(scale)
    if (!propChanged && !dragging && prevScale > 0 && scale > 0 && (pos.x !== 0 || pos.y !== 0)) {
      const ratio = scale / prevScale
      emitNext.current = true
      setPos({ ...pos, x: pos.x * ratio, y: pos.y * ratio })
    }
  }

  const box = useMemo(() => {
    const lt = anchoredToLeftTop(pos, outerW, outerH, frameWidth, frameHeight)
    const c = clampToFrame(lt.x, lt.y, outerW, outerH, frameWidth, frameHeight, edgeInset)
    return avoidExclusions(c.x, c.y, outerW, outerH, { left: 0, top: 0, right: frameWidth, bottom: frameHeight }, exclusionRects)
  }, [pos, outerW, outerH, frameWidth, frameHeight, edgeInset, exclusionRects])
  const boxRef = useRef(box)
  boxRef.current = box

  // Frame resize: right/bottom offsets stay, left/top rescale with the free space.
  const lastFrame = useRef<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const prev = lastFrame.current
    lastFrame.current = { w: frameWidth, h: frameHeight }
    if (!prev || (prev.w === frameWidth && prev.h === frameHeight)) return
    lastResizeAt = performance.now()
    const cur = posRef.current
    const scaled = rescaleOnResize(cur, outerW, outerH, prev.w, prev.h, frameWidth, frameHeight)
    const lt = anchoredToLeftTop(scaled, outerW, outerH, frameWidth, frameHeight)
    const c = clampToFrame(lt.x, lt.y, outerW, outerH, frameWidth, frameHeight, edgeInset)
    commit(leftTopToAnchored(c.x, c.y, outerW, outerH, frameWidth, frameHeight, cur.anchorX, cur.anchorY))
  }, [frameWidth, frameHeight, outerW, outerH, edgeInset, commit])

  // Sibling registration for snapping.
  const liveBox = useRef<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (!registry) return
    return registry.register(id, () => {
      const b = liveBox.current ?? { left: boxRef.current.x, top: boxRef.current.y }
      return { id, left: b.left, top: b.top, right: b.left + outerW, bottom: b.top + outerH }
    })
  }, [registry, id, outerW, outerH])

  // Drag.
  const dragState = useRef<{ lastX: number; lastY: number; raw: { left: number; top: number }; shown: { left: number; top: number }; snap: boolean; prev: { targetId: string; contact: SnapContact } | null } | null>(null)
  const { startDrag } = useWindowDrag({
    cursor: 'grabbing',
    onMove: (x, y) => {
      const d = dragState.current
      if (!d) return
      const dx = x - d.lastX
      const dy = y - d.lastY
      d.lastX = x
      d.lastY = y
      const c = clampToFrame(d.raw.left + dx, d.raw.top + dy, outerW, outerH, frameWidth, frameHeight, edgeInset)
      const a = avoidExclusions(c.x, c.y, outerW, outerH, { left: 0, top: 0, right: frameWidth, bottom: frameHeight }, exclusionRects)
      d.raw = { left: a.x, top: a.y }
      let shown = { left: a.x, top: a.y }
      let engagement: SnapEngagement | null = null
      if (registry && d.snap) {
        const siblings = registry.siblings(id)
        if (siblings.length > 0) {
          const res = snapToSiblings({
            left: a.x,
            top: a.y,
            width: outerW,
            height: outerH,
            siblings,
            previous: d.prev,
            isDestinationValid: (b) => {
              if (b.left < edgeInset || b.top < edgeInset || b.right > frameWidth - edgeInset || b.bottom > frameHeight - edgeInset) return false
              for (const ex of exclusionRects ?? []) if (b.left < ex.right && b.right > ex.left && b.top < ex.bottom && b.bottom > ex.top) return false
              return true
            },
          })
          shown = { left: a.x + res.dx, top: a.y + res.dy }
          engagement = res.engagement
          d.prev = engagement && engagement.state === 'engaged' ? { targetId: engagement.targetId, contact: engagement.contact } : engagement ? d.prev : null
        }
      }
      d.shown = shown
      liveBox.current = shown
      if (outerRef.current) outerRef.current.style.transform = `translate3d(${shown.left}px, ${shown.top}px, 0)`
      registry?.setState({ active: engagement !== null, engagement })
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PANEL_MOVED_EVENT))
    },
    onEnd: () => {
      const d = dragState.current
      dragState.current = null
      liveBox.current = null
      if (d) commit(leftTopToAnchored(d.shown.left, d.shown.top, outerW, outerH, frameWidth, frameHeight, posRef.current.anchorX, posRef.current.anchorY))
      registry?.setState(IDLE)
      setDragging(false)
      endPanelDrag()
    },
  })

  // Shift released mid-drag drops the snap.
  useEffect(() => {
    return onModifiersChange((m) => {
      const d = dragState.current
      if (!d || d.snap === m.shift) return
      d.snap = m.shift
      if (!m.shift) {
        d.prev = null
        d.shown = { ...d.raw }
        liveBox.current = d.shown
        registry?.setState(IDLE)
        if (outerRef.current) outerRef.current.style.transform = `translate3d(${d.raw.left}px, ${d.raw.top}px, 0)`
      }
    })
  }, [registry])

  const setScale = useCallback(
    (next: number) => {
      if (next !== scale) onScaleChangeRef.current?.(next)
    },
    [scale],
  )

  const onMouseDownCapture = (e: ReactMouseEvent): void => {
    if (locked) return
    if (!e.altKey) return
    if (e.button === 0) {
      e.preventDefault()
      e.stopPropagation()
      dragState.current = { lastX: e.clientX, lastY: e.clientY, raw: { left: box.x, top: box.y }, shown: { left: box.x, top: box.y }, snap: e.shiftKey, prev: null }
      setDragging(true)
      beginPanelDrag()
      startDrag(e)
    } else if (e.button === 2) {
      e.preventDefault()
      e.stopPropagation()
      commit(defaultPosition)
    } else if (e.button === 1) {
      e.preventDefault()
      e.stopPropagation()
      setScale(1)
    }
  }

  // Alt + wheel scales every panel (global uiScale), batched per frame.
  const stops = useMemo(() => UI_SCALE_STEPS.filter((s) => s >= minScale && s <= maxScale), [minScale, maxScale])
  const hoveredRef = useRef(hovered)
  hoveredRef.current = hovered
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  useEffect(() => {
    if (!scaleEnabled || locked) return
    let pending = 0
    let raf = 0
    const flush = (): void => {
      raf = 0
      const steps = pending
      pending = 0
      if (steps !== 0) onScaleChangeRef.current?.(stepScale(scaleRef.current, steps, stops))
    }
    const onWheel = (e: WheelEvent): void => {
      if (!e.altKey) {
        wheelOwner = null
        return
      }
      if (wheelOwner !== null) {
        if (wheelOwner !== id) return
      } else {
        let over: boolean
        if (pointerPassthrough) {
          const el = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null
          over = !!(el && innerRef.current?.contains(el))
        } else over = hoveredRef.current
        if (!over) return
        wheelOwner = id
      }
      e.preventDefault()
      pending += e.deltaY > 0 ? -1 : 1
      if (raf === 0) raf = requestAnimationFrame(flush)
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', onWheel)
      if (wheelOwner === id) wheelOwner = null
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [scaleEnabled, locked, stops, id, pointerPassthrough])

  // FLIP animation for jumps not caused by dragging / window resizes.
  const prevLayout = useRef<{ x: number; y: number; zoom: number; contentScale: number } | null>(null)
  const anim = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    const prev = prevLayout.current
    prevLayout.current = { x: box.x, y: box.y, zoom, contentScale }
    if (!prev) return
    const scaleChanged = prev.zoom !== zoom || prev.contentScale !== contentScale
    const moved = Math.abs(prev.x - box.x) > 0.5 || Math.abs(prev.y - box.y) > 0.5
    if (!scaleChanged && !moved) return
    const recentResize = performance.now() - lastResizeAt < 200
    const suppressed = altHeld || recentResize || (externallyPositioned && !scaleChanged) || dragging || isAnyPanelDragging()
    anim.current?.cancel()
    anim.current = null
    const el = innerRef.current
    if (suppressed || !el || typeof el.animate !== 'function') return
    const dx = (prev.x - box.x) / zoom
    const dy = (prev.y - box.y) / zoom
    const s = (prev.zoom * prev.contentScale) / (zoom * contentScale)
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(s - 1) > 1e-3) {
      anim.current = el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], FLIP)
    }
  }, [box.x, box.y, zoom, contentScale, altHeld, externallyPositioned, dragging])

  const editing = (altHeld || dragging) && !locked
  const transform = `translate3d(${box.x}px, ${box.y}px, 0)`
  return (
    <div
      ref={outerRef}
      role="presentation"
      className={[editing ? 'dp-alt-move' : '', className ?? ''].join(' ').trim() || undefined}
      style={{ position: 'absolute', left: 0, top: 0, transform: dragging && dragState.current ? `translate3d(${dragState.current.shown.left}px, ${dragState.current.shown.top}px, 0)` : transform, width: outerW, height: outerH, userSelect: 'none', zIndex, overflow: physicalSize ? 'hidden' : 'visible', pointerEvents: 'none' }}
      data-tutorial={dataTutorial}
      onMouseDownCapture={onMouseDownCapture}
      onContextMenuCapture={(e) => {
        if (e.altKey) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
    >
      <PanelScaleContext.Provider value={zoom}>
        <div style={{ width, height, zoom }}>
          <div
            ref={innerRef}
            role="presentation"
            style={{ width: '100%', height: '100%', transformOrigin: '0 0', pointerEvents: pointerPassthrough && !editing ? 'none' : 'auto' }}
            onMouseEnter={() => {
              if (!dragState.current) setHovered(true)
            }}
            onMouseLeave={() => {
              if (!dragState.current) setHovered(false)
            }}
          >
            {children}
          </div>
        </div>
      </PanelScaleContext.Provider>
      <div className={`dp-move-affordance${dragging ? ' dp-move-affordance--active' : ''}`} data-visible={editing || undefined} aria-hidden>
        <span className="dp-move-affordance__corner dp-move-affordance__corner--tl" />
        <span className="dp-move-affordance__corner dp-move-affordance__corner--tr" />
        <span className="dp-move-affordance__corner dp-move-affordance__corner--bl" />
        <span className="dp-move-affordance__corner dp-move-affordance__corner--br" />
        {altHintLabel && <span className="dp-move-affordance__label">{altHintLabel}</span>}
      </div>
    </div>
  )
}

