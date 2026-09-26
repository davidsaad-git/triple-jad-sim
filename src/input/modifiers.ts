/**
 * Global modifier / mouse-button / held-key tracker.
 *
 * Capture-phase listeners on key and pointer events keep the current
 * Shift/Ctrl/Alt/Meta state, the pressed mouse buttons and the held keys
 * (keyed by `event.code`, stored as the lower-cased `event.key`). Keys that
 * auto-repeated and were not seen for 1.5 s are purged every 0.5 s (stuck-key
 * guard). Everything resets on blur, focus, pagehide and visibilitychange.
 * While a keybind editor captures keys (`beginKeyCapture`), keydowns are not
 * tracked and `isKeyHeld` reports nothing.
 */

export interface ModifierState {
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

export interface MouseButtonState {
  left: boolean
  right: boolean
  middle: boolean
}

const MOD_BIT = { shift: 1, ctrl: 2, alt: 4, meta: 8 } as const
const BUTTON_BIT = { left: 1, right: 2, middle: 4 } as const
const ALL_BUTTONS = BUTTON_BIT.left | BUTTON_BIT.right | BUTTON_BIT.middle
const STALE_REPEAT_MS = 1500
const PURGE_INTERVAL_MS = 500
const MOD_ORDER = ['shift', 'ctrl', 'alt', 'meta'] as const
const KEY_TO_MOD: Record<string, keyof ModifierState> = { Shift: 'shift', Control: 'ctrl', Alt: 'alt', Meta: 'meta' }
/** Held-key name registered for each modifier (so bindings like "Shift" can be polled). */
const MOD_KEY_NAME: Record<keyof ModifierState, string> = { shift: 'shift', ctrl: 'control', alt: 'alt', meta: 'meta' }

const NO_MODS: ModifierState = { shift: false, ctrl: false, alt: false, meta: false }
const NO_BUTTONS: MouseButtonState = { left: false, right: false, middle: false }

interface HeldKey {
  key: string
  lastSeenMs: number
  sawRepeat: boolean
}

interface KeyLikeEvent {
  type: string
  key?: string
  code?: string
  repeat?: boolean
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

interface PointerLikeEvent {
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  buttons?: number
}

type KeyCaptureHandler = (event: KeyboardEvent) => boolean

export class InputTracker {
  private modBits = 0
  private mods: ModifierState = NO_MODS
  private buttonBits = 0
  private buttons: MouseButtonState = NO_BUTTONS
  /** event.code -> held key. */
  private readonly held = new Map<string, HeldKey>()
  /** lower-cased key name -> hold count. */
  private readonly heldCounts = new Map<string, number>()
  private readonly modListeners = new Set<(mods: ModifierState) => void>()
  private readonly buttonListeners = new Set<(buttons: MouseButtonState) => void>()
  private purgeTimer: ReturnType<typeof setInterval> | null = null
  private captureHandler: KeyCaptureHandler | null = null
  private readonly nowMs: () => number

  constructor(nowMs: () => number = () => Date.now()) {
    this.nowMs = nowMs
  }

  getModifiers(): ModifierState {
    return this.mods
  }

  getMouseButtons(): MouseButtonState {
    return this.buttons
  }

  onModifiersChange(listener: (mods: ModifierState) => void): () => void {
    this.modListeners.add(listener)
    return () => {
      this.modListeners.delete(listener)
    }
  }

  onMouseButtonsChange(listener: (buttons: MouseButtonState) => void): () => void {
    this.buttonListeners.add(listener)
    return () => {
      this.buttonListeners.delete(listener)
    }
  }

  /** True while `key` (a KeyboardEvent.key such as "a", " " or "Shift") is held. */
  isKeyHeld(key: string): boolean {
    return !this.isKeyCaptureActive() && this.heldCounts.has(key.toLowerCase())
  }

  isKeyCaptureActive(): boolean {
    return this.captureHandler !== null
  }

