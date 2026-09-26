/**
 * Consumption of `inferno_visual` events: projectiles become homing flights, graphics one-shot
 * spot anims, animation cues are queued at `tick * 30 + delayCycles` and
 * released by the scene on their exact cycle.
 */
import type { SimEvent, VisualAnimation, VisualGraphic, VisualProjectile, VisualTarget } from '../../sim/api'
import { Flight, orientation } from './projectile'
import { oneShot, type SpotAnimSystem } from './SpotAnims'

export interface InfernoContext {
  cycle: number
  /** Visual SW position of an actor ('player' included), or null when gone. */
  resolveActor(actorId: string): readonly [number, number] | null
  /** OSRS surface height at a world tile point (tile-shape aware). */
  surfaceHeight(x: number, y: number): number
  /** Bilinear OSRS height (`rd`). */
  bilinearHeight(x: number, y: number): number
}

export interface AnimationCue {
  cue: VisualAnimation
  cycle: number
}

interface FlightEntry {
  cue: VisualProjectile
  flight: Flight
  lastKnown: readonly [number, number] | null
}

interface GraphicEntry {
  cue: VisualGraphic
  start: number
}

export class InfernoVisuals {
  private readonly seen = new Set<number>()
  private readonly flights = new Map<string, FlightEntry>()
  private readonly graphics = new Map<string, GraphicEntry>()
  private animations: AnimationCue[] = []

  consumeEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.type !== 'inferno_visual') continue
      if (this.seen.has(ev.eventId)) continue
      this.seen.add(ev.eventId)
      const base = ev.tick * 30
      ev.projectiles.forEach((p, i) => {
        this.flights.set(`inferno-${ev.eventId}-projectile-${i}`, {
          cue: p,
          flight: new Flight(base + p.startDelayCycles, base + p.endDelayCycles + 1, p.startOffset, p.slope),
          lastKnown: null,
        })
      })
      ev.graphics.forEach((g, i) => {
        this.graphics.set(`inferno-${ev.eventId}-graphic-${i}`, { cue: g, start: base + g.delayCycles })
      })
      for (const a of ev.animations) this.animations.push({ cue: a, cycle: base + a.delayCycles })
    }
  }

  /** Remove and return the cues due at or before `now`, sorted by cycle (`takeAnimations`). */
  takeAnimations(now: number): AnimationCue[] {
    const due = this.animations.filter((a) => a.cycle <= now)
    if (due.length === 0) return due
    this.animations = this.animations.filter((a) => a.cycle > now)
    return due.sort((a, b) => a.cycle - b.cycle)
  }

  private targetCenter(t: VisualTarget, entry: FlightEntry | null, ctx: InfernoContext, active: boolean): [number, number] {
    if (t.kind === 'tile') return [t.position[0] + 0.5, t.position[1] + 0.5]
    const r = ctx.resolveActor(t.actorId)
    if (r && active && entry) entry.lastKnown = r
    const p = r ?? entry?.lastKnown ?? t.position
    return [p[0] + t.size / 2, p[1] + t.size / 2]
  }

  update(spots: SpotAnimSystem, ctx: InfernoContext): void {
    for (const [id, e] of this.flights) {
      const c = e.cue
      const active = ctx.cycle >= e.flight.startCycle && ctx.cycle < e.flight.endExclusive
      const [tx, ty] = this.targetCenter(c.target, e, ctx, active)
      const sx = c.sourcePosition[0]
      const sy = c.sourcePosition[1]
      const source = { x: sx, y: sy, z: (c.startHeight - ctx.surfaceHeight(sx, sy)) / 128 }
      const target = { x: tx, y: ty, z: (c.endHeight - ctx.surfaceHeight(tx, ty)) / 128 }
      const s = e.flight.sample(ctx.cycle, source, target)
      if (s.kind === 'expired') {
        spots.despawn(id)
        this.flights.delete(id)
        continue
      }
      if (s.kind === 'pending' || !spots.isLoaded(c.spotAnimId)) {
        spots.despawn(id)
        continue
      }
      const o = orientation(s.motion)
      const lengths = spots.frameLengths(c.spotAnimId) ?? []
      const seq = spots.seqOf(c.spotAnimId)
      spots.upsert({
        instanceId: id,
        spotAnimId: c.spotAnimId,
        transform: { x: s.motion.x, y: s.motion.y, z: s.motion.z, yaw2048: o.yaw2048, pitchRad: o.pitchRad },
        lifecycle: { kind: 'duration', startTick: e.flight.startCycle / 30, endTick: e.flight.endExclusive / 30 },
        frameProgress: Flight.frameProgress('frame-step', ctx.cycle - e.flight.startCycle, lengths, seq?.frameStep ?? -1),
        heightOffsetMode: 'actor',
      })
    }
    for (const [id, g] of this.graphics) {
      const c = g.cue
      const state = oneShot(
        spots,
        {
          instanceId: id,
          spotAnimId: c.spotAnimId,
          startCycle: g.start,
          transform: () => {
            const [cx, cy] = this.targetCenter(c.target, null, ctx, false)
            return { x: cx, y: cy, z: (c.height - ctx.bilinearHeight(cx, cy)) / 128 }
          },
          heightOffsetMode: 'actor',
          fallbackDurationCycles: 0,
        },
        ctx.cycle,
      )
      if (state === 'expired' || (state === 'unloaded' && ctx.cycle >= g.start)) this.graphics.delete(id)
    }
  }

  clear(spots: SpotAnimSystem): void {
    for (const id of this.flights.keys()) spots.despawn(id)
    for (const id of this.graphics.keys()) spots.despawn(id)
    this.flights.clear()
    this.graphics.clear()
    this.animations = []
    this.seen.clear()
  }
}
