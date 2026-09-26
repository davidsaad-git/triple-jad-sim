import { useEffect, useState } from 'react'
import { PANEL_DRAG_END_EVENT, PANEL_DRAG_START_EVENT } from './DraggablePanel'
import { useAltHeld } from './hooks'

/**
 * "UI layout" shortcut hint bar shown while Alt is held or a panel is being
 * dragged. Compact
 * labels below a 1040 px container come from the CSS container queries.
 * Alt+key presses (other than modifiers) are swallowed outside text fields.
 */

export const ALT_HINTS: readonly { keys: string; keysCompact: string; label: string; labelCompact: string }[] = [
  { keys: 'Alt + Drag', keysCompact: 'Alt+Drag', label: 'Move', labelCompact: 'Move' },
  { keys: 'Alt + Scroll', keysCompact: 'Alt+Scroll', label: 'Resize', labelCompact: 'Size' },
  { keys: 'Alt + Right Click', keysCompact: 'Alt+RClick', label: 'Reset position', labelCompact: 'Reset pos' },
  { keys: 'Alt + Middle Click', keysCompact: 'Alt+MClick', label: 'Reset scale', labelCompact: 'Reset scale' },
  { keys: 'Alt + Shift', keysCompact: 'Alt+Shift', label: 'Snap to panels', labelCompact: 'Snap' },
]

function isModifierKey(key: string): boolean {
  return key === 'Alt' || key === 'Shift' || key === 'Control' || key === 'Meta'
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

export function AltHintBar() {
  const alt = useAltHeld()
  const [dragging, setDragging] = useState(false)
  const visible = alt || dragging
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && !isModifierKey(e.key) && !isTextField(e.target)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const start = (): void => setDragging(true)
    const end = (): void => setDragging(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener(PANEL_DRAG_START_EVENT, start)
    window.addEventListener(PANEL_DRAG_END_EVENT, end)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener(PANEL_DRAG_START_EVENT, start)
      window.removeEventListener(PANEL_DRAG_END_EVENT, end)
    }
  }, [])
  return (
    <div className="hint-bar-anchor" data-visible={visible || undefined} aria-hidden={!visible}>
      <div className="hint-bar" role="group" aria-label="UI panel layout shortcuts">
        <span className="hint-bar__scope" aria-hidden="true">
          UI layout
        </span>
        <ul className="hint-bar__chips">
          {ALT_HINTS.map((h) => (
            <li key={h.keys} className="hint-bar__chip">
              <kbd className="hint-bar__keys">
                <span className="hint-bar__keys-full">{h.keys}</span>
                <span className="hint-bar__keys-short">{h.keysCompact}</span>
              </kbd>
              <span className="hint-bar__label">
                <span className="hint-bar__label-full">{h.label}</span>
                <span className="hint-bar__label-short">{h.labelCompact}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
