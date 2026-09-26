/**
 * The game's audio: scim.gg's audio hook plus the
 * compositor hand-off of tick events and frame states, wired to our runtime and renderer contracts.
 *
 * Timing: events of a tick are played on the first
 * rendered frame after the tick (FrameSoundFeed.onFrame, or a
 * requestAnimationFrame fallback when no renderer feeds frames), with the
 * player's sim tile as listener; rule delays are `delayCycles x 20 ms` of
 * real time, never scaled by the game speed. Frame sounds follow the
 * renderer's animation clock.
 */
import type { CacheSystem } from '../cache/CacheSystem'
import { ObjTypeLoader, SeqTypeLoader } from '../cache/config'
import type { SimRuntime } from '../app/runtime/types'
import { DEFAULT_SETTINGS, type Settings, settingsStore } from '../app/settings/settings'
import type { FrameSoundFeed, SequenceFrameState } from '../render/api'
import type { SimEvent, Tile } from '../sim/api'
import { type AudioContextFactory, AudioEngine, type SoundPlayRecord, type SoundSource } from './AudioEngine'
import { type EnginePlayOptions, EventAudioPlayer } from './EventAudioPlayer'
import { type FrameSoundSeq, type FrameSoundSeqLookup, FrameSoundTracker } from './FrameSoundTracker'
import { createCoreLayer } from './rules/core'
import { INFERNO_LAYER } from './rules/inferno'
import type { RuleLayer } from './rules/types'
import { CacheSoundBank } from './SoundBank'

export type PlayOptions = EnginePlayOptions

export interface AudioSystem {
  /** Play the rules for every tick's events of this runtime; returns a detach function. */
  attach(runtime: SimRuntime): () => void
  /** Hand this to the renderer (`<GameViewport frameSoundFeed>`). */
  readonly frameSoundFeed: FrameSoundFeed
  /** Create/resume the AudioContext; call from a user gesture (also done on the first click/keydown). */
  unlock(): void
  /** Play one sound id directly (UI sounds; scim has none in-game). */
  play(id: number, opts?: PlayOptions): void
  /** Sound Debug overlay feed. */
  onSoundPlayed(listener: (record: SoundPlayRecord) => void): () => void
  /** Most recent plays, newest first. */
  getRecentSoundEvents(limit?: number): SoundPlayRecord[]
  /** Synthesise every id the rules can play (runs in idle slots; started automatically in the browser). */
  preload(): Promise<void>
  readonly engine: AudioEngine
  readonly eventPlayer: EventAudioPlayer
  readonly frameTracker: FrameSoundTracker
  dispose(): void
}

export interface AudioSystemOptions {
  /** Override the sound source (tests); default: the cache synthesiser. */
  source?: SoundSource
  /** Override the frame-sound sequence lookup (tests); default: cache SeqTypes. */
  seqLookup?: FrameSoundSeqLookup
  /** Item name lookup for the equip sound kind; default: cache ObjTypes. */
  itemName?: (id: number) => string | null
  contextFactory?: AudioContextFactory
  /** Random source for the player hit sound pick (default Math.random, like scim). */
  random?: () => number
  /** Schedules the fallback event flush (default requestAnimationFrame / setTimeout). */
  requestFrame?: (cb: () => void) => void
  /** Wall clock in ms (default performance.now). */
  now?: () => number
  /** Install window listeners (gesture unlock, mute when unfocused) and preload. Default: when `window` exists. */
  browser?: boolean
}

/**
 * Sounds synthesised first when preloading: everything a triple-Jad fight
 * with the Zuk loadouts plays, then the rest of the rule ids.
 */
export const PRIORITY_SOUND_IDS: readonly number[] = [
  159, 162, 163, 408, 409, 410, 608, 610, 511, 518, 519, 520, 521, 2675, 2677, 2676, 2663, 2672, 2393, 2401, 2685, 2670, 2665,
  2669, 10194, 10100, 2700, 1352, 2695, 3892, 2699, 2696, 800, 6410, 1460, 6412, 160, 178, 183, 227, 512, 2238, 2239, 2240,
  2242, 2236, 2247,
]

/** Frame-sound ids worth preloading (scim minus lobby/Yama ids): Tumeken's shadow cast graphic. */
export const FRAME_PRELOAD_SOUND_IDS: readonly number[] = [6412]

/** A renderer that fed a frame within this window drives the event flush. */
const FEED_ACTIVE_MS = 250
/** Ticks of events kept when several ticks pass between two rendered frames. */
const MAX_BACKLOG_TICKS = 2

function defaultRequestFrame(): (cb: () => void) => void {
  if (typeof requestAnimationFrame === 'function') return (cb) => requestAnimationFrame(() => cb())
  return (cb) => setTimeout(cb, 16)
}

