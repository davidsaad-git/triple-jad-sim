/**
 * NPC animation controller, re-implemented from scim's:
 *
 * - a base track (idle / walk, looping, phase kept across attacks; walk
 *   restarts when it starts) and a primary track (attack / defend / heal /
 *   death, one-shot, optional start delay);
 * - fixed 20 ms client cycles accumulated from the delta (max 50 per call);
 * - an attack-type signal replaces the primary when there is none, or it is
 *   not death and incoming.forcedPriority >= current.forcedPriority
 *   (a primary still in its delay counts); death always wins and never ends;
 * - pose: death alone; base alone when no active primary; primary interleaved
 *   with the base frame (masks) when the base is not idle; else primary alone;
 * - no frame tweening; a pose is only rebuilt when "clip:frame" changes.
 * Skeletal clips are not supported (no Inferno sequence uses them).
 */
import type { SeqType } from '../../cache/config/SeqType'

export interface AnimClip {
  /** Clip name ('idle', 'walk', 'death', or an attack clip key). */
  id: string
  seqId: number
  seq: SeqType
  frameIds: readonly number[]
  frameLengths: readonly number[]
}

export interface NpcAnimationSet {
  idle: AnimClip
  walk?: AnimClip | undefined
  death?: AnimClip | undefined
  attackClips: Record<string, AnimClip>
}

export interface PoseAdapter {
  resetPose(): void
  applyFrame(frameId: number): void
  applyFrameInterleaved(primaryFrameId: number, baseFrameId: number, masks: readonly number[]): void
  commitPose(): void
}

type BaseState = 'idle' | 'walk'
type Mode = 'loop' | 'oneshot'

interface Track {
  state: BaseState | 'attack' | 'death'
  clip: AnimClip
  mode: Mode
  elapsed: number
  duration: number
  delay: number
}

interface Signal {
  clip: AnimClip
  durationClientTicks?: number | undefined
  delayClientTicks?: number | undefined
}

/** `getFrameLengthTicks`: max(1, floor(len ?? 1)). */
export function frameLength(clip: AnimClip, i: number): number {
  const n = clip.frameLengths[i] ?? 1
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1
}

/** Clip duration in client cycles (`FC`). */
export function clipDuration(clip: AnimClip): number {
  let total = 0
  for (let i = 0; i < clip.frameIds.length; i++) total += frameLength(clip, i)
  return Math.max(1, total)
}

function normalizeDuration(v: number): number {
  return Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 1
}

/** Frame id of `clip` at `elapsed` cycles. */
export function sampleFrameId(clip: AnimClip, elapsed: number, mode: Mode): number | null {
  if (clip.frameIds.length === 0) return null
  const total = clipDuration(clip)
  const local = mode === 'loop' ? elapsed % total : Math.min(elapsed, total - 1)
  let acc = 0
  for (let i = 0; i < clip.frameIds.length; i++) {
    acc += frameLength(clip, i)
    if (local < acc) return clip.frameIds[i]!
  }
  return clip.frameIds[clip.frameIds.length - 1]!
}

export class NpcAnimController {
  private readonly set: NpcAnimationSet
  private readonly adapter: PoseAdapter
  private readonly signals: Signal[] = []
  private base: Track
  private primary: Track | null = null
  private remainderMs = 0
  private lastPoseKey: string | null = null

  constructor(set: NpcAnimationSet, adapter: PoseAdapter) {
    this.set = set
    this.adapter = adapter
    this.base = this.makeTrack('idle', set.idle)
  }

  private makeTrack(state: BaseState, clip: AnimClip): Track {
    return { state, clip, mode: 'loop', elapsed: 0, duration: clipDuration(clip), delay: 0 }
  }

  reset(): void {
    this.signals.length = 0
    this.remainderMs = 0
    this.primary = null
    if (this.base.state !== 'idle') this.base = this.makeTrack('idle', this.set.idle)
  }

  /** Advance by `deltaMs * speed` and re-pose. */
  update(deltaMs: number, speed: number, isMoving: boolean): void {
    this.remainderMs += Math.max(0, deltaMs) * Math.max(0, speed)
    const cycles = Math.min(Math.floor(this.remainderMs / 20), 50)
    this.remainderMs -= cycles * 20
    this.base.elapsed += cycles
    this.advancePrimary(cycles)
    if (this.primary && this.primary.state === 'death') {
      this.applyPose()
      return
    }
    if (this.primary && this.primary.state === 'attack' && this.primary.delay === 0 && this.primary.elapsed >= this.primary.duration) {
      this.primary = null
    }
    while (this.signals.length > 0) this.activate(this.signals.shift()!)
    const next = isMoving && this.set.walk ? { state: 'walk' as const, clip: this.set.walk } : { state: 'idle' as const, clip: this.set.idle }
    this.setBase(next.state, next.clip)
    this.applyPose()
  }

