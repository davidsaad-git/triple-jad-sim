import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react'
import type { SimRuntime } from '../../app/runtime/types'
import { settingsStore, useSetting } from '../../app/settings/settings'
import { resetCameraYaw, viewportStore } from '../../render/viewportBridge'
import { CHROME_PACK_PATHS, packAsset, useActivePack } from '../packs'
import { AltHintBar } from './AltHintBar'
import './client.css'
import { ClientProvider } from './context'
import { PanelSnapProvider, SnapGuides } from './DraggablePanel'
import { FixedChatbox, FixedFrameStrips } from './FixedChatbox'
import { GamePanel } from './GamePanel'
import { useElementSize } from './hooks'
import { InfoboxPanel } from './Infoboxes'
import { type Box, computeFrameBox, FIXED, type FrameBox, snapRect } from './layout'
import { Minimap } from './Minimap'
import { preloadImages } from './sprites/imageStore'

/**
 * The in-game client chrome around the 3D viewport: sizes the `.game-viewport-frame` for the layout mode
 * (Fixed 765x503 / Resizable Classic / Resizable Modern) and resolution, puts
 * the viewport in it, and layers the minimap + orbs, side panel + tabs,
 * infoboxes, fixed-mode frame strips and chatbox, snap guides and the Alt
 * hint bar on top.
 *
 * It fills its parent (the viewport stage) and measures it.
 */
export interface ClientFrameProps {
  runtime: SimRuntime
  /** The 3D viewport (canvas + its input and projected overlays). */
  viewport: ReactNode
  /** Extra layers over the chrome (HUD stack, plugin widgets), in the frame's coordinates. */
  children?: ReactNode
  /** Camera yaw in degrees for the minimap and compass (default: the renderer's viewport bridge). */
  getCameraYaw?: () => number
  /** Compass click / Enter: "Face north" (default: the renderer's reset). */
  onCompassClick?: () => void
  /** Open drawers covering the stage edges (px); panels are pushed out of them. */
  insets?: { left?: number; right?: number }
  /** The HUD renders an `InfoboxDock` itself (skip the floating HUD-pinned strip). */
  hudInfoboxDocked?: boolean
}

const defaultYaw = (): number => viewportStore.get().yaw

/** The 3D viewport rect inside the frame for a layout. */
export function viewportRectFor(box: FrameBox, chatVisible: boolean): { left: number; top: number; width: number; height: number } {
  if (box.kind !== 'fixed-layout') return { left: 0, top: 0, width: box.width, height: box.height }
  const r = snapRect(chatVisible ? FIXED.viewport : FIXED.viewportCollapsed, box.fixedScale)
  return { left: r.x, top: r.y, width: r.width, height: r.height }
}

/** Exclusion rects (frame coordinates) for drawers overlapping the frame. */
export function drawerExclusions(box: FrameBox, stageWidth: number, insets: { left?: number; right?: number } | undefined): Box[] {
  if (box.kind === 'fixed-layout' || !insets) return []
  const out: Box[] = []
  const left = (insets.left ?? 0) - box.left
  if (left > 0) out.push({ left: 0, top: 0, right: Math.min(box.width, left), bottom: box.height })
  const rightEdge = stageWidth - (insets.right ?? 0) - box.left
  if ((insets.right ?? 0) > 0 && rightEdge < box.width) {
    out.push({ left: Math.max(0, rightEdge), top: 0, right: box.width, bottom: box.height })
  }
  return out
}

export function ClientFrame({ runtime, viewport, children, getCameraYaw = defaultYaw, onCompassClick = resetCameraYaw, insets, hudInfoboxDocked = false }: ClientFrameProps) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const size = useElementSize(stage)
  const layout = useSetting('clientLayoutMode')
  const resolution = useSetting('gameResolution')
  const fixedLayoutScale = useSetting('fixedLayoutScale')
  const settingsScale = useSetting('uiScale')
  const chatVisible = useSetting('fixedChatboxVisible')
  const rendererType = useSetting('rendererType')
  const pack = useActivePack()

  // Warm the chrome sprites of the active pack.
  useEffect(() => {
    preloadImages(CHROME_PACK_PATHS.map((p) => packAsset(p, pack)))
  }, [pack])

  const stageW = size?.width ?? 0
  const stageH = size?.height ?? 0
  const box = useMemo(() => computeFrameBox(layout, resolution, fixedLayoutScale, stageW, stageH), [layout, resolution, fixedLayoutScale, stageW, stageH])
  const fixed = layout === 'fixed'
  const uiScale = fixed ? box.fixedScale : settingsScale
  const vp = viewportRectFor(box, chatVisible)
  const exclusions = useMemo(() => drawerExclusions(box, stageW, insets), [box, stageW, insets])
  const frameClass = `game-viewport-frame ${box.kind === 'fit' ? 'game-viewport-frame--fit' : 'game-viewport-frame--fixed'}`
  const frameStyle: CSSProperties = box.kind === 'fit' ? { inset: 0 } : { left: box.left, top: box.top, width: box.width, height: box.height }
  const ready = size !== null && box.width > 0 && box.height > 0

  return (
    <ClientProvider runtime={runtime}>
      <PanelSnapProvider>
        <div ref={setStage} className="client-stage">
          <div className={frameClass} style={frameStyle} data-layout={layout}>
            <div className="client-viewport" style={{ left: vp.left, top: vp.top, width: vp.width, height: vp.height }}>
              {viewport}
            </div>
            {ready && (
              <div className="client-overlay">
                <SnapGuides />
                <AltHintBar />
                {/* scim renders no minimap with the Canvas 2D renderer. */}
                {rendererType !== 'canvas2d' && <Minimap
                  mode={layout}
                  uiScale={uiScale}
                  fixedScale={box.fixedScale}
                  frameWidth={box.width}
                  frameHeight={box.height}
                  exclusionRects={exclusions}
                  getCameraYaw={getCameraYaw}
                  onCompassClick={onCompassClick}
                />}
                {fixed && <FixedFrameStrips scale={box.fixedScale} viewportHeight={(chatVisible ? FIXED.viewport : FIXED.viewportCollapsed).height} />}
                {fixed && <FixedChatbox scale={box.fixedScale} visible={chatVisible} onToggle={() => settingsStore.patch({ fixedChatboxVisible: !chatVisible })} />}
                {children}
                <GamePanel mode={layout} uiScale={uiScale} fixedScale={box.fixedScale} frameWidth={box.width} frameHeight={box.height} exclusionRects={exclusions} />
                <InfoboxPanel layout={layout} uiScale={uiScale} frameWidth={box.width} frameHeight={box.height} exclusionRects={exclusions} hudDocked={hudInfoboxDocked} />
              </div>
            )}
          </div>
        </div>
      </PanelSnapProvider>
    </ClientProvider>
  )
}
