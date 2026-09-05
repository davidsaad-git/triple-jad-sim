import type { Tile } from './Collision'

export type HitsplatKind = 'damage' | 'block' | 'poison' | 'venom' | 'heal' | 'disease'

export interface Hitsplat {
  kind: HitsplatKind
  amount: number
  /** Tick on which it was applied; the renderer fades it out. */
  tick: number
}

export interface AnimationState {
  /** Sequence id, or -1 for the idle/stance animation. */
  seqId: number
  /** Tick the animation started on. */
  startTick: number
  /** Client-style frame delay accumulator is derived from ticks + alpha at render time. */
  loop: boolean
}

export type Facing = number // 0..2047 client units, 0 = south? (client: 0 north-facing is 1024) – see Actor.faceTile

let nextActorId = 1

/**
 * Shared state for players and NPCs. Positions are region-local tiles with
 * (x, y) the south-west corner; size is the footprint in tiles.
 */
export abstract class Actor {
  readonly id = nextActorId++
  x = 0
  y = 0
  /** Position at the previous tick, for render interpolation. */
  prevX = 0
  prevY = 0
  size = 1
  facing: Facing = 0
  hitpoints = 1
  maxHitpoints = 1
  dead = false
  /** When true the world drops the actor at the end of the tick it died on. */
  removeWhenDead = false
  /** Practice toggle: damage is shown but never applied. */
  invulnerable = false
  /** Ticks until this actor may attack again (weapon speed cooldown). */
  attackDelay = 0
  /** Ticks this actor is frozen (spawn stun, dig, etc.). */
  frozen = 0
  animation: AnimationState = { seqId: -1, startTick: 0, loop: true }
  readonly hitsplats: Hitsplat[] = []
  /** Movement queue: tiles to walk to (SW corner positions). */
  path: Tile[] = []
  /** Tiles moved this tick (1 walk, 2 run), for animation choice. */
  stepsThisTick = 0

  abstract get name(): string

  setPosition(x: number, y: number): void {
    this.x = x
    this.y = y
    this.prevX = x
    this.prevY = y
  }

  /** Centre of the footprint in tile units (e.g. 1.5 for a 3x3 at x=0). */
  get centreX(): number {
    return this.x + this.size / 2
  }

  get centreY(): number {
    return this.y + this.size / 2
  }

  playAnimation(seqId: number, tick: number, loop = false): void {
    this.animation = { seqId, startTick: tick, loop }
  }

  /** Face a tile from the centre of this actor; angle in client units (0..2047). */
  faceTile(tx: number, ty: number): void {
    const dx = tx + 0.5 - this.centreX
    const dy = ty + 0.5 - this.centreY
    if (dx === 0 && dy === 0) return
    // Client: 0 = facing south (down), 512 = west, 1024 = north, 1536 = east.
    const angle = Math.atan2(dx, dy) // 0 when dy > 0 (north)
    this.facing = ((Math.round((angle / (2 * Math.PI)) * 2048) + 1024) % 2048 + 2048) % 2048
  }

  applyDamage(amount: number, tick: number, kind: HitsplatKind = 'damage'): number {
    const dealt = Math.max(0, Math.min(amount, this.hitpoints))
    if (!this.invulnerable) this.hitpoints -= dealt
    this.hitsplats.push({ kind: dealt === 0 && kind === 'damage' ? 'block' : kind, amount: dealt, tick })
    if (this.hitpoints <= 0) this.dead = true
    return dealt
  }

  heal(amount: number, tick: number, showHitsplat = false): number {
    const healed = Math.max(0, Math.min(amount, this.maxHitpoints - this.hitpoints))
    this.hitpoints += healed
    if (showHitsplat && healed > 0) this.hitsplats.push({ kind: 'heal', amount: healed, tick })
    return healed
  }

  /** Drop hitsplats older than `maxAge` ticks. */
  pruneHitsplats(tick: number, maxAge = 3): void {
    while (this.hitsplats.length && tick - this.hitsplats[0]!.tick > maxAge) this.hitsplats.shift()
  }
}
