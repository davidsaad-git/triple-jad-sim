/**
 * Web Audio playback engine, a port of scim.gg's.
 *
 * Graph: BufferSource -> per-voice Gain(volume) -> sfx bus | area bus -> master -> destination.
 * No panner, no playbackRate, no detune: mono 22050 Hz buffers played as-is.
 *
 * - The AudioContext is created lazily by the first call that needs it
 *   (`resume`, `play`); a context created before a user gesture starts
 *   suspended and is resumed by the first click / keydown (see AudioSystem).
 * - 32 voices; when full the oldest scheduled voice (insertion order) is
 *   stopped, even if it has not started yet. No de-duplication of ids.
 * - `play` drops the sound while paused, focus-muted, or when the master or
 *   channel volume is 0.
 * - `pausePlayback` / `resumePlayback` freeze voices (offset + remaining
 *   delay) and restart them; `setFocusSuspended(true)` mutes master and stops
 *   everything for good (mute when unfocused).
 *
 * Difference from scim, by design: sounds come from the cache synthesiser
 * (a `SoundSource`) instead of fetched .ogg files, so the first play of an id
 * is not delayed by fetch/decode latency.
 */
import { clamp } from './attenuation'
import type { EnginePlayOptions } from './EventAudioPlayer'
import type { SoundChannel } from './rules/types'

/** Synthesised PCM provider (see SoundBank). */
export interface SoundSource {
  /** Mono PCM in -1..1 at `sampleRate`, or null if the id does not exist. */
  getPcm(id: number): Float32Array | null
  readonly sampleRate: number
}

export interface SoundPlayRecord {
  eventId: number
  soundId: number
  trigger: string
  timestamp: number
}

export const MAX_VOICES = 32
const HISTORY_LIMIT = 200

interface Voice {
  buffer: AudioBuffer
  channel: SoundChannel
  volume: number
  /** Seconds into the buffer the voice (re)started from. */
  offset: number
  /** Context time the voice starts (or started) playing. */
  startTime: number
  gain: GainNode
}

interface PausedVoice {
  buffer: AudioBuffer
  channel: SoundChannel
  volume: number
  offset: number
  remainingDelay: number
}

export type AudioContextFactory = () => AudioContext

function defaultContextFactory(): AudioContext {
  if (typeof AudioContext === 'undefined') throw new Error('[AudioEngine] AudioContext is not available in this environment')
  return new AudioContext()
}

export class AudioEngine {
  private readonly source: SoundSource
  private readonly createContext: AudioContextFactory
  private disposed = false
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private areaGain: GainNode | null = null
  private readonly buffers = new Map<number, AudioBuffer | null>()
  private readonly active = new Map<AudioBufferSourceNode, Voice>()
  private readonly pausedVoices: PausedVoice[] = []
  private playbackPaused = false
  private masterVolume = 1
  private sfxVolume = 1
  private areaVolume = 1
  private focusSuspended = false
  private listeners: ((record: SoundPlayRecord) => void)[] = []
  private playSeq = 0
  private history: SoundPlayRecord[] = []
  private readonly now: () => number

  constructor(source: SoundSource, createContext: AudioContextFactory = defaultContextFactory, now: () => number = Date.now) {
    this.source = source
    this.createContext = createContext
    this.now = now
  }

  // --- Context -----------------------------------------------------------------

  private ensureContext(): AudioContext {
    if (this.context === null) {
      const ctx = this.createContext()
      const master = ctx.createGain()
      const sfx = ctx.createGain()
      const area = ctx.createGain()
      sfx.connect(master)
      area.connect(master)
      master.connect(ctx.destination)
      master.gain.value = this.focusSuspended ? 0 : this.masterVolume
      sfx.gain.value = this.sfxVolume
      area.gain.value = this.areaVolume
      this.context = ctx
      this.masterGain = master
      this.sfxGain = sfx
      this.areaGain = area
    }
    return this.context
  }