  /**
   * Keybind editor capture: `handler` sees every keydown
   * first (capture phase); returning true swallows the event. Returns the
   * release function.
   */
  beginKeyCapture(handler: KeyCaptureHandler, target: Window | undefined = typeof window !== 'undefined' ? window : undefined): () => void {
    this.captureHandler = handler
    const listener = (event: KeyboardEvent): void => {
      if (this.captureHandler !== handler || !handler(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    target?.addEventListener('keydown', listener, true)
    return () => {
      if (this.captureHandler === handler) this.captureHandler = null
      target?.removeEventListener('keydown', listener, true)
    }
  }

  // ---- event feeding (public for tests) -----------------------------------

  handlePointerEvent(event: PointerLikeEvent): void {
    this.setModBits(modBitsOf(event))
    this.setButtonBits(typeof event.buttons === 'number' ? event.buttons & ALL_BUTTONS : 0)
  }

  handleKeyEvent(event: KeyLikeEvent): void {
    const isDown = event.type === 'keydown'
    if (isDown && this.isKeyCaptureActive()) return
    const key = typeof event.key === 'string' ? event.key : ''
    const mod = KEY_TO_MOD[key]
    const bits = modBitsOf(event)
    if (mod) {
      this.setModBits(isDown ? bits | MOD_BIT[mod] : bits)
      return
    }
    this.setModBits(bits)
    if (key === '') return
    const code = typeof event.code === 'string' && event.code !== '' ? event.code : key
    if (!isDown) {
      const held = this.held.get(code)
      if (!held) return
      this.held.delete(code)
      this.release(held.key)
      if (this.held.size === 0) this.stopPurge()
      return
    }
    const existing = this.held.get(code)
    if (existing) {
      existing.lastSeenMs = this.nowMs()
      if (event.repeat) existing.sawRepeat = true
      return
    }
    const name = key.toLowerCase()
    this.held.set(code, { key: name, lastSeenMs: this.nowMs(), sawRepeat: event.repeat === true })
    this.hold(name)
    this.startPurge()
  }

  /** Drop keys that auto-repeated and have not been seen for 1.5 s. */
  purgeStale(): void {
    const now = this.nowMs()
    for (const [code, held] of this.held) {
      if (held.sawRepeat && now - held.lastSeenMs > STALE_REPEAT_MS) {
        this.held.delete(code)
        this.release(held.key)
      }
    }
    if (this.held.size === 0) this.stopPurge()
  }

  /** Everything released (blur, focus, pagehide, visibilitychange). */
  reset(): void {
    this.held.clear()
    this.heldCounts.clear()
    this.stopPurge()
    this.setModBits(0)
    this.setButtonBits(0)
  }

  // ---- window wiring --------------------------------------------------------

  private attached = false

  attach(target: Window): void {
    if (this.attached) return
    this.attached = true
    const onKey = (e: KeyboardEvent): void => this.handleKeyEvent(e)
    const onPointer = (e: Event): void => this.handlePointerEvent(e as MouseEvent)
    const onReset = (): void => this.reset()
    target.addEventListener('keydown', onKey, { capture: true, passive: true })
    target.addEventListener('keyup', onKey, { capture: true, passive: true })
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'click', 'contextmenu', 'wheel']) {
      target.addEventListener(type, onPointer, { capture: true, passive: true })
    }
    target.addEventListener('blur', onReset)
    target.addEventListener('focus', onReset)
    target.addEventListener('pagehide', onReset)
    target.document.addEventListener('visibilitychange', onReset)
  }

  // ---- internals --------------------------------------------------------------

  private hold(name: string): void {
    this.heldCounts.set(name, (this.heldCounts.get(name) ?? 0) + 1)
  }

  private release(name: string): void {
    const n = (this.heldCounts.get(name) ?? 0) - 1
    if (n > 0) this.heldCounts.set(name, n)
    else this.heldCounts.delete(name)
  }

  private setModBits(bits: number): void {
    const prev = this.modBits
    if (bits === prev) return
    this.modBits = bits
    this.mods = { shift: (bits & MOD_BIT.shift) !== 0, ctrl: (bits & MOD_BIT.ctrl) !== 0, alt: (bits & MOD_BIT.alt) !== 0, meta: (bits & MOD_BIT.meta) !== 0 }
    for (const mod of MOD_ORDER) {
      const was = (prev & MOD_BIT[mod]) !== 0
      const is = (bits & MOD_BIT[mod]) !== 0
      if (was !== is) {
        if (is) this.hold(MOD_KEY_NAME[mod])
        else this.release(MOD_KEY_NAME[mod])
      }
    }
    for (const listener of [...this.modListeners]) listener(this.mods)
  }

  private setButtonBits(bits: number): void {
    if (bits === this.buttonBits) return
    this.buttonBits = bits
    this.buttons = { left: (bits & BUTTON_BIT.left) !== 0, right: (bits & BUTTON_BIT.right) !== 0, middle: (bits & BUTTON_BIT.middle) !== 0 }
    for (const listener of [...this.buttonListeners]) listener(this.buttons)
  }

  private startPurge(): void {
    if (this.purgeTimer !== null || typeof setInterval === 'undefined') return
    this.purgeTimer = setInterval(() => this.purgeStale(), PURGE_INTERVAL_MS)
  }

  private stopPurge(): void {
    if (this.purgeTimer === null) return
    clearInterval(this.purgeTimer)
    this.purgeTimer = null
  }
}

function modBitsOf(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): number {
  return (e.shiftKey ? MOD_BIT.shift : 0) | (e.ctrlKey ? MOD_BIT.ctrl : 0) | (e.altKey ? MOD_BIT.alt : 0) | (e.metaKey ? MOD_BIT.meta : 0)
}

/** The app-wide tracker; attached to `window` on first use. */
export const inputTracker = new InputTracker()

function ensureAttached(): InputTracker {
  if (typeof window !== 'undefined') inputTracker.attach(window)
  return inputTracker
}

/** Current Shift/Ctrl/Alt/Meta. */
export function getModifiers(): ModifierState {
  return ensureAttached().getModifiers()
}

/** Subscribe to modifier changes. */
export function onModifiersChange(listener: (mods: ModifierState) => void): () => void {
  return ensureAttached().onModifiersChange(listener)
}

export function getMouseButtons(): MouseButtonState {
  return ensureAttached().getMouseButtons()
}

/** Held-key poll for camera keys. */
export function isKeyHeld(key: string): boolean {
  return ensureAttached().isKeyHeld(key)
}

export function beginKeyCapture(handler: KeyCaptureHandler): () => void {
  return ensureAttached().beginKeyCapture(handler)
}

export function isKeyCaptureActive(): boolean {
  return inputTracker.isKeyCaptureActive()
}

/** True when an editable element has focus: camera keys and hotkeys are ignored then. */
export function isEditableElement(el: unknown): boolean {
  if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}
