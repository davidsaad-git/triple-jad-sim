/**
 * The 3D game viewport: owns the canvas,
 * the WebGL2 renderer, the camera and its controls, the per-frame scene
 * build, the DOM overlays (hitsplats, health bars, prayer icons, marker
 * labels), the picker and the frame-sound feed.
 *
 * Render it inside a positioned container that has the viewport's size; the
 * input layer (src/input/ViewportInput) is a sibling in the same container.
 */
import { type JSX, useEffect, useRef, useState } from 'react'
import { lineMarkersStore, npcHighlightsStore, tileIndicatorsStore, tileMarkersStore } from '../app/plugins/stores'
import type { SimRuntime } from '../app/runtime/types'
import { settingsStore } from '../app/settings/settings'
import { TextureLoader } from '../cache/texture/TextureLoader'
import { NpcTypeLoader } from '../cache/config/NpcType'
import type { ActorScreenAnchor, FrameSoundFeed, OverlayProjection, ViewportPicker, ViewportPick } from './api'
import { Camera, DEFAULT_PITCH } from './camera/Camera'
import { CameraController } from './camera/CameraController'
import { Renderer } from './gl/Renderer'
import { buildTextureArray, textureAnimTime } from './gl/textures'
import { DomOverlays } from './overlays/DomOverlays'
import { HEALTHBAR_HEIGHT, PLAYER_HEAD_HEIGHT } from './overlays/UiOverlays'
import { pickNpcs } from './picking'
import { SceneCompositor, type PluginOverlays } from './SceneCompositor'
import { PlayerVisualFeed } from './actors/PlayerVisualFeed'
import { registerCompassReset, viewportStore } from './viewportBridge'
import { bilinearHeight } from '../scene/arena/surfaceHeight'

export interface GameViewportProps {
  runtime: SimRuntime
  onReady?: (api: { picker: ViewportPicker; overlay: OverlayProjection }) => void
  frameSoundFeed?: FrameSoundFeed
}

/** scim's default camera for the Zuk-arena encounters: distance 24 is kept unclamped by the constructor. */
export const DEFAULT_CAMERA = { yaw: 0, pitch: DEFAULT_PITCH, distance: 24 } as const

const NPC_HIGHLIGHT_COLOR = '#6fb0ae'


class OverlayProjectionImpl implements OverlayProjection {
  anchors = new Map<string, ActorScreenAnchor>()
  private readonly listeners = new Set<(a: ReadonlyMap<string, ActorScreenAnchor>) => void>()
  camera: Camera | null = null

  getAnchors(): ReadonlyMap<string, ActorScreenAnchor> {
    return this.anchors
  }

  onFrame(listener: (a: ReadonlyMap<string, ActorScreenAnchor>) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  projectTile(x: number, y: number, heightUnits: number): { x: number; y: number } | null {
    const c = this.camera
    if (!c) return null
    return c.project(x, y, -bilinearHeight(c.terrainHeights, x, y) / 128 + heightUnits / 128)
  }

  emit(): void {
    for (const l of this.listeners) l(this.anchors)
  }
}

export function GameViewport({ runtime, onReady, frameSoundFeed }: GameViewportProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const iconsRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const feedRef = useRef(frameSoundFeed)
  feedRef.current = frameSoundFeed
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas || !iconsRef.current || !labelsRef.current || !barsRef.current) return
    let disposed = false
    let frameHandle: number | null = null
    const cleanups: (() => void)[] = []
    runtime.setSceneReady(false)
    let software = false
    let cssW = Math.max(1, wrap.clientWidth)
    let cssH = Math.max(1, wrap.clientHeight)
    const dprOf = (): number => {
      const s = settingsStore.get()
      const scale = software ? s.renderScaleSoftware : s.renderScaleHardware
      const d = window.devicePixelRatio
      const clamped = Number.isFinite(d) && d > 0 ? Math.min(d, 2) : 1
      return (Number.isFinite(scale) && scale > 0 ? scale : 1) * clamped
    }
    let renderer: Renderer
    try {
      renderer = new Renderer(canvas)
      software = renderer.isSoftwareRenderer()
    } catch (e) {
      setError((e as Error).message)
      runtime.setSceneReady(true)
      return
    }
    const overlay = new OverlayProjectionImpl()
    const dom = new DomOverlays(iconsRef.current, labelsRef.current, barsRef.current)
    let dpr = dprOf()
    renderer.resize({ width: cssW, height: cssH, dpr })
    const snap0 = runtime.getSnapshot()
    const camera = new Camera(
      { width: cssW, height: cssH, dpr },
      {
        pitch: DEFAULT_CAMERA.pitch,
        yaw: DEFAULT_CAMERA.yaw,
        distance: DEFAULT_CAMERA.distance,
        targetX: snap0.state.playerPosition[0] + 0.5,
        targetY: snap0.state.playerPosition[1] + 0.5,
      },
    )
    overlay.camera = camera
    const controller = new CameraController(camera, snap0.state.playerPosition[0], snap0.state.playerPosition[1])
    controller.onChange = () => viewportStore.update({ yaw: camera.yawTarget })
    controller.attach(wrap, canvas)
    cleanups.push(() => controller.dispose())
    registerCompassReset(() => {
      camera.update({ yaw: 0 })
      viewportStore.update({ yaw: 0 })
    })
    cleanups.push(() => registerCompassReset(null))

