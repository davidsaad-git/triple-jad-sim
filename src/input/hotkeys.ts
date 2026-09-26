import { type GamePanelKeybinds, type Keybinds, keybindStore } from '../app/keybinds'
import { handleEscapeKeydown } from './escape'

export { ESC_PRIORITY, escapeStackSize, handleEscapeKeydown, registerEscapeHandler, useEscapeHandler } from './escape'
export { beginKeyCapture, getModifiers, isKeyCaptureActive, isKeyHeld, onModifiersChange } from './modifiers'

/**
 * Global keyboard shortcuts (scim; side-panel tab
 * keys).
 *
 * - Ctrl/Cmd+R (no Shift): restart; a second press within 1.5 s shows the
 *   "use Ctrl+Shift+R" tip. Ctrl+Shift+R reloads normally.
 * - Ctrl+K: toggle the encounter picker. Ctrl+Shift+F: toggle the FPS readout.
 * - Every other Ctrl/Cmd combo is prevented outside text fields, except C, V,
 *   X, A (and Ctrl+Shift+R).
 * - Ctrl+wheel and Ctrl +/-/0 are blocked (tip: Alt + Scroll).
 * - F1-F12 are always prevented; Tab is prevented and blurs the focused element;
 *   Alt keyup is prevented; unbound digits 1-9 show the "Rebind keys" tip.
 * - Game-panel tab keys (keybindStore.gamePanel) select a tab (not a toggle),
 *   ignored in inputs/textareas; preventDefault except for Escape.
 * - Escape runs the priority stack (escape.ts).
 */

export type GamePanelTab = keyof GamePanelKeybinds

export type ShortcutHintType = 'resize' | 'drag' | 'keybind' | 'reload' | 'firefox-shift-rclick'

/** Tip texts; `emphasis` parts are highlighted. */
export const SHORTCUT_HINT_MESSAGES: Record<ShortcutHintType, { text: string; emphasis?: boolean; kbd?: boolean }[]> = {
  resize: [{ text: 'Use ' }, { text: 'Alt + Scroll', emphasis: true }, { text: ' to resize UI panels' }],
  drag: [{ text: 'Use ' }, { text: 'Alt + Drag', emphasis: true }, { text: ' to move UI panels' }],
  keybind: [{ text: 'Rebind keys in the ' }, { text: 'Keybinds', emphasis: true }, { text: ' tab' }],
  reload: [{ text: 'Trying to reload the page? Use ' }, { text: 'Ctrl+Shift+R', kbd: true }, { text: ' instead.' }],
  'firefox-shift-rclick': [
    { text: 'Firefox opens its own menu on ' },
    { text: 'Shift + Right-click', emphasis: true },
    { text: '. Use ' },
    { text: 'Ctrl + Right-click', emphasis: true },
    { text: ' instead.' },
  ],
}

// ---------------------------------------------------------------------------
// Registries the UI hooks into
// ---------------------------------------------------------------------------

const tabListeners = new Set<(tab: GamePanelTab) => void>()
const hintListeners = new Set<(type: ShortcutHintType) => void>()

/** The client frame registers here to switch the side-panel tab. */
export function onPanelTabSelect(listener: (tab: GamePanelTab) => void): () => void {
  tabListeners.add(listener)
  return () => {
    tabListeners.delete(listener)
  }
}

/** Select a side-panel tab programmatically (same path as the key). */
export function selectPanelTab(tab: GamePanelTab): void {
  for (const l of [...tabListeners]) l(tab)
}

/** The tip-toast UI registers here (see SHORTCUT_HINT_MESSAGES). */
export function onShortcutHint(listener: (type: ShortcutHintType) => void): () => void {
  hintListeners.add(listener)
  return () => {
    hintListeners.delete(listener)
  }
}