function cacheSeqLookup(cache: CacheSystem | null): FrameSoundSeqLookup {
  let loader: SeqTypeLoader | null | undefined
  const memo = new Map<number, FrameSoundSeq | null>()
  return (seqId) => {
    const hit = memo.get(seqId)
    if (hit !== undefined) return hit
    let out: FrameSoundSeq | null = null
    if (loader === undefined) {
      try {
        loader = cache ? new SeqTypeLoader(cache) : null
      } catch {
        loader = null
      }
    }
    try {
      const seq = loader?.tryLoad(seqId)
      if (seq && seq.frameSounds.size > 0) out = { frameSounds: seq.frameSounds, looping: seq.frameStep !== -1, frameCount: seq.frameIds.length }
    } catch {
      out = null
    }
    memo.set(seqId, out)
    return out
  }
}

function cacheItemName(cache: CacheSystem | null): (id: number) => string | null {
  let loader: ObjTypeLoader | null | undefined
  return (id) => {
    if (loader === undefined) {
      try {
        loader = cache ? new ObjTypeLoader(cache) : null
      } catch {
        loader = null
      }
    }
    try {
      return loader?.load(id).name ?? null
    } catch {
      return null
    }
  }
}

const NULL_SOURCE: SoundSource = { sampleRate: 22050, getPcm: () => null }

