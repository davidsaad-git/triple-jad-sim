/**
 * The simulation engine: a re-implementation of scim.gg's
 * for one encounter. `advanceTick` runs scim's
 * `advanceTickUnchecked` pipeline stage by stage.
 */
import type { ObjTypeLoader } from '../../cache/config/ObjType'
import type {
  CombatSupplies,
  DamageHistoryEntry,
  DpsProjection,
  EncounterCommand,
  EquipSlot,
  Equipment,
  EquipmentStats,
  Inventory,
  ItemOption,
  Loadout,
  MechanicsConfig,
  NpcState,
  PotionBoost,
  PrayerId,
  SimEngine,
  SimEvent,
  SimState,
  SkillName,
  Tile,
} from '../api'
import { buildAttackPlan, projectPlan } from '../combat/attackPlan'
import { CombatSystem } from '../combat/CombatSystem'
import { applyProtection, markNpcDead, notePlayerDamage, powerOfDeathFactor, tryInstantSpecial, instantSpecial } from '../combat/effects'
import { playerCombatStep, clearIfAttackBlocked, setAttackTarget, usesConflictionRolls } from '../combat/playerAttack'
import { resolveAttackResources } from '../combat/resources'
import { promoteRetaliation } from '../combat/retaliation'
import { hasSpecialAttack } from '../combat/specials'
import { checkSpell } from '../combat/spells'
import type { CombatBridge, DamageResult, DamageStyle, PrayerReduction } from '../combat/types'
import {
  attackKindOf,
  autocastSpell,
  damageStyleOf,
  defaultStyleIndex,
  DEFAULT_SPELLBOOK,
  formulaStyleOf,
  playerCombatParams,
  weaponCategory,
  weaponCategoryKey,
} from '../combat/weaponCategories'
import { prayerCategory, protects, REDEMPTION_HEAL_FRACTION } from '../data/prayers'
import type { Encounter, EncounterContext, NpcMovementRecord } from '../encounters/types'
import { consumableDef, PREPOT_OPS, setTrack, trackReady, TRACK_ATTACK_DELAY, type ConsumableDef, type ConsumeRule } from '../items/consumables'
import { applyItemEffects, hasEnhancedPrayerRestoration, surgeBlocked, type ItemActionState } from '../items/itemEffects'
import { computeEquipmentStats, computeWeight, emptyEquipmentStats, isStackableObj, itemStatsFromObj, loadObj } from '../items/itemStats'
import { Arena, type ArenaConfig } from '../map/Arena'
import { angleFromDelta, angleTowardActor } from '../map/facing'
import { boxesOverlap, npcMovementVetoed } from '../map/npcMovement'
import { playerInRange, tileInsideNpc } from '../map/reach'
import { stepToward, stepTowardNpc, type StepResult } from '../map/pathfinding'
import type { NpcContext, NpcDefeat } from '../npc/defineNpc'
import { NpcDefinitionRegistry } from '../npc/defineNpc'
import { addToInventory, consumeInventory, countFreeSlots, emptyInventory, removeFromInventory } from '../player/inventory'
import { applyPrayerOpsWithPoints, projectPendingPrayers } from '../player/prayerOps'
import { defaultBaseLevels, sanitizeLevels, statsFromLevels } from '../player/stats'
import {
  castDeathCharge,
  castMarkOfDarkness,
  decayBoosts,
  deathChargeProc,
  drainPrayer,
  fillSpecial,
  initialCombatTimers,
  initialPoisonState,
  initialSpecialAttack,
  isVenomVarp,
  LIGHTBEARER,
  MAX_RUN_ENERGY,
  preserveReady,
  regenerateSpecial,
  stepPoison,
  tickCombatTimers,
  updateLightbearer,
  updateRunEnergy,
} from '../player/timers'
import { EventBus } from './EventBus'
import { mulberry32, resolveSeed, type RandomFn } from './rng'
import type { InputOp, NpcActor, PlayerActor, PrayerOp } from './types'
import { WorldState } from './WorldState'

export const PLAYER_ID = 'player'

/** wearPos1 -> slot. */
const WEAR_POS_TO_SLOT: Readonly<Record<number, EquipSlot>> = {
  0: 'head',
  1: 'cape',
  2: 'amulet',
  3: 'weapon',
  4: 'body',
  5: 'shield',
  7: 'legs',
  9: 'hands',
  10: 'boots',
  12: 'ring',
}
const AMMO_WEAR_POS = 13
const METAL_WORDS = ['platebody', 'chainbody', 'hauberk', 'cuirass', 'chestplate', 'platemail', 'armour', 'armor']
const SOFT_WORDS = ['robe', 'robetop', 'tunic', 'shirt', 'jacket', 'vest', 'leather', 'hide', "d'hide"]
const PURGING_STAFF = 29594
const MOD_ANIM = 8970
const VFX_PLAYER_REDEMPTION = 436

/** scim's global mechanic defaults (`lm`); `upgradedPrayers` is mirrored as `deadeyeMysticVigour`. */
export const BASE_MECHANICS: MechanicsConfig = {
  infiniteHealth: false,
  infiniteSpecialAttack: false,
  autoPrepot: true,
  doubleDeathCharge: true,
  deadeyeMysticVigour: true,
  upgradedPrayers: true,
  vialSmasher: true,
}

export interface EngineOptions {
  encounter: Encounter
  objTypeLoader: ObjTypeLoader | null
  /** Cache-built arena (scim registers it per encounter kind). */
  arenaConfig: ArenaConfig | null
  baseLevels?: Partial<Record<SkillName, number>>
  mechanics?: Partial<MechanicsConfig>
  combatSeed?: number
}

type EquipmentPreview = { inventory: Inventory; equipment: Equipment; combatSupplies: CombatSupplies }

function copySupplies(s: CombatSupplies): CombatSupplies {
  return {
    equippedAmmo: s.equippedAmmo ? { ...s.equippedAmmo } : null,
    quiverAmmo: s.quiverAmmo ? { ...s.quiverAmmo } : null,
    runePouch: s.runePouch ? { kind: s.runePouch.kind, slots: s.runePouch.slots.map((x) => (x ? { ...x } : null)) } : null,
    blowpipe: s.blowpipe ? { ...s.blowpipe } : null,
    selectedSpell: s.selectedSpell,
    spellbook: s.spellbook,
  }
}

function defaultSupplies(): CombatSupplies {
  return { equippedAmmo: null, quiverAmmo: null, runePouch: null, blowpipe: null, selectedSpell: null, spellbook: DEFAULT_SPELLBOOK }
}

function withoutUndefined(e: Equipment): Equipment {
  const out: Equipment = {}
  for (const [k, v] of Object.entries(e)) if (v !== undefined) out[k as EquipSlot] = v
  return out
}

export class SimulationEngine implements SimEngine {
  private world = new WorldState()
  private failedCondition: string | null = null
  private readonly encounter: Encounter
  private mechanicsConfig: MechanicsConfig
  private damageHistory: DamageHistoryEntry[] = []
  private readonly objTypeLoader: ObjTypeLoader | null
  private readonly tickEvents = new EventBus()
  private readonly combatSystem: CombatSystem
  private npcDefinitions: NpcDefinitionRegistry
  private readonly cacheArenaConfig: ArenaConfig | null
  private arenaInstance: Arena
  private lastEvents: SimEvent[] = []
  private selfDamageHitPending = false
  private attackStylePerCategory: Record<string, number> = {}
  private pendingNpcDefeats: { actor: NpcActor; defeat: NpcDefeat }[] = []
  private configuredLevels: Record<SkillName, number>
  private runStartPosition: Tile
  private prepotApplied = false
  private combatSeed: number
  private combatRandom: RandomFn
  private readonly rollCombat: RandomFn = () => this.combatRandom()
  private storedLoadout: Loadout | null = null

