/**
 * OSRS-style client movement interpolation of the local player
 *. Units: 128 per tile,
 * 20 ms client cycles; walking 4 units/cycle (2 while turning, 6/8 with a
 * backlog), doubled when running; turning 32 angle units per whole cycle;
 * a waypoint further than 288 units snaps (teleport).
 */
import { direction8 } from './facing'

const UNIT = 128
const CYCLE_MS = 20
const TELEPORT = 288
const WALK = 4
const TURN_SLOW = 2
const TURN_SPEED = 32

interface Waypoint {
  x: number
  y: number
  running: boolean
}

export type Locomotion = 'walk' | 'turnLeft' | 'turnRight' | 'walkBack'

export interface MovementState {
  /** Tiles (SW corner of the tile the model stands on, fractional). */
  position: [number, number]
  isVisuallyMoving: boolean
  simIsMoving: boolean
  locomotion: Locomotion | null
  isRunning: boolean
  facingAngle: number
  targetAngle: number
  isTurning: boolean
}

export class PlayerMovement {
  x: number
  y: number
  private queue: Waypoint[] = []
  private targetAngle = 0
  private renderAngle = 0
  private forcedFacing: number | null = null
  private interacting = false
  private pendingInteractionClear = false
  lastProcessedTick = -1
  private moving = false
  private running = false
  private movementDelay = 0
  private blocksRunning = false
  private blocksWalking = false
  private turnRemainderMs = 0

  constructor(x: number, y: number) {
    this.x = x * UNIT
    this.y = y * UNIT
  }

  get facingAngle(): number {
    return this.renderAngle
  }

  set facingAngle(a: number) {
    this.targetAngle = a & 2047
    this.renderAngle = a & 2047
  }

  reset(x: number, y: number): void {
    this.x = x * UNIT
    this.y = y * UNIT
    this.queue = []
    this.lastProcessedTick = -1
    this.targetAngle = 0
    this.renderAngle = 0
    this.forcedFacing = null
    this.interacting = false
    this.pendingInteractionClear = false
    this.moving = false
    this.running = false
    this.movementDelay = 0
    this.blocksRunning = false
    this.blocksWalking = false
    this.turnRemainderMs = 0
  }

  setTargetAngle(a: number): void {
    if (this.queue.length === 0) this.targetAngle = a & 2047
  }

  setForcedFacing(a: number | null): void {
    this.forcedFacing = a === null ? null : a & 2047
  }

  setInteracting(v: boolean): void {
    if (v) {
      this.interacting = true
      this.pendingInteractionClear = false
    } else if (this.interacting) this.pendingInteractionClear = true
  }

  setPrimaryAnimBlocking(running: boolean, walking: boolean): void {
    this.blocksRunning = running
    this.blocksWalking = walking
  }

  /** Append the tiles walked this tick (once per tick). */
  enqueueTickMovement(tick: number, path: readonly (readonly [number, number])[], running: boolean): void {
    if (tick === this.lastProcessedTick) return
    this.lastProcessedTick = tick
    for (const [x, y] of path) this.queue.push({ x, y, running })
    this.retarget()
  }

  get pathLength(): number {
    return this.queue.length
  }

  private currentTurnTarget(): number {
    return this.forcedFacing ?? this.targetAngle
  }

  private effectivelyInteracting(): boolean {
    return this.interacting && !this.pendingInteractionClear
  }

  private retarget(): void {
    while (this.queue.length > 0) {
      const w = this.queue[0]!
      const tx = w.x * UNIT
      const ty = w.y * UNIT
      const dx = tx - this.x
      const dy = ty - this.y
      this.targetAngle = direction8(dx, dy, this.targetAngle)
      this.running = this.speed(w) >= 8
      if (Math.max(Math.abs(dx), Math.abs(dy)) > TELEPORT) {
        this.x = tx
        this.y = ty
        this.queue.shift()
      } else if (tx === Math.trunc(this.x) && ty === Math.trunc(this.y)) {
        this.queue.shift()
      } else return
    }
    this.movementDelay = 0
  }

  private blockedByAnim(): boolean {
    if (this.queue.length === 0) return false
    const w = this.queue[0]!
    return (w.running && this.blocksRunning) || (!w.running && this.blocksWalking)
  }

