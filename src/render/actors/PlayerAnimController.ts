/**
 * Local-player animation controller, re-implemented from scim's
 *: a looping movement sequence
 * (idle / walk / run / turns / stand-turn) chosen from the movement state,
 * and a one-shot primary (attack, block, eat, intro) with OSRS replacement
 * rules; frames advance in 20 ms cycles of wall time x speed (max 50 per
 * frame); interleaved posing when the primary has masks and the movement
 * sequence is not the idle one.
 */
import type { SeqType } from '../../cache/config/SeqType'
import type { PoseAdapter } from './NpcAnimController'
import type { Locomotion } from './PlayerMovement'

export type MoveState = 'idle' | 'walk' | 'run' | 'turnLeft' | 'turnRight' | 'walkBack' | 'idleTurnLeft' | 'idleTurnRight'

export type PoseSet = Partial<Record<MoveState, SeqType | null>>

export interface PlayerAnimationSet extends PoseSet {
  eat?: SeqType | null
  attack?: SeqType | null
  block?: SeqType | null
  unarmed?: PoseSet
}

export interface PlayerAnimInput {
  deltaMs: number
  speed: number
  isMoving: boolean
  simIsMoving: boolean
  isRunning: boolean
  locomotion: Locomotion | null
  visualAngle: number
  targetAngle: number
  isTurning: boolean
}

type Signal = { type: 'consume' } | { type: 'attack'; seq?: SeqType } | { type: 'block' } | { type: 'intro'; seq: SeqType }

/** scim's SeqType post-decode defaults for precedence/priority. */
export function precedenceAnimating(seq: SeqType): number {
  return seq.precedenceAnimating === -1 ? (seq.masks ? 2 : 0) : seq.precedenceAnimating
}

export function movementPriority(seq: SeqType): number {
  return seq.priority === -1 ? (seq.masks ? 2 : 0) : seq.priority
}

export class PlayerAnimController {
  set: PlayerAnimationSet
  private readonly adapter: PoseAdapter
  private readonly signals: Signal[] = []
  private moveSeq: SeqType | null
  private moveState: MoveState = 'idle'
  private moveFrame = 0
  private moveFrameTick = 0
  private moveAccMs = 0
  private primary: SeqType | null = null
  private primaryFrame = 0
  private primaryFrameTick = 0
  private primaryAccMs = 0
  private primaryDone = true
  private consume = false
  private idleTurnCounter = 0
  private lastPoseKey: string | null = null
  private rebuildPending = true

  constructor(set: PlayerAnimationSet, adapter: PoseAdapter) {
    this.set = set
    this.adapter = adapter
    this.moveSeq = set.idle ?? null
  }

  get isConsuming(): boolean {
    return !this.primaryDone && this.consume
  }

  private get poseSet(): PoseSet {
    return this.isConsuming && this.set.unarmed ? this.set.unarmed : this.set
  }

  private poseSeq(state: MoveState): SeqType | null {
    return this.poseSet[state] ?? null
  }

  /** Replace the animation set after an equipment change (keeps phases). */
  setAnimationSet(set: PlayerAnimationSet): void {
    this.set = set
    this.refreshPoseSequence()
    this.lastPoseKey = null
  }

  reset(): void {
    const hadPrimary = !this.primaryDone || this.primary !== null
    const hadSignals = this.signals.length > 0
    const moving = this.moveState !== 'idle'
    this.signals.length = 0
    this.primary = null
    this.primaryFrame = 0
    this.primaryFrameTick = 0
    this.primaryAccMs = 0
    this.primaryDone = true
    this.consume = false
    this.idleTurnCounter = 0
    if (moving) {
      this.moveState = 'idle'
      this.moveSeq = this.set.idle ?? null
      this.moveFrame = 0
      this.moveFrameTick = 0
      this.moveAccMs = 0
    }
    this.rebuildPending = this.rebuildPending || hadPrimary || hadSignals || moving
  }

  triggerConsume(): void {
    this.signals.push({ type: 'consume' })
  }

  triggerAttack(seq?: SeqType): void {
    this.signals.push(seq ? { type: 'attack', seq } : { type: 'attack' })
  }

  triggerBlock(): void {
    this.signals.push({ type: 'block' })
  }

