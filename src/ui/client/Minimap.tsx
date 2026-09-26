import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ClientLayoutMode, PanelPosition } from '../../app/settings/settings'
import { settingsStore, useSetting } from '../../app/settings/settings'
import { usePluginStore, xpDropsStore } from '../../app/plugins/stores'
import { NpcTypeLoader } from '../../cache/config/NpcType'
import type { CacheSystem } from '../../cache/CacheSystem'
import { INFERNO_MAP_SQUARE } from '../../sim/map/buildArena'
import { packAsset, uiAsset, useActivePack } from '../packs'
import { useClient, useSimState } from './context'
import { DraggablePanel } from './DraggablePanel'
import {
  type Box,
  COMPACT_ORB_LAYOUTS,
  DEFAULT_COMPACT_ORBS_POSITION,
  DEFAULT_MINIMAP_POSITION,
  FIXED,
  FIXED_MINIMAP,
  FIXED_ORB_CONTAINER,
  FIXED_XP_ORB,
  MINIMAP,
  MINIMAP_CANVAS,
  MINIMAP_TILE_PX,
  MINIMAP_ZOOM_DEFAULT,
  MINIMAP_ZOOM_MAX,
  MINIMAP_ZOOM_MIN,
  minimapDotOffset,
  minimapTransform,
  normalizeCompactLayout,
  snapRect,
} from './layout'
import { minimapImageFor } from './minimapData'
import { Orbs } from './Orbs'
import { PixelSprite } from './sprites/PixelSprite'

/**
 * Minimap block: the map
 * square rasterised from the cache and rotated by camera yaw, NPC dots,
 * compass (face north), the orbs, and in Fixed layout the side edges and XP
 * orb. Compact Orbs hides the map and packs the orbs into a grid.
 */

export interface MinimapProps {
  mode: ClientLayoutMode
  uiScale: number
  fixedScale: number
  frameWidth: number
  frameHeight: number
  exclusionRects?: readonly Box[]
  /** Camera yaw in degrees, the compass rotation (scim's). */
  getCameraYaw?: () => number
  onCompassClick?: () => void
  /** Map square to draw (the Inferno arena by default). */
  mapSquare?: { x: number; y: number }
  /** Clamp for the player marker (map-square-local tiles). */
  arenaBounds?: { minX: number; minY: number; maxX: number; maxY: number }
}

/** The Inferno map square (35,83) the sim's arena is built from. */
export const DEFAULT_MAP_SQUARE: { x: number; y: number } = INFERNO_MAP_SQUARE

const dotLoaders = new WeakMap<CacheSystem, { loader: NpcTypeLoader; shows: Map<number, boolean> }>()

/** NPC types that draw a minimap dot (`drawMapDot && isInteractable`). */
function npcShowsDot(cache: CacheSystem, npcTypeId: number): boolean {
  let entry = dotLoaders.get(cache)
  if (!entry) {
    entry = { loader: new NpcTypeLoader(cache), shows: new Map() }
    dotLoaders.set(cache, entry)
  }
  const hit = entry.shows.get(npcTypeId)
  if (hit !== undefined) return hit
  let show = false
  try {
    const t = entry.loader.load(npcTypeId)
    show = t.drawMapDot && t.isInteractable
  } catch {
    show = false
  }
  entry.shows.set(npcTypeId, show)
  return show
}

function drawNoData(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, MINIMAP_CANVAS, MINIMAP_CANVAS)
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let t = 0; t <= 64; t += 8) {
    const p = t * MINIMAP_TILE_PX
    ctx.moveTo(p, 0)
    ctx.lineTo(p, MINIMAP_CANVAS)
    ctx.moveTo(0, p)
    ctx.lineTo(MINIMAP_CANVAS, p)
  }
  ctx.stroke()
}

