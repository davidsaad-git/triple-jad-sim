/**
 * "Show Shortcut Hints" tip toasts: INPUT emits hint types (`onShortcutHint`), this stack
 * shows them bottom-left above the HUD tools. Same type at most once per 30 s,
 * at most 5 per session, auto-dismiss after 7 s (160 ms exit); "Don't show
 * again" appends the type to `disabledShortcutHints`.
 */
import './styles/tokens.css'
import './styles/toasts.css'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { settingsStore, useSetting } from '../../app/settings/settings'
import { onShortcutHint, SHORTCUT_HINT_MESSAGES, type ShortcutHintType } from '../../input/hotkeys'

const SHOW_MS = 7000
const SAME_TYPE_MS = 30000
const MAX_PER_SESSION = 5
const EXIT_MS = 160
const EDGE = 8

interface Toast {
  id: number
  type: ShortcutHintType
}

/** Throttle state machine (pure, testable): returns true when a toast should show. */
export class HintThrottle {
  private last = new Map<string, number>()
  private count = 0
  allow(type: string, now: number, enabled: boolean, disabled: readonly string[]): boolean {
    if (!enabled || disabled.includes(type)) return false
    if (this.count >= MAX_PER_SESSION || now - (this.last.get(type) ?? -Infinity) < SAME_TYPE_MS) return false
    this.last.set(type, now)
    this.count++
    return true
  }
}

function message(type: ShortcutHintType): ReactNode {
  return SHORTCUT_HINT_MESSAGES[type].map((part, i) =>
    part.kbd ? (
      <kbd key={i} className="kbd">
        {part.text}
      </kbd>
    ) : part.emphasis ? (
      <span key={i} className="zoom-hint-toast__emph">
        {part.text}
      </span>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  )
}

function ToastItem({ toast, onDismiss, onOptOut }: { toast: Toast; onDismiss: (id: number) => void; onOptOut: (type: ShortcutHintType) => void }) {
  const [exiting, setExiting] = useState(false)
  const done = useRef(false)
  const exitTimer = useRef<number | null>(null)
  const exit = useCallback(() => {
    if (done.current) return
    done.current = true
    setExiting(true)
    exitTimer.current = window.setTimeout(() => onDismiss(toast.id), EXIT_MS)
  }, [onDismiss, toast.id])
  useEffect(() => {
    const t = window.setTimeout(exit, SHOW_MS)
    return () => {
      window.clearTimeout(t)
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current)
    }
  }, [exit])
  return (
    <div className={`zoom-hint-toast ${exiting ? 'zoom-hint-toast--exit' : 'zoom-hint-toast--enter'}`} aria-live="polite" aria-atomic="true">
      <div className="zoom-hint-toast__main">
        <span className="zoom-hint-toast__tip">Tip</span>
        <div className="zoom-hint-toast__body">
          <div className="zoom-hint-toast__message">{message(toast.type)}</div>
          <button
            type="button"
            className="zoom-hint-toast__opt-out"
            onClick={() => {
              onOptOut(toast.type)
              exit()
            }}
          >
            Don&apos;t show again
          </button>
        </div>
        <button type="button" className="zoom-hint-toast__close" onClick={exit} aria-label="Dismiss tip" title="Dismiss">
          ×
        </button>
      </div>
    </div>
  )
}

export function ShortcutHintToasts({ left = EDGE }: { left?: number }) {
  const enabled = useSetting('showShortcutHints')
  const disabled = useSetting('disabledShortcutHints')
  const [toasts, setToasts] = useState<Toast[]>([])
  const throttle = useRef(new HintThrottle())
  const nextId = useRef(0)
  useEffect(
    () =>
      onShortcutHint((type) => {
        if (!throttle.current.allow(type, Date.now(), enabled, disabled)) return
        const t: Toast = { id: ++nextId.current, type }
        setToasts((list) => [...list.filter((x) => x.type !== type), t])
      }),
    [enabled, disabled],
  )
  const dismiss = useCallback((id: number) => setToasts((l) => l.filter((t) => t.id !== id)), [])
  const optOut = useCallback((type: ShortcutHintType) => {
    const cur = settingsStore.get().disabledShortcutHints
    if (!cur.includes(type)) settingsStore.patch({ disabledShortcutHints: [...cur, type] })
  }, [])
  if (toasts.length === 0) return null
  return (
    <div
      className="zoom-hint-toast-stack zoom-hint-toast-stack--left"
      style={{ flexDirection: 'column-reverse', left, bottom: 'calc(var(--bottom-left-stack-height, 40px) + var(--bottom-left-stack-bottom, 8px) + 8px)' }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} onOptOut={optOut} />
      ))}
    </div>
  )
}
