/**
 * NPC definition framework (scim defineNpc
 * NpcDefinitionRegistry).
 *
 * A definition owns an identity object; actors created through it carry
 * `definition = identity` and a `state`. Hooks are no-ops for foreign actors.
 * `move` falls back to the generic chase when the spec has no `move`
 * key; `move: false` never moves.
 */
import type { NpcAttackRequest, DamageResult, DamageStyle, PrayerReduction } from '../combat/types'
import type { EventBus } from '../core/EventBus'
import type { RandomFn } from '../core/rng'
import type { NpcActor, NpcDefinitionIdentity } from '../core/types'
import type { WorldState } from '../core/WorldState'
import type { Tile } from '../api'
import type { Arena } from '../map/Arena'
import { genericChase, type NpcMove } from '../map/npcMovement'

export interface NpcContext {
  tick: number
  world: WorldState
  tickEvents: EventBus
  random: RandomFn
  arena: Arena
  spawnNpc(npc: NpcActor): void
  despawnNpc(id: string): void
}

export interface EnvironmentalDamage {
  baseDamage: number | readonly [number, number]
  attackType: DamageStyle
  source: string
  prayerReduction?: PrayerReduction
  playerPosition?: Tile
}

export interface NpcTickResult {
  environmentalDamages: EnvironmentalDamage[]
  npcAttacks?: NpcAttackRequest[]
}

export interface NpcDefeat {
  npcId: string
  tick: number
}

export type CompletionOwnership = 'encounter-owned' | 'external'

export interface NpcAttackTimer {
  nextAttackTick: number
  attackSpeed: number
}

interface HookArgs<S, C> {
  actor: NpcActor<S>
  config: C
  context: NpcContext
}

export interface NpcDefinitionSpec<S, C> {
  id: string
  move?: false | ((args: HookArgs<S, C>) => NpcMove[])
  tick?: (args: HookArgs<S, C>) => NpcTickResult
  postTick?: (args: HookArgs<S, C>) => EnvironmentalDamage[]
  resolveLocalEffects?: (args: HookArgs<S, C>) => EnvironmentalDamage[]
  attackTimer?: (args: HookArgs<S, C>) => NpcAttackTimer | null
  onDamageResolved?: (args: HookArgs<S, C> & { damage: DamageResult }) => void
  onDefeated?: (args: HookArgs<S, C> & { defeat: NpcDefeat; ownership: CompletionOwnership }) => void
  onDespawn?: (args: HookArgs<S, C>) => void
}

export interface NpcRegistration {
  readonly definitionId: string
  isActor(actor: NpcActor): boolean
  notifyDamageResolved(actor: NpcActor, damage: DamageResult, ctx: NpcContext): boolean
  notifyDefeated(actor: NpcActor, defeat: NpcDefeat, ownership: CompletionOwnership, ctx: NpcContext): boolean
  notifyDespawn(actor: NpcActor, ctx: NpcContext): boolean
  move(actor: NpcActor, ctx: NpcContext): NpcMove[]
  tick(actor: NpcActor, ctx: NpcContext): NpcTickResult
  postTick(actor: NpcActor, ctx: NpcContext): EnvironmentalDamage[]
  resolveLocalEffects(actor: NpcActor, ctx: NpcContext): EnvironmentalDamage[]
  attackTimer(actor: NpcActor, ctx: NpcContext): NpcAttackTimer | null
}

export interface NpcDefinition<S, C> {
  readonly id: string
  readonly identity: NpcDefinitionIdentity
  createActor(base: NpcActor, state: S): NpcActor<S>
  getState(actor: NpcActor): S | null
  isActor(actor: NpcActor): actor is NpcActor<S>
  register(config: C): NpcRegistration
}

