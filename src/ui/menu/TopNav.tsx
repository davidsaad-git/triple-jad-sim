/**
 * Top-left navigation and the right-hand Plugins button (scim app root
 *). Training has no course for this
 * encounter, so no split exit button or first-visit crumb is shown.
 */
import './styles/tokens.css'
import './styles/controls.css'
import './styles/nav.css'
import { menuController, useMenuState } from './menuState'

export function TopNav({ worldReady = true }: { worldReady?: boolean }) {
  const settingsOpen = useMenuState((s) => s.settings)
  const pluginsOpen = useMenuState((s) => s.plugins)
  return (
    <>
      <nav className={`sidebar-nav${settingsOpen ? ' sidebar-nav--tucked' : ''}`} inert={settingsOpen || undefined}>
        <button type="button" className="controls-toggle-open" onClick={() => menuController.open('settings')} title="Open Settings">
          Settings
        </button>
        <button type="button" className="controls-toggle-open" data-tutorial="whats-new-button" onClick={() => menuController.open('whatsNew')} title="See what's new in Scim.gg">
          What&apos;s New
        </button>
        {worldReady && (
          <>
            <button
              type="button"
              className="controls-toggle-open"
              data-tutorial="encounters-button"
              onClick={(e) => {
                e.currentTarget.blur()
                menuController.open('encounters')
              }}
              title="Browse encounters (Ctrl+K)"
            >
              Encounters
            </button>
            <div className="tutorials-button-anchor">
              <button type="button" className="controls-toggle-open" onClick={() => menuController.open('training')} title="Training">
                Training
              </button>
            </div>
            <button type="button" className="controls-toggle-open" onClick={() => menuController.open('replays')} title="Runs you shared or opened">
              Replays
            </button>
          </>
        )}
      </nav>
      {worldReady && (
        <nav className={`sidebar-nav right-nav${pluginsOpen ? ' sidebar-nav--tucked' : ''}`} inert={pluginsOpen || undefined}>
          <button type="button" className="controls-toggle-open" onClick={() => menuController.open('plugins')} title="Open Plugins">
            Plugins
          </button>
        </nav>
      )}
    </>
  )
}
