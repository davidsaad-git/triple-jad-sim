import type { Actor } from './Actor'
import type { CollisionQuery, PathFinder } from './Collision'
import { Random } from './Random'

export interface DelayedAction {
  tick: number
  run: (world: World) => void
}

export interface Projectile {
  id: number
  /** Client spotanim/graphic id used to render it. */
  graphicId: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  /** Tick it was launched and tick it lands (inclusive). */
  startTick: number
  landTick: number
  /** Callback when it lands. */
  onLand: (world: World) => void
}

/**
 * The simulation container. Holds actors, queued actions and projectiles and
 * advances them in the client-like order documented in ARCHITECTURE.md.
 * Everything the engine randomises goes through `rng` so runs are replayable.
 */
export class World {
  tick = 0
  readonly rng: Random
  readonly collision: CollisionQuery
  readonly pathfinder: PathFinder
  readonly actors: Actor[] = []
  private readonly delayed: DelayedAction[] = []
  readonly projectiles: Projectile[] = []
  private nextProjectileId = 1
  private readonly systems: WorldSystem[] = []

  constructor(seed: number, collision: CollisionQuery, pathfinder: PathFinder) {
    this.rng = new Random(seed)
    this.collision = collision
    this.pathfinder = pathfinder
  }

  addSystem(system: WorldSystem): void {
    this.systems.push(system)
  }

  addActor(actor: Actor): void {
    this.actors.push(actor)
  }

  removeActor(actor: Actor): void {
    const i = this.actors.indexOf(actor)
    if (i >= 0) this.actors.splice(i, 1)
  }

  schedule(delayTicks: number, run: (world: World) => void): void {
    this.delayed.push({ tick: this.tick + Math.max(0, delayTicks), run })
  }

  launchProjectile(p: Omit<Projectile, 'id'>): Projectile {
    const projectile: Projectile = { id: this.nextProjectileId++, ...p }
    this.projectiles.push(projectile)
    return projectile
  }

  /** Advance one game tick. */
  step(): void {
    this.tick++
    const tick = this.tick
    for (const a of this.actors) {
      a.prevX = a.x
      a.prevY = a.y
      a.stepsThisTick = 0
      a.pruneHitsplats(tick)
    }

    for (const s of this.systems) s.preTick?.(this)
    for (const s of this.systems) s.npcPhase?.(this)
    this.runDelayed()
    this.landProjectiles()
    for (const s of this.systems) s.playerPhase?.(this)
    for (const s of this.systems) s.postTick?.(this)

    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i]!
      if (a.dead && a.removeWhenDead) this.actors.splice(i, 1)
    }
  }

  private runDelayed(): void {
    const due = this.delayed.filter((d) => d.tick <= this.tick)
    if (!due.length) return
    for (const d of due) {
      const i = this.delayed.indexOf(d)
      if (i >= 0) this.delayed.splice(i, 1)
    }
    for (const d of due) d.run(this)
  }

  private landProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!
      if (p.landTick <= this.tick) {
        this.projectiles.splice(i, 1)
        p.onLand(this)
      }
    }
  }
}

/**
 * A pluggable slice of per-tick behaviour (player controller, Inferno wave
 * manager, prayer drain...). Phases run in the order listed.
 */
export interface WorldSystem {
  preTick?(world: World): void
  npcPhase?(world: World): void
  playerPhase?(world: World): void
  postTick?(world: World): void
}