export function createAudioSystem(cache: CacheSystem | null, options: AudioSystemOptions = {}): AudioSystem {
  const bank = options.source ? null : cache ? new CacheSoundBank(cache) : null
  const source: SoundSource = options.source ?? bank ?? NULL_SOURCE
  const engine = new AudioEngine(source, options.contextFactory)
  const layers: RuleLayer[] = [
    INFERNO_LAYER,
    createCoreLayer({ ...(options.random ? { random: options.random } : {}), itemName: options.itemName ?? cacheItemName(cache) }),
  ]
  const eventPlayer = new EventAudioPlayer(engine, ...layers)
  const frameTracker = new FrameSoundTracker(engine, options.seqLookup ?? cacheSeqLookup(cache))
  const requestFrame = options.requestFrame ?? defaultRequestFrame()
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const browser = options.browser ?? (typeof window !== 'undefined' && typeof document !== 'undefined')
  const cleanups: (() => void)[] = []

  // --- Runtime hand-off state ----------------------------------------------------
  let runtime: SimRuntime | null = null
  let pending: SimEvent[] = []
  let lastPlayedEventId = -1
  let lastTick: number | null = null
  let lastFeedFrameAt = Number.NEGATIVE_INFINITY
  let flushScheduled = false

  function listenerTile(): Tile {
    const snap = runtime?.getSnapshot()
    return snap ? snap.state.playerPosition : [0, 0]
  }

  function flushEvents(): void {
    if (pending.length === 0) return
    // Normally one tick's events per frame; if frames stalled while ticks kept
    // coming, keep the last two ticks rather than bursting a backlog.
    const latest = pending[pending.length - 1]!.tick
    const events = pending.filter((e) => e.tick >= latest - MAX_BACKLOG_TICKS + 1)
    pending = []
    eventPlayer.onEvents(events, listenerTile())
  }

  function scheduleFallbackFlush(): void {
    if (flushScheduled) return
    flushScheduled = true
    requestFrame(() => {
      flushScheduled = false
      if (now() - lastFeedFrameAt >= FEED_ACTIVE_MS) flushEvents()
    })
  }

  /** Ctrl+R / engine reset: stop everything and forget tracking. */
  function onRestart(): void {
    engine.stopAll()
    eventPlayer.reset()
    frameTracker.reset()
    pending = []
    lastPlayedEventId = -1
  }

  function onTick(events: readonly SimEvent[], tick: number): void {
    if (lastTick !== null && tick < lastTick) onRestart()
    lastTick = tick
    let added = false
    for (const e of events) {
      if (e.eventId <= lastPlayedEventId) continue
      pending.push(e)
      lastPlayedEventId = e.eventId
      added = true
    }
    if (added) scheduleFallbackFlush()
  }

  const frameSoundFeed: FrameSoundFeed = {
    onFrame(states: readonly SequenceFrameState[], listener: { x: number; y: number } | null, paused: boolean): void {
      lastFeedFrameAt = now()
      flushEvents()
      if (paused) frameTracker.silentSync(states)
      else frameTracker.update(states, listener)
    },
  }

  // --- Settings (volumes live; scim nSe effects) --------------------
  let focusUnwire: (() => void) | null = null
  let lastSettings: Settings | null = null

  function wireFocusMute(enabled: boolean): void {
    focusUnwire?.()
    focusUnwire = null
    if (!enabled || !browser) {
      engine.setFocusSuspended(false)
      return
    }
    const check = () => {
      const focused = document.hidden ? false : typeof document.hasFocus !== 'function' || document.hasFocus()
      engine.setFocusSuspended(!focused)
      if (!focused) eventPlayer.reset()
    }
    check()
    const winEvents = ['focus', 'blur', 'pageshow', 'pagehide'] as const
    for (const t of winEvents) window.addEventListener(t, check)
    document.addEventListener('visibilitychange', check)
    focusUnwire = () => {
      for (const t of winEvents) window.removeEventListener(t, check)
      document.removeEventListener('visibilitychange', check)
      engine.setFocusSuspended(false)
    }
  }

  /** A finite volume or the default (scim validates stored settings the same way). */
  function volume(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }

  function applySettings(s: Settings): void {
    const prev = lastSettings
    lastSettings = s
    if (!prev || prev.masterVolume !== s.masterVolume) {
      const master = volume(s.masterVolume, DEFAULT_SETTINGS.masterVolume)
      engine.setMasterVolume(master)
      if (master <= 0) eventPlayer.reset()
    }
    if (!prev || prev.sfxVolume !== s.sfxVolume) engine.setSfxVolume(volume(s.sfxVolume, DEFAULT_SETTINGS.sfxVolume))
    if (!prev || prev.areaVolume !== s.areaVolume) engine.setAreaVolume(volume(s.areaVolume, DEFAULT_SETTINGS.areaVolume))
    if (!prev || prev.muteWhenUnfocused !== s.muteWhenUnfocused) wireFocusMute(s.muteWhenUnfocused !== false)
  }

  applySettings(settingsStore.get())
  cleanups.push(settingsStore.subscribe(() => applySettings(settingsStore.get())))
  cleanups.push(() => {
    focusUnwire?.()
    focusUnwire = null
  })

  // --- Gesture unlock (scim: window click / keydown, once) -----------------------
  // Capture phase so an input layer that stops propagation cannot swallow them.
  if (browser) {
    const unlockOnce = () => void engine.resume()
    window.addEventListener('click', unlockOnce, { once: true, capture: true })
    window.addEventListener('keydown', unlockOnce, { once: true, capture: true })
    cleanups.push(() => {
      window.removeEventListener('click', unlockOnce, { capture: true })
      window.removeEventListener('keydown', unlockOnce, { capture: true })
    })
  }

  // --- Preload -------------------------------------------------------------------
  let preloadPromise: Promise<void> | null = null
  function preload(): Promise<void> {
    if (!preloadPromise) {
      const ids = [...new Set([...PRIORITY_SOUND_IDS, ...eventPlayer.getAllSoundIds(), ...FRAME_PRELOAD_SOUND_IDS])]
      preloadPromise = bank ? bank.preload(ids) : Promise.resolve()
    }
    return preloadPromise
  }
  if (browser) void preload()

  let disposed = false
  let detachCurrent: (() => void) | null = null

  return {
    frameSoundFeed,
    engine,
    eventPlayer,
    frameTracker,

    attach(rt: SimRuntime): () => void {
      // One runtime at a time: attaching again detaches the previous one.
      detachCurrent?.()
      runtime = rt
      pending = []
      frameTracker.reset()
      eventPlayer.reset()
      const snap = rt.getSnapshot()
      lastTick = snap.state.currentTick
      // Events already present when attaching are history, not news.
      lastPlayedEventId = snap.events.reduce((m, e) => Math.max(m, e.eventId), -1)

      const offTick = rt.onTick((s) => onTick(s.events, s.state.currentTick))
      // Focus pause (hidden tab / unfocused with pauseWhenUnfocused): freeze voices, resume on return.
      const onSuspend = (suspended: boolean) => (suspended ? engine.pausePlayback() : engine.resumePlayback())
      if (rt.clock.suspended) engine.pausePlayback()
      const offSuspend = rt.clock.onSuspendChange(onSuspend)

      let detached = false
      const detach = () => {
        if (detached) return
        detached = true
        offTick()
        offSuspend()
        if (detachCurrent === detach) detachCurrent = null
        if (runtime === rt) {
          runtime = null
          pending = []
          engine.stopAll()
          frameTracker.reset()
          eventPlayer.reset()
        }
      }
      detachCurrent = detach
      return detach
    },

    unlock(): void {
      void engine.resume()
    },

    play(id: number, opts: PlayOptions = {}): void {
      engine.play(id, opts, 'ui')
    },

    onSoundPlayed: (listener) => engine.onSoundPlayed(listener),
    getRecentSoundEvents: (limit) => engine.getRecentSoundEvents(limit),
    preload,

    dispose(): void {
      if (disposed) return
      disposed = true
      detachCurrent?.()
      for (const c of cleanups.splice(0)) c()
      runtime = null
      pending = []
      engine.dispose()
    },
  }
}