  constructor(opts: EngineOptions) {
    this.encounter = opts.encounter
    this.npcDefinitions = this.encounter.getNpcDefinitions()
    this.mechanicsConfig = this.mergeMechanics(this.mergeMechanics(BASE_MECHANICS, this.encounter.getDefaultMechanicsConfig()), opts.mechanics ?? {})
    this.objTypeLoader = opts.objTypeLoader
    this.combatSeed = resolveSeed(opts.combatSeed)
    this.combatRandom = mulberry32(this.combatSeed)
    this.combatSystem = new CombatSystem(this.rollCombat)
    this.configuredLevels = sanitizeLevels(opts.baseLevels ?? defaultBaseLevels())
    this.cacheArenaConfig = opts.arenaConfig
    this.arenaInstance = Arena.fromEncounter(this.cacheArenaConfig, this.encounter.getArenaConfig())
    const start = this.encounter.getDefaultPlayerStart()
    this.runStartPosition = [start[0], start[1]]
    this.initializeWorld(start, emptyInventory())
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  get lastTickEvents(): readonly SimEvent[] {
    return this.lastEvents
  }

  get arena(): Arena {
    return this.arenaInstance
  }

  get worldState(): WorldState {
    return this.world
  }

  get currentTick(): number {
    return this.world.tick
  }

  getSeeds(): { combatSeed: number; encounterSeed: number } {
    return { combatSeed: this.combatSeed, encounterSeed: this.encounter.getSeeds().encounterSeed }
  }

  getMechanicsConfig(): MechanicsConfig {
    return { ...this.mechanicsConfig }
  }

  getDamageHistory(): readonly DamageHistoryEntry[] {
    return this.damageHistory
  }

  getEncounter(): Encounter {
    return this.encounter
  }

  private player(): PlayerActor {
    const p = this.world.getPlayer()
    if (!p) throw new Error('Player actor missing from world state')
    return p
  }

  // -------------------------------------------------------------------------
  // World construction
  // -------------------------------------------------------------------------

  private mergeMechanics(base: MechanicsConfig, patch: Partial<MechanicsConfig>): MechanicsConfig {
    const out: MechanicsConfig = { ...base }
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = v
    if (patch.deadeyeMysticVigour !== undefined) out.upgradedPrayers = patch.deadeyeMysticVigour
    else if (typeof patch.upgradedPrayers === 'boolean') out.deadeyeMysticVigour = patch.upgradedPrayers
    return out
  }

  private createPlayerActor(position: Tile, inventory: Inventory): PlayerActor {
    const stats = statsFromLevels(this.configuredLevels)
    return {
      id: PLAYER_ID,
      kind: 'player',
      alive: true,
      position: [position[0], position[1]],
      previousPosition: [position[0], position[1]],
      facing: 1024,
      size: 1,
      vitals: { hp: stats.hitpoints.current, maxHp: stats.hitpoints.max },
      movementPath: [],
      isMoving: false,
      isRunning: false,
      history: new Map(),
      activePrayer: null,
      offensivePrayer: null,
      independentPrayers: [],
      prayerState: { points: stats.prayer.current, maxPoints: stats.prayer.max, drainCounter: 0, activePrayers: [], prayerActivationTicks: {} },
      stats,
      poisonState: initialPoisonState(),
      specialAttack: initialSpecialAttack(),
      combatTimers: initialCombatTimers(),
      potionBoosts: [],
      inventory,
      combatSupplies: defaultSupplies(),
      isRunEnabled: true,
      isSpecialAttackActive: false,
      runEnergy: { energy: MAX_RUN_ENERGY },
      ctrlClickOverride: false,
      equipment: {},
      equipmentStats: emptyEquipmentStats(),
      weight: 0,
      pendingInputOps: [],
      cooldownTracks: { food: 0, potion: 0, combo_food: 0 },
      pendingItemPickup: null,
      activeEffects: [],
      quickPrayersActive: false,
      outline: { color: '#90f668', style: 'full' },
      attackTarget: null,
      autoAttackPause: null,
      attackInteractionActive: true,
      manualCastSpell: null,
      selectedAttackStyleIndex: 0,
      pendingConflictionAttack: null,
      xpCounters: {},
    }
  }

  
  private initializeWorld(start: Tile, inventory: Inventory): void {
    this.world.tick = 0
    this.world.pendingHits = []
    this.world.actors = new Map()
    this.world.groundItems = []
    this.world.groundItemSeq = 0
    const player = this.createPlayerActor(start, inventory)
    this.world.actors.set(player.id, player)
    for (const npc of this.encounter.createNpcs(start, this.arenaInstance)) {
      this.npcDefinitions.validateActor(npc)
      this.world.actors.set(npc.id, npc)
      npc.history.set(0, npc.position)
    }
    this.encounter.configureRunStart?.(this.mechanicsConfig)
    player.history.set(0, player.position)
    this.syncVitalsToStats()
    this.tickEvents.setTick(0)
    this.lastEvents = this.tickEvents.flush()
  }

  private applyArena(): void {
    this.arenaInstance = Arena.fromEncounter(this.cacheArenaConfig, this.encounter.getArenaConfig())
  }

  // -------------------------------------------------------------------------
  // Contexts
  // -------------------------------------------------------------------------

  private buildEncounterCtx(tick: number, playerPos: Tile, movements: Map<string, NpcMovementRecord>): EncounterContext {
    return {
      tick,
      playerPos: [playerPos[0], playerPos[1]],
      world: this.world,
      tickEvents: this.tickEvents,
      arena: this.arenaInstance,
      spawnNpc: (n) => this.spawnEncounterNpc(n),
      despawnNpc: (id) => this.despawnEncounterNpc(id),
      npcMovements: movements,
    }
  }

  /** scim `buildNpcDefinitionContext` (combat RNG). */
  private npcDefinitionContext(): NpcContext {
    return {
      tick: this.world.tick,
      world: this.world,
      tickEvents: this.tickEvents,
      random: this.rollCombat,
      arena: this.arenaInstance,
      spawnNpc: (n) => this.spawnEncounterNpc(n),
      despawnNpc: (id) => this.despawnEncounterNpc(id),
    }
  }

  private *moveDefinedNpcs(npcs: Iterable<NpcActor>): Generator<{ npcId: string; path: Tile[] }> {
    for (const npc of npcs) if (this.world.getNpc(npc.id) === npc) yield* this.npcDefinitions.move(npc, this.npcDefinitionContext())
  }

  private spawnEncounterNpc(npc: NpcActor): void {
    if (this.world.actors.has(npc.id)) throw new Error(`spawnNpc: duplicate actor id '${npc.id}'`)
    this.npcDefinitions.validateActor(npc)
    this.world.actors.set(npc.id, npc)
    npc.history.set(this.world.tick, [npc.position[0], npc.position[1]])
  }

  private despawnEncounterNpc(id: string): void {
    const npc = this.world.getNpc(id)
    if (!npc) return
    this.world.actors.delete(id)
    this.tickEvents.emit({ type: 'actor_despawned', actorId: id })
    this.npcDefinitions.notifyDespawn(npc, this.npcDefinitionContext())
  }

  private buildCombatBridge(extra: Partial<CombatBridge>): CombatBridge {
    return {
      events: this.tickEvents,
      infiniteHealth: this.mechanicsConfig.infiniteHealth,
      incomingDamageMultiplier: undefined,
      outgoingDamageMultiplier: undefined,
      specDamageMultiplier: undefined,
      onDamageApplied: (r) => this.onCombatDamageApplied(r),
      onSourceSelfDamageApplied: () => this.tryRedemption(this.world.tick),
      ...extra,
    }
  }

  private pendingHitBridge(): CombatBridge {
    return this.buildCombatBridge({ enablePendingHits: true, resolveAttack: () => ({}) })
  }

  lookupItemStats(id: number): EquipmentStats | null {
    if (!this.objTypeLoader) return null
    const obj = loadObj(this.objTypeLoader, id)
    return obj ? itemStatsFromObj(obj) : null
  }

  // -------------------------------------------------------------------------
  // The tick
  // -------------------------------------------------------------------------

  canAdvance(): boolean {
    return this.player().alive && this.encounter.getOutcome().phase !== 'victory'
  }

  advanceTick(targetTile: Tile): void {
    if (!this.canAdvance()) return
    this.advanceTickUnchecked(targetTile)
  }

  
  private advanceTickUnchecked(targetTile: Tile): void {
    const p = this.player()
    const prevTick = this.world.tick
    const tick = prevTick + 1
    const specAtStart = p.specialAttack.energy
    this.world.tick = tick
    this.tickEvents.setTick(tick)

    // Stage 2: input band (+ Redemption after item self-damage).
    this.processInputBand(tick)
    if (this.selfDamageHitPending) {
      this.selfDamageHitPending = false
      this.tryRedemption(tick)
    }
    const mechanics = { ...this.mechanicsConfig }
    const movements = new Map<string, NpcMovementRecord>()
    const ctx = this.buildEncounterCtx(tick, p.position, movements)

    // Stage 4: hazards.
    for (const h of this.encounter.resolveHazards(ctx, mechanics)) this.applyDamage(h.baseDamage, h.attackType, h.source, tick, h.prayerReduction, h.playerPosition)
    // Stage 5: retaliation promotion; stage 6: NPC queue band.
    promoteRetaliation(this.world)
    this.processNpcQueueBand()

    // Stage 7: NPC movement.
    {
      const snapshot = new Map(this.world.getNpcs().map((n) => [n.id, n] as const))
      for (const npc of snapshot.values()) {
        const tgt = npc.combat.targetId === null ? undefined : this.world.actors.get(npc.combat.targetId)
        npc.combat.startedTurnOverlappingTarget = tgt?.alive === true && boxesOverlap(npc, tgt)
        npc.previousPosition = npc.position
        npc.movementPath = []
        npc.isMoving = false
        npc.isRunning = false
      }
      const moves = this.encounter.moveNpcs ? this.encounter.moveNpcs(ctx, mechanics) : this.moveDefinedNpcs(snapshot.values())
      for (const m of moves) {
        const npc = this.world.getNpc(m.npcId)
        if (!npc || !npc.alive || snapshot.get(m.npcId) !== npc) continue
        const from: Tile = [npc.position[0], npc.position[1]]
        const path = npcMovementVetoed(npc, p, tick) ? [] : m.path
        const dest = path.length > 0 ? path[path.length - 1]! : from
        const moved = dest[0] !== from[0] || dest[1] !== from[1]
        if (moved) {
          npc.position = [dest[0], dest[1]]
          npc.movementPath = path.map(([x, y]) => [x, y] as Tile)
          npc.isMoving = true
          npc.isRunning = path.length > 1
          const prev = path.length > 1 ? path[path.length - 2]! : from
          npc.facing = npc.lockedFacing ?? angleFromDelta(dest[0] - prev[0], dest[1] - prev[1], npc.facing)
          this.tickEvents.emit({ type: 'movement', actorId: npc.id, from, to: [npc.position[0], npc.position[1]] })
        }
        movements.set(npc.id, { npcId: npc.id, from, to: [npc.position[0], npc.position[1]], path: npc.movementPath, moved })
      }
    }
    // Stage 8-9.
    this.updateStationaryNpcTargetFacing()
    for (const npc of this.world.getNpcs()) if (npc.alive) this.recordHistory(npc.history, tick, npc.position)

    // Stage 10-11: encounter NPC tick and attack commits.
    const result = this.encounter.processTick(ctx, mechanics)
    for (const attack of result.npcAttacks ?? []) {
      const attacker = this.world.actors.get(attack.attackerId)
      const target = this.world.actors.get(attack.targetId)
      if (!attacker || !target) continue
      const npc = this.world.getNpc(attack.attackerId)
      const bridge = this.buildCombatBridge({ enablePendingHits: true })
      const ok = attack.isContinuation
        ? this.combatSystem.processSupplementalHitRequest(this.world, { attacker, target, attack }, bridge)
        : this.combatSystem.processAttackRequest(this.world, { attacker, target, attack }, bridge)
      if (ok && npc && !attack.isContinuation) npc.combat.lastAttackTick = tick
    }
    // Stage 12.
    for (const d of result.environmentalDamages) this.applyDamage(d.baseDamage, d.attackType, d.source, tick, d.prayerReduction, d.playerPosition)
    // Stage 13-16.
    this.combatSystem.processPendingHits(this.world, this.pendingHitBridge(), 'player')
    this.processPlayerTimerBand(tick, prevTick, specAtStart)
    clearIfAttackBlocked(p, this.world)
    this.processItemPickup()

    // Stage 17: player movement.
    const start: Tile = [p.position[0], p.position[1]]
    const running = (p.ctrlClickOverride ? !p.isRunEnabled : p.isRunEnabled) && p.runEnergy.energy > 0
    const tgt = p.attackTarget ? this.world.actors.get(p.attackTarget) : undefined
    let step: StepResult
    if (tgt?.alive && tgt.kind === 'npc') {
      const { attackRange } = playerCombatParams(p)
      const inside = tileInsideNpc(p.position, tgt.position, tgt.size)
      const range = p.attackInteractionActive ? attackRange : 1
      step =
        !inside && playerInRange(this.arenaInstance, p.position, tgt.position, tgt.size, range, true)
          ? { position: [p.position[0], p.position[1]], stepTiles: [] }
          : stepTowardNpc(this.arenaInstance, p.position, tgt.position, tgt.size, running)
    } else {
      step = stepToward(this.arenaInstance, p.position, targetTile, running)
    }
    const pos = step.position
    if (pos[0] >= 0 && pos[0] < 64 && pos[1] >= 0 && pos[1] < 64 && this.arenaInstance.inBounds(pos[0], pos[1])) {
      p.previousPosition = start
      p.position = [pos[0], pos[1]]
      p.movementPath = step.stepTiles.map(([x, y]) => [x, y] as Tile)
    } else {
      p.position = start
      p.previousPosition = start
      p.movementPath = []
    }
    this.recordHistory(p.history, tick, p.position)
    const moved = start[0] !== p.position[0] || start[1] !== p.position[1]
    p.isMoving = moved
    p.isRunning = moved && p.movementPath.length > 1
    if (moved) {
      const last = p.movementPath[p.movementPath.length - 1]!
      const prev = p.movementPath.length > 1 ? p.movementPath[p.movementPath.length - 2]! : start
      p.facing = angleFromDelta(last[0] - prev[0], last[1] - prev[1], p.facing)
      this.tickEvents.emit({ type: 'movement', actorId: p.id, from: start, to: [p.position[0], p.position[1]] })
    }

    // Stage 18: player combat.
    playerCombatStep(p, {
      world: this.world,
      arena: this.arenaInstance,
      tickEvents: this.tickEvents,
      combatSystem: this.combatSystem,
      random: this.rollCombat,
      infiniteHealth: this.mechanicsConfig.infiniteHealth,
      lookupItemStats: (id) => this.lookupItemStats(id),
      onDamageApplied: (r) => this.onCombatDamageApplied(r),
    })

    // Stage 19-24.
    const postCtx = this.buildEncounterCtx(tick, p.position, movements)
    for (const d of this.encounter.processPostTick(postCtx, mechanics)) this.applyDamage(d.baseDamage, d.attackType, d.source, tick, d.prayerReduction, d.playerPosition)
    const stamina = p.activeEffects.some((e) => e.type === 'stamina')
    p.runEnergy = updateRunEnergy(p.runEnergy, { isRunning: p.isRunning, agility: 99, weight: p.weight, drainMultiplier: stamina ? 0.3 : 1 })
    if (p.runEnergy.energy <= 0 && p.isRunEnabled) p.isRunEnabled = false
    this.adjudicateNpcDefeats(postCtx)
    this.pruneDeadActors(tick)
    this.lastEvents = this.tickEvents.flush()
  }

  private recordHistory(history: Map<number, Tile>, tick: number, pos: Tile): void {
    history.set(tick, pos)
    history.delete(tick - 50)
  }

  private processNpcQueueBand(): void {
    const bridge = this.pendingHitBridge()
    this.combatSystem.processPendingHits(this.world, bridge, 'npc')
    this.combatSystem.processBurnStacks(this.world, bridge)
    this.combatSystem.processNpcPoison(this.world, bridge)
  }

  /** scim `updateStationaryNpcTargetFacing`. */
  private updateStationaryNpcTargetFacing(): void {
    for (const npc of this.world.getNpcs()) {
      if (!npc.alive || npc.isMoving || npc.lockedFacing !== undefined) continue
      const id = npc.combat.targetId
      if (id === null) continue
      const t = this.world.actors.get(id)
      if (t?.alive) npc.facing = angleTowardActor(npc, t)
    }
  }

  
  private pruneDeadActors(tick: number): void {
    const due: NpcActor[] = []
    for (const a of this.world.actors.values()) {
      if (a.alive || a.kind !== 'npc') continue
      if (a.role !== 'boss' && a.despawnTick != null && tick - a.despawnTick >= 10) due.push(a)
    }
    for (const npc of due) {
      if (this.world.getNpc(npc.id) !== npc || npc.alive) continue
      this.world.actors.delete(npc.id)
      this.npcDefinitions.notifyDespawn(npc, this.npcDefinitionContext())
    }
  }

  
  private adjudicateNpcDefeats(ctx: EncounterContext): void {
    const defeats = this.pendingNpcDefeats
    this.pendingNpcDefeats = []
    if (!this.player().alive || this.failedCondition !== null) return
    for (const { actor, defeat } of defeats) {
      this.encounter.onNpcDefeated?.(defeat, ctx, 'encounter-owned')
      this.npcDefinitions.notifyDefeated(actor, defeat, 'encounter-owned', this.npcDefinitionContext())
    }
  }

  // -------------------------------------------------------------------------
  // Player timer b
  // -------------------------------------------------------------------------

  private processPlayerTimerBand(tick: number, prevTick: number, specAtStart: number): void {
    const p = this.player()
    this.processActiveEffects(tick)
    this.processPoison(tick)
    const drained = drainPrayer(p.prayerState, p.equipmentStats.prayer, tick)
    p.prayerState = drained.state
    if (drained.drained) this.finalizePrayerDepletion(tick)
    p.specialAttack = updateLightbearer(p.specialAttack, p.equipment.ring === LIGHTBEARER)
    p.specialAttack = this.mechanicsConfig.infiniteSpecialAttack ? fillSpecial(p.specialAttack) : regenerateSpecial(p.specialAttack, specAtStart)
    const heartBefore = p.combatTimers.saturatedHeartActiveTicks
    const markBefore = p.combatTimers.markOfDarknessActiveTicks
    p.combatTimers = tickCombatTimers(p.combatTimers)
    if (heartBefore > 0 && p.combatTimers.saturatedHeartActiveTicks === 0) {
      p.stats = { ...p.stats, magic: { ...p.stats.magic, current: p.stats.magic.max } }
      p.potionBoosts = p.potionBoosts.filter((b) => !(b.stat === 'magic' && b.isDivine))
      this.tickEvents.emit({ type: 'status_effect_expired', effect: 'saturated_heart' })
    }
    if (markBefore > 0 && p.combatTimers.markOfDarknessActiveTicks === 0) this.tickEvents.emit({ type: 'status_effect_expired', effect: 'mark_of_darkness' })
    const decay = decayBoosts(
      p.stats,
      p.potionBoosts,
      p.combatTimers.statBoostDecayTick,
      prevTick,
      preserveReady(p.prayerState, tick),
      p.combatTimers.statBoostDecayExtended,
    )
    p.stats = decay.stats
    p.potionBoosts = decay.potionBoosts
    p.combatTimers = { ...p.combatTimers, statBoostDecayTick: decay.nextDecayTick, statBoostDecayExtended: decay.decayExtended }
    this.syncVitalsToStats()
  }

  
  private processActiveEffects(tick: number): void {
    const p = this.player()
    if (p.activeEffects.length === 0) return
    const keep: typeof p.activeEffects = []
    for (const e of p.activeEffects) {
      if (e.startedTick === tick) {
        keep.push(e)
        continue
      }
      const left = e.ticksRemaining - 1
      if (left <= 0) {
        if (e.type === 'delayed_heal' && p.alive) {
          const healed = Math.min(p.vitals.maxHp, p.vitals.hp + (e.data?.amount ?? 0))
          p.vitals.hp = Math.max(p.vitals.hp, healed)
          this.syncVitalsToStats()
        }
        continue
      }
      if (e.type === 'prayer_regeneration' && (e.tickDuration - left) % 12 === 0) {
        p.prayerState = { ...p.prayerState, points: Math.min(p.prayerState.maxPoints, p.prayerState.points + 1) }
      }
      keep.push({ ...e, ticksRemaining: left })
    }
    p.activeEffects = keep
  }

  
  private processPoison(tick: number): void {
    const p = this.player()
    if (p.poisonState.poisonVarp === 0 || p.poisonState.startedTick === tick) return
    const counter = p.poisonState.poisonTickCounter - 1
    if (counter > 0) {
      p.poisonState = { ...p.poisonState, poisonTickCounter: counter }
      return
    }
    const r = stepPoison(p.poisonState)
    p.poisonState = { ...r.state, poisonTickCounter: 30 }
    if (r.damage <= 0) return
    const venom = isVenomVarp(r.state.poisonVarp)
    this.applyDamage(r.damage, 'typeless', venom ? 'Venom' : 'Poison', this.world.tick, undefined, undefined, venom ? 'venom' : 'poison')
  }

  // -------------------------------------------------------------------------
  // Damage bookkeeping
  // -------------------------------------------------------------------------

  
  private onCombatDamageApplied(r: DamageResult): void {
    const p = this.player()
    const fromPlayer = r.sourceId === PLAYER_ID
    const source = fromPlayer ? 'PlayerAttack' : this.encounter.getNpcDamageSourceLabel()
    const npc = this.world.getNpcs().find((n) => n.id === r.targetId)
    if (npc) this.npcDefinitions.notifyDamageResolved(npc, r, this.npcDefinitionContext())
    const sourceNpc = this.world.getNpc(r.sourceId)
    const expected = fromPlayer ? r.expectedHit : undefined
    this.damageHistory.push({
      tick: r.tick,
      source,
      ...(sourceNpc ? { sourceNpcTypeId: sourceNpc.npcTypeId } : {}),
      targetId: r.targetId,
      baseDamage: r.baseDamage,
      attackType: r.attackType,
      activePrayer: r.activePrayer,
      prayedCorrectly: r.prayedCorrectly,
      effectiveDamage: r.effectiveDamage,
      hpBefore: r.hpBefore,
      hpAfter: r.hpAfter,
      ...(expected === undefined ? {} : { expectedHit: expected }),
    })
    if (!this.mechanicsConfig.infiniteHealth && p.vitals.hp <= 0) {
      p.alive = false
      this.failedCondition = 'Death'
    }
    if (r.onKillEffect && r.hpAfter === 0 && fromPlayer) {
      const k = r.onKillEffect
      if (k.refundSpecEnergy) p.specialAttack = { ...p.specialAttack, energy: Math.min(100, p.specialAttack.energy + k.refundSpecEnergy) }
      if (k.reduceAttackDelayTicks) this.combatSystem.reduceNextAttackTick(p.id, k.reduceAttackDelayTicks, r.tick)
    }
    if (npc && r.hpBefore > 0 && r.hpAfter === 0 && fromPlayer) {
      const dc = deathChargeProc(p.specialAttack, p.combatTimers)
      if (dc) {
        p.specialAttack = dc.special
        p.combatTimers = dc.timers
      }
    }
    if (npc && r.hpBefore > 0 && r.hpAfter === 0) {
      markNpcDead(npc, r.tick)
      this.pendingNpcDefeats.push({ actor: npc, defeat: { npcId: npc.id, tick: r.tick } })
    }
    if (r.targetId === PLAYER_ID) {
      this.tryRedemption(r.tick)
      if (typeof r.applyPoison === 'number') this.applyPoisonToPlayer(r.applyPoison)
    }
    this.syncVitalsToStats()
  }

  /** scim engine `applyDamage`: hazards, poison and environmental damage to the player. */
  private applyDamage(
    baseDamage: number | readonly [number, number],
    style: DamageStyle,
    source: string,
    tick: number,
    reduction?: PrayerReduction,
    playerPosition?: Tile,
    hitsplat?: 'poison' | 'venom',
  ): void {
    const p = this.player()
    const rolled = typeof baseDamage === 'number' ? baseDamage : baseDamage[0] >= baseDamage[1] ? baseDamage[0] : baseDamage[0] + Math.floor(this.rollCombat() * (baseDamage[1] - baseDamage[0] + 1))
    let dmg = Math.max(0, Math.floor(rolled))
    const hpBefore = p.vitals.hp
    if (style === 'melee') dmg = Math.floor(dmg * powerOfDeathFactor(p, tick))
    const eff = applyProtection(dmg, style, p.activePrayer, reduction)
    if (!this.mechanicsConfig.infiniteHealth) {
      notePlayerDamage(p, eff)
      p.vitals.hp -= eff
      if (p.vitals.hp < 0) p.vitals.hp = 0
    }
    const prayedCorrectly = style === 'typeless' ? null : protects(style, p.activePrayer)
    this.damageHistory.push({
      tick,
      source,
      targetId: PLAYER_ID,
      baseDamage: dmg,
      attackType: style,
      activePrayer: p.activePrayer,
      prayedCorrectly,
      effectiveDamage: eff,
      hpBefore,
      hpAfter: p.vitals.hp,
    })
    const pos = playerPosition ?? p.position
    this.tickEvents.emit({
      type: 'hit_applied',
      targetId: PLAYER_ID,
      targetPosition: [pos[0], pos[1]],
      damage: eff,
      blocked: eff === 0,
      prayedCorrectly,
      attackKind: style === 'typeless' ? 'typeless' : style === 'magic' ? 'magic_shadow' : style === 'range' ? 'range_shadow' : 'melee_crush',
      accurate: true,
    })
    this.tickEvents.emit({ type: 'hitsplat_spawned', targetId: PLAYER_ID, amount: eff, hitsplatType: hitsplat ?? (eff > 0 ? 'damage' : 'block') })
    if (!this.mechanicsConfig.infiniteHealth && p.vitals.hp <= 0) {
      p.alive = false
      this.failedCondition = 'Death'
      this.tickEvents.emit({ type: 'actor_died', actorId: PLAYER_ID })
    }
    if (hitsplat !== 'poison' && hitsplat !== 'venom') this.tryRedemption(tick)
    this.syncVitalsToStats()
  }

  private applyPoisonToPlayer(severity: number): void {
    const p = this.player()
    const v = p.poisonState.poisonVarp
    if (v < 0 || isVenomVarp(v)) return
    const starting = v === 0
    p.poisonState = {
      ...p.poisonState,
      poisonVarp: Math.max(v, severity),
      ...(starting ? { poisonTickCounter: 30, startedTick: this.world.tick } : {}),
    }
  }

  
  private tryRedemption(tick: number): void {
    const p = this.player()
    if (!p.alive || p.activePrayer !== 'Redemption' || p.prayerState.points <= 0) return
    const { hp, maxHp } = p.vitals
    if (hp <= 0 || hp * 10 >= maxHp) return
    const heal = Math.floor(p.stats.prayer.max * REDEMPTION_HEAL_FRACTION)
    p.vitals.hp = Math.min(maxHp, hp + heal)
    this.finalizePrayerDepletion(tick)
    this.tickEvents.setTick(tick)
    this.tickEvents.emit({ type: 'player_graphic_applied', spotAnimId: VFX_PLAYER_REDEMPTION })
    this.syncVitalsToStats()
  }

  
  private finalizePrayerDepletion(tick: number): void {
    const p = this.player()
    p.prayerState = { ...p.prayerState, points: 0, drainCounter: 0, activePrayers: [], prayerActivationTicks: {} }
    p.activePrayer = null
    p.offensivePrayer = null
    p.independentPrayers = []
    p.quickPrayersActive = false
    this.tickEvents.setTick(tick)
    this.tickEvents.emit({ type: 'prayer_depleted', actorId: p.id })
  }

  /** scim: hitpoints and prayer stats mirror the vitals. */
  private syncVitalsToStats(): void {
    const p = this.player()
    p.stats = {
      ...p.stats,
      hitpoints: { current: p.vitals.hp, max: p.vitals.maxHp },
      prayer: { current: p.prayerState.points, max: p.prayerState.maxPoints },
    }
  }

  private rebuildActivePrayers(): void {
    const p = this.player()
    const list: PrayerId[] = []
    if (p.activePrayer && prayerCategory(p.activePrayer) === 'protection') list.push(p.activePrayer)
    if (p.offensivePrayer && prayerCategory(p.offensivePrayer) === 'offensive') list.push(p.offensivePrayer)
    for (const x of p.independentPrayers) if (prayerCategory(x) === 'independent') list.push(x)
    p.prayerState = { ...p.prayerState, activePrayers: list }
  }

  private enforceQuickPrayerInvariant(): void {
    const p = this.player()
    if (p.activePrayer === null && p.offensivePrayer === null && p.independentPrayers.length === 0) p.quickPrayersActive = false
  }

  // -------------------------------------------------------------------------
  // Input b
  // -------------------------------------------------------------------------

  private processInputBand(tick: number): void {
    const p = this.player()
    this.enforceQuickPrayerInvariant()
    const ops = p.pendingInputOps
    if (ops.length === 0) return
    p.pendingInputOps = []
    let attackOpSeen = false
    let untrackedUsed = false
    let failEmitted = false
    for (const op of ops) {
      switch (op.type) {
        case 'protection':
        case 'offensive':
        case 'independent':
        case 'quickPrayers':
          failEmitted = this.applyPrayerOp(op, tick, failEmitted)
          break
        case 'equip':
        case 'unequip':
        case 'equip_ammo':
        case 'unequip_ammo':
          this.applyEquipmentOp(op, attackOpSeen)
          break
        case 'use_item':
          untrackedUsed = this.applyItemOp(op, attackOpSeen, untrackedUsed)
          break
        case 'drop_item':
          this.applyDropOp(op.inventoryIndex, tick)
          break
        case 'special_attack_toggle':
          if (tryInstantSpecial(p, tick)) break
          if (p.equipment.weapon !== undefined && hasSpecialAttack(p.equipment.weapon)) p.isSpecialAttackActive = !p.isSpecialAttackActive
          break
        case 'run_toggle':
          p.ctrlClickOverride = false
          p.isRunEnabled = !p.isRunEnabled
          break
        case 'attack_target':
          setAttackTarget(p, this.world, op)
          p.pendingItemPickup = null
          attackOpSeen = true
          break
        case 'pickup_ground_item':
          p.pendingItemPickup = { groundItemId: op.groundItemId }
          break
      }
    }
  }

  
  private applyPrayerOp(op: PrayerOp, tick: number, failEmitted: boolean): boolean {
    const p = this.player()
    const r = applyPrayerOpsWithPoints(
      { protection: p.activePrayer, offensive: p.offensivePrayer, independent: p.independentPrayers, quickPrayersActive: p.quickPrayersActive },
      [op],
      p.prayerState.points > 0,
    )
    p.quickPrayersActive = r.quickPrayersActive
    let emitted = failEmitted
    if (r.rejected.length > 0 && !failEmitted) {
      this.tickEvents.setTick(tick)
      this.tickEvents.emit({ type: 'prayer_activation_failed', actorId: p.id, attemptedPrayer: r.rejected[0] ?? null })
      emitted = true
    }
    for (const t of r.transitions) {
      this.tickEvents.setTick(tick)
      this.tickEvents.emit({ type: 'prayer_changed', actorId: p.id, from: t.from, to: t.to })
    }
    const activated = r.activated.filter((x) => x === r.protection || x === r.offensive || r.independent.includes(x))
    if (activated.length > 0) {
      const ticks = { ...p.prayerState.prayerActivationTicks }
      for (const x of activated) ticks[x] = tick
      p.prayerState = { ...p.prayerState, prayerActivationTicks: ticks }
    }
    let changed = false
    if (r.protectionTouched && p.activePrayer !== r.protection) {
      p.activePrayer = r.protection
      changed = true
    }
    if (r.offensiveTouched && p.offensivePrayer !== r.offensive) {
      p.offensivePrayer = r.offensive
      changed = true
    }
    if (r.independentTouched) {
      const a = r.independent
      const b = p.independentPrayers
      if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
        p.independentPrayers = [...a]
        changed = true
      }
    }
    this.enforceQuickPrayerInvariant()
    if (changed) this.rebuildActivePrayers()
    return emitted
  }