    const resize = (): void => {
      cssW = Math.max(1, wrap.clientWidth)
      cssH = Math.max(1, wrap.clientHeight)
      dpr = dprOf()
      renderer.resize({ width: cssW, height: cssH, dpr })
      camera.setViewport({ width: cssW, height: cssH, dpr })
    }
    const ro = new ResizeObserver(() => resize())
    ro.observe(wrap)
    cleanups.push(() => ro.disconnect())
    let lastScaleKey = `${settingsStore.get().renderScaleHardware}|${settingsStore.get().renderScaleSoftware}`
    cleanups.push(
      settingsStore.subscribe(() => {
        const s = settingsStore.get()
        const k = `${s.renderScaleHardware}|${s.renderScaleSoftware}`
        if (k !== lastScaleKey) {
          lastScaleKey = k
          resize()
        }
      }),
    )

    // pointer tracking for the hover tile (the input layer listens on the same container)
    let pointer: { x: number; y: number } | null = null
    const onPointerMove = (e: MouseEvent): void => {
      const r = wrap.getBoundingClientRect()
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onPointerLeave = (): void => {
      pointer = null
    }
    wrap.addEventListener('mousemove', onPointerMove)
    wrap.addEventListener('pointerleave', onPointerLeave)
    cleanups.push(() => {
      wrap.removeEventListener('mousemove', onPointerMove)
      wrap.removeEventListener('pointerleave', onPointerLeave)
    })

    let compositor: SceneCompositor | null = null
    const npcNames = new NpcTypeLoader(runtime.cache)
    let seededKey = ''
    const seedHighlights = (): void => {
      const snap = runtime.getSnapshot()
      const ids = [...new Set(snap.state.npcs.filter((n) => n.role === 'boss' || n.role === 'minion').map((n) => n.npcTypeId))].sort((a, b) => a - b)
      const key = ids.join(',')
      if (key === seededKey || key === '') return
      seededKey = key
      const st = npcHighlightsStore.get()
      let highlights = st.highlights
      const seeded = [...st.seededBossDefaults]
      let changed = false
      for (const id of ids) {
        if (seeded.includes(id)) continue
        seeded.push(id)
        changed = true
        let name = `NPC ${id}`
        try {
          const n = npcNames.load(id).name
          if (n && n !== 'null') name = n
        } catch {
          // keep the fallback name
        }
        if (!highlights.some((h) => h.npcTypeId === id && h.mode === 'trueTile')) {
          highlights = [...highlights, { npcName: name, npcTypeId: id, mode: 'trueTile', color: NPC_HIGHLIGHT_COLOR }]
        }
      }
      if (changed) npcHighlightsStore.patch({ highlights, seededBossDefaults: seeded })
    }

    const picker: ViewportPicker = {
      pick(x: number, y: number): ViewportPick {
        const tile = camera.screenToTile(x, y)
        const npcIds = compositor ? pickNpcs(camera, x, y, compositor.npcs.hitTestData()) : []
        return { tile: tile ? [tile.x, tile.y] : null, npcIds, groundItemIds: [] }
      },
      pickTileEdge(x: number, y: number) {
        return camera.screenToTileEdge(x, y)
      },
    }

    // frame loop state
    let lastFrame = runtime.clock.now()
    let lastRealFrame = performance.now()
    const feed = new PlayerVisualFeed(snap0.state.currentTick)
    let nextFrameAt = -1
    let fpsFrames = 0
    let fpsWindowStart = lastFrame
    let lastYaw = camera.yawTarget
    const loop = (): void => {
      frameHandle = null
      if (disposed) return
      const cap = settingsStore.get().fpsCap
      if (cap > 0) {
        const interval = 1000 / cap
        const t = performance.now()
        if (nextFrameAt < 0) nextFrameAt = t + interval
        else if (t < nextFrameAt) {
          frameHandle = runtime.scheduler.request(loop)
          return
        } else {
          nextFrameAt += interval
          if (nextFrameAt < t - interval) nextFrameAt = t + interval
        }
      } else nextFrameAt = -1
      try {
        renderFrame()
      } catch (e) {
        console.error('GameViewport frame failed', e)
      }
      frameHandle = runtime.scheduler.request(loop)
    }

    const renderFrame = (): void => {
      if (!compositor) return
      const now = runtime.clock.now()
      const dt = Math.min(now - lastFrame, 50)
      lastFrame = now
      // Camera input runs on real time so it still moves while the user has paused the sim clock.
      const realNow = performance.now()
      const cameraDt = Math.min(realNow - lastRealFrame, 50)
      lastRealFrame = realNow
      const snap = runtime.getSnapshot()
      const state = snap.state
      const settings = settingsStore.get()
      const speed = settings.speedMultiplier > 0 ? settings.speedMultiplier : 1
      const interp = runtime.clock.interpolatedTick(now)
      // player visual path
      const pm = compositor.player.movement
      if (feed.feed(pm, state, compositor.player.controller)) controller.snapTo(state.playerPosition[0], state.playerPosition[1])
      const visual = pm.advance(dt, speed)
      // camera
      controller.update(cameraDt, visual.position)
      // hover
      let hover: readonly [number, number] | null = null
      if (pointer) {
        const t = camera.screenToTile(pointer.x, pointer.y)
        hover = t ? [t.x, t.y] : null
      }
      seedHighlights()
      const kind = state.encounter?.kind || 'tripleJad'
      const ti = tileIndicatorsStore.get()
      const tm = tileMarkersStore.get()
      const lm = lineMarkersStore.get()
      const nh = npcHighlightsStore.get()
      const plugins: PluginOverlays = {
        tileIndicators: { enabled: ti.enabled, ...ti.config },
        tileMarkers: tm.showMarkers ? (tm.markersByEncounter[kind] ?? []) : [],
        showTileMarkerLabels: tm.showMarkers && tm.showLabels,
        tileMarkerWidth: tm.markerWidth,
        lineMarkers: lm.showLines ? (lm.linesByEncounter[kind] ?? []) : [],
        showLineMarkerLabels: lm.showLines && lm.showLabels,
        lineMarkerWidth: lm.lineWidth,
        npcHighlights: nh.showHighlights ? nh.highlights : [],
      }
      const out = compositor.frame({
        state,
        events: snap.events,
        interpTick: interp,
        frameDeltaMs: dt,
        speed,
        camera,
        playerVisual: visual,
        hoverTile: hover,
        destinationTile: runtime.getDisplayedTargetTile(),
        settings: {
          brightness: settings.brightness,
          contrast: settings.contrast,
          saturation: settings.saturation,
          smoothTerrain: settings.smoothTerrain,
          showDebugGrid: settings.showDebugGrid,
          showNpcClickbox: settings.showNpcClickbox,
        },
        plugins,
      })
      renderer.render(out.queue, camera.viewProjection(), textureAnimTime(performance.now()))
      dom.icons(out.icons)
      dom.labels(out.labels)
      dom.hitsplats(out.hitsplats)
      dom.healthBars(out.healthBars)
      // anchors for other DOM overlays
      const anchors = new Map<string, ActorScreenAnchor>()
      const [vx, vy] = visual.position
      const ground = -bilinearHeight(camera.terrainHeights, vx, vy) / 128
      const head = camera.project(vx + 0.5, vy + 0.5, ground + PLAYER_HEAD_HEIGHT)
      if (head) {
        anchors.set('player', {
          actorId: 'player',
          x: head.x,
          y: head.y,
          healthBarY: head.y + HEALTHBAR_HEIGHT,
          healthBarWidth: 40,
          hasPrayerIcon: out.icons.length > 0,
        })
      }
      const frac = Math.max(0, Math.min(1, interp - state.currentTick))
      for (const npc of state.npcs) {
        const h = compositor.npcs.overlayHeights(npc.id)
        if (!h) continue
        const moved = npc.previousPosition[0] !== npc.position[0] || npc.previousPosition[1] !== npc.position[1]
        const cx = (frac > 0 && moved ? npc.previousPosition[0] + (npc.position[0] - npc.previousPosition[0]) * frac : npc.position[0]) + npc.size / 2
        const cy = (frac > 0 && moved ? npc.previousPosition[1] + (npc.position[1] - npc.previousPosition[1]) * frac : npc.position[1]) + npc.size / 2
        const a = camera.project(cx, cy, h.baseHeight + h.healthBarHeight)
        if (a) anchors.set(npc.id, { actorId: npc.id, x: a.x, y: a.y, healthBarY: a.y + HEALTHBAR_HEIGHT, healthBarWidth: h.healthBarWidth, hasPrayerIcon: false })
      }
      overlay.anchors = anchors
      overlay.emit()
      feedRef.current?.onFrame(out.frameStates, out.listener, out.discontinuity)
      if (camera.yawTarget !== lastYaw) {
        lastYaw = camera.yawTarget
        viewportStore.update({ yaw: lastYaw })
      }
      fpsFrames++
      if (now - fpsWindowStart >= 1000) {
        viewportStore.update({ fps: Math.round((fpsFrames * 1000) / (now - fpsWindowStart)) })
        fpsFrames = 0
        fpsWindowStart = now
      }
    }

    // Build the scene off the first paint so the page can show its loading state.
    const buildTimer = window.setTimeout(() => {
      if (disposed) return
      try {
        const textures = TextureLoader.load(runtime.cache)
        const texData = buildTextureArray(textures)
        renderer.uploadTextures(texData)
        const snap = runtime.getSnapshot()
        const c = new SceneCompositor(runtime.cache, (id) => texData.layerOf.get(id) ?? -1, snap.state)
        c.load(settingsStore.get().smoothTerrain, snap.state)
        camera.setTerrainHeights(c.terrainHeights)
        controller.snapTo(snap.state.playerPosition[0], snap.state.playerPosition[1])
        compositor = c
        feed.reset(snap.state.currentTick, c.player.movement)
        runtime.setSceneReady(true)
        onReadyRef.current?.({ picker, overlay })
        viewportStore.update({ yaw: camera.yawTarget })
      } catch (e) {
        console.error('GameViewport: scene build failed', e)
        setError((e as Error).message)
        runtime.setSceneReady(true)
      }
      frameHandle = runtime.scheduler.request(loop)
    }, 0)
    cleanups.push(() => window.clearTimeout(buildTimer))
    cleanups.push(
      runtime.clock.onSuspendChange((suspended) => {
        if (!suspended) {
          lastFrame = runtime.clock.now()
          lastRealFrame = performance.now()
          nextFrameAt = -1
          fpsFrames = 0
          fpsWindowStart = lastFrame
        }
      }),
    )

    return () => {
      disposed = true
      if (frameHandle !== null) runtime.scheduler.cancel(frameHandle)
      for (const c of cleanups) c()
      renderer.dispose()
    }
  }, [runtime])

  const layer = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden' } as const
  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#000' }}>
      <canvas ref={canvasRef} role="img" aria-label="3D Game Grid" style={{ display: 'block' }} onContextMenu={(e) => e.preventDefault()} />
      <div ref={iconsRef} style={layer} />
      <div ref={labelsRef} style={layer} />
      <div ref={barsRef} style={layer} />
      {error ? (
        <div style={{ position: 'absolute', left: 8, top: 8, color: '#d46a60', fontFamily: 'monospace', fontSize: 12 }}>Renderer error: {error}</div>
      ) : null}
    </div>
  )
}

export default GameViewport