function emitHint(type: ShortcutHintType): void {
  for (const l of [...hintListeners]) l(type)
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/** Normalise a KeyboardEvent.key for comparison: Space, Plus, single chars upper-cased. */
export function normalizeKeyName(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'Space'
  if (key === '+') return 'Plus'
  return key.length === 1 ? key.toUpperCase() : key
}

export function keysEqual(a: string, b: string): boolean {
  return normalizeKeyName(a) === normalizeKeyName(b)
}

/** Display form of a key in the Shortcuts dialog / tips. */
export function formatKeyLabel(key: string): string {
  if (key === 'Escape') return 'Esc'
  if (key === ' ') return 'Space'
  if (key.startsWith('F') && key.length <= 3) return key
  return key.length === 1 ? key.toUpperCase() : key
}

// ---------------------------------------------------------------------------
// Handlers (pure over event-like objects; installGlobalHotkeys wires them)
// ---------------------------------------------------------------------------

export interface HotkeyActions {
  onRestart(): void
  onToggleEncounterPicker(): void
  onToggleShowFps(): void
  /** Defaults to the onShortcutHint registry. */
  onHint?: (type: ShortcutHintType) => void
}

export interface HotkeyKeyEvent {
  key: string
  code?: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  target: EventTarget | null
  defaultPrevented: boolean
  preventDefault(): void
}

export interface HotkeyOptions {
  keybinds?: () => Keybinds
  now?: () => number
  /** Blur hook for Tab (defaults to blurring document.activeElement). */
  blurActive?: () => void
  /** Called when an unbound digit is pressed (scim `shortcut-hint:highlight-settings`). */
  onHighlightSettings?: () => void
}

function isTextField(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined') return false
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
}

function isInputOrTextarea(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined') return false
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

export interface HotkeyHandlers {
  keydown(event: HotkeyKeyEvent): void
  keyup(event: Pick<HotkeyKeyEvent, 'key' | 'preventDefault'>): void
  wheel(event: { ctrlKey: boolean; preventDefault(): void }): void
}

export function createHotkeyHandlers(actions: HotkeyActions, options: HotkeyOptions = {}): HotkeyHandlers {
  const keybinds = options.keybinds ?? (() => keybindStore.get())
  const now = options.now ?? (() => Date.now())
  const hint = actions.onHint ?? emitHint
  let lastRestartAt = 0

  const blurActive =
    options.blurActive ??
    (() => {
      if (typeof document === 'undefined') return
      const el = document.activeElement
      if (el instanceof HTMLElement && el !== document.body) el.blur()
    })

  return {
    keydown(e) {
      // Ctrl +/-/0: browser zoom blocked.
      if (e.ctrlKey) {
        const plus = e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd'
        const minus = e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract'
        const zero = e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0'
        if (plus || minus || zero) {
          hint('resize')
          e.preventDefault()
        }
      }
      // F1-F12.
      if (/^F\d{1,2}$/.test(e.key)) e.preventDefault()
      // Unbound digits.
      if (!isInputOrTextarea(e.target) && !e.ctrlKey && !e.altKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const kb = keybinds()
        const bound = new Set<string>([...Object.values(kb.gamePanel), ...Object.values(kb.camera)])
        if (!bound.has(e.key)) {
          hint('keybind')
          options.onHighlightSettings?.()
        }
      }
      // Tab.
      if (e.key === 'Tab') {
        e.preventDefault()
        blurActive()
      }
      // Ctrl+K.
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        actions.onToggleEncounterPicker()
      }
      // Ctrl+Shift+F.
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        actions.onToggleShowFps()
      }
      // Ctrl/Cmd+R.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && keysEqual(e.key, 'r')) {
        e.preventDefault()
        actions.onRestart()
        const t = now()
        if (t - lastRestartAt < 1500) hint('reload')
        lastRestartAt = t
      }
      // Other Ctrl/Cmd combos.
      if ((e.ctrlKey || e.metaKey) && e.key !== 'Control' && e.key !== 'Meta' && !isTextField(e.target)) {
        const k = e.key.toLowerCase()
        const allowed = (e.shiftKey && k === 'r') || k === 'c' || k === 'v' || k === 'x' || k === 'a'
        if (!allowed) e.preventDefault()
      }
      // Side-panel tabs.
      if (!isInputOrTextarea(e.target)) {
        for (const [tab, bind] of Object.entries(keybinds().gamePanel)) {
          if (bind && keysEqual(e.key, bind)) {
            if (bind !== 'Escape') e.preventDefault()
            selectPanelTab(tab as GamePanelTab)
            break
          }
        }
      }
    },
    keyup(e) {
      if (e.key === 'Alt') e.preventDefault()
    },
    wheel(e) {
      if (!e.ctrlKey) return
      hint('resize')
      e.preventDefault()
    },
  }
}

/**
 * Install the global handlers on `window`. Returns the uninstall function.
 * The Escape stack installs its own listener (escape.ts).
 */
