/**
 * The wave-68 triple-Jad encounter, built on scim's Zuk encounter with the BUILD_PLAN deviations:
 * three JalTok-Jads (7700) targeting the player, magic/range speed 9, first
 * attacks at spawn + 8/11/14 (shuffled with the encounter RNG), Yt-HurKot
 * spawned relative to each Jad, victory when all Jads are dead.
 */
import type { EncounterCommand, EncounterOutcome, EncounterSnapshot, MechanicsConfig, Tile } from '../../api'
import { markNpcDead } from '../../combat/effects'
import { mulberry32, resolveEncounterSeed, type RandomFn } from '../../core/rng'
import type { NpcActor } from '../../core/types'
import type { WorldState } from '../../core/WorldState'
import type { Arena, ArenaConfig } from '../../map/Arena'
import { boxesOverlap } from '../../map/npcMovement'
import type { NpcMove } from '../../map/npcMovement'
import { NpcDefinitionRegistry, type CompletionOwnership, type EnvironmentalDamage, type NpcContext, type NpcDefeat, type NpcTickResult } from '../../npc/defineNpc'
import type { Encounter, EncounterCommandContext, EncounterCommandResult, EncounterContext, EncounterSeeds } from '../types'
import {
  DAMAGE_SOURCE_LABEL,
  ENCOUNTER_KIND,
  HEALER_OFFSETS,
  HEALER_SIZE,
  JAD_EXECUTION,
  JAD_INITIAL_DELAYS,
  JAD_SPAWN_TILES,
  PLAYER_START,
  VICTORY_DELAY,
} from './constants'
import { createHealer, createJad, JAD_HEALER, JALTOK_JAD_DEF } from './npcs'
import { actorTarget, emitVisual } from './visuals'

/** Fallback arena bounds, used only without a cache-built arena. */
const FALLBACK_ARENA: ArenaConfig = {
  bounds: { minX: 17, maxX: 45, minY: 17, maxY: 46, width: 29, height: 30 },
  walkableTiles: null,
  collisionMap: null,
}

export const TRIPLE_JAD_DEFAULT_MECHANICS: Partial<MechanicsConfig> = { infiniteHealth: false }

interface CommandSpawnContext {
  tick: number
  world: WorldState
  arena: Arena
  spawnNpc(npc: NpcActor): void
  despawnNpc(id: string): void
}

export class TripleJadEncounter implements Encounter {
  readonly kind = ENCOUNTER_KIND
  private encounterSeed: number
  private random: RandomFn
  private nextActorId = 0
  private outcome: EncounterOutcome = { phase: 'active' }
  private jadIds: string[] = []
  private readonly definitions: NpcDefinitionRegistry
  private parentHealTick: number | null = null
  private readonly healedParents = new Set<string>()

  constructor(encounterSeed?: number) {
    this.encounterSeed = resolveEncounterSeed(encounterSeed)
    this.random = mulberry32(this.encounterSeed)
    this.definitions = new NpcDefinitionRegistry([
      JAD_HEALER.register({ presentHeal: (parent, ctx) => this.presentParentHeal(parent, ctx) }),
      JALTOK_JAD_DEF.register({ execution: JAD_EXECUTION, spawnHealers: (jadId, ctx) => this.spawnJadHealers(jadId, ctx) }),
    ])
  }

  getDefaultPlayerStart(): Tile {
    return [PLAYER_START[0], PLAYER_START[1]]
  }

  getNpcDefinitions(): NpcDefinitionRegistry {
    return this.definitions
  }

  getSeeds(): EncounterSeeds {
    return { encounterSeed: this.encounterSeed }
  }

  reset(seeds?: Partial<EncounterSeeds>): void {
    this.encounterSeed = resolveEncounterSeed(seeds?.encounterSeed)
    this.random = mulberry32(this.encounterSeed)
    this.nextActorId = 0
    this.outcome = { phase: 'active' }
    this.jadIds = []
    this.parentHealTick = null
    this.healedParents.clear()
  }

  private allocateId(kind: string): string {
    return `${kind}_${this.nextActorId++}`
  }

