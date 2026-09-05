import { useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes, loadCacheFromUrl, type CacheLoadProgress } from './cache/browser/loadCache'
import type { CacheSystem } from './cache/CacheSystem'
import { Session } from './app/Session'
import { TILE_SIZE } from './render/Camera'
import { CameraControls } from './render/CameraControls'
import { GpuMesh } from './render/Mesh'
import { Renderer } from './render/Renderer'
import { ActorMarkers } from './render/ActorMarkers'
import { ActorRenderer } from './render/actors/ActorRenderer'
import { ActorModelResolver } from './render/actors/ActorModelResolver'
import { buildTextureArray } from './render/textures'
import { pickTile, rayFromScreen } from './render/pick'
import { pickActor } from './render/pickActor'
import { rgba } from './render/Mesh'
import { ClientFrame } from './ui/client/ClientFrame'
import { ViewportOverlay } from './ui/ViewportOverlay'
import { projectActors, publishOverlay } from './app/OverlayProjector'
import { GameCanvas } from './ui/GameCanvas'
import { LoadingScreen } from './ui/LoadingScreen'
import { TopMenu } from './ui/menu/TopMenu'
import { EncountersDialog, type EncounterConfig } from './ui/menu/EncountersDialog'
import { SettingsDialog, type SettingsValues } from './ui/menu/SettingsDialog'

const CACHE_URL = '/osrs-cache/disk.zip'

type Stage = { kind: 'loading'; progress: CacheLoadProgress } | { kind: 'error'; message: string } | { kind: 'ready'; cache: CacheSystem }

