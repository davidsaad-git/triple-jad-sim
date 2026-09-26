import { type JSX, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clampBox, viewportFrameRect } from './dom'
import type { ClickType, MenuContent, MenuEntry, MenuPalette } from './menu'

/**
 * The right-click menu.
 *
 * A full-screen transparent overlay (portal on document.body, z 100000,
 * pointer-events auto) swallows every pointer event while the menu is open;
 * the menu box itself has pointer-events none and all hit-testing uses row
 * rects from window listeners:
 * - mousemove: the row under the cursor is hovered; hovering a row with a
 *   submenu opens it (it stays open while the cursor is in the submenu);
 *   moving more than 25 px away from the menu (+ open submenu) closes it.
 * - left mousedown (capture): select the row / submenu row under the cursor
 *   (cross + onClick), or just close when outside. Other buttons are ignored.
 * - window blur closes it. There is no Escape handler.
 */

export interface OpenMenu {
  content: MenuContent
  /** Client coordinates of the right click. */
  x: number
  y: number
}

export interface ContextMenuProps {
  menu: OpenMenu | null
  palette: MenuPalette
  /** Menu scale g (0.85 at uiScale 1). */
  scale: number
  onClose: () => void
  /** Draw the selection cross (fixed on the body). */
  onCross: (clientX: number, clientY: number, type: ClickType) => void
}

const MARGIN = 4
const DISMISS_DISTANCE = 25

function rowIndexAt(container: HTMLElement | null, selector: string, x: number, y: number, attr?: string): number {
  if (!container) return -1
  const rows = container.querySelectorAll<HTMLElement>(selector)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      if (!attr) return i
      const v = parseInt(rows[i]!.getAttribute(attr) ?? '', 10)
      return Number.isNaN(v) ? -1 : v
    }
  }
  return -1
}

