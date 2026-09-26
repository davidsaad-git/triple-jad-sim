import type { MouseEvent as ReactMouseEvent } from 'react'
import type { MenuContent } from './menu'

/**
 * The one app-wide right-click menu (scim provider: `showContextMenu`,
 * `hideContextMenu`). The viewport
 * and the inventory (CLIENT-UI) open menus through it; ViewportInput renders
 * it (<ContextMenu>). Opening hides the tooltip; closing re-checks hover.
 */

export interface OpenMenuState {
  content: MenuContent
  /** Client coordinates of the right click. */
  x: number
  y: number
}

let current: OpenMenuState | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of [...listeners]) l()
}

export function showContextMenu(content: MenuContent, clientX: number, clientY: number): void {
  if (content.entries.length === 0) return
  current = { content, x: clientX, y: clientY }
  notify()
}

export function hideContextMenu(): void {
  if (!current) return
  current = null
  notify()
}

export function getContextMenu(): OpenMenuState | null {
  return current
}

export function isContextMenuOpen(): boolean {
  return current !== null
}

export function subscribeContextMenu(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Props for a UI element with a right-click menu:
 * right mousedown without Alt opens the menu (when it has entries); the native
 * context menu is suppressed.
 */
export function bindContextMenu(getContent: () => MenuContent | null): {
  onMouseDown: (e: ReactMouseEvent) => void
  onContextMenu: (e: ReactMouseEvent) => void
} {
  return {
    onMouseDown: (e) => {
      if (e.button !== 2 || e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      const content = getContent()
      if (content && content.entries.length > 0) showContextMenu(content, e.clientX, e.clientY)
    },
    onContextMenu: (e) => e.preventDefault(),
  }
}
