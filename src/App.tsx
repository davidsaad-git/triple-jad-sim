import { useEffect, useState } from 'react'
import type { ViewportPicker, OverlayProjection } from './render/api'
import { GameViewport } from './render/GameViewport'
import { ViewportInput } from './input/ViewportInput'
import { installGlobalHotkeys } from './input/hotkeys'
import { loadBestCache, type CacheLoadProgress } from './cache/browser/loadCache'
import { RuntimeContext, useRuntime, useTickSnapshot } from './app/runtime/RuntimeContext'
import { isEditableElement } from './input/modifiers'
import { createSession, type Session } from './app/Session'
import { installPackTheme } from './ui/theme'
import { AppMenus, menuController, TRIPLE_JAD_ENCOUNTER } from './ui/menu'
import { HudTools } from './ui/hud'
import { PluginOverlays } from './ui/plugins'
import { OutcomeScreens, TitleCard } from './ui/screens'
import { soundName } from './audio'
import { ClientFrame } from './ui/client'
import { settingsStore, useSetting } from './app/settings/settings'
import { useRenderFps } from './render/viewportBridge'

/**
 * Integration shell: loads the cache, creates the
 * session and mounts every layer in scim's DOM order.
 */
export default function App() {
  const [progress, setProgress] = useState<CacheLoadProgress | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => installPackTheme(), [])

  useEffect(() => {
    let cancelled = false
    let created: Session | null = null
    loadBestCache((p) => {
      if (!cancelled) setProgress(p)
    })
      .then((cache) => {
        if (cancelled) return
        created = createSession(cache)
        setSession(created)
        if (import.meta.env.DEV) (window as unknown as { __zuk: Session }).__zuk = created
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
      created?.dispose()
    }
  }, [])

  if (error) return <div className="boot-status">Failed to load the game cache: {error}</div>
  if (!session) return <div className="boot-status">{describeProgress(progress)}</div>
  return (
    <RuntimeContext.Provider value={session.runtime}>
      <Game session={session} />
    </RuntimeContext.Provider>
  )
}

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

function Game({ session }: { session: Session }) {
  const [api, setApi] = useState<{ picker: ViewportPicker; overlay: OverlayProjection } | null>(null)
  const { width, height } = useWindowSize()
  const snapshot = useTickSnapshot()

  useEffect(
    () =>
      installGlobalHotkeys({
        onRestart: () => session.runtime.restart(),
        onToggleEncounterPicker: () => menuController.toggle('encounters'),
        onToggleShowFps: () => settingsStore.patch({ showFps: !settingsStore.get().showFps }),
      }),
    [session],
  )

  // Pause (our addition; scim has none): P or the Pause key toggles it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isEditableElement(e.target)) return
      if (e.key === 'p' || e.key === 'P' || e.key === 'Pause') {
        e.preventDefault()
        session.runtime.togglePause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])

  return (
    <div className="app-container">
      <FpsCounter />
      <PausedBanner />
      <AppMenus runtime={session.runtime} cache={session.cache} onStart={(config) => session.startRun(config)} />
      <section className="grid-panel">
        <div className="game-viewport-stage">
          <div className="game-workspace">
            <ClientFrame
              runtime={session.runtime}
              viewport={
                <>
                  <GameViewport runtime={session.runtime} frameSoundFeed={session.audio.frameSoundFeed} onReady={setApi} />
                  <ViewportInput runtime={session.runtime} picker={api?.picker ?? null} />
                  <PluginOverlays runtime={session.runtime} overlay={api?.overlay ?? null} audio={session.audio} soundName={soundName} />
                </>
              }
            />
          </div>
          <div className="workspace-presentation-surface">
            <div className="workspace-tools-host">
              <HudTools runtime={session.runtime} viewportWidth={width} viewportHeight={height} rightReserved={204} />
            </div>
          </div>
        </div>
      </section>
      <TitleCard encounterName={TRIPLE_JAD_ENCOUNTER.displayName} />
      <OutcomeScreens state={snapshot.state} onRestart={() => session.runtime.restart()} />
    </div>
  )
}

/** Shown while the user has paused the sim. */
function PausedBanner() {
  const runtime = useRuntime()
  const [paused, setPaused] = useState(() => runtime.isPaused())
  useEffect(() => runtime.onPauseChange(setPaused), [runtime])
  if (!paused) return null
  return (
    <div className="paused-banner" role="status">
      <span className="paused-banner__title">PAUSED</span>
      <span className="paused-banner__hint">Press P to resume</span>
    </div>
  )
}

/** scim: render FPS in the top-right corner when Settings > showFps (Ctrl+Shift+F toggles it). */
function FpsCounter() {
  const visible = useSetting('showFps')
  const fps = useRenderFps()
  if (!visible) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: 6,
        right: 8,
        zIndex: 1000,
        fontFamily: '"RuneScape Plain 11", monospace',
        fontSize: 14,
        color: '#c8aa6e',
        pointerEvents: 'none',
        textShadow: '1px 1px 0 #000',
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      {fps > 0 ? fps : ''}
    </div>
  )
}

function describeProgress(p: CacheLoadProgress | null): string {
  if (!p) return 'Loading game cache...'
  if (p.phase === 'downloading' && p.totalBytes > 0) return `Downloading game cache ${Math.round((p.loadedBytes / p.totalBytes) * 100)}%`
  if (p.phase === 'unpacking') return 'Unpacking game cache...'
  return 'Loading game cache...'
}