export function ContextMenu({ menu, palette, scale: g, onClose, onCross }: ContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const subRef = useRef<HTMLDivElement | null>(null)
  const [hovered, setHovered] = useState(-1)
  const [submenuParent, setSubmenuParent] = useState(-1)
  const [hoveredSub, setHoveredSub] = useState(-1)
  const hoveredRef = useRef(-1)
  const parentRef = useRef(-1)
  const hoveredSubRef = useRef(-1)
  const contentRef = useRef<MenuContent | null>(null)
  contentRef.current = menu?.content ?? null

  const open = menu !== null && menu.content.entries.length > 0

  // Position at open: centred horizontally on the cursor, top at the cursor, clamped.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!open || !el || !menu) return
    const pos = clampBox(menu.x - el.offsetWidth / 2, menu.y, el.offsetWidth, el.offsetHeight, viewportFrameRect(), MARGIN)
    el.style.left = `${pos.x}px`
    el.style.top = `${pos.y}px`
    hoveredRef.current = -1
    parentRef.current = -1
    hoveredSubRef.current = -1
    setHovered(-1)
    setSubmenuParent(-1)
    setHoveredSub(-1)
  }, [open, menu])

  // Submenu placement: parent's right edge - 1, aligned with the parent row; flips left; clamped.
  useLayoutEffect(() => {
    if (!open || submenuParent < 0) return
    const el = menuRef.current
    const sub = subRef.current
    const entries = contentRef.current?.entries
    if (!el || !sub || !entries) return
    const parentEntry = entries[submenuParent]
    if (!parentEntry?.submenu || parentEntry.submenu.length === 0) return
    const row = el.querySelectorAll<HTMLElement>('[role="menuitem"]')[submenuParent]
    if (!row) return
    const bounds = viewportFrameRect()
    const menuRect = el.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const w = sub.offsetWidth
    const h = sub.offsetHeight
    const firstRow = sub.querySelector<HTMLElement>('[role="menuitem"], [data-submenu-index]')
    const rowOffset = firstRow ? firstRow.offsetTop : 0
    let left = menuRect.right - 1
    let top = rowRect.top - rowOffset
    if (left + w + MARGIN > bounds.right) left = menuRect.left - w + 1
    if (left < bounds.left + MARGIN) left = bounds.left + MARGIN
    if (left + w + MARGIN > bounds.right) left = bounds.right - w - MARGIN
    if (top < bounds.top + MARGIN) top = bounds.top + MARGIN
    if (top + h + MARGIN > bounds.bottom) top = bounds.bottom - h - MARGIN
    sub.style.left = `${left}px`
    sub.style.top = `${top}px`
  }, [open, submenuParent, menu])

  const unionRect = useCallback((): DOMRect | null => {
    const el = menuRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const sub = subRef.current
    if (!sub || parentRef.current < 0) return r
    const s = sub.getBoundingClientRect()
    const left = Math.min(r.left, s.left)
    const top = Math.min(r.top, s.top)
    return new DOMRect(left, top, Math.max(r.right, s.right) - left, Math.max(r.bottom, s.bottom) - top)
  }, [])

  useEffect(() => {
    if (!open) return
    const onMove = (e: MouseEvent): void => {
      const rect = unionRect()
      if (!rect) return
      const dx = Math.max(rect.left - e.clientX, e.clientX - rect.right, 0)
      const dy = Math.max(rect.top - e.clientY, e.clientY - rect.bottom, 0)
      if (Math.sqrt(dx * dx + dy * dy) > DISMISS_DISTANCE) {
        onClose()
        return
      }
      const entries = contentRef.current?.entries ?? []
      const row = rowIndexAt(menuRef.current, '[role="menuitem"]', e.clientX, e.clientY)
      const subRow = rowIndexAt(subRef.current, '[data-submenu-index]', e.clientX, e.clientY, 'data-submenu-index')
      let parent = parentRef.current
      if (row >= 0 && entries[row]?.submenu && entries[row]!.submenu!.length > 0) parent = row
      else if (subRow >= 0 && parentRef.current >= 0) parent = parentRef.current
      else if (row >= 0) parent = -1
      if (parent !== parentRef.current) {
        parentRef.current = parent
        hoveredSubRef.current = -1
        setSubmenuParent(parent)
        setHoveredSub(-1)
      }
      if (row !== hoveredRef.current) {
        hoveredRef.current = row
        setHovered(row)
      }
      if (subRow !== hoveredSubRef.current) {
        hoveredSubRef.current = subRow
        setHoveredSub(subRow)
      }
    }
    const select = (entry: MenuEntry | undefined, e: MouseEvent): void => {
      if (!entry || entry.disabled) return
      if (entry.clickType) onCross(e.clientX, e.clientY, entry.clickType)
      entry.onClick?.()
    }
    const onDown = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const entries = contentRef.current?.entries
      if (entries) {
        const parent = parentRef.current
        const subRow = rowIndexAt(subRef.current, '[data-submenu-index]', e.clientX, e.clientY, 'data-submenu-index')
        if (parent >= 0 && subRow >= 0) select(entries[parent]?.submenu?.[subRow], e)
        else {
          const row = rowIndexAt(menuRef.current, '[role="menuitem"]', e.clientX, e.clientY)
          if (row >= 0) select(entries[row], e)
        }
      }
      e.stopPropagation()
      e.preventDefault()
      onClose()
    }
    const onBlur = (): void => onClose()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [open, onClose, onCross, unionRect])

  if (!open || !menu || typeof document === 'undefined') return null

  const fontSize = `${Math.round(18 * g)}px`
  const textShadow = '1px 1px 0 rgba(0, 0, 0, 0.7)'
  const boxStyle = {
    position: 'absolute' as const,
    left: menu.x,
    top: menu.y,
    pointerEvents: 'none' as const,
    backgroundColor: palette.background,
    border: `1px solid ${palette.border}`,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    padding: '2px',
    display: 'flex',
    flexDirection: 'column' as const,
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
    WebkitFontSmoothing: 'none',
    MozOsxFontSmoothing: 'grayscale',
  }
  const submenu = submenuParent >= 0 ? (menu.content.entries[submenuParent]?.submenu ?? null) : null

  const renderSubmenuRows = (items: MenuEntry[]): JSX.Element[] => {
    const out: JSX.Element[] = []
    let section: { entry: MenuEntry; index: number } | null = null
    let swatches: { entry: MenuEntry; index: number }[] = []
    const swatch = (entry: MenuEntry, index: number): JSX.Element => {
      const size = Math.round(15 * g)
      const active = entry.target === 'active'
      const isHovered = hoveredSub === index
      return (
        <div
          key={`swatch-${entry.targetColor}-${index}`}
          role="menuitem"
          data-submenu-index={index}
          tabIndex={0}
          style={{
            cursor: 'default',
            backgroundColor: entry.targetColor,
            width: `${size}px`,
            height: `${size}px`,
            boxSizing: 'border-box',
            borderRadius: '2px',
            border: active ? `1px solid ${palette.swatchBorderActive}` : isHovered ? `1px solid ${palette.swatchBorderHover}` : `1px solid ${palette.swatchBorder}`,
            boxShadow: active ? `0 0 0 1px ${palette.swatchBorderActive}` : 'none',
            transition: 'border-color 0.15s ease',
          }}
        />
      )
    }
    const flush = (): void => {
      if (!section && swatches.length === 0) return
      if (section) {
        const { entry, index } = section
        const isHovered = hoveredSub === index
        const disabled = entry.disabled === true
        out.push(
          <div key={`section-${index}`} style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <div
              role="menuitem"
              data-submenu-index={index}
              tabIndex={disabled ? -1 : 0}
              style={{
                flex: 1,
                padding: '2px 4px',
                cursor: 'default',
                backgroundColor: isHovered && !disabled ? palette.backgroundHover : 'transparent',
                display: 'flex',
                alignItems: 'center',
                lineHeight: `${Math.round(14 * g)}px`,
              }}
            >
              <span style={{ fontFamily: '"RuneScape Bold 12", sans-serif', fontSize, color: disabled ? palette.disabled : palette.action, textShadow }}>{entry.action}</span>
              {entry.target && (
                <span
                  style={{
                    fontFamily: '"RuneScape Bold 12", sans-serif',
                    fontSize,
                    color: disabled ? palette.disabled : (entry.targetColor ?? palette.target),
                    textShadow,
                    marginLeft: `${Math.round(4 * g)}px`,
                    marginRight: swatches.length > 0 ? `${Math.round(8 * g)}px` : 0,
                  }}
                >
                  {entry.target}
                </span>
              )}
            </div>
            {swatches.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: `${Math.round(5 * g)}px`, paddingRight: `${Math.round(4 * g)}px` }}>
                {swatches.map((s) => swatch(s.entry, s.index))}
              </div>
            )}
          </div>,
        )
      } else {
        out.push(
          <div
            key={`swatches-${swatches[0]?.index}`}
            style={{ display: 'flex', alignItems: 'center', gap: `${Math.round(5 * g)}px`, padding: `${Math.round(2 * g)}px ${Math.round(4 * g)}px` }}
          >
            {swatches.map((s) => swatch(s.entry, s.index))}
          </div>,
        )
      }
    }
    items.forEach((entry, index) => {
      if (entry.action === 'swatch') swatches.push({ entry, index })
      else {
        flush()
        section = { entry, index }
        swatches = []
      }
    })
    flush()
    return out
  }

  return createPortal(
    <div
      role="dialog"
      data-context-menu-overlay=""
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 100000, pointerEvents: 'auto' }}
    >
      <div ref={menuRef} role="menu" className="panel-surface" style={boxStyle}>
        <div
          style={{
            padding: '3px 6px',
            fontFamily: '"RuneScape Bold 12", sans-serif',
            fontSize,
            color: palette.headerText,
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            textShadow,
            lineHeight: `${Math.round(15 * g)}px`,
            textAlign: 'center',
          }}
        >
          Choose Option
        </div>
        <div style={{ height: 1, backgroundColor: palette.separator, margin: '0 2px' }} />
        {menu.content.entries.map((entry, i) => {
          const isHovered = hovered === i
          const disabled = entry.disabled === true
          const hasSub = !!entry.submenu && entry.submenu.length > 0
          return (
            <div
              key={`${i}:${entry.action}:${entry.target ?? ''}:${entry.targetColor ?? ''}:${entry.clickType ?? ''}:${disabled ? 'disabled' : 'enabled'}`}
              role="menuitem"
              tabIndex={disabled ? -1 : 0}
              style={{
                padding: hasSub ? '2px 16px 2px 4px' : '2px 4px',
                cursor: 'default',
                backgroundColor: isHovered && !disabled ? palette.backgroundHover : 'transparent',
                display: 'flex',
                alignItems: 'center',
                lineHeight: `${Math.round(14 * g)}px`,
                position: 'relative',
              }}
            >
              <span style={{ fontFamily: '"RuneScape Bold 12", sans-serif', fontSize, color: disabled ? palette.disabled : palette.action, textShadow }}>{entry.action}</span>
              {entry.target && (
                <span
                  style={{
                    fontFamily: '"RuneScape Bold 12", sans-serif',
                    fontSize,
                    color: disabled ? palette.disabled : (entry.targetColor ?? palette.target),
                    textShadow,
                    marginLeft: `${Math.round(4 * g)}px`,
                  }}
                >
                  {entry.target}
                </span>
              )}
              {hasSub && (
                <span
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 0,
                    height: 0,
                    borderTop: '3px solid transparent',
                    borderBottom: '3px solid transparent',
                    borderLeft: `4px solid ${disabled ? palette.disabled : palette.action}`,
                    filter: 'drop-shadow(1px 1px 0px #000)',
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
      {submenu && submenu.length > 0 && (
        <div ref={subRef} role="menu" className="panel-surface" style={boxStyle}>
          <div
            style={{
              padding: '3px 4px 1px 4px',
              fontFamily: '"RuneScape Bold 12", sans-serif',
              fontSize,
              color: palette.headerText,
              backgroundColor: palette.headerBackground,
              textShadow: '1px 1px 0 #000',
              lineHeight: `${Math.round(15 * g)}px`,
              textAlign: 'center',
            }}
          >
            {menu.content.entries[submenuParent]?.target ?? 'Choose Option'}
          </div>
          <div style={{ height: 1, backgroundColor: palette.separator, margin: 0 }} />
          {renderSubmenuRows(submenu)}
        </div>
      )}
    </div>,
    document.body,
  )
}