  private isTwoHanded(id: number): boolean {
    if (!this.objTypeLoader) return false
    const obj = loadObj(this.objTypeLoader, id)
    return obj !== null && obj.wearPos2 === 5
  }

  /** scim `previewEquipFromInventoryState`. */
  private previewEquipFromInventory(inv: Inventory, eq: Equipment, index: number, slot: EquipSlot): { inventory: Inventory; equipment: Equipment } | null {
    const item = inv[index]
    if (!item) return null
    const out = [...inv]
    const twoHandedWeapon = slot === 'weapon' && this.isTwoHanded(item.id)
    const shieldWith2h = slot === 'shield' && eq.weapon !== undefined && this.isTwoHanded(eq.weapon)
    if (twoHandedWeapon) {
      const w = eq.weapon
      const s = eq.shield
      if (s !== undefined && countFreeSlots(inv, index) - (w === undefined ? 0 : 1) < 1) return null
      out[index] = w === undefined ? null : { id: w }
      if (s !== undefined) {
        const free = out.indexOf(null)
        if (free !== -1) out[free] = { id: s }
      }
      const next = { ...eq, weapon: item.id }
      delete next.shield
      return { inventory: out, equipment: next }
    }
    if (shieldWith2h) {
      const w = eq.weapon
      const s = eq.shield
      if (w !== undefined && countFreeSlots(inv, index) - (s === undefined ? 0 : 1) < 1) return null
      out[index] = s === undefined ? null : { id: s }
      if (w !== undefined) {
        const free = out.indexOf(null)
        if (free !== -1) out[free] = { id: w }
      }
      const next = { ...eq, shield: item.id }
      delete next.weapon
      return { inventory: out, equipment: next }
    }
    const old = eq[slot]
    out[index] = old === undefined ? null : { id: old }
    return { inventory: out, equipment: { ...eq, [slot]: item.id } }
  }

  
  private previewUnequip(inv: Inventory, eq: Equipment, slot: EquipSlot): { inventory: Inventory; equipment: Equipment } | null {
    const id = eq[slot]
    if (id === undefined) return null
    const free = inv.indexOf(null)
    if (free === -1) return null
    const out = [...inv]
    out[free] = { id }
    const next = { ...eq }
    delete next[slot]
    return { inventory: out, equipment: next }
  }