  triggerIntro(seq: SeqType): void {
    this.signals.push({ type: 'intro', seq })
  }

  private startPrimary(seq: SeqType, consume: boolean): void {
    this.primary = seq
    this.primaryFrame = 0
    this.primaryFrameTick = 0
    this.primaryAccMs = 0
    this.primaryDone = false
    this.consume = consume
    this.refreshPoseSequence()
  }

  private refreshPoseSequence(): void {
    const s = this.poseSeq(this.moveState)
    if (s && s !== this.moveSeq) {
      this.moveSeq = s
      if (this.moveFrame >= s.frameIds.length) {
        this.moveFrame = 0
        this.moveFrameTick = 0
      }
      this.lastPoseKey = null
    }
  }

  private applyMovementState(state: MoveState, seq: SeqType): void {
    if (this.moveState !== state || this.moveSeq !== seq) {
      this.moveState = state
      this.moveSeq = seq
      if (this.moveFrame >= seq.frameIds.length) {
        this.moveFrame = 0
        this.moveFrameTick = 0
      }
      this.lastPoseKey = null
    }
  }

  private trail(running: boolean): { state: MoveState; seq: SeqType } | null {
    for (const state of (running ? ['run', 'walk'] : ['walk', 'run']) as MoveState[]) {
      const s = this.poseSeq(state)
      if (s) return { state, seq: s }
    }
    return null
  }

  /** `getAnimationHeightOffset`. */
  heightOffset(): number {
    const p = this.primaryDone ? null : this.primary
    const current = this.moveSeq ?? this.poseSeq('idle')
    const idle = this.poseSet.idle ?? null
    const s = p !== null && idle !== null && current?.id === idle.id ? p : current ?? p
    return s?.heightOffset ?? 0
  }

  /** `getPrimaryAnimMovementBlock`. */
  movementBlock(): { blocksRunning: boolean; blocksWalking: boolean } {
    if (this.primaryDone || !this.primary) return { blocksRunning: false, blocksWalking: false }
    return { blocksRunning: precedenceAnimating(this.primary) === 0, blocksWalking: movementPriority(this.primary) === 0 }
  }

  frameState(): { seqId: number; frame: number } | null {
    if (!this.primaryDone && this.primary) return { seqId: this.primary.id, frame: this.primaryFrame }
    return this.moveSeq ? { seqId: this.moveSeq.id, frame: this.moveFrame } : null
  }

  /** Force the rest pose to be applied (first frame after (re)load). */
  applyInitialFrame(): void {
    this.lastPoseKey = null
    this.pose()
  }