  private speed(w: Waypoint): number {
    let s = WALK
    if (this.currentTurnTarget() !== this.renderAngle && !this.effectivelyInteracting()) s = TURN_SLOW
    if (this.queue.length > 2) s = 6
    if (this.queue.length > 3) s = 8
    if (this.movementDelay > 0 && this.queue.length > 1) s = 8
    if (w.running) s <<= 1
    return s
  }

  private stepAngle(target: number): void {
    const d = (target - this.renderAngle) & 2047
    if (d === 0) return
    const dir = d > 1024 ? -1 : 1
    this.renderAngle = (this.renderAngle + dir * TURN_SPEED) & 2047
    if (d < TURN_SPEED || d > 2048 - TURN_SPEED) this.renderAngle = target
  }

  /** Advance by `ms` of wall time at `speed`. */
  advance(ms: number, speedMultiplier: number): MovementState {
    if (!Number.isFinite(ms) || ms <= 0) return this.state()
    const scaled = ms * (Number.isFinite(speedMultiplier) && speedMultiplier > 0 ? speedMultiplier : 1)
    const cycles = scaled / CYCLE_MS
    this.turnRemainderMs += scaled
    const whole = Math.floor(this.turnRemainderMs / CYCLE_MS)
    this.turnRemainderMs -= whole * CYCLE_MS
    for (let i = 0; i < whole; i++) {
      if (this.blockedByAnim()) this.movementDelay++
      else if (this.movementDelay > 0 && this.queue.length > 1) this.movementDelay--
      const t = this.currentTurnTarget()
      this.stepAngle(t)
      if (this.pendingInteractionClear && this.renderAngle === t) {
        this.pendingInteractionClear = false
        this.interacting = false
      }
    }
    if (!this.blockedByAnim()) this.interpolate(cycles)
    this.moving = this.queue.length > 0
    if (!this.moving) this.running = false
    return this.state()
  }

  private interpolate(cycles: number): void {
    let left = cycles
    while (this.queue.length > 0 && left > 0) {
      const w = this.queue[0]!
      const fx = this.x
      const fy = this.y
      const tx = w.x * UNIT
      const ty = w.y * UNIT
      const dx = tx - fx
      const dy = ty - fy
      const s = this.speed(w)
      const step = s * left
      let over = 0
      if (fx < tx) {
        this.x += step
        if (this.x > tx) {
          over = (this.x - tx) / s
          this.x = tx
        }
      } else if (fx > tx) {
        this.x -= step
        if (this.x < tx) {
          over = (tx - this.x) / s
          this.x = tx
        }
      }
      if (fy < ty) {
        this.y += step
        if (this.y > ty) {
          over = Math.max(over, (this.y - ty) / s)
          this.y = ty
        }
      } else if (fy > ty) {
        this.y -= step
        if (this.y < ty) {
          over = Math.max(over, (ty - this.y) / s)
          this.y = ty
        }
      }
      left = over
      if (dx !== 0 || dy !== 0) this.running = s >= 8
      if (tx === Math.trunc(this.x) && ty === Math.trunc(this.y)) {
        this.x = tx
        this.y = ty
        this.queue.shift()
        const next = this.queue[0]
        if (next) this.targetAngle = direction8(next.x * UNIT - tx, next.y * UNIT - ty, this.targetAngle)
      }
    }
  }

  private locomotion(): Locomotion | null {
    if (this.queue.length === 0) return null
    const d = (this.currentTurnTarget() - this.renderAngle) & 2047
    const s = d > 1024 ? d - 2048 : d
    if (s >= -256 && s <= 256) return 'walk'
    if (s > 256 && s < 768) return 'turnRight'
    if (s < -256 && s >= -768) return 'turnLeft'
    return 'walkBack'
  }

  state(): MovementState {
    const t = this.currentTurnTarget()
    return {
      position: [this.x / UNIT, this.y / UNIT],
      isVisuallyMoving: this.moving,
      simIsMoving: this.queue.length > 0,
      locomotion: this.locomotion(),
      isRunning: this.running,
      facingAngle: this.renderAngle,
      targetAngle: t,
      isTurning: this.renderAngle !== t,
    }
  }
}