  /** scim `resolveQueuedEquipInventoryIndex`. */
  private resolveEquipIndex(inv: Inventory, index: number, itemId: number): number {
    return inv[index]?.id === itemId ? index : inv.findIndex((i) => i?.id === itemId)
  }

  
  private previewEquipmentOp(state: EquipmentPreview, op: InputOp): EquipmentPreview | null {
    switch (op.type) {
      case 'unequip': {
        const r = this.previewUnequip(state.inventory, state.equipment, op.slot as EquipSlot)
        return r ? { ...state, ...r } : null
      }
      case 'equip': {
        const idx = this.resolveEquipIndex(state.inventory, op.inventoryIndex, op.itemId)
        const r = this.previewEquipFromInventory(state.inventory, state.equipment, idx, op.slot as EquipSlot)
        return r ? { ...state, ...r } : null
      }
      case 'equip_ammo': {
        const idx = this.resolveEquipIndex(state.inventory, op.inventoryIndex, op.itemId)
        const item = state.inventory[idx]
        if (!item) return null
        const cur = state.combatSupplies.equippedAmmo
        const out = [...state.inventory]
        out[idx] = cur?.id === item.id || cur === null ? null : { ...cur }
        return { ...state, inventory: out, combatSupplies: { ...state.combatSupplies, equippedAmmo: { id: op.itemId } } }
      }
      case 'unequip_ammo': {
        const cur = state.combatSupplies.equippedAmmo
        if (cur === null) return null
        const free = state.inventory.indexOf(null)
        if (free === -1) return null
        const out = [...state.inventory]
        out[free] = { ...cur }
        return { ...state, inventory: out, combatSupplies: { ...state.combatSupplies, equippedAmmo: null } }
      }
      default:
        return state
    }
  }

  
  private applyEquipmentOp(op: InputOp, attackOpSeen: boolean): void {
    const p = this.player()
    const weaponBefore = p.equipment.weapon
    const r = this.previewEquipmentOp({ inventory: p.inventory, equipment: p.equipment, combatSupplies: p.combatSupplies }, op)
    if (!r) return
    p.inventory = r.inventory
    p.equipment = withoutUndefined(r.equipment)
    p.combatSupplies = r.combatSupplies
    if (op.type === 'equip') {
      this.tickEvents.emit({ type: 'item_equipped', slot: op.slot, itemId: op.itemId, equipSound: this.equipSoundKind(op.slot as EquipSlot, op.itemId) })
    }
    this.recalculateEquipmentStats()
    if (p.equipment.weapon !== weaponBefore) {
      p.isSpecialAttackActive = false
      this.syncAttackStyleForCurrentWeapon()
    }
    if (op.type === 'equip' || op.type === 'equip_ammo') {
      if (attackOpSeen) p.attackInteractionActive = false
      else p.attackTarget = null
    }
  }

  
  private equipSoundKind(slot: EquipSlot, itemId: number): string {
    if (slot === 'head') return 'helmet'
    if (slot === 'legs') return 'legs'
    if (slot === 'hands') return 'hands'
    if (slot === 'body') {
      if (!this.objTypeLoader) return 'fun'
      const obj = loadObj(this.objTypeLoader, itemId)
      if (!obj) return 'fun'
      const name = obj.name.toLowerCase()
      return !SOFT_WORDS.some((w) => name.includes(w)) && METAL_WORDS.some((w) => name.includes(w)) ? 'metal_body' : 'fun'
    }
    if (slot === 'weapon') {
      const cat = weaponCategoryKey(itemId)
      return cat === 'staff' || cat === 'powered_staff' ? 'staff' : 'fun'
    }
    return 'fun'
  }

