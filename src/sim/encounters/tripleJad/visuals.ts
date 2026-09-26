/**
 * Inferno visual/event helpers shared by the Jad and Yt-HurKot definitions:
 * (inferno_visual) (zuk_attack) (zuk_death), `yee` (zuk_hit),
 * `bee` (archetype -> kind), `NO`/`PO`/`FO` (projectile sources/targets and
 * the Jad magic volley) and the hit reaction.
 */
import type { SimEventBody, Tile, VisualAnimation, VisualGraphic, VisualProjectile, VisualTarget } from '../../api'
import type { DamageResult } from '../../combat/types'
import type { EventBus } from '../../core/EventBus'
import type { Actor, NpcActor } from '../../core/types'
import { centreDistance } from '../../combat/formulas'
import { faceExact } from '../../map/facing'
import { HEALER_ARCHETYPE, JAD_ARCHETYPE } from './constants'

export interface InfernoVisual {
  animations: VisualAnimation[]
  projectiles: VisualProjectile[]
  graphics: VisualGraphic[]
}

export type InfernoNpcKind = 'jad' | 'jad_healer'

/** scim: emit a (deep-copied) inferno_visual batch. */
export function emitVisual(events: EventBus, visual: InfernoVisual): void {
  events.emit({ type: 'inferno_visual', ...structuredClone(visual) })
}

export function animationOnly(actorId: string, clipId: string): InfernoVisual {
  return { animations: [{ actorId, clipId, delayCycles: 0 }], projectiles: [], graphics: [] }
}

type ZukAttackEvent = Extract<SimEventBody, { type: 'zuk_attack' }>


export function emitZukAttack(events: EventBus, e: Omit<ZukAttackEvent, 'type'>): void {
  events.emit({
    type: 'zuk_attack',
    ...e,
    sourcePosition: [e.sourcePosition[0], e.sourcePosition[1]],
    targetPosition: [e.targetPosition[0], e.targetPosition[1]],
  })
}


export function emitZukDeath(events: EventBus, actorId: string, npcKind: InfernoNpcKind, position: Tile): void {
  events.emit({ type: 'zuk_death', actorId, npcKind, position: [position[0], position[1]] })
}


export function emitZukHit(events: EventBus, actorId: string, npcKind: InfernoNpcKind, position: Tile): void {
  events.emit({ type: 'zuk_hit', actorId, npcKind, position: [position[0], position[1]] })
}

/** scim (restricted to the kinds this wave has). */
export function infernoKind(npc: NpcActor): InfernoNpcKind | null {
  return npc.archetypeId === JAD_ARCHETYPE ? 'jad' : npc.archetypeId === HEALER_ARCHETYPE ? 'jad_healer' : null
}

/** scim: projectile source at the centre tile's middle. */
export function projectileSource(actor: { position: Tile; size: number }): [number, number] {
  const o = Math.floor(actor.size / 2) + 0.5
  return [actor.position[0] + o, actor.position[1] + o]
}


export function actorTarget(actor: Actor): VisualTarget {
  return { kind: 'actor', actorId: actor.id, size: actor.size, position: [actor.position[0], actor.position[1]] }
}

/**
 * scim: face the target (`RO`) and build the three
 * magic projectiles 448/449/450, timed as if the animation started 90 cycles
 * (3 ticks) before launch. The caller shifts them by -90 at release.
 */
export function jadMagicVolley(jad: NpcActor, target: Actor): InfernoVisual {
  faceExact(jad, target)
  const d = centreDistance(jad, target)
  const specs = [
    { spotAnimId: 448, start: 2, end: 2 },
    { spotAnimId: 449, start: 6, end: 6 },
    { spotAnimId: 450, start: 10, end: 12 },
  ]
  return {
    animations: [{ actorId: jad.id, clipId: 'magic', delayCycles: 0 }],
    graphics: [],
    projectiles: specs.map((s) => ({
      spotAnimId: s.spotAnimId,
      sourcePosition: projectileSource(jad),
      target: actorTarget(target),
      startDelayCycles: 90 + s.start,
      endDelayCycles: 90 + s.end + 8 * d,
      slope: 16,
      startOffset: 32,
      startHeight: 512,
      endHeight: 124,
    })),
  }
}

/** scim: hit reaction (sound event + defend clip unless the hit killed it). */
export function hitReaction(npc: NpcActor, damage: DamageResult, events: EventBus): void {
  if (damage.effectiveDamage < 0 || damage.hpAfter > damage.hpBefore) return
  const kind = infernoKind(npc)
  if (kind === null) return
  emitZukHit(events, npc.id, kind, npc.position)
  if (damage.hpAfter > 0) emitVisual(events, animationOnly(npc.id, 'defend'))
}
