import { forwardRef, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useSettings } from '../app/settings/settings'
import { clampBox, presentationRect, toElementLocal, windowRect } from './dom'
import { type TooltipContent, tooltipPalette, tooltipScale } from './menu'

/**
 * The cursor tooltip card (scim provider + `U1` card + `ppe` layer +
 * positioning). scim has no OSRS
 * top-left mouse-over text: hover text is a small card next to the cursor.
 *
 * One tooltip exists app-wide. The viewport hover resolver drives it, and UI
 * elements (prayers, orbs, items) can use `bindTooltip` / `showTooltip`.
 * `TooltipLayer` must be mounted once (ViewportInput mounts it).
 */

interface TooltipState {
  content: TooltipContent | null
  visible: boolean
}

let state: TooltipState = { content: null, visible: false }
const listeners = new Set<() => void>()
const cursor = { x: -1, y: -1 }

function setState(next: TooltipState): void {
  state = next
  for (const l of [...listeners]) l()
}

export function showTooltip(content: TooltipContent): void {
  setState({ content, visible: true })
}

export function hideTooltip(): void {
  if (!state.visible && state.content === null) return
  setState({ content: null, visible: false })
}

export function getTooltipState(): TooltipState {
  return state
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Props for a UI element with a tooltip. */
export function bindTooltip(getContent: () => TooltipContent | null): {
  'data-tooltip-bound': 'true'
  onMouseEnter: (e: ReactMouseEvent) => void
  onMouseMove: (e: ReactMouseEvent) => void
  onMouseLeave: () => void
} {
  const refresh = (e: ReactMouseEvent): void => {
    cursor.x = e.clientX
    cursor.y = e.clientY
    const content = getContent()
    if (content) showTooltip(content)
    else hideTooltip()
  }
  return { 'data-tooltip-bound': 'true', onMouseEnter: refresh, onMouseMove: refresh, onMouseLeave: hideTooltip }
}

/** Cursor offset below the pointer and clamp margin. */
const CURSOR_OFFSET_Y = 24
const MARGIN = 4

/** Place the card: left at the cursor, 24 px below it, clamped; above the cursor if it overflows. */
export function positionTooltip(el: HTMLElement, clientX: number, clientY: number): void {
  const parent = el.parentElement?.matches('.game-viewport-frame, .workspace-presentation-surface') ? el.parentElement : null
  const bounds = parent ? presentationRect() : windowRect()
  const at = parent ? toElementLocal(parent, clientX, clientY) : { x: clientX, y: clientY }
  const tl = parent ? toElementLocal(parent, bounds.left, bounds.top) : { x: bounds.left, y: bounds.top }
  const br = parent ? toElementLocal(parent, bounds.right, bounds.bottom) : { x: bounds.right, y: bounds.bottom }
  const w = el.offsetWidth
  const h = el.offsetHeight
  const pos = clampBox(at.x, at.y + CURSOR_OFFSET_Y, w, h, { left: tl.x, top: tl.y, right: br.x, bottom: br.y }, MARGIN, at.y - h - MARGIN)
  el.style.left = `${pos.x}px`
  el.style.top = `${pos.y}px`
}

export interface TooltipCardProps {
  content: TooltipContent
  scale?: number
  background: string
  border: string
  style?: CSSProperties
}

/** The card itself: one line of spans in "RuneScape Plain 11". */
export const TooltipCard = forwardRef<HTMLDivElement, TooltipCardProps>(function TooltipCard({ content, scale = 1, background, border, style }, ref) {
  return (
    <div
      ref={ref}
      style={{
        backgroundColor: background,
        border: `1px solid ${border}`,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
        padding: '4px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {content.lines.map((line, i) => (
        <div key={`line-${i}-${line.spans.map((s) => s.text).join('')}`} style={{ lineHeight: `${Math.round(14 * scale)}px` }}>
          {line.spans.map((span, j) => (
            <span
              key={`${j}-${span.text}-${span.color}`}
              style={{
                fontFamily: '"RuneScape Plain 11", sans-serif',
                fontSize: `${Math.round(18 * scale)}px`,
                color: span.color,
                textShadow: '1px 1px 0 rgba(0, 0, 0, 0.7)',
              }}
            >
              {span.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
})

/** Scale source: uiScale, or the Fixed layout's stretch (viewport width / 765). */
export function useMenuUiScale(): number {
  const layout = useSettings((s) => s.clientLayoutMode)
  const uiScale = useSettings((s) => s.uiScale)
  if (layout === 'fixed' && typeof window !== 'undefined') return Math.max(0.1, window.innerWidth / 765)
  return uiScale
}

/** Renders the shared tooltip (portal into the viewport frame, or fixed on the body). */
export function TooltipLayer(): JSX.Element | null {
  const snap = useSyncExternalStore(subscribe, getTooltipState, getTooltipState)
  const pack = useSettings((s) => s.activeResourcePack)
  const scale = tooltipScale(useMenuUiScale())
  const elRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      cursor.x = e.clientX
      cursor.y = e.clientY
      if (state.visible && elRef.current) positionTooltip(elRef.current, e.clientX, e.clientY)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  const setRef = useCallback((el: HTMLDivElement | null) => {
    elRef.current = el
  }, [])

  useLayoutEffect(() => {
    if (snap.visible && elRef.current && cursor.x >= 0) positionTooltip(elRef.current, cursor.x, cursor.y)
  })

  const lines = snap.visible && snap.content && snap.content.lines.length > 0 ? snap.content : null
  if (!lines || typeof document === 'undefined') return null
  const host = document.querySelector('.workspace-presentation-surface') ?? document.querySelector('.game-viewport-frame')
  const colors = tooltipPalette(pack)
  return createPortal(
    <TooltipCard
      ref={setRef}
      content={lines}
      scale={scale}
      background={colors.background}
      border={colors.border}
      style={{ position: host ? 'absolute' : 'fixed', left: 0, top: 0, pointerEvents: 'none', zIndex: 99999 }}
    />,
    host ?? document.body,
  )
}