  private itemActionState(tick: number): ItemActionState {
    const p = this.player()
    return {
      playerHP: p.vitals.hp,
      maxHP: p.vitals.maxHp,
      stats: p.stats,
      poisonState: p.poisonState,
      potionBoosts: p.potionBoosts,
      prayerState: p.prayerState,
      runEnergy: p.runEnergy,
      specialAttack: p.specialAttack,
      combatTimers: p.combatTimers,
      cooldownTracks: p.cooldownTracks,
      activeEffects: p.activeEffects,
      currentTick: tick,
    }
  }

  /** scim (no encounter item restrictions in this fight). */
  private resolveItemEffects(def: ConsumableDef, state: ItemActionState, holder: { equipment: Equipment; inventory: Inventory }): ItemActionState {
    return applyItemEffects(def.effects, state, { enhancedPrayerRestoration: hasEnhancedPrayerRestoration(holder.equipment, holder.inventory) })
  }

  /** scim: Vial Smasher removes the empty vial. */
  private consumeItem(inv: Inventory, index: number, def: ConsumableDef): Inventory {
    const rule: ConsumeRule =
      this.mechanicsConfig.vialSmasher === true && def.consume.type === 'replace' && def.consume.withId === 229 ? { type: 'remove' } : def.consume
    return consumeInventory(inv, index, rule)
  }

  
  private applyItemOp(op: Extract<InputOp, { type: 'use_item' }>, attackOpSeen: boolean, untrackedUsed: boolean): boolean {
    const p = this.player()
    if (attackOpSeen) p.attackInteractionActive = false
    const item = p.inventory[op.inventoryIndex]
    if (!item) return untrackedUsed
    const def = consumableDef(item.id, op.option)
    if (!def) return untrackedUsed
    const track = def.track
    const tracked = track !== undefined && (def.delayTicks ?? 0) > 0
    const tick = this.world.tick
    if ((tracked && !trackReady(p.cooldownTracks, track, tick)) || (track === undefined && untrackedUsed) || (def.minHpToUse !== undefined && p.vitals.hp < def.minHpToUse)) {
      return untrackedUsed
    }
    const before = this.itemActionState(tick)
    if (surgeBlocked(def.effects, before)) return untrackedUsed
    const after = this.resolveItemEffects(def, before, p)
    const changed = after !== before
    p.vitals.hp = after.playerHP
    p.vitals.maxHp = after.maxHP
    p.stats = after.stats
    p.poisonState = after.poisonState
    p.potionBoosts = after.potionBoosts
    p.prayerState = after.prayerState
    p.runEnergy = after.runEnergy
    p.specialAttack = after.specialAttack
    p.combatTimers = after.combatTimers
    p.activeEffects = after.activeEffects
    if (changed && def.effects.some((e) => e.op === 'self_damage' || e.op === 'self_damage_formula')) {
      const dmg = Math.max(0, before.playerHP - after.playerHP)
      notePlayerDamage(p, dmg)
      this.tickEvents.emit({ type: 'hitsplat_spawned', targetId: PLAYER_ID, amount: dmg, hitsplatType: dmg > 0 ? 'damage' : 'block' })
      this.selfDamageHitPending = true
    }
    p.inventory = this.consumeItem(p.inventory, op.inventoryIndex, def)
    if (tracked) {
      p.cooldownTracks = setTrack(p.cooldownTracks, track, tick, def.delayTicks ?? 0)
      this.tickEvents.emit({ type: 'item_consumed', track, itemId: item.id })
    }
    if (track !== undefined) this.combatSystem.extendNextAttackTickIfActive(p.id, tick, TRACK_ATTACK_DELAY[track])
    if (!attackOpSeen) p.attackTarget = null
    if (def.playerGraphic !== undefined && changed) this.tickEvents.emit({ type: 'player_graphic_applied', spotAnimId: def.playerGraphic })
    this.syncVitalsToStats()
    return untrackedUsed || track === undefined
  }