export function Minimap({ mode, uiScale, fixedScale, frameWidth, frameHeight, exclusionRects, getCameraYaw, onCompassClick, mapSquare = DEFAULT_MAP_SQUARE, arenaBounds }: MinimapProps) {
  const { runtime } = useClient()
  const state = useSimState()
  const pack = useActivePack()
  const fixed = mode === 'fixed'
  const compactSetting = useSetting('compactOrbsEnabled')
  const compact = compactSetting && !fixed
  const compactLayout = normalizeCompactLayout(useSetting('compactOrbsLayout'))
  const minimapPos = useSetting('minimapPosition')
  const compactPos = useSetting('compactOrbsPosition')
  const xpEnabled = usePluginStore(xpDropsStore, (s) => s.enabled)
  const [xpHover, setXpHover] = useState(false)
  const [zoom, setZoom] = useState(MINIMAP_ZOOM_DEFAULT)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const circleRef = useRef<HTMLDivElement | null>(null)
  const compassRef = useRef<HTMLCanvasElement | null>(null)
  const dotRefs = useRef(new Map<string, HTMLImageElement>())
  const stateRef = useRef(state)
  stateRef.current = state
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const yawRef = useRef(getCameraYaw)
  yawRef.current = getCameraYaw
  const boundsRef = useRef(arenaBounds)
  boundsRef.current = arenaBounds

  const diameter = fixed ? FIXED_MINIMAP.circle.diameter : MINIMAP.circle.diameter
  const circle = fixed ? FIXED_MINIMAP.circle : MINIMAP.circle
  const compass = fixed ? FIXED_MINIMAP.compass : MINIMAP.compass
  const frameRect = fixed ? FIXED_MINIMAP.frame : MINIMAP.frame
  const panel = fixed ? FIXED_MINIMAP.panel : compact ? COMPACT_ORB_LAYOUTS[compactLayout] : MINIMAP.panel
  const physical = fixed ? snapRect(FIXED.minimapBlock, fixedScale) : undefined

  // Raster the map square once per cache/square.
  const image = useMemo(() => minimapImageFor(runtime.cache, mapSquare.x, mapSquare.y), [runtime.cache, mapSquare.x, mapSquare.y])
  useLayoutEffect(() => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    if (!image) {
      drawNoData(ctx)
      return
    }
    const bytes = new Uint8ClampedArray(image.byteLength)
    bytes.set(new Uint8Array(image.buffer, image.byteOffset, image.byteLength))
    const data = new ImageData(bytes, MINIMAP_CANVAS, MINIMAP_CANVAS)
    ctx.putImageData(data, 0, 0)
  }, [image, compact])

  // Wheel zoom over the circle (ignored with Alt, which scales panels).
  useEffect(() => {
    const el = circleRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      setZoom((z) => Math.max(MINIMAP_ZOOM_MIN, Math.min(MINIMAP_ZOOM_MAX, z + (e.deltaY > 0 ? -0.5 : 0.5))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [compact])

  // Per-frame: player position, yaw, dots.
  useEffect(() => {
    let handle = 0
    const frame = (): void => {
      const s = stateRef.current
      const tick = runtime.clock.interpolatedTick()
      const f = Math.max(0, Math.min(1, tick - s.currentTick))
      let px = s.playerPreviousPosition[0] + (s.playerPosition[0] - s.playerPreviousPosition[0]) * f
      let py = s.playerPreviousPosition[1] + (s.playerPosition[1] - s.playerPreviousPosition[1]) * f
      const b = boundsRef.current
      if (b) {
        px = Math.max(b.minX, Math.min(b.maxX, px))
        py = Math.max(b.minY, Math.min(b.maxY, py))
      }
      const yaw = yawRef.current?.() ?? 0
      const z = zoomRef.current
      const cx = px * MINIMAP_TILE_PX + MINIMAP_TILE_PX / 2
      const cy = (63 - py) * MINIMAP_TILE_PX + MINIMAP_TILE_PX / 2
      const t = minimapTransform(cx, cy, yaw, z, diameter)
      const c = canvasRef.current
      if (c) {
        c.style.transform = t.transform
        c.style.transformOrigin = t.origin
      }
      if (compassRef.current) compassRef.current.style.transform = `rotate(${yaw}deg)`
      for (const npc of s.npcs) {
        const el = dotRefs.current.get(npc.id)
        if (!el) continue
        if (!npc.alive) {
          el.style.display = 'none'
          continue
        }
        const nx = npc.previousPosition[0] + (npc.position[0] - npc.previousPosition[0]) * f + npc.size / 2
        const ny = npc.previousPosition[1] + (npc.position[1] - npc.previousPosition[1]) * f + npc.size / 2
        const off = minimapDotOffset(nx, ny, px, py, yaw, z, diameter)
        if (off) {
          el.style.display = ''
          el.style.left = `${off.x}px`
          el.style.top = `${off.y}px`
        } else el.style.display = 'none'
      }
      handle = runtime.scheduler.request(frame)
    }
    handle = runtime.scheduler.request(frame)
    return () => runtime.scheduler.cancel(handle)
  }, [runtime, diameter])

  const dotNpcs = state.npcs.filter((n) => n.alive && npcShowsDot(runtime.cache, n.npcTypeId))
  const hidden = compact ? 'none' : undefined
  const onPos = (p: PanelPosition): void => settingsStore.patch(compact ? { compactOrbsPosition: p } : { minimapPosition: p })

  return (
    <DraggablePanel
      defaultPosition={compact ? DEFAULT_COMPACT_ORBS_POSITION : DEFAULT_MINIMAP_POSITION}
      position={fixed ? DEFAULT_MINIMAP_POSITION : compact ? compactPos : minimapPos}
      width={panel.width}
      height={panel.height}
      scale={fixed ? fixedScale : uiScale}
      {...(physical ? { physicalSize: { width: physical.width, height: physical.height } } : {})}
      {...(fixed ? {} : { onPositionChange: onPos })}
      onScaleChange={(s) => settingsStore.patch({ uiScale: Math.max(1, Math.min(3, s)) })}
      frameWidth={frameWidth}
      frameHeight={frameHeight}
      {...(exclusionRects ? { exclusionRects } : {})}
      locked={fixed}
      scaleEnabled={!fixed}
      dataTutorial="minimap"
      pointerPassthrough
    >
      <div className="panel-surface" style={{ position: 'relative', width: panel.width, height: panel.height, pointerEvents: 'none' }}>
        {fixed &&
          ([
            ['panel/fixed_mode_minimap_left_edge.png', FIXED_MINIMAP.leftEdge],
            ['panel/fixed_mode_minimap_right_edge.png', FIXED_MINIMAP.rightEdge],
            ['panel/fixed_mode_minimap_frame_bottom.png', FIXED_MINIMAP.bottom],
          ] as const).map(([path, r]) => (
            <img key={path} src={packAsset(path, pack)} alt="" aria-hidden draggable={false} style={{ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height, pointerEvents: 'none', imageRendering: 'pixelated', zIndex: 10 }} />
          ))}
        <div style={{ position: 'absolute', display: hidden, left: compass.x, top: compass.y, width: compass.diameter, height: compass.diameter, borderRadius: '50%', overflow: 'hidden', pointerEvents: 'none', zIndex: 8 }}>
          <PixelSprite
            ref={compassRef}
            src={packAsset('other/compass.png', pack)}
            alt="Compass"
            style={{ position: 'absolute', left: (compass.diameter - MINIMAP.compassSprite) / 2, top: (compass.diameter - MINIMAP.compassSprite) / 2, width: MINIMAP.compassSprite, height: MINIMAP.compassSprite, pointerEvents: 'none', transformOrigin: 'center center', imageRendering: 'pixelated' }}
          />
          {onCompassClick && (
            <button
              type="button"
              onMouseDown={(e) => {
                if (e.button === 0) onCompassClick()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onCompassClick()
                }
              }}
              aria-label="Face north"
              title="Face north"
              style={{ position: 'absolute', inset: 0, clipPath: 'circle(50%)', border: 'none', background: 'transparent', padding: 0, margin: 0, outline: 'none', cursor: 'default', pointerEvents: 'auto' }}
            />
          )}
        </div>
        {fixed ? (
          <div style={{ position: 'absolute', left: FIXED_ORB_CONTAINER.x, top: FIXED_ORB_CONTAINER.y, width: 32 + 57, height: 128 + 34 }}>
            <button
              type="button"
              aria-label={xpEnabled ? 'Disable XP drops' : 'Enable XP drops'}
              onClick={() => xpDropsStore.patch({ enabled: !xpEnabled })}
              onMouseEnter={() => setXpHover(true)}
              onMouseLeave={() => setXpHover(false)}
              style={{ position: 'absolute', left: FIXED_XP_ORB.x, top: FIXED_XP_ORB.y, width: FIXED_XP_ORB.width, height: FIXED_XP_ORB.height, border: 'none', background: 'transparent', padding: 0, margin: 0, outline: 'none', cursor: 'default', pointerEvents: 'auto', zIndex: 20 }}
            >
              <img
                src={packAsset(xpEnabled ? (xpHover ? 'other/minimap_orb_xp_activated_hovered.png' : 'other/minimap_orb_xp_activated.png') : xpHover ? 'other/minimap_orb_xp_hovered.png' : 'other/minimap_orb_xp.png', pack)}
                alt=""
                aria-hidden
                width={FIXED_XP_ORB.width}
                height={FIXED_XP_ORB.height}
                draggable={false}
                style={{ display: 'block', imageRendering: 'pixelated', pointerEvents: 'none' }}
              />
            </button>
            <Orbs layout="fixed" />
          </div>
        ) : (
          <Orbs layout={compact ? compactLayout : 'arc'} />
        )}
        <div
          ref={circleRef}
          data-tutorial="minimap-circle"
          style={{ position: 'absolute', display: hidden, left: circle.x, top: circle.y, width: diameter, height: diameter, borderRadius: '50%', clipPath: 'circle(50%)', overflow: 'hidden', backgroundColor: '#000', pointerEvents: 'auto', zIndex: 5 }}
        >
          <canvas ref={canvasRef} width={MINIMAP_CANVAS} height={MINIMAP_CANVAS} style={{ width: '100%', height: '100%', display: 'block' }} />
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: 3, height: 3, marginLeft: -1.5, marginTop: -1.5, backgroundColor: '#ffffff', pointerEvents: 'none', zIndex: 2 }} />
          {dotNpcs.map((n) => (
            <img
              key={n.id}
              ref={(el) => {
                if (el) dotRefs.current.set(n.id, el)
                else dotRefs.current.delete(n.id)
              }}
              src={uiAsset('minimap/npc-dot.png')}
              alt=""
              draggable={false}
              style={{ position: 'absolute', imageRendering: 'pixelated', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 2, display: 'none' }}
            />
          ))}
        </div>
        <PixelSprite
          src={packAsset(fixed ? 'panel/fixed_mode_minimap_and_compass_frame.png' : 'panel/minimap_and_compass_frame.png', pack)}
          alt=""
          aria-hidden
          width={frameRect.width}
          height={frameRect.height}
          style={{ position: 'absolute', display: hidden, left: frameRect.x, top: frameRect.y, pointerEvents: 'none', zIndex: 10, imageRendering: 'pixelated' }}
        />
      </div>
    </DraggablePanel>
  )
}
