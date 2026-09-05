import { useEffect, useRef, useState, type ReactNode } from 'react'
import { hudStore, noopActions, type UiActions } from '../../app/HudState'
import { useStore } from '../../app/GameStore'
import { Chatbox } from './Chatbox'
import { Minimap } from './Minimap'
import { SidePanel } from './SidePanel'
import './ClientFrame.css'

export type ClientLayout = 'fixed' | 'resizable-classic' | 'resizable-modern'

export interface ClientFrameProps {
  layout: ClientLayout
  /** The WebGL canvas element (fills the viewport region). */
  viewport: ReactNode
  actions?: UiActions
  /** Overlays drawn over the viewport (HUD, hitsplats, tile markers). */
  overlays?: ReactNode
}

/** OSRS fixed-mode dimensions. */
export const FIXED_WIDTH = 765
export const FIXED_HEIGHT = 503
export const FIXED_VIEWPORT_WIDTH = 512
export const FIXED_VIEWPORT_HEIGHT = 334

/**
 * The client chrome: viewport, minimap + orbs, side panel with tabs, chatbox.
 * Fixed mode is a 765x503 box scaled to fit the window; resizable modes fill
 * the window with the panels overlaid on the viewport.
 */
export function ClientFrame({ layout, viewport, actions = noopActions, overlays }: ClientFrameProps) {
  const activeTab = useStore(hudStore, (s) => s.activeTab)
  const hostRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (layout !== 'fixed') return
    const host = hostRef.current
    if (!host) return
    const fit = () => {
      const s = Math.min(host.clientWidth / FIXED_WIDTH, host.clientHeight / FIXED_HEIGHT)
      setScale(Math.max(0.25, Math.floor(s * 100) / 100))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(host)
    return () => ro.disconnect()
  }, [layout])

  if (layout === 'fixed') {
    return (
      <div className="client-host" ref={hostRef}>
        <div className="client client--fixed" style={{ transform: `scale(${scale})` }}>
          <div className="client__viewport">
            {viewport}
            {overlays}
          </div>
          <div className="client__minimap">
            <Minimap actions={actions} />
          </div>
          <div className="client__side">
            <SidePanel layout="fixed" activeTab={activeTab} actions={actions} />
          </div>
          <div className="client__chat">
            <Chatbox />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="client-host">
      <div className={`client client--resizable client--${layout}`}>
        <div className="client__viewport client__viewport--full">
          {viewport}
          {overlays}
        </div>
        <div className="client__minimap client__minimap--floating">
          <Minimap actions={actions} />
        </div>
        <div className={`client__side client__side--${layout === 'resizable-modern' ? 'modern' : 'classic'}`}>
          <SidePanel layout={layout} activeTab={activeTab} actions={actions} />
        </div>
        <div className="client__chat client__chat--floating">
          <Chatbox />
        </div>
      </div>
    </div>
  )
}
