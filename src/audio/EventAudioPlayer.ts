/**
 * Turns tick events into sound plays through layered rule tables, scim.gg
 * `uee`.
 *
 * Chain semantics: for each event the rules registered for
 * its type are tried in layer order; `pass` continues, `silent` stops, and the
 * first `play` wins (all of its entries play, then the chain stops). An entry
 * with a source tile is attenuated with `areaAttenuation` against the
 * listener tile (the player's sim tile) and skipped when inaudible; its
 * channel defaults to "area" when it has a position, else "sfx". Delays are
 * `delayCycles x 20 ms` of real time.
 *
 * The replay scheduler (`updateReplayClock` / `finishReplay`) is ported too so
 * a replay viewer can drive delays on the replay clock.
 */
import type { SimEvent, Tile } from '../sim/api'
import { areaAttenuation, DEFAULT_AREA_RANGE } from './attenuation'
import { collectLayerSoundIds, normaliseSound, type RuleLayer, type RuleResult, type SoundChannel, type SoundRule } from './rules/types'

/** Milliseconds per client cycle. */
export const CYCLE_MS = 20
/** Milliseconds per tick for replay due times. */
const TICK_MS = 600

export interface EnginePlayOptions {
  volume?: number
  channel?: SoundChannel
  delayMs?: number
}

/** The subset of the engine the event player talks to. */
export interface EventSoundSink {
  play(id: number, options: EnginePlayOptions, trigger?: string): void
  getMasterVolume(): number
  getSfxVolume(): number
  getAreaVolume(): number
  isFocusSuspended(): boolean
}

/** One play an event resolves to (before replay scheduling). */
export interface ResolvedPlay {
  id: number
  volume: number
  channel: SoundChannel
  /** Present only for entries with delayCycles > 0. */
  delayMs?: number
  trigger: string
}

interface PendingReplaySound {
  dueTimeMs: number
  soundId: number
  options: EnginePlayOptions
  trigger: string
}

export class EventAudioPlayer {
  private readonly engine: EventSoundSink
  private readonly chains = new Map<string, SoundRule[]>()
  private readonly layers: readonly RuleLayer[]
  private replayTimeMs: number | null = null
  /** Sorted by due time, latest first (popped from the end). */
  private readonly pendingReplay: PendingReplaySound[] = []

  constructor(engine: EventSoundSink, ...layers: RuleLayer[]) {
    this.engine = engine
    this.layers = layers
    for (const layer of layers) {
      for (const [type, rule] of Object.entries(layer.rules)) {
        if (!rule) continue
        let chain = this.chains.get(type)
        if (!chain) {
          chain = []
          this.chains.set(type, chain)
        }
        chain.push(rule)
      }
    }
  }

  /** Pure resolution of one event against the chain (no engine calls). */
  resolve(event: SimEvent, listener: Tile): ResolvedPlay[] {
    const chain = this.chains.get(event.type)
    const out: ResolvedPlay[] = []
    if (!chain) return out
    for (const rule of chain) {
      const result: RuleResult = typeof rule.resolve === 'function' ? rule.resolve(event) : { kind: 'play', sound: rule.resolve }
      if (result.kind === 'pass') continue
      if (result.kind === 'silent') break
      const entries = normaliseSound(result.sound)
      if (entries.length === 0) break
      const baseVolume = result.volume ?? 1
      for (const entry of entries) {
        const pos = entry.position === undefined ? result.position : entry.position
        const range = entry.range ?? result.range ?? DEFAULT_AREA_RANGE
        const volume = pos ? baseVolume * areaAttenuation(pos, listener, range) : baseVolume
        if (volume <= 0) continue
        const play: ResolvedPlay = {
          id: entry.id,
          volume,
          channel: entry.channel ?? result.channel ?? (pos ? 'area' : 'sfx'),
          trigger: `event:${event.type}`,
        }
        if (entry.delayCycles > 0) play.delayMs = entry.delayCycles * CYCLE_MS
        out.push(play)
      }
      break
    }
    return out
  }

  /** scim: play every event's sounds (live) or schedule them on the replay clock. */
  onEvents(events: readonly SimEvent[], listener: Tile): void {
    for (const event of events) {
      for (const p of this.resolve(event, listener)) {
        const options: EnginePlayOptions = { volume: p.volume, channel: p.channel }
        if (this.replayTimeMs === null) {
          if (p.delayMs !== undefined) options.delayMs = p.delayMs
        } else if (p.delayMs !== undefined) {
          const due = event.tick * TICK_MS + p.delayMs
          if (due > this.replayTimeMs) {
            if (this.isMuted(p.channel)) continue
            const at = this.pendingReplay.findIndex((s) => s.dueTimeMs <= due)
            this.pendingReplay.splice(at < 0 ? this.pendingReplay.length : at, 0, { dueTimeMs: due, soundId: p.id, options, trigger: p.trigger })
            continue
          }
        }
        this.engine.play(p.id, options, p.trigger)
      }
    }
  }

  private isMuted(channel: SoundChannel): boolean {
    const e = this.engine
    return e.getMasterVolume() <= 0 || e.isFocusSuspended() || (channel === 'area' ? e.getAreaVolume() : e.getSfxVolume()) <= 0
  }

  /** Replay clock (ms of replay time), or null for live play. Plays every due pending sound unless paused. */
  updateReplayClock(timeMs: number | null, paused = false): void {
    this.replayTimeMs = timeMs
    if (timeMs === null) {
      this.pendingReplay.length = 0
      return
    }
    if (paused) return
    for (let s = this.pendingReplay.at(-1); s && s.dueTimeMs <= timeMs; s = this.pendingReplay.at(-1)) {
      this.pendingReplay.pop()
      this.engine.play(s.soundId, s.options, s.trigger)
    }
  }

  /** End of a replay: flush pending sounds with their remaining delay scaled by the replay speed. */
  finishReplay(speed: number): void {
    const now = this.replayTimeMs
    if (now === null) return
    for (let s = this.pendingReplay.pop(); s; s = this.pendingReplay.pop()) {
      this.engine.play(s.soundId, { ...s.options, delayMs: (s.dueTimeMs - now) / speed }, s.trigger)
    }
  }

  getAllSoundIds(): number[] {
    return collectLayerSoundIds(this.layers)
  }

  reset(): void {
    this.pendingReplay.length = 0
    this.replayTimeMs = null
  }
}