  /** Returns true when the model was re-posed. */
  update(input: PlayerAnimInput): boolean {
    while (this.signals.length > 0) {
      const s = this.signals.shift()!
      if (s.type === 'consume') {
        if (this.set.eat) this.startPrimary(this.set.eat, true)
      } else if (s.type === 'attack') {
        const seq = s.seq ?? this.set.attack
        if (seq) this.startPrimary(seq, false)
      } else if (s.type === 'intro') {
        this.startPrimary(s.seq, false)
      } else {
        const b = this.set.block
        if (b && (this.primaryDone || !this.primary || b.forcedPriority >= this.primary.forcedPriority)) this.startPrimary(b, false)
      }
    }
    let dt = input.deltaMs
    if (dt <= 0 || dt >= 1000) {
      if (!this.rebuildPending) return false
      dt = 0
    }
    this.rebuildPending = false
    const scaled = dt * input.speed
    this.moveAccMs += scaled
    const moveCycles = Math.min(Math.floor(this.moveAccMs / 20), 50)
    this.moveAccMs -= moveCycles * 20
    this.primaryAccMs += scaled
    const primaryCycles = Math.min(Math.floor(this.primaryAccMs / 20), 50)
    this.primaryAccMs -= primaryCycles * 20
    if (!this.primaryDone && this.primary && primaryCycles > 0) {
      const p = this.primary
      this.primaryFrameTick += primaryCycles
      while (this.primaryFrame < p.frameIds.length && this.primaryFrameTick >= p.frameLengths[this.primaryFrame]!) {
        this.primaryFrameTick -= p.frameLengths[this.primaryFrame]!
        this.primaryFrame++
      }
      if (this.primaryFrame >= p.frameIds.length) {
        this.primary = null
        this.primaryFrame = 0
        this.primaryFrameTick = 0
        this.primaryAccMs = 0
        this.primaryDone = true
        this.consume = false
        this.refreshPoseSequence()
      }
    }
    if (input.simIsMoving) {
      let state = this.directional(input)
      if (input.isRunning && state === 'walk') state = 'run'
      const seq = this.poseSeq(state)
      if (seq) this.applyMovementState(state, seq)
      else {
        const t = this.trail(input.isRunning)
        if (t) this.applyMovementState(t.state, t.seq)
        else {
          const idle = this.poseSeq('idle')
          if (idle) this.applyMovementState('idle', idle)
        }
      }
      this.idleTurnCounter = 0
    } else if (input.isMoving) {
      const t = this.trail(input.isRunning)
      if (t) this.applyMovementState(t.state, t.seq)
      this.idleTurnCounter = 0
    } else if (input.isTurning) {
      this.idleTurnCounter += moveCycles
      const d = (input.targetAngle - input.visualAngle) & 2047
      const big = (d > 1024 ? 2048 - d : d) > 32
      const side: MoveState = d > 1024 ? 'idleTurnLeft' : 'idleTurnRight'
      if (this.moveState === 'idleTurnLeft' || this.moveState === 'idleTurnRight' || big || this.idleTurnCounter > 25) {
        if (this.moveState !== side) {
          const s = this.poseSeq(side)
          if (s) this.applyMovementState(side, s)
          else {
            const w = this.poseSeq('walk')
            if (w) this.applyMovementState('walk', w)
            else if (this.moveState !== 'idle') {
              const idle = this.poseSeq('idle')
              if (idle) this.applyMovementState('idle', idle)
            }
          }
        }
      } else if (this.moveState !== 'idle') {
        const idle = this.poseSeq('idle')
        if (idle) this.applyMovementState('idle', idle)
      }
    } else {
      this.idleTurnCounter = 0
      if (this.moveState !== 'idle') {
        const idle = this.poseSeq('idle')
        if (idle) this.applyMovementState('idle', idle)
      }
    }
    const seq = this.moveSeq ?? this.set.idle ?? null
    if (!seq) return false
    if (moveCycles > 0) {
      this.moveFrameTick += moveCycles
      while (this.moveFrame < seq.frameIds.length && this.moveFrameTick >= seq.frameLengths[this.moveFrame]!) {
        this.moveFrameTick -= seq.frameLengths[this.moveFrame]!
        this.moveFrame++
      }
      if (this.moveFrame >= seq.frameIds.length) {
        this.moveFrame = 0
        this.moveFrameTick = 0
      }
    }
    return this.pose()
  }

  private pose(): boolean {
    const seq = this.moveSeq ?? this.set.idle ?? null
    if (!seq || seq.frameIds.length === 0) return false
    const baseFrame = seq.frameIds[this.moveFrame]!
    let key = `pose:${seq.id}:${baseFrame}`
    let primaryFrame: number | null = null
    if (!this.primaryDone && this.primary) {
      primaryFrame = this.primary.frameIds[this.primaryFrame]!
      key += `+primary:${this.primary.id}:${primaryFrame}`
    }
    if (key === this.lastPoseKey) return false
    this.adapter.resetPose()
    const idle = this.poseSet.idle ?? null
    if (primaryFrame !== null && this.primary?.masks && idle && seq.id !== idle.id) {
      this.adapter.applyFrameInterleaved(primaryFrame, baseFrame, this.primary.masks)
    } else if (primaryFrame !== null) this.adapter.applyFrame(primaryFrame)
    else this.adapter.applyFrame(baseFrame)
    this.adapter.commitPose()
    this.lastPoseKey = key
    return true
  }

  private directional(input: PlayerAnimInput): MoveState {
    if (input.locomotion) return input.locomotion
    const d = (input.targetAngle - input.visualAngle) & 2047
    const s = d > 1024 ? d - 2048 : d
    if (s >= -256 && s <= 256) return 'walk'
    if (s > 256 && s < 768) return 'turnRight'
    if (s < -256 && s >= -768) return 'turnLeft'
    return 'walkBack'
  }
}
