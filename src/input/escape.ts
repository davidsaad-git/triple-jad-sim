import { useEffect, useRef } from 'react'

/**
 * Escape priority stack.
 *
 * Open overlays register a close handler with a priority; Escape runs only the
 * highest-priority one (the first registered wins a tie). The in-game context
 * menu is not on this stack. The side-panel "inventory" tab key (Escape by
 * default) is handled separately by hotkeys.ts and does not check this stack,
 * exactly like scim (both listeners run on the same keydown).
 */

export const ESC_PRIORITY = {
  SIDE_PANEL: 10,
  ARMED_SPELL: 15,
  SETTINGS: 20,
  PLUGINS: 21,
  CACHE_EXPLORER: 30,
  COLOR_PICKER: 40,
  CONFIGURE_DIALOG: 40,
  ENCOUNTER_PICKER: 50,
  /** Shortcuts / Credits / What's New / Training / Replays modals. */
  MODAL: 1300,
} as const

interface EscapeEntry {
  priority: number
  handler: () => void
}

const stack: EscapeEntry[] = []
let listening = false

interface EscapeKeyEvent {
  key: string
  defaultPrevented: boolean
}

/** Run the top handler for an Escape keydown. Returns true when a handler ran. */
export function handleEscapeKeydown(event: EscapeKeyEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || stack.length === 0) return false
  let top = stack[0]!
  for (let i = 1; i < stack.length; i++) if (stack[i]!.priority > top.priority) top = stack[i]!
  top.handler()
  return true
}

function onWindowKeydown(event: KeyboardEvent): void {
  handleEscapeKeydown(event)
}

function ensureListening(): void {
  if (listening || typeof window === 'undefined') return
  window.addEventListener('keydown', onWindowKeydown)
  listening = true
}

function maybeStopListening(): void {
  if (stack.length > 0 || !listening || typeof window === 'undefined') return
  window.removeEventListener('keydown', onWindowKeydown)
  listening = false
}

/** Register an open overlay's Escape handler; call the returned function when it closes. */
export function registerEscapeHandler(priority: number, handler: () => void): () => void {
  const entry: EscapeEntry = { priority, handler }
  stack.push(entry)
  ensureListening()
  return () => {
    const i = stack.indexOf(entry)
    if (i >= 0) stack.splice(i, 1)
    maybeStopListening()
  }
}

/**
 * React hook: while `isOpen`, Escape at `priority` calls the
 * latest `onClose`.
 */
export function useEscapeHandler(priority: number, isOpen: boolean, onClose: () => void): void {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!isOpen) return
    return registerEscapeHandler(priority, () => ref.current())
  }, [isOpen, priority])
}

/** Number of open overlays on the stack (for tests / debugging). */
export function escapeStackSize(): number {
  return stack.length
}
