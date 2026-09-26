/**
 * Encounter interface the engine drives (the shape of scim's, bundle
 *).
 */
import type { EncounterCommand, EncounterOutcome, EncounterSnapshot, MechanicsConfig, SimEventBody, Tile } from '../api'
import type { EventBus } from '../core/EventBus'
import type { NpcActor } from '../core/types'
import type { WorldState } from '../core/WorldState'
import type { ArenaConfig } from '../map/Arena'
import type { Arena } from '../map/Arena'
import type { NpcMove } from '../map/npcMovement'
import type { CompletionOwnership, EnvironmentalDamage, NpcDefeat, NpcDefinitionRegistry, NpcTickResult } from '../npc/defineNpc'

export interface NpcMovementRecord {
  npcId: string
  from: Tile
  to: Tile
  path: Tile[]
  moved: boolean
}


export interface EncounterContext {
  tick: number
  playerPos: Tile
  world: WorldState
  tickEvents: EventBus
  arena: Arena
  spawnNpc(npc: NpcActor): void
  despawnNpc(id: string): void
  npcMovements: Map<string, NpcMovementRecord>
}

export interface EncounterCommandContext {
  playerPos: Tile
  tick: number
  world: WorldState
  tickEvents: EventBus
  arena: Arena
  spawnNpc(npc: NpcActor): void
  despawnNpc(id: string): void
}

export interface EncounterCommandResult {
  gameEvents?: SimEventBody[]
}

export interface EncounterSeeds {
  encounterSeed: number
}

export interface Encounter {
  readonly kind: string
  getDefaultPlayerStart(): Tile
  getNpcDefinitions(): NpcDefinitionRegistry
  /** World initialisation: the NPCs present at tick 0. */
  createNpcs(start: Tile, arena: Arena): NpcActor[]
  configureRunStart?(mechanics: MechanicsConfig): void
  getSeeds(): EncounterSeeds
  reset(seeds?: Partial<EncounterSeeds>): void
  resolveHazards(ctx: EncounterContext, mechanics: MechanicsConfig): EnvironmentalDamage[]
  moveNpcs?(ctx: EncounterContext, mechanics: MechanicsConfig): Iterable<NpcMove>
  processTick(ctx: EncounterContext, mechanics: MechanicsConfig): NpcTickResult
  processPostTick(ctx: EncounterContext, mechanics: MechanicsConfig): EnvironmentalDamage[]
  onNpcDefeated?(defeat: NpcDefeat, ctx: EncounterContext, ownership: CompletionOwnership): void
  getOutcome(): EncounterOutcome
  getSnapshot(args: { tick: number; mechanics: MechanicsConfig; world: WorldState }): EncounterSnapshot
  getDefaultMechanicsConfig(): Partial<MechanicsConfig>
  getNpcDamageSourceLabel(): string
  /** Fallback when no cache-built arena is registered. */
  getArenaConfig(): ArenaConfig
  executeCommand?(command: EncounterCommand, ctx: EncounterCommandContext, mechanics: MechanicsConfig): EncounterCommandResult | undefined
}
