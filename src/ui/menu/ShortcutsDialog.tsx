/**
 * Shortcuts dialog, opened from the
 * keyboard icon in the Settings header. The rows come from INPUT's
 * `getShortcutCategories` (scim, current binds). Esc priority 1300;
 * clicking outside closes.
 */
import './styles/tokens.css'
import './styles/controls.css'
import './styles/shortcuts.css'
import { useKeybinds } from '../../app/keybinds'
import { getShortcutCategories, type ShortcutCategory } from '../../input/hotkeys'
import { CloseIcon } from './controls'
import { ESC_PRIORITY, useEscapeLayer } from './escape'
import { menuController, useMenuState } from './menuState'

export function ShortcutsDialog({ categories }: { categories?: ShortcutCategory[] }) {
  const open = useMenuState((s) => s.shortcuts)
  const keybinds = useKeybinds((k) => k)
  const close = () => {
    menuController.close('shortcuts')
    const a = document.activeElement
    if (a instanceof HTMLElement && a !== document.body) a.blur()
  }
  useEscapeLayer(ESC_PRIORITY.MODAL, open, close)
  if (!open) return null
  const cats = categories ?? getShortcutCategories(keybinds)
  return (
    <div className="shortcuts-modal-overlay" onClick={close} role="dialog" aria-modal="true">
      <div className="shortcuts-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-modal-header">
          <h2 className="shortcuts-modal-title">Shortcuts</h2>
          <button type="button" className="shortcuts-modal-close" onClick={close} aria-label="Close shortcuts modal" title="Close">
            <CloseIcon size={14} viewBox="0 0 14 14" d="M2 2l10 10M12 2L2 12" />
          </button>
        </div>
        <div className="shortcuts-modal-content">
          <div className="shortcuts-modal-grid">
            {cats.map((c) => (
              <div key={c.title} className={`shortcuts-modal-category${c.title === 'Game Panel Tabs' ? ' shortcuts-modal-category--compact' : ''}`}>
                <h3 className="shortcuts-modal-category-title">{c.title}</h3>
                <div className="shortcuts-modal-list">
                  {c.shortcuts.map((s) => {
                    // scim splits on " + " (spaced), so "Ctrl+K" stays one key cap.
                    const parts = s.keys.split(' + ')
                    return (
                      <div key={`${s.keys}|${s.description}`} className="shortcuts-modal-row">
                        <div className="shortcuts-modal-keys">
                          {parts.map((p, i) => (
                            <span key={p} className="shortcuts-modal-keys-wrapper">
                              <kbd className="kbd">{p}</kbd>
                              {i < parts.length - 1 && <span className="shortcuts-modal-plus">+</span>}
                            </span>
                          ))}
                        </div>
                        <div className="shortcuts-modal-desc">{s.description}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