export default function App() {
  const [stage, setStage] = useState<Stage>({
    kind: 'loading',
    progress: { phase: 'checking', fraction: -1, loadedBytes: 0, totalBytes: 0, fromCache: false },
  })

  useEffect(() => {
    let cancelled = false
    loadCacheFromUrl(CACHE_URL, (progress) => {
      if (!cancelled) setStage({ kind: 'loading', progress })
    })
      .then((cache) => {
        if (!cancelled) setStage({ kind: 'ready', cache })
      })
      .catch((e: unknown) => {
        if (!cancelled) setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (stage.kind === 'error') {
    return <LoadingScreen title="ZUK" subtitle="OSRS Inferno Simulator" progress={0} status="Failed to load" detail={stage.message} />
  }

  if (stage.kind === 'loading') {
    const p = stage.progress
    const status =
      p.phase === 'checking'
        ? 'Checking local cache...'
        : p.phase === 'downloading'
          ? 'Downloading game cache'
          : p.phase === 'unpacking'
            ? 'Unpacking game cache'
            : 'Ready'
    const detail =
      p.phase === 'downloading'
        ? `${formatBytes(p.loadedBytes)}${p.totalBytes ? ` / ${formatBytes(p.totalBytes)}` : ''}`
        : p.fromCache
          ? 'From browser storage'
          : ''
    return (
      <LoadingScreen
        title="ZUK"
        subtitle="OSRS Inferno Simulator"
        progress={p.fraction < 0 ? 0 : p.fraction}
        status={status}
        detail={detail}
      />
    )
  }

  return <GameView cache={stage.cache} />
}

function GameView({ cache }: { cache: CacheSystem }) {
  const session = useMemo(() => new Session(cache), [cache])
  const [settings, setSettings] = useState<SettingsValues>({ layout: 'fixed', playbackSpeed: 1, brightness: 1 })
  const [dialog, setDialog] = useState<'settings' | 'encounters' | null>(null)
  const [config, setConfig] = useState<EncounterConfig>({ wave: 1, preset: 'Max Tbow', infiniteHealth: false, infinitePrayer: false })
  const rendererRef = useRef<Renderer | null>(null)

  useEffect(() => {
    session.clock.speed = settings.playbackSpeed
    if (rendererRef.current) rendererRef.current.brightness = settings.brightness
  }, [session, settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        session.restartWave()
      } else if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setDialog((d) => (d === 'encounters' ? null : 'encounters'))
      } else if (e.key === 'Escape') {
        setDialog(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])

  const viewport = (
    <GameCanvas
      onMount={(canvas) => {
        const renderer = new Renderer(canvas)
        rendererRef.current = renderer
        renderer.brightness = settings.brightness
        const controls = new CameraControls(renderer.camera, canvas)
        renderer.add(new GpuMesh(renderer.gl, session.arena.terrain))
        const locsDefault = renderer.add(new GpuMesh(renderer.gl, session.arena.locs))
        const locsZuk = renderer.add(new GpuMesh(renderer.gl, session.arena.locsZuk))
        locsZuk.visible = false
        renderer.textureArray = buildTextureArray(renderer.gl, session.arena.textures)
        const markers = new ActorMarkers(renderer, session.arena.heights)
        const actorRenderer = new ActorRenderer(renderer, new ActorModelResolver(cache, session.arena.locModels, () => session.controller.loadout), session.arena.heights)
        const unsub = renderer.addFrameListener((dt) => {
          controls.update(dt)
          const zukWave = session.encounter.state.wave === 69 && session.encounter.state.phase !== 'waveStarting'
          locsDefault.visible = !zukWave
          locsZuk.visible = zukWave
          const p = session.player
          const a = session.clock.alpha
          const ix = p.prevX + (p.x - p.prevX) * a
          const iy = p.prevY + (p.y - p.prevY) * a
          renderer.camera.target[0] = (ix + 0.5) * TILE_SIZE
          renderer.camera.target[2] = (iy + 0.5) * TILE_SIZE
          renderer.camera.target[1] = session.arena.heights.heightAt(renderer.camera.target[0], renderer.camera.target[2]) ?? 0
          const unmodelled = actorRenderer.sync(session.world.actors, session.world.tick, a)
          markers.sync(unmodelled, a, (x) => (x === session.player ? rgba(60, 200, 90) : rgba(200, 70, 60)))
          const rect = canvas.getBoundingClientRect()
          publishOverlay(
            projectActors(renderer, session.arena.heights, session.world.actors, a, session.world.tick),
            session.encounter.state.wave,
            session.encounter.state.phase,
            session.world.tick,
            session.spawnCountdown,
            rect.width,
            rect.height,
            session.bossInfo,
            session.setTimerTicks,
          )
        })
        const onClick = (e: MouseEvent) => {
          if (e.button !== 0) return
          const rect = canvas.getBoundingClientRect()
          const ray = rayFromScreen(renderer.camera, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
          const actor = pickActor(ray, session.world.actors, session.arena.heights, session.clock.alpha)
          if (actor && actor !== session.player) {
            session.attack(actor)
            return
          }
          const hit = pickTile(ray, session.arena.heights)
          if (hit) session.walkTo(hit.x, hit.y)
        }
        canvas.addEventListener('click', onClick)
        session.attach(renderer)
        if (session.encounter.state.wave === 0) session.startWave(1)
        return {
          renderer,
          dispose: () => {
            canvas.removeEventListener('click', onClick)
            session.detach()
            unsub()
            controls.dispose()
            renderer.dispose()
            rendererRef.current = null
          },
        }
      }}
    />
  )

  return (
    <>
      <ClientFrame layout={settings.layout} viewport={viewport} actions={session.actions} overlays={<ViewportOverlay />} />
      <TopMenu onOpen={setDialog} onRestart={() => session.restartWave()} />
      {dialog === 'encounters' && (
        <EncountersDialog
          initial={config}
          onClose={() => setDialog(null)}
          onStart={(c) => {
            setConfig(c)
            session.applyConfig(c)
            setDialog(null)
          }}
        />
      )}
      {dialog === 'settings' && <SettingsDialog values={settings} onChange={setSettings} onClose={() => setDialog(null)} />}
    </>
  )
}