  triggerAttack(clip: AnimClip, opts: { durationClientTicks?: number | undefined; delayClientTicks?: number | undefined } = {}): void {
    this.signals.push({ clip, durationClientTicks: opts.durationClientTicks, delayClientTicks: opts.delayClientTicks })
  }

  triggerDeath(): void {
    const d = this.set.death
    if (!d) return
    this.primary = { state: 'death', clip: d, mode: 'oneshot', elapsed: 0, duration: clipDuration(d), delay: 0 }
  }

  get isDying(): boolean {
    return this.primary?.state === 'death'
  }

  /** Primary that is playing (not delayed). */
  private active(): Track | null {
    const p = this.primary
    return p && p.delay === 0 ? p : null
  }

  private advancePrimary(cycles: number): void {
    const p = this.primary
    if (!p || cycles <= 0) return
    const consumed = Math.min(p.delay, cycles)
    p.elapsed += Math.max(0, cycles - p.delay)
    p.delay = Math.max(0, p.delay - consumed)
  }

  private activate(s: Signal): void {
    const p = this.primary
    const canReplace = !p || (p.state !== 'death' && s.clip.seq.forcedPriority >= p.clip.seq.forcedPriority)
    if (!canReplace) return
    this.primary = {
      state: 'attack',
      clip: s.clip,
      mode: 'oneshot',
      elapsed: 0,
      duration: normalizeDuration(s.durationClientTicks ?? clipDuration(s.clip)),
      delay: Math.max(0, Math.floor(s.delayClientTicks ?? 0)),
    }
  }

  private setBase(state: BaseState, clip: AnimClip): void {
    const changed = this.base.state !== state || this.base.clip.id !== clip.id
    this.base.state = state
    this.base.clip = clip
    this.base.mode = 'loop'
    this.base.duration = clipDuration(clip)
    if (changed) this.base.elapsed = 0
  }

  /** Sequence height offset for the model matrix. */
  heightOffset(): number {
    const p = this.active()
    if (!p || (p.state === 'attack' && this.base.clip.seqId !== this.set.idle.seqId)) return this.base.clip.seq.heightOffset
    return p.clip.seq.heightOffset
  }

  /** Current sequence and frame index (frame sounds). */
  frameState(): { seqId: number; seq: SeqType; frame: number } | null {
    const t = this.active() ?? this.base
    const id = sampleFrameId(t.clip, t.elapsed, t.mode)
    if (id === null) return null
    const i = t.clip.frameIds.indexOf(id)
    return { seqId: t.clip.seqId, seq: t.clip.seq, frame: i >= 0 ? i : 0 }
  }

  /** Debug / tests: current clip ids. */
  describe(): { base: string; primary: string | null; primaryDelay: number } {
    return { base: this.base.clip.id, primary: this.primary?.clip.id ?? null, primaryDelay: this.primary?.delay ?? 0 }
  }

  private applyAlone(t: Track): void {
    const id = sampleFrameId(t.clip, t.elapsed, t.mode)
    if (id === null) return
    const key = `${t.clip.id}:${id}`
    if (key === this.lastPoseKey) return
    this.adapter.resetPose()
    this.adapter.applyFrame(id)
    this.adapter.commitPose()
    this.lastPoseKey = key
  }

  private applyPose(): void {
    const p = this.active()
    const b = this.base
    if (p && p.state === 'death') {
      this.applyAlone(p)
      return
    }
    if (!p) {
      this.applyAlone(b)
      return
    }
    const pid = sampleFrameId(p.clip, p.elapsed, p.mode)
    if (pid === null) {
      this.applyAlone(b)
      return
    }
    const masks = p.clip.seq.masks
    if (masks && masks.length > 0 && b.clip.seqId !== this.set.idle.seqId) {
      const bid = sampleFrameId(b.clip, b.elapsed, b.mode)
      if (bid !== null) {
        const key = `${p.clip.id}:${pid}+${b.clip.id}:${bid}`
        if (key === this.lastPoseKey) return
        this.adapter.resetPose()
        this.adapter.applyFrameInterleaved(pid, bid, masks)
        this.adapter.commitPose()
        this.lastPoseKey = key
        return
      }
    }
    const key = `${p.clip.id}:${pid}`
    if (key === this.lastPoseKey) return
    this.adapter.resetPose()
    this.adapter.applyFrame(pid)
    this.adapter.commitPose()
    this.lastPoseKey = key
  }
}
