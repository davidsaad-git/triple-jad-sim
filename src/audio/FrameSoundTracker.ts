/**
 * Cache sequence frame sounds, a port of scim.gg's.
 *
 * Called once per rendered frame with every animated thing's current sequence
 * frame (NPCs incl. dying ones, the local player, spot-anims whose sequence
 * has frame sounds). Per key it remembers the last frame seen:
 *  - new key or new sequence: remember it and play the CURRENT frame's sounds;
 *  - same sequence, frame advanced: play every frame from last+1 to current
 *    (catch-up of skipped frames);
 *  - frame went backwards: looping sequence (frameStep != -1) plays last+1..end
 *    then 0..current; otherwise 0..current;
 *  - keys not seen this frame are forgotten.
 * Every entry of a frame plays (no weighted pick, `loops` ignored):
 * `location <= 0` or no position -> full-volume sfx; otherwise area channel
 * attenuated with `areaAttenuation(pos, listener, location, retain)`.
 *
 * `silentSync` records frames without playing (paused timeline, discontinuity).
 */
import type { SequenceFrameState } from '../render/api'
import { areaAttenuation, type Point } from './attenuation'
import type { EnginePlayOptions } from './EventAudioPlayer'

export interface FrameSoundEntry {
  id: number
  loops: number
  location: number
  retain: number
}

/** What the tracker needs of a SeqType. */
export interface FrameSoundSeq {
  /** Frame index -> sounds; empty map when the sequence has none. */
  frameSounds: ReadonlyMap<number, readonly FrameSoundEntry[]>
  /** scim: frameStep !== -1. */
  looping: boolean
  /** Number of (non-skeletal) frames; 0 for skeletal sequences. */
  frameCount: number
}

export type FrameSoundSeqLookup = (seqId: number) => FrameSoundSeq | null

export interface FrameSoundSink {
  play(id: number, options: EnginePlayOptions, trigger?: string): void
}

interface TrackState {
  seqId: number
  lastFrame: number
}

export class FrameSoundTracker {
  private readonly sink: FrameSoundSink
  private readonly lookup: FrameSoundSeqLookup
  private readonly state = new Map<string, TrackState>()

  constructor(sink: FrameSoundSink, lookup: FrameSoundSeqLookup) {
    this.sink = sink
    this.lookup = lookup
  }

  update(states: readonly SequenceFrameState[], listener: { x: number; y: number } | null): void {
    // scim falls back to [0, 0] when the player's visual centre is unknown.
    const lis: Point = listener ? [listener.x, listener.y] : [0, 0]
    const seen = new Set<string>()
    for (const s of states) {
      seen.add(s.key)
      const prev = this.state.get(s.key)
      if (!prev || prev.seqId !== s.seqId) {
        this.state.set(s.key, { seqId: s.seqId, lastFrame: s.frame })
        this.playFrame(s, s.frame, lis)
        continue
      }
      if (prev.lastFrame === s.frame) continue
      const seq = this.lookup(s.seqId)
      if (seq && seq.frameSounds.size > 0) {
        if (s.frame > prev.lastFrame) {
          for (let f = prev.lastFrame + 1; f <= s.frame; f++) this.playFrame(s, f, lis, seq)
        } else if (seq.looping) {
          for (let f = prev.lastFrame + 1; f < seq.frameCount; f++) this.playFrame(s, f, lis, seq)
          for (let f = 0; f <= s.frame; f++) this.playFrame(s, f, lis, seq)
        } else {
          for (let f = 0; f <= s.frame; f++) this.playFrame(s, f, lis, seq)
        }
      }
      prev.lastFrame = s.frame
    }
    this.prune(seen)
  }

  silentSync(states: readonly SequenceFrameState[]): void {
    const seen = new Set<string>()
    for (const s of states) {
      seen.add(s.key)
      this.state.set(s.key, { seqId: s.seqId, lastFrame: s.frame })
    }
    this.prune(seen)
  }

  reset(): void {
    this.state.clear()
  }

  private prune(seen: ReadonlySet<string>): void {
    for (const key of [...this.state.keys()]) if (!seen.has(key)) this.state.delete(key)
  }

  private playFrame(s: SequenceFrameState, frame: number, listener: Point, seq: FrameSoundSeq | null = this.lookup(s.seqId)): void {
    const entries = seq?.frameSounds.get(frame)
    if (!entries) return
    const trigger = `frame:seq=${s.seqId},f=${frame}`
    for (const e of entries) {
      if (e.location <= 0 || s.position === null) {
        this.sink.play(e.id, { channel: 'sfx' }, trigger)
        continue
      }
      const v = areaAttenuation([s.position.x, s.position.y], listener, e.location, e.retain)
      if (v > 0) this.sink.play(e.id, { channel: 'area', volume: v }, trigger)
    }
  }
}