  /** Create the context if needed and resume it (call from a user gesture). */
  async resume(): Promise<void> {
    if (this.disposed) return
    let ctx: AudioContext
    try {
      ctx = this.ensureContext()
    } catch {
      return
    }
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // resume() rejects without a gesture; the next gesture retries via play()/unlock()
      }
    }
  }

  get contextState(): AudioContextState | 'none' {
    return this.context?.state ?? 'none'
  }

  isReady(): boolean {
    return this.context !== null && this.masterGain !== null && this.sfxGain !== null
  }

  // --- Playback ----------------------------------------------------------------

  private getBuffer(id: number, ctx: AudioContext): AudioBuffer | null {
    const cached = this.buffers.get(id)
    if (cached !== undefined) return cached
    let buffer: AudioBuffer | null = null
    const pcm = this.source.getPcm(id)
    if (pcm && pcm.length > 0) {
      buffer = ctx.createBuffer(1, pcm.length, this.source.sampleRate)
      buffer.getChannelData(0).set(pcm)
    }
    this.buffers.set(id, buffer)
    return buffer
  }

  /** scim `play(id, options, trigger)`. */
  play(id: number, options: EnginePlayOptions = {}, trigger?: string): void {
    if (this.disposed || this.playbackPaused || this.masterVolume <= 0 || this.focusSuspended) return
    const channel = options.channel ?? 'sfx'
    if ((channel === 'area' ? this.areaVolume : this.sfxVolume) <= 0) return
    let ctx: AudioContext
    try {
      ctx = this.ensureContext()
    } catch {
      return
    }
    const buffer = this.getBuffer(id, ctx)
    if (!buffer) return
    if (trigger) this.notifyPlayed(id, trigger)
    if (this.active.size >= MAX_VOICES) {
      const oldest = this.active.entries().next()
      if (!oldest.done) this.stopVoice(oldest.value[0], oldest.value[1])
    }
    const when = ctx.currentTime + Math.max(0, options.delayMs ?? 0) / 1000
    this.startVoice({ buffer, channel, volume: clamp(options.volume ?? 1, 0, 1), offset: 0 }, when)
  }

  private startVoice(v: { buffer: AudioBuffer; channel: SoundChannel; volume: number; offset: number }, when: number): void {
    const ctx = this.ensureContext()
    const bus = v.channel === 'area' ? this.areaGain : this.sfxGain
    if (!bus) return
    const node = ctx.createBufferSource()
    node.buffer = v.buffer
    const gain = ctx.createGain()
    gain.gain.value = v.volume
    node.connect(gain)
    gain.connect(bus)
    node.onended = () => {
      if (this.active.delete(node)) {
        node.disconnect()
        gain.disconnect()
      }
    }
    this.active.set(node, { ...v, startTime: when, gain })
    node.start(when, v.offset)
  }

  private stopVoice(node: AudioBufferSourceNode, voice: Voice): void {
    this.active.delete(node)
    node.onended = null
    try {
      node.stop()
    } catch {
      // already stopped
    }
    node.disconnect()
    voice.gain.disconnect()
  }

  get activeVoiceCount(): number {
    return this.active.size
  }

  /** Freeze every voice (offset + remaining delay) and drop new plays until resumed. */
  pausePlayback(): void {
    if (this.disposed || this.playbackPaused) return
    this.playbackPaused = true
    if (!this.context) return
    const now = this.context.currentTime
    for (const [node, v] of [...this.active]) {
      const offset = v.offset + Math.max(0, now - v.startTime)
      if (offset < v.buffer.duration) {
        this.pausedVoices.push({ buffer: v.buffer, channel: v.channel, volume: v.volume, offset, remainingDelay: Math.max(0, v.startTime - now) })
      }
      this.stopVoice(node, v)
    }
  }

  /** Restart the frozen voices where they left off. */
  resumePlayback(): void {
    if (this.disposed || !this.playbackPaused) return
    this.playbackPaused = false
    if (!this.context) return
    const now = this.context.currentTime
    for (const v of this.pausedVoices) this.startVoice(v, now + v.remainingDelay)
    this.pausedVoices.length = 0
  }

  get isPlaybackPaused(): boolean {
    return this.playbackPaused
  }

  stopAll(): void {
    this.playbackPaused = false
    this.pausedVoices.length = 0
    for (const [node, v] of [...this.active]) this.stopVoice(node, v)
  }

  // --- Volumes and focus -------------------------------------------------------

  setMasterVolume(v: number): void {
    this.masterVolume = clamp(v, 0, 1)
    if (this.masterGain && !this.focusSuspended) this.masterGain.gain.value = this.masterVolume
    if (this.masterVolume <= 0) this.stopAll()
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = clamp(v, 0, 1)
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolume
  }

  setAreaVolume(v: number): void {
    this.areaVolume = clamp(v, 0, 1)
    if (this.areaGain) this.areaGain.gain.value = this.areaVolume
  }

  /** Mute when unfocused: master to 0 and stop everything (nothing resumes on refocus). */
  setFocusSuspended(suspended: boolean): void {
    if (this.focusSuspended === suspended) return
    this.focusSuspended = suspended
    if (this.masterGain) this.masterGain.gain.value = suspended ? 0 : this.masterVolume
    if (suspended) this.stopAll()
  }

  isFocusSuspended(): boolean {
    return this.focusSuspended
  }

  getMasterVolume(): number {
    return this.masterVolume
  }

  getSfxVolume(): number {
    return this.sfxVolume
  }

  getAreaVolume(): number {
    return this.areaVolume
  }

  // --- Sound debug history -------

  onSoundPlayed(listener: (record: SoundPlayRecord) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  getRecentSoundEvents(limit = 50): SoundPlayRecord[] {
    const n = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50
    return this.history.slice(0, n)
  }

  private notifyPlayed(soundId: number, trigger: string): void {
    const record: SoundPlayRecord = { eventId: ++this.playSeq, soundId, trigger, timestamp: this.now() }
    this.history = [record, ...this.history].slice(0, HISTORY_LIMIT)
    if (this.listeners.length === 0) return
    this.listeners = this.listeners.filter((l) => {
      try {
        l(record)
        return true
      } catch {
        return false
      }
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopAll()
    this.buffers.clear()
    this.listeners = []
    this.history = []
    const ctx = this.context
    this.context = null
    this.masterGain = null
    this.sfxGain = null
    this.areaGain = null
    if (ctx) void ctx.close().catch(() => {})
  }
}