export function defineNpc<S, C>(spec: NpcDefinitionSpec<S, C>): NpcDefinition<S, C> {
  const identity: NpcDefinitionIdentity = { id: spec.id }
  const isActor = (a: NpcActor): a is NpcActor<S> => a.definition === identity && a.state !== undefined
  return {
    id: spec.id,
    identity,
    createActor: (base, state) => ({ ...base, definition: identity, state }) as NpcActor<S>,
    getState: (a) => (isActor(a) ? (a.state as S) : null),
    isActor,
    register: (config) => {
      const args = (actor: NpcActor, context: NpcContext): HookArgs<S, C> | null =>
        isActor(actor) ? { actor, config, context } : null
      return {
        definitionId: spec.id,
        isActor,
        notifyDamageResolved: (actor, damage, ctx) => {
          const a = args(actor, ctx)
          if (!a) return false
          spec.onDamageResolved?.({ ...a, damage })
          return true
        },
        notifyDefeated: (actor, defeat, ownership, ctx) => {
          const a = args(actor, ctx)
          if (!a) return false
          spec.onDefeated?.({ ...a, defeat, ownership })
          return true
        },
        notifyDespawn: (actor, ctx) => {
          const a = args(actor, ctx)
          if (!a) return false
          spec.onDespawn?.(a)
          return true
        },
        move: (actor, ctx) => {
          const a = args(actor, ctx)
          if (!a || spec.move === false) return []
          return spec.move ? spec.move(a) : genericChase(actor, ctx)
        },
        tick: (actor, ctx) => {
          const a = args(actor, ctx)
          return a ? (spec.tick?.(a) ?? { environmentalDamages: [] }) : { environmentalDamages: [] }
        },
        postTick: (actor, ctx) => {
          const a = args(actor, ctx)
          return a ? (spec.postTick?.(a) ?? []) : []
        },
        resolveLocalEffects: (actor, ctx) => {
          const a = args(actor, ctx)
          return a ? (spec.resolveLocalEffects?.(a) ?? []) : []
        },
        attackTimer: (actor, ctx) => {
          const a = args(actor, ctx)
          return a ? (spec.attackTimer?.(a) ?? null) : null
        },
      }
    },
  }
}

export class DuplicateNpcDefinitionError extends Error {
  readonly definitionId: string
  constructor(definitionId: string) {
    super(`Duplicate NPC definition id: ${definitionId}`)
    this.definitionId = definitionId
    this.name = 'DuplicateNpcDefinitionError'
  }
}

export class NpcDefinitionMismatchError extends Error {
  readonly actorId: string
  readonly definitionId: string
  constructor(actorId: string, definitionId: string) {
    super(`NPC '${actorId}' has no matching registered definition '${definitionId}'`)
    this.actorId = actorId
    this.definitionId = definitionId
    this.name = 'NpcDefinitionMismatchError'
  }
}


export class NpcDefinitionRegistry {
  private readonly registrations = new Map<string, NpcRegistration>()

  constructor(registrations: readonly NpcRegistration[] = []) {
    for (const r of registrations) {
      if (this.registrations.has(r.definitionId)) throw new DuplicateNpcDefinitionError(r.definitionId)
      this.registrations.set(r.definitionId, r)
    }
  }

  private of(actor: NpcActor): NpcRegistration | undefined {
    return this.registrations.get(actor.definition?.id ?? '')
  }

  validateActor(actor: NpcActor): void {
    if (!actor.definition) {
      if (actor.state !== undefined) throw new NpcDefinitionMismatchError(actor.id, '(missing)')
      return
    }
    if (!this.registrations.get(actor.definition.id)?.isActor(actor)) throw new NpcDefinitionMismatchError(actor.id, actor.definition.id)
  }

  notifyDamageResolved(actor: NpcActor, damage: DamageResult, ctx: NpcContext): boolean {
    return this.of(actor)?.notifyDamageResolved(actor, damage, ctx) ?? false
  }

  notifyDefeated(actor: NpcActor, defeat: NpcDefeat, ownership: CompletionOwnership, ctx: NpcContext): boolean {
    return this.of(actor)?.notifyDefeated(actor, defeat, ownership, ctx) ?? false
  }

  notifyDespawn(actor: NpcActor, ctx: NpcContext): boolean {
    return this.of(actor)?.notifyDespawn(actor, ctx) ?? false
  }

  move(actor: NpcActor, ctx: NpcContext): NpcMove[] {
    return this.of(actor)?.move(actor, ctx) ?? []
  }

  tick(actor: NpcActor, ctx: NpcContext): NpcTickResult {
    return this.of(actor)?.tick(actor, ctx) ?? { environmentalDamages: [] }
  }

  postTick(actor: NpcActor, ctx: NpcContext): EnvironmentalDamage[] {
    return this.of(actor)?.postTick(actor, ctx) ?? []
  }

  resolveLocalEffects(actor: NpcActor, ctx: NpcContext): EnvironmentalDamage[] {
    return this.of(actor)?.resolveLocalEffects(actor, ctx) ?? []
  }

  attackTimer(actor: NpcActor, ctx: NpcContext): NpcAttackTimer | null {
    return this.of(actor)?.attackTimer(actor, ctx) ?? null
  }
}

export type { NpcMove }