export function installGlobalHotkeys(actions: HotkeyActions, options: HotkeyOptions = {}): () => void {
  if (typeof window === 'undefined') return () => {}
  const handlers = createHotkeyHandlers(actions, {
    onHighlightSettings: () => window.dispatchEvent(new CustomEvent('shortcut-hint:highlight-settings')),
    ...options,
  })
  const hint = actions.onHint ?? emitHint
  const onKeydown = (e: KeyboardEvent): void => handlers.keydown(e)
  const onKeyup = (e: KeyboardEvent): void => handlers.keyup(e)
  const onWheel = (e: WheelEvent): void => handlers.wheel(e)
  const onCtrlDrag = (): void => hint('drag')
  const onFirefoxShiftRightClick = (e: MouseEvent): void => {
    if (e.button !== 2 || !e.shiftKey) return
    const t = e.target
    if (t instanceof HTMLElement && t.closest('[data-tutorial-input-surface="gameplay"], [data-viewport-input]')) hint('firefox-shift-rclick')
  }
  const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)
  // scim blocks the browser context menu and native drags document-wide at boot.
  const prevent = (e: Event): void => e.preventDefault()
  document.addEventListener('dragstart', prevent)
  document.addEventListener('contextmenu', prevent)
  window.addEventListener('keydown', onKeydown, { passive: false })
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('shortcut-hint:ctrl-drag', onCtrlDrag)
  if (isFirefox) window.addEventListener('mousedown', onFirefoxShiftRightClick, true)
  return () => {
    document.removeEventListener('dragstart', prevent)
    document.removeEventListener('contextmenu', prevent)
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('keyup', onKeyup)
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('shortcut-hint:ctrl-drag', onCtrlDrag)
    if (isFirefox) window.removeEventListener('mousedown', onFirefoxShiftRightClick, true)
  }
}

/** For tests: run the Escape stack for an event the same way the window listener does. */
export function dispatchEscape(event: { key: string; defaultPrevented: boolean }): boolean {
  return handleEscapeKeydown(event)
}

// ---------------------------------------------------------------------------
// Shortcuts dialog data
// ---------------------------------------------------------------------------

export interface ShortcutRow {
  keys: string
  description: string
}

export interface ShortcutCategory {
  title: string
  shortcuts: ShortcutRow[]
}

function panelKey(kb: Keybinds, tab: GamePanelTab, fallback: string): string {
  const key = kb.gamePanel[tab] ?? fallback
  return key === 'Escape' ? 'Esc' : key === ' ' ? 'Space' : key
}

function cameraKey(kb: Keybinds, action: keyof Keybinds['camera'], fallback: string): string {
  const key = kb.camera[action] ?? fallback
  return key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key
}

export function getShortcutCategories(kb: Keybinds = keybindStore.get()): ShortcutCategory[] {
  return [
    {
      title: 'General',
      shortcuts: [
        { keys: 'Ctrl+K', description: 'Open encounter picker' },
        { keys: 'Ctrl+R', description: 'Restart simulation' },
        { keys: 'P', description: 'Pause / resume' },
        { keys: 'Esc', description: 'Close topmost overlay' },
        { keys: 'Ctrl+Shift+R', description: 'Reload the page' },
      ],
    },
    {
      title: 'Game Panel Tabs',
      shortcuts: [
        { keys: panelKey(kb, 'inventory', 'Escape'), description: 'Inventory' },
        { keys: panelKey(kb, 'combat', 'F1'), description: 'Combat' },
        { keys: panelKey(kb, 'skills', 'F2'), description: 'Skills' },
        { keys: panelKey(kb, 'equipment', 'F4'), description: 'Equipment' },
        { keys: panelKey(kb, 'prayer', 'F5'), description: 'Prayer' },
        { keys: panelKey(kb, 'spellbook', 'F6'), description: 'Spellbook' },
        { keys: panelKey(kb, 'settings', 'F11'), description: 'Settings' },
      ],
    },
    {
      title: 'Camera',
      shortcuts: [
        { keys: `${cameraKey(kb, 'orbitRotateLeft', 'a')} / ${cameraKey(kb, 'orbitRotateRight', 'd')}`, description: 'Rotate left / right' },
        { keys: `${cameraKey(kb, 'orbitTiltUp', 'w')} / ${cameraKey(kb, 'orbitTiltDown', 's')}`, description: 'Tilt up / down' },
      ],
    },
    {
      title: 'Replay',
      shortcuts: [
        { keys: 'Space', description: 'Play / pause' },
        { keys: '← / →', description: 'Step backward / forward' },
        { keys: 'Home / End', description: 'Jump to start / end' },
        { keys: 'Esc', description: 'Exit replay' },
      ],
    },
    {
      title: 'Mouse Shortcuts',
      shortcuts: [
        { keys: 'Ctrl+Click', description: 'Invert walk/run' },
        { keys: 'Shift+Right-click', description: 'Extended context menu' },
        { keys: 'Alt+Drag', description: 'Move UI panels' },
        { keys: 'Alt+Scroll', description: 'Resize UI panels' },
        { keys: 'Alt+Right-click', description: 'Reset panel position' },
        { keys: 'Alt+Middle-click', description: 'Reset panel scale' },
      ],
    },
  ]
}