  /** Fisher-Yates over the first-attack delays with the encounter RNG (two draws). */
  private shuffledDelays(): number[] {
    const d = [...JAD_INITIAL_DELAYS]
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1))
      ;[d[i], d[j]] = [d[j]!, d[i]!]
    }
    return d
  }

  private makeJads(spawnTick: number): NpcActor[] {
    const delays = this.shuffledDelays()
    const jads = JAD_SPAWN_TILES.map((pos, i) =>
      createJad({ id: this.allocateId('jad'), position: pos, spawnTick, targetId: 'player', initialDelayTicks: delays[i] ?? JAD_EXECUTION.initialDelayTicks }),
    )
    this.jadIds = jads.map((j) => j.id)
    return jads
  }

  createNpcs(_start: Tile, _arena: Arena): NpcActor[] {
    return this.makeJads(0)
  }

  resolveHazards(): EnvironmentalDamage[] {
    return []
  }

  processPostTick(): EnvironmentalDamage[] {
    return []
  }

  private npcContext(ctx: EncounterContext | CommandSpawnContext, tickEvents: NpcContext['tickEvents']): NpcContext {
    return {
      tick: ctx.tick,
      world: ctx.world,
      tickEvents,
      random: this.random,
      arena: ctx.arena,
      spawnNpc: (n) => ctx.spawnNpc(n),
      despawnNpc: (id) => ctx.despawnNpc(id),
    }
  }

  /** scim without the Zuk-alive gate: every NPC's definition move, encounter RNG. */
  *moveNpcs(ctx: EncounterContext): Iterable<NpcMove> {
    const nctx = this.npcContext(ctx, ctx.tickEvents)
    for (const npc of ctx.world.getNpcs()) if (ctx.world.getNpc(npc.id) === npc) yield* this.definitions.move(npc, nctx)
  }

  /** scim: outcome, then resolveLocalEffects for all NPCs, then tick for all NPCs. */
  processTick(ctx: EncounterContext, _mechanics: MechanicsConfig): NpcTickResult {
    if (this.outcome.phase === 'resolving' && this.outcome.completionTick !== undefined && ctx.tick >= this.outcome.completionTick) {
      this.outcome = { ...this.outcome, phase: 'victory' }
    }
    const nctx = this.npcContext(ctx, ctx.tickEvents)
    const env: EnvironmentalDamage[] = []
    for (const npc of ctx.world.getNpcs()) if (ctx.world.getNpc(npc.id) === npc) env.push(...this.definitions.resolveLocalEffects(npc, nctx))
    const attacks: NonNullable<NpcTickResult['npcAttacks']> = []
    for (const npc of ctx.world.getNpcs()) {
      if (ctx.world.getNpc(npc.id) !== npc) continue
      const r = this.definitions.tick(npc, nctx)
      env.push(...r.environmentalDamages)
      attacks.push(...(r.npcAttacks ?? []))
    }
    return { environmentalDamages: env, npcAttacks: attacks }
  }

  /**
   * Victory flow (scim's Zuk): when the last Jad
   * dies every remaining minion dies with it and the outcome resolves to
   * victory 6 ticks later.
   */
  onNpcDefeated(defeat: NpcDefeat, ctx: EncounterContext, ownership: CompletionOwnership): void {
    if (!this.jadIds.includes(defeat.npcId)) return
    const anyJadAlive = this.jadIds.some((id) => ctx.world.getNpc(id)?.alive === true)
    if (anyJadAlive || this.outcome.phase !== 'active') return
    const completion = [...this.jadIds]
    const nctx = this.npcContext(ctx, ctx.tickEvents)
    for (const npc of ctx.world.getNpcs()) {
      if (npc.role !== 'minion' || !npc.alive) continue
      npc.vitals.hp = 0
      markNpcDead(npc, defeat.tick)
      ctx.tickEvents.emit({ type: 'actor_died', actorId: npc.id })
      this.definitions.notifyDefeated(npc, { npcId: npc.id, tick: defeat.tick }, ownership, nctx)
      completion.push(npc.id)
    }
    if (ownership === 'encounter-owned') {
      this.outcome = {
        phase: 'resolving',
        decisiveTick: defeat.tick,
        completionTick: defeat.tick + VICTORY_DELAY,
        primaryActorId: defeat.npcId,
        completionActorIds: completion,
      }
    }
  }

  getOutcome(): EncounterOutcome {
    return this.outcome
  }

  getSnapshot(args: { tick: number; mechanics: MechanicsConfig; world: WorldState }): EncounterSnapshot {
    const jads = this.jadIds.map((id) => {
      const npc = args.world.getNpc(id)
      const st = npc ? JALTOK_JAD_DEF.getState(npc) : null
      return {
        id,
        present: npc !== null,
        alive: npc?.alive ?? false,
        hp: npc?.vitals.hp ?? 0,
        maxHp: npc?.vitals.maxHp ?? 0,
        spawnTick: npc?.spawnTick ?? null,
        initialDelayTicks: st?.initialDelayTicks ?? null,
        firstAttackTick: npc && st ? (npc.spawnTick ?? 0) + st.initialDelayTicks : null,
        nextActionTick: npc?.combat.nextActionTick ?? null,
        pendingStyle: st?.pendingAttack?.style ?? null,
        pendingReleaseTick: st?.pendingAttack?.releaseTick ?? null,
        healersSpawned: st?.healersSpawned ?? false,
        removeAt: st?.removeAt ?? null,
        healerIds: args.world
          .getNpcs()
          .filter((n) => JAD_HEALER.getState(n)?.parentId === id)
          .map((n) => n.id),
      }
    })
    return {
      kind: ENCOUNTER_KIND,
      state: { jads, jadsAlive: jads.filter((j) => j.alive).length, encounterSeed: this.encounterSeed },
      visuals: {},
    }
  }

  getDefaultMechanicsConfig(): Partial<MechanicsConfig> {
    return { ...TRIPLE_JAD_DEFAULT_MECHANICS }
  }

  getNpcDamageSourceLabel(): string {
    return DAMAGE_SOURCE_LABEL
  }

  getArenaConfig(): ArenaConfig {
    return FALLBACK_ARENA
  }

  /** scim: graphic 444 at most once per Jad per tick. */
  private presentParentHeal(parent: NpcActor, ctx: NpcContext): void {
    if (this.parentHealTick !== ctx.tick) {
      this.parentHealTick = ctx.tick
      this.healedParents.clear()
    }
    if (this.healedParents.has(parent.id)) return
    this.healedParents.add(parent.id)
    emitVisual(ctx.tickEvents, { animations: [], projectiles: [], graphics: [{ spotAnimId: 444, target: actorTarget(parent), height: 256, delayCycles: 0 }] })
  }

  /** Is the healer footprint at `t` free of every other present NPC footprint? */
  private tileFree(world: WorldState, t: Tile): boolean {
    return !world.getNpcs().some((n) => n.alive && boxesOverlap({ position: t, size: HEALER_SIZE }, n))
  }

  /**
   * Wave-68 healer placement: the offset tile from the Jad's current SW tile,
   * or when it is not walkable / inside another NPC, the nearest free
   * walkable tile on growing Chebyshev rings (scan x outer, y inner).
   */
  healerSpawnTile(world: WorldState, arena: Arena, desired: Tile): Tile {
    const ok = (t: Tile): boolean => arena.isWalkable(t[0], t[1]) && this.tileFree(world, t)
    if (ok(desired)) return desired
    for (let r = 1; r <= 64; r++) {
      for (let x = desired[0] - r; x <= desired[0] + r; x++) {
        for (let y = desired[1] - r; y <= desired[1] + r; y++) {
          if (Math.max(Math.abs(x - desired[0]), Math.abs(y - desired[1])) !== r) continue
          if (ok([x, y])) return [x, y]
        }
      }
    }
    return desired
  }

  /** scim with the wave-68 offsets. */
  spawnJadHealers(jadId: string, ctx: { tick: number; world: WorldState; arena: Arena; spawnNpc(npc: NpcActor): void }): NpcActor[] {
    const jad = ctx.world.getNpc(jadId)
    if (!jad) return []
    const spawned: NpcActor[] = []
    for (const [dx, dy] of HEALER_OFFSETS) {
      const pos = this.healerSpawnTile(ctx.world, ctx.arena, [jad.position[0] + dx, jad.position[1] + dy])
      const healer = createHealer({ id: this.allocateId('jad_healer'), position: pos, spawnTick: ctx.tick, parentId: jadId })
      ctx.spawnNpc(healer)
      spawned.push(healer)
    }
    const st = JALTOK_JAD_DEF.getState(jad)
    if (st) st.healersSpawned = true
    return spawned
  }

  private targetJads(world: WorldState, jadId: unknown): NpcActor[] {
    const alive = this.jadIds.map((id) => world.getNpc(id)).filter((n): n is NpcActor => n !== null && n.alive)
    return typeof jadId === 'string' ? alive.filter((n) => n.id === jadId) : alive
  }

  executeCommand(command: EncounterCommand, ctx: EncounterCommandContext): EncounterCommandResult | undefined {
    switch (command.type) {
      case 'restart-wave': {
        for (const npc of ctx.world.getNpcs()) ctx.world.removePendingHitsBySource(npc.id)
        ctx.world.pendingHits = ctx.world.pendingHits.filter((h) => ctx.world.getNpc(h.targetId) === null)
        for (const npc of ctx.world.getNpcs()) ctx.despawnNpc(npc.id)
        this.outcome = { phase: 'active' }
        this.parentHealTick = null
        this.healedParents.clear()
        for (const jad of this.makeJads(ctx.tick)) ctx.spawnNpc(jad)
        return {}
      }
      case 'spawn-jad-healers': {
        for (const jad of this.targetJads(ctx.world, command.jadId)) this.spawnJadHealers(jad.id, ctx)
        return {}
      }
      case 'clear-healers': {
        for (const npc of ctx.world.getNpcs()) if (JAD_HEALER.isActor(npc)) ctx.despawnNpc(npc.id)
        return {}
      }
      case 'set-jad-hp': {
        const hp = typeof command.hp === 'number' ? command.hp : Number.NaN
        if (!Number.isFinite(hp)) return undefined
        for (const jad of this.targetJads(ctx.world, command.jadId)) {
          jad.vitals = { ...jad.vitals, hp: Math.max(1, Math.min(jad.vitals.maxHp, Math.floor(hp))) }
        }
        return {}
      }
      default:
        return undefined
    }
  }

  /** Current Jad ids in spawn order (world ids). */
  getJadIds(): readonly string[] {
    return this.jadIds
  }
}