  private isStackable(id: number, quantity: number): boolean {
    if (!this.objTypeLoader) return quantity > 1
    const obj = loadObj(this.objTypeLoader, id)
    return obj ? isStackableObj(obj) : quantity > 1
  }

  
  private applyDropOp(index: number, tick: number): void {
    const p = this.player()
    const item = p.inventory[index]
    if (!item) return
    const quantity = item.quantity ?? 1
    const stackable = this.isStackable(item.id, quantity)
    const pos: Tile = [p.position[0], p.position[1]]
    p.inventory = removeFromInventory(p.inventory, index)
    const existing = stackable ? this.world.groundItems.findIndex((g) => g.itemId === item.id && g.position[0] === pos[0] && g.position[1] === pos[1]) : -1
    const g = existing === -1 ? undefined : this.world.groundItems[existing]
    if (g) this.world.groundItems[existing] = { ...g, quantity: g.quantity + quantity }
    else this.world.groundItems.push({ id: this.world.nextGroundItemId(), itemId: item.id, quantity, position: pos, droppedTick: tick })
    this.tickEvents.emit({ type: 'ground_item_dropped', itemId: item.id, quantity, position: pos })
    this.recalculateEquipmentStats()
  }

  
  private processItemPickup(): void {
    const p = this.player()
    const pending = p.pendingItemPickup
    if (!pending) return
    const idx = this.world.groundItems.findIndex((g) => g.id === pending.groundItemId)
    const g = idx === -1 ? undefined : this.world.groundItems[idx]
    if (!g) {
      p.pendingItemPickup = null
      return
    }
    if (p.position[0] !== g.position[0] || p.position[1] !== g.position[1]) return
    p.pendingItemPickup = null
    const inv = addToInventory(p.inventory, g.itemId, g.quantity, this.isStackable(g.itemId, g.quantity))
    if (!inv) return
    p.inventory = inv
    this.world.groundItems.splice(idx, 1)
    this.recalculateEquipmentStats()
    this.tickEvents.emit({ type: 'ground_item_taken', itemId: g.itemId, quantity: g.quantity, position: [g.position[0], g.position[1]] })
  }

  private recalculateEquipmentStats(): void {
    const p = this.player()
    if (this.objTypeLoader) {
      p.equipmentStats = computeEquipmentStats(p.equipment, this.objTypeLoader)
      p.weight = computeWeight(p.equipment, p.inventory, this.objTypeLoader)
    } else {
      p.equipmentStats = emptyEquipmentStats()
      p.weight = 0
    }
  }

  private syncAttackStyleForCurrentWeapon(): void {
    const p = this.player()
    const cat = weaponCategoryKey(p.equipment.weapon)
    const remembered = this.attackStylePerCategory[cat]
    p.selectedAttackStyleIndex =
      remembered !== undefined && weaponCategory(p.equipment.weapon).styles[remembered] !== undefined
        ? remembered
        : defaultStyleIndex(p.equipment.weapon, p.combatSupplies.spellbook)
  }

  // -------------------------------------------------------------------------
  // Public commands
  // -------------------------------------------------------------------------

  private queueInput(op: InputOp): void {
    this.player().pendingInputOps.push(op)
  }

  setCtrlClickOverride(ctrl: boolean): void {
    this.player().ctrlClickOverride = ctrl
  }

  applyAction(action: { attackTarget: string | null; manualCastSpell?: string | null }): void {
    this.queueAttackTarget(action.attackTarget, action.manualCastSpell ?? null)
  }

  queueAttackTarget(targetId: string | null, manualCastSpell: string | null = null): void {
    this.queueInput({ type: 'attack_target', targetId, manualCastSpell })
  }

  queueProtectionPrayer(prayer: PrayerId | null): void {
    this.queueInput({ type: 'protection', prayer })
  }

  queueOffensivePrayer(prayer: PrayerId | null): void {
    this.queueInput({ type: 'offensive', prayer })
  }

  queueIndependentPrayer(prayer: PrayerId): void {
    this.queueInput({ type: 'independent', prayer })
  }

  queueQuickPrayerToggle(selections: PrayerId[]): void {
    this.queueInput({ type: 'quickPrayers', selections: [...selections] })
  }

  queueEquipFromInventory(inventoryIndex: number, itemId: number, slot: EquipSlot): void {
    this.queueInput({ type: 'equip', inventoryIndex, itemId, slot })
  }

  queueEquipAmmoFromInventory(inventoryIndex: number, itemId: number): void {
    this.queueInput({ type: 'equip_ammo', inventoryIndex, itemId })
  }

  queueUnequip(slot: EquipSlot): void {
    this.queueInput({ type: 'unequip', slot })
  }

  queueUnequipAmmo(): void {
    this.queueInput({ type: 'unequip_ammo' })
  }

  queueItemAction(inventoryIndex: number, option: ItemOption = 'default'): void {
    this.queueInput({ type: 'use_item', inventoryIndex, option })
  }

  queueDropItem(inventoryIndex: number): void {
    this.queueInput({ type: 'drop_item', inventoryIndex })
  }

  queuePickupGroundItem(groundItemId: string): void {
    this.queueInput({ type: 'pickup_ground_item', groundItemId })
  }

  swapInventorySlots(a: number, b: number): void {
    const p = this.player()
    if (a === b || a < 0 || a >= p.inventory.length || b < 0 || b >= p.inventory.length) return
    const inv = [...p.inventory]
    const tmp = inv[a] ?? null
    inv[a] = inv[b] ?? null
    inv[b] = tmp
    p.inventory = inv
  }

  queueSpecialAttackToggle(): void {
    this.queueInput({ type: 'special_attack_toggle' })
  }

  queueRunToggle(): void {
    this.queueInput({ type: 'run_toggle' })
  }

  setSelectedAttackStyleIndex(index: number): void {
    const p = this.player()
    p.selectedAttackStyleIndex = index
    this.attackStylePerCategory[weaponCategoryKey(p.equipment.weapon)] = index
  }

  setAttackStylePerCategory(map: Record<string, number>): void {
    this.attackStylePerCategory = { ...map }
    this.syncAttackStyleForCurrentWeapon()
  }

  getAttackStylePerCategory(): Record<string, number> {
    return { ...this.attackStylePerCategory }
  }

  setSelectedSpell(spell: string | null): void {
    const p = this.player()
    p.combatSupplies = { ...p.combatSupplies, selectedSpell: spell }
  }

  /** Arceuus self-spells. */
  castMarkOfDarkness(): void {
    const p = this.player()
    if (!this.canCastSelfSpell('Mark of Darkness')) return
    const t = castMarkOfDarkness(p.stats.magic.max, p.equipment.weapon === PURGING_STAFF, p.combatTimers)
    if (!t) return
    p.combatTimers = t
    this.tickEvents.emit({ type: 'spell_self_cast', animationId: MOD_ANIM, spotAnimId: 1852 })
  }

  castDeathCharge(): void {
    const p = this.player()
    if (!this.canCastSelfSpell('Death Charge')) return
    const double = this.mechanicsConfig.doubleDeathCharge === true
    const t = castDeathCharge(p.combatTimers, double)
    if (!t) return
    p.combatTimers = t
    this.tickEvents.emit({ type: 'spell_self_cast', animationId: MOD_ANIM, spotAnimId: double ? 3288 : 1854 })
  }

  private canCastSelfSpell(name: string): boolean {
    const p = this.player()
    return (
      p.combatSupplies.spellbook === 'arceuus' &&
      checkSpell(name, { equipment: p.equipment, inventory: p.inventory, runePouch: p.combatSupplies.runePouch, magicLevel: p.stats.magic.current }).ok
    )
  }

  // --- run setup ------------------------------------------------------------------

  setInventory(inventory: Inventory): void {
    this.player().inventory = inventory.map((i) => (i ? { ...i } : null))
    this.recalculateEquipmentStats()
  }

  setEquipment(equipment: Equipment): void {
    const p = this.player()
    const before = p.equipment.weapon
    p.equipment = withoutUndefined(equipment)
    this.recalculateEquipmentStats()
    if (p.equipment.weapon !== before) {
      p.isSpecialAttackActive = false
      this.syncAttackStyleForCurrentWeapon()
    }
  }

  setCombatSupplies(supplies: CombatSupplies): void {
    const p = this.player()
    const book = p.combatSupplies.spellbook
    p.combatSupplies = copySupplies(supplies)
    if (p.combatSupplies.spellbook !== book) this.syncAttackStyleForCurrentWeapon()
  }

  /** Applies inventory, equipment and supplies now and remembers them for `reset`. */
  setLoadout(loadout: Loadout): void {
    this.storedLoadout = {
      equipment: { ...loadout.equipment },
      inventory: loadout.inventory.map((i) => (i ? { ...i } : null)),
      supplies: copySupplies(loadout.supplies),
    }
    this.setInventory(loadout.inventory)
    this.setEquipment(loadout.equipment)
    this.setCombatSupplies(loadout.supplies)
  }

  setPlayerStats(baseLevels: Record<SkillName, number>): void {
    this.configuredLevels = sanitizeLevels(baseLevels)
    const p = this.player()
    p.stats = statsFromLevels(this.configuredLevels)
    p.vitals = { hp: p.stats.hitpoints.current, maxHp: p.stats.hitpoints.max }
    p.prayerState = { points: p.stats.prayer.current, maxPoints: p.stats.prayer.max, drainCounter: 0, activePrayers: [], prayerActivationTicks: {} }
  }

  setMechanicsConfig(config: Partial<MechanicsConfig>): void {
    this.mechanicsConfig = this.mergeMechanics(this.mechanicsConfig, config)
    if (this.world.tick === 0) this.encounter.configureRunStart?.(this.mechanicsConfig)
  }

  /** scim: boost/timed/heart/cure effects of each distinct inventory item. */
  applyPrepotEffects(): void {
    this.prepotApplied = true
    if (!this.mechanicsConfig.autoPrepot) return
    const p = this.player()
    const seen = new Set<number>()
    for (const item of p.inventory) {
      if (!item || seen.has(item.id)) continue
      const def = consumableDef(item.id)
      if (!def || !def.effects.some((e) => PREPOT_OPS.has(e.op))) continue
      seen.add(item.id)
      const effects = def.effects.filter((e) => PREPOT_OPS.has(e.op))
      if (effects.length === 0) continue
      const st = applyItemEffects(effects, this.itemActionState(this.world.tick))
      p.vitals.hp = st.playerHP
      p.vitals.maxHp = st.maxHP
      p.stats = st.stats
      p.poisonState = st.poisonState
      p.potionBoosts = st.potionBoosts
      p.prayerState = st.prayerState
      p.runEnergy = st.runEnergy
      p.combatTimers = st.combatTimers
      p.activeEffects = st.activeEffects
    }
    if (p.equipment.weapon === PURGING_STAFF || p.inventory.some((i) => i !== null && i.id === PURGING_STAFF)) {
      const t = castMarkOfDarkness(p.stats.magic.max, true, p.combatTimers)
      if (t) p.combatTimers = t
    }
    this.syncVitalsToStats()
  }

  /** scim + the UI restart: re-seed, rebuild, re-apply the stored loadout and prepot. */
  reset(options?: { combatSeed?: number; encounterSeed?: number }): void {
    this.encounter.reset(options?.encounterSeed === undefined ? {} : { encounterSeed: options.encounterSeed })
    this.combatSeed = resolveSeed(options?.combatSeed)
    this.combatRandom = mulberry32(this.combatSeed)
    const start = this.encounter.getDefaultPlayerStart()
    this.runStartPosition = [start[0], start[1]]
    const keptInventory = this.player().inventory
    const keptSupplies = copySupplies(this.player().combatSupplies)
    const keptEquipment = { ...this.player().equipment }
    this.failedCondition = null
    this.prepotApplied = false
    this.pendingNpcDefeats = []
    this.selfDamageHitPending = false
    this.npcDefinitions = this.encounter.getNpcDefinitions()
    this.damageHistory = []
    this.combatSystem.reset()
    this.applyArena()
    this.initializeWorld(start, keptInventory)
    const initEvents = this.lastEvents
    const loadout = this.storedLoadout ?? { inventory: keptInventory, equipment: keptEquipment, supplies: keptSupplies }
    this.setInventory(loadout.inventory)
    this.setEquipment(loadout.equipment)
    this.setCombatSupplies(loadout.supplies)
    this.applyPrepotEffects()
    this.lastEvents = [...initEvents, ...this.tickEvents.flush()]
  }

  /** Practice-panel commands, applied immediately. */
  executeEncounterCommand(command: EncounterCommand): boolean {
    const p = this.player()
    const result = this.encounter.executeCommand?.(
      command,
      {
        playerPos: [p.position[0], p.position[1]],
        tick: this.world.tick,
        world: this.world,
        tickEvents: this.tickEvents,
        arena: this.arenaInstance,
        spawnNpc: (n) => this.spawnEncounterNpc(n),
        despawnNpc: (id) => this.despawnEncounterNpc(id),
      },
      this.mechanicsConfig,
    )
    if (!result) return false
    for (const e of result.gameEvents ?? []) this.tickEvents.emit(e)
    const flushed = this.tickEvents.flush()
    if (flushed.length > 0) this.lastEvents = [...this.lastEvents, ...flushed]
    return true
  }

  /** Clears the fail state of a practice run (used by the wave restart command). */
  clearDefeatBookkeeping(): void {
    this.pendingNpcDefeats = []
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getItemEquipSlot(itemId: number): EquipSlot | null {
    if (!this.objTypeLoader) return null
    const obj = loadObj(this.objTypeLoader, itemId)
    if (!obj) return null
    const equippable = obj.wearPos1 !== -1 || obj.maleModel !== -1 || obj.femaleModel !== -1
    return equippable ? (WEAR_POS_TO_SLOT[obj.wearPos1] ?? null) : null
  }

  isAmmoItem(itemId: number): boolean {
    if (!this.objTypeLoader) return false
    const obj = loadObj(this.objTypeLoader, itemId)
    if (!obj) return false
    const equippable = obj.wearPos1 !== -1 || obj.maleModel !== -1 || obj.femaleModel !== -1
    return equippable && obj.wearPos1 === AMMO_WEAR_POS
  }

  /** scim `getAdjustedTheoreticalDps` ( ->). */
  getAdjustedTheoreticalDps(): DpsProjection | null {
    const p = this.player()
    const npcs = this.world.getNpcs()
    const target = p.attackTarget ? (npcs.find((n) => n.id === p.attackTarget) ?? npcs.find((n) => n.role === 'boss')) : npcs.find((n) => n.role === 'boss')
    if (!target || target.vitals.hp <= 0) return null
    const params = playerCombatParams(p)
    const style = formulaStyleOf(p.equipment.weapon, p.selectedAttackStyleIndex)
    const spell = autocastSpell({
      weaponId: p.equipment.weapon,
      selectedStyleIndex: p.selectedAttackStyleIndex,
      selectedSpell: p.combatSupplies.selectedSpell,
      spellbook: p.combatSupplies.spellbook,
    })
    const resources = resolveAttackResources({
      weaponId: p.equipment.weapon,
      equipment: p.equipment,
      inventory: p.inventory,
      formulaStyle: style,
      supplies: p.combatSupplies,
      magicLevel: p.stats.magic.current,
      activeSpell: spell?.name ?? null,
    })
    const plan = buildAttackPlan({
      player: p,
      target,
      formulaStyle: style,
      resources,
      attackSpeedTicks: params.attackSpeed,
      delivery: { style: damageStyleOf(style), attackKind: attackKindOf(style), impactDelayTicks: 0 },
      application: { outgoingDamageMultiplier: 1, specialAttackDamageMultiplier: 1 },
      manualCast: false,
      isSpecialAttack: false,
      standardAccuracyMode: usesConflictionRolls(p.equipment, style, resources) ? 'steady_state' : 'single_roll',
      lookupItemStats: (id) => this.lookupItemStats(id),
    })
    if (plan === null || plan.kind === 'unsupported') return null
    const proj = projectPlan(plan)
    return {
      style,
      dps: proj.appliedDamagePerSecond,
      maxHit: proj.maximumAppliedDamagePerAttack,
      accuracy: proj.hits[0]?.accuracyProbability ?? 0,
      attackSpeedTicks: plan.attackSpeedTicks,
      attackIntervalSeconds: plan.attackSpeedTicks * 0.6,
      expectedAppliedDamagePerAttack: proj.expectedAppliedDamagePerAttack,
      outgoingDamageMultiplier: plan.application.outgoingDamageMultiplier,
      specialAttackDamageMultiplier: plan.application.specialAttackDamageMultiplier,
      baseAttackRoll: plan.diagnostics.baseAttackRoll,
      baseDefenceRoll: plan.diagnostics.baseDefenceRoll,
      baseMaxHit: plan.diagnostics.baseMaxHit,
      profileMaxHit: plan.diagnostics.profileMaxHit,
      hits: proj.hits.map((h, i) => ({
        planIndex: h.planIndex,
        accuracyProbability: h.accuracyProbability,
        gateProbability: h.gateProbability,
        expectedAppliedDamage: h.expectedAppliedDamage,
        maximumAppliedDamage: h.maximumAppliedDamage,
        procChance: plan.hits[i]?.proc?.chance ?? 0,
      })),
    }
  }

  /** scim `projectSpecialAttackState`. */
  private projectSpecialAttackState(): boolean {
    const p = this.player()
    let active = p.isSpecialAttackActive
    let holder: EquipmentPreview = { inventory: p.inventory, equipment: p.equipment, combatSupplies: p.combatSupplies }
    let st = this.itemActionState(this.world.tick + 1)
    let untracked = false
    for (const op of p.pendingInputOps) {
      switch (op.type) {
        case 'equip':
        case 'unequip':
        case 'equip_ammo':
        case 'unequip_ammo': {
          const next = this.previewEquipmentOp(holder, op)
          if (next) {
            if (next.equipment.weapon !== holder.equipment.weapon) active = false
            holder = next
          }
          break
        }
        case 'special_attack_toggle': {
          const inst = instantSpecial(holder.equipment.weapon, st.specialAttack, 1)
          if (inst !== null) {
            active = false
            st = { ...st, specialAttack: inst.specialAttack }
            break
          }
          if (holder.equipment.weapon !== undefined && hasSpecialAttack(holder.equipment.weapon)) active = !active
          break
        }
        case 'drop_item':
          holder = { ...holder, inventory: removeFromInventory(holder.inventory, op.inventoryIndex) }
          break
        case 'use_item': {
          const item = holder.inventory[op.inventoryIndex]
          if (!item) break
          const def = consumableDef(item.id, op.option)
          if (!def) break
          const track = def.track
          const delay = def.delayTicks ?? 0
          if (
            (track === undefined && untracked) ||
            (def.minHpToUse !== undefined && st.playerHP < def.minHpToUse) ||
            (track !== undefined && delay > 0 && !trackReady(st.cooldownTracks, track, st.currentTick)) ||
            surgeBlocked(def.effects, st)
          ) {
            break
          }
          st = this.resolveItemEffects(def, st, holder)
          holder = { ...holder, inventory: this.consumeItem(holder.inventory, op.inventoryIndex, def) }
          if (track !== undefined && delay > 0) st = { ...st, cooldownTracks: setTrack(st.cooldownTracks, track, st.currentTick, delay) }
          untracked ||= track === undefined
          break
        }
        default:
          break
      }
    }
    return active
  }

  /** scim + `pendingSpecialAttackActive`. */
  getState(): SimState {
    const p = this.player()
    const npcs = this.world.getNpcs()
    const boss = npcs.find((n) => n.role === 'boss') ?? npcs[0] ?? null
    const ordered = boss ? [boss, ...npcs.filter((n) => n.id !== boss.id)] : npcs
    const npcStates: NpcState[] = ordered.map((n) => {
      const targetId = n.combat.targetId === null ? null : this.world.actors.get(n.combat.targetId)?.alive === true ? n.combat.targetId : null
      const timer =
        (n.alive ? this.npcDefinitions.attackTimer(n, this.npcDefinitionContext()) : null) ??
        (!n.alive || targetId === null || n.combat.attackSpeed <= 0 || n.combat.nextActionTick <= 0
          ? null
          : { nextAttackTick: n.combat.nextActionTick, attackSpeed: n.combat.attackSpeed })
      return {
        id: n.id,
        npcTypeId: n.npcTypeId,
        archetypeId: n.archetypeId,
        role: n.role,
        alive: n.alive,
        position: n.position,
        previousPosition: n.previousPosition,
        facingAngle: n.facing,
        ...(n.lockedFacing === undefined ? {} : { lockedFacing: n.lockedFacing }),
        ...(n.actionFacing === undefined ? {} : { actionFacing: n.actionFacing }),
        combatTargetId: targetId,
        ...(timer ? { attackTimer: timer } : {}),
        size: n.size,
        hp: n.vitals.hp,
        maxHp: n.vitals.maxHp,
        ...(n.outline === undefined ? {} : { outline: n.outline }),
        ...(n.spawnTick === undefined ? {} : { spawnTick: n.spawnTick }),
        ...(n.despawnTick === undefined ? {} : { despawnTick: n.despawnTick }),
        history: n.history,
      }
    })
    const first = npcStates[0]
    const pending = projectPendingPrayers({
      start: { protection: p.activePrayer, offensive: p.offensivePrayer, independent: p.independentPrayers, quickPrayersActive: p.quickPrayersActive },
      hasPrayerPoints: p.prayerState.points > 0,
      ops: p.pendingInputOps,
      inventory: p.inventory,
      equipment: p.equipment,
      cooldownTracks: p.cooldownTracks,
      prayerLevel: p.stats.prayer.max,
      playerHp: p.vitals.hp,
      inputTick: this.world.tick + 1,
      restoreRules: { allowed: true },
    })
    const runToggles = p.pendingInputOps.filter((o) => o.type === 'run_toggle').length
    const specToggles = p.pendingInputOps.filter((o) => o.type === 'special_attack_toggle').length
    const next = this.combatSystem.getNextAttackTick(p.id)
    const boosts: PotionBoost[] = p.potionBoosts.map((b) => ({
      stat: b.stat,
      amount: b.boostAmount,
      boostAmount: b.boostAmount,
      isDivine: b.isDivine,
      ticksRemaining: b.ticksRemaining,
    }))
    const stats = {
      attack: { ...p.stats.attack },
      strength: { ...p.stats.strength },
      defence: { ...p.stats.defence },
      ranged: { ...p.stats.ranged },
      magic: { ...p.stats.magic },
      prayer: { ...p.stats.prayer },
      hitpoints: { ...p.stats.hitpoints },
    }
    return {
      currentTick: this.world.tick,
      playerPosition: p.position,
      playerPreviousPosition: p.previousPosition,
      playerMovementPath: p.movementPath,
      playerFacingAngle: p.facing,
      playerIsMoving: p.isMoving,
      playerIsRunning: p.isRunning,
      primaryNpcPosition: first?.position ?? [0, 0],
      primaryNpcPreviousPosition: first?.previousPosition ?? [0, 0],
      primaryNpcFacingAngle: first?.facingAngle ?? 0,
      primaryNpcSize: first?.size ?? 1,
      playerOutline: p.outline,
      npcs: npcStates,
      encounter: this.encounter.getSnapshot({ tick: this.world.tick, mechanics: this.mechanicsConfig, world: this.world }),
      encounterOutcome: { ...this.encounter.getOutcome() },
      isAlive: p.alive,
      activePrayer: p.activePrayer,
      offensivePrayer: p.offensivePrayer,
      independentPrayers: [...p.independentPrayers],
      failedCondition: this.failedCondition,
      playerHistory: p.history,
      playerHP: p.vitals.hp,
      maxHP: p.vitals.maxHp,
      poisonVarp: p.poisonState.poisonVarp,
      poisonTickCounter: p.poisonState.poisonTickCounter,
      damageHistory: this.damageHistory.slice(),
      stats,
      specialAttack: { ...p.specialAttack },
      combatTimers: { ...p.combatTimers },
      potionBoosts: boosts,
      inventory: p.inventory.map((i) => (i ? { ...i } : null)),
      groundItems: this.world.groundItems.map((g) => ({ ...g, position: [g.position[0], g.position[1]] as Tile })),
      isRunEnabled: runToggles % 2 === 1 ? !p.isRunEnabled : p.isRunEnabled,
      isSpecialAttackActive: p.isSpecialAttackActive,
      pendingSpecialAttackActive: this.projectSpecialAttackState(),
      pendingSpecialAttackToggles: specToggles,
      pendingProtectionPrayer: [pending.protectionTouched, pending.protection],
      pendingOffensivePrayer: [pending.offensiveTouched, pending.offensive],
      pendingIndependentPrayers: [pending.independentTouched, [...pending.independent]],
      quickPrayersActive: pending.quickPrayersActive,
      runEnergy: { ...p.runEnergy },
      equipmentStats: { ...p.equipmentStats },
      prayerState: { ...p.prayerState, activePrayers: [...p.prayerState.activePrayers], prayerActivationTicks: { ...p.prayerState.prayerActivationTicks } },
      playerEquipment: { ...p.equipment },
      playerCombatSupplies: copySupplies(p.combatSupplies),
      cooldownTracks: { ...p.cooldownTracks },
      mechanicsConfig: { ...this.mechanicsConfig },
      attackTarget: p.attackTarget,
      lastAttackTarget: p.lastAttackTarget ?? null,
      selectedAttackStyleIndex: p.selectedAttackStyleIndex,
      playerAttackCooldown: next === undefined ? 0 : Math.max(0, next - this.world.tick),
      playerNextAttackTick: next ?? -1,
      playerAttackSpeed: this.combatSystem.getScheduledAttackCycle(p.id) ?? playerCombatParams(p).attackSpeed,
      introActive: false,
    }
  }

  /** Whether auto-prepot ran for the current run. */
  get wasPrepotApplied(): boolean {
    return this.prepotApplied
  }

  get startPosition(): Tile {
    return this.runStartPosition
  }
}
