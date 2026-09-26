/**
 * Public contract of the simulation engine (src/sim).
 *
 * This file is the boundary between the deterministic engine and everything
 * that presents it (renderer, audio, UI, input driver). It mirrors scim.gg's
 * engine surface: the state snapshot is scim's projection, the events are its tick-event bus payloads (* 02, 04), and the command methods are the engine calls its UI
 * makes.
 *
 * Presentation code must only use what is declared here. The engine may add
 * fields, but must not rename or remove any without updating every consumer.
 *
 * Conventions: tiles are map-square-local [x, y] (x east, y north) in the
 * Inferno map square 35,83 (region 9043); an actor's position is its SW tile.
 * Facing is 0..2047 with 0 = south, 512 = west, 1024 = north, 1536 = east.
 * One tick = 600 ms = 30 client cycles of 20 ms.
 */

export type Tile = readonly [number, number]

// ---------------------------------------------------------------------------
// Prayers, skills, equipment
// ---------------------------------------------------------------------------

/** scim's prayer enum values. */
export type PrayerId =
  | 'ProtectMagic'
  | 'ProtectRange'
  | 'ProtectMelee'
  | 'Redemption'
  | 'Piety'
  | 'Rigour'
  | 'Augury'
  | 'EagleEye'
  | 'MysticMight'
  | 'Deadeye'
  | 'MysticVigour'
  | 'Preserve'

export type SkillName = 'attack' | 'strength' | 'defence' | 'ranged' | 'magic' | 'prayer' | 'hitpoints'

export interface SkillLevel {
  current: number
  max: number
}

export type PlayerStats = Record<SkillName, SkillLevel>

/** Canonical equipment slots (ammo is not a slot; it lives in combat supplies). */
export type EquipSlot = 'head' | 'cape' | 'amulet' | 'weapon' | 'body' | 'shield' | 'legs' | 'hands' | 'boots' | 'ring'

export const EQUIP_SLOTS: readonly EquipSlot[] = ['head', 'cape', 'amulet', 'weapon', 'body', 'shield', 'legs', 'hands', 'boots', 'ring']

export type Equipment = Partial<Record<EquipSlot, number>>

export interface InventoryItem {
  id: number
  /** Missing means 1. */
  quantity?: number
}

/** Always 28 entries. */
export type Inventory = (InventoryItem | null)[]

export type Spellbook = 'standard' | 'ancient' | 'lunar' | 'arceuus'

export interface RunePouch {
  kind: 'standard' | 'divine'
  slots: ({ id: number } | null)[]
}

export interface CombatSupplies {
  equippedAmmo: { id: number; quantity?: number } | null
  quiverAmmo: { id: number; quantity?: number } | null
  runePouch: RunePouch | null
  blowpipe: { id: number } | null
  selectedSpell: string | null
  spellbook: Spellbook
}

export interface Loadout {
  equipment: Equipment
  inventory: Inventory
  supplies: CombatSupplies
}

/** Summed equipment bonuses. */
export interface EquipmentStats {
  attackStab: number
  attackSlash: number
  attackCrush: number
  attackMagic: number
  attackRanged: number
  defenceStab: number
  defenceSlash: number
  defenceCrush: number
  defenceMagic: number
  defenceRanged: number
  meleeStrength: number
  rangedStrength: number
  magicDamage: number
  prayer: number
  attackSpeed: number
  attackRange: number
}

export interface PrayerState {
  points: number
  maxPoints: number
  drainCounter: number
  activePrayers: PrayerId[]
  prayerActivationTicks: Partial<Record<PrayerId, number>>
}

export interface SpecialAttackState {
  energy: number
  regenTickCounter: number
  lightbearerEquipped: boolean
}

export interface RunEnergyState {
  /** 0..10000; the orb shows floor(energy / 100). */
  energy: number
}

export interface PotionBoost {
  stat: SkillName
  amount: number
  isDivine?: boolean
  [extra: string]: unknown
}

export interface CooldownTracks {
  food: number
  potion: number
  combo_food: number
}

// ---------------------------------------------------------------------------
// Mechanics toggles (Configure dialog / Practice panel)
// ---------------------------------------------------------------------------

export interface MechanicsConfig {
  infiniteHealth: boolean
  infiniteSpecialAttack: boolean
  autoPrepot: boolean
  doubleDeathCharge: boolean
  deadeyeMysticVigour: boolean
  vialSmasher: boolean
  /** Triple-Jad specific toggles (our additions) live under their own keys. */
  [key: string]: boolean | string | number
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export type NpcRole = 'boss' | 'npc' | 'minion'

export interface NpcAttackTimerState {
  nextAttackTick: number
  attackSpeed: number
}

export interface NpcState {
  id: string
  npcTypeId: number
  archetypeId: string
  role: NpcRole
  alive: boolean
  position: Tile
  previousPosition: Tile
  facingAngle: number
  lockedFacing?: number
  actionFacing?: number
  /** Resolved combat target actor id (player id 'player' or an npc id). */
  combatTargetId: string | null
  attackTimer?: NpcAttackTimerState
  size: number
  hp: number
  maxHp: number
  outline?: unknown
  spawnTick?: number
  despawnTick?: number
  /** tick -> position, last 50 ticks. */
  history: ReadonlyMap<number, Tile>
}

export type OutcomePhase = 'active' | 'resolving' | 'victory'

export interface EncounterOutcome {
  phase: OutcomePhase
  decisiveTick?: number
  completionTick?: number
  primaryActorId?: string
  completionActorIds?: string[]
}

/** Encounter-specific HUD data (scim, e.g. Zuk's set timer). */
export interface EncounterSnapshot {
  kind: string
  state: Record<string, unknown>
  visuals: Record<string, unknown>
}

export interface DamageHistoryEntry {
  tick: number
  source: string
  sourceNpcTypeId?: number
  targetId: string
  baseDamage: number
  attackType: string
  activePrayer: PrayerId | null
  prayedCorrectly: boolean | null
  effectiveDamage: number
  hpBefore: number
  hpAfter: number
  expectedHit?: number
}

export interface GroundItem {
  id: string
  itemId: number
  quantity: number
  position: Tile
  droppedTick: number
}

export interface SimState {
  currentTick: number
  playerPosition: Tile
  playerPreviousPosition: Tile
  playerMovementPath: Tile[]
  playerFacingAngle: number
  playerIsMoving: boolean
  playerIsRunning: boolean
  primaryNpcPosition: Tile
  primaryNpcPreviousPosition: Tile
  primaryNpcFacingAngle: number
  primaryNpcSize: number
  playerOutline?: unknown
  /** Boss first (none in triple Jad), then every NPC in world insertion order. */
  npcs: NpcState[]
  encounter: EncounterSnapshot
  encounterOutcome: EncounterOutcome
  isAlive: boolean
  activePrayer: PrayerId | null
  offensivePrayer: PrayerId | null
  independentPrayers: PrayerId[]
  failedCondition: string | null
  playerHistory: ReadonlyMap<number, Tile>
  playerHP: number
  maxHP: number
  poisonVarp: number
  poisonTickCounter: number
  damageHistory: readonly DamageHistoryEntry[]
  stats: PlayerStats
  specialAttack: SpecialAttackState
  combatTimers: Record<string, number | boolean>
  potionBoosts: PotionBoost[]
  inventory: Inventory
  groundItems: GroundItem[]
  /** Projected: includes queued-but-unprocessed run toggles. */
  isRunEnabled: boolean
  isSpecialAttackActive: boolean
  /** Projected spec toggle state including queued toggles (scim `projectSpecialAttackState`). */
  pendingSpecialAttackActive: boolean
  pendingSpecialAttackToggles: number
  /** [touched, prayer] projections including queued prayer ops. */
  pendingProtectionPrayer: [boolean, PrayerId | null]
  pendingOffensivePrayer: [boolean, PrayerId | null]
  pendingIndependentPrayers: [boolean, PrayerId[]]
  quickPrayersActive: boolean
  runEnergy: RunEnergyState
  equipmentStats: EquipmentStats
  prayerState: PrayerState
  playerEquipment: Equipment
  playerCombatSupplies: CombatSupplies
  cooldownTracks: CooldownTracks
  mechanicsConfig: MechanicsConfig
  attackTarget: string | null
  lastAttackTarget: string | null
  selectedAttackStyleIndex: number
  playerAttackCooldown: number
  playerNextAttackTick: number | undefined
  playerAttackSpeed: number | undefined
  introActive: boolean
}

// ---------------------------------------------------------------------------
// Tick events (every event carries tick + eventId, stamped by the bus)
// ---------------------------------------------------------------------------

export interface EventStamp {
  tick: number
  eventId: number
}

export type HitsplatType = 'damage' | 'block' | 'heal' | 'burn' | 'poison' | 'venom' | 'doom'

export type AttackStyleKind = 'melee' | 'range' | 'magic' | 'typeless'

export type VisualTarget =
  | { kind: 'actor'; actorId: string; size: number; position: Tile }
  | { kind: 'tile'; position: Tile }

export interface VisualAnimation {
  actorId: string
  /** 'idle' | 'walk' | 'magic' | 'range' | 'melee' | 'defend' | 'death' | 'heal' | 'attack' | 'spawn' | 'hit' */
  clipId: string
  delayCycles: number
}

export interface VisualProjectile {
  spotAnimId: number
  sourcePosition: readonly [number, number]
  target: VisualTarget
  startDelayCycles: number
  endDelayCycles: number
  slope: number
  startOffset: number
  startHeight: number
  endHeight: number
}

export interface VisualGraphic {
  spotAnimId: number
  target: VisualTarget
  delayCycles: number
  height: number
}

export interface SpellCastInfo {
  sourcePosition: Tile
  targetPosition: Tile
  targetSize: number
  accurate: boolean
}

export type SimEventBody =
  | { type: 'movement'; actorId: string; from: Tile; to: Tile }
  | { type: 'actor_died'; actorId: string }
  | { type: 'actor_despawned'; actorId: string }
  | { type: 'prayer_changed'; actorId: string; from: PrayerId | null; to: PrayerId | null }
  | { type: 'prayer_activation_failed'; actorId: string; attemptedPrayer: PrayerId | null }
  | { type: 'prayer_depleted'; actorId?: string }
  | {
      type: 'hit_applied'
      targetId: string
      targetPosition: Tile
      damage: number
      blocked: boolean
      attackKind: string
      prayedCorrectly: boolean | null
      accurate: boolean
    }
  | { type: 'hitsplat_spawned'; targetId: string; amount: number; hitsplatType: HitsplatType }
  | {
      type: 'attack_started'
      sourceId: string
      targetId: string
      style: AttackStyleKind
      attackKind: string
      spellId?: string | null
      usingSpecialAttack?: boolean
      impactDelayTicks: number
      weaponId?: number
      ammoId?: number
      ammoSource?: string
      spellCast?: SpellCastInfo
    }
  | { type: 'spell_targeted'; sourceId: string; targetId: string; spellId: string; spellCast?: SpellCastInfo; impactDelayTicks: number; weaponId?: number }
  | { type: 'item_equipped'; slot: string; itemId: number; /** scim sends an equip-sound kind string (or omits it). */ equipSound?: string | number }
  | { type: 'item_consumed'; track: string; itemId: number }
  | { type: 'ground_item_dropped'; [k: string]: unknown }
  | { type: 'ground_item_taken'; [k: string]: unknown }
  | { type: 'player_graphic_applied'; spotAnimId: number; height?: number; [k: string]: unknown }
  | { type: 'npc_graphic_applied'; targetId: string; spotAnimId: number; height: number }
  | { type: 'status_effect_expired'; effect: string }
  | { type: 'spell_self_cast'; [k: string]: unknown }
  | { type: 'xp_drop'; skills: { skill: SkillName; amount: number }[]; predictedHit: number }
  | { type: 'intro_started'; [k: string]: unknown }
  | { type: 'intro_completed' }
  // Inferno encounter events (scim's Zuk-mode names are kept so the audio/visual rules port 1:1).
  | { type: 'inferno_visual'; animations: VisualAnimation[]; projectiles: VisualProjectile[]; graphics: VisualGraphic[] }
  | {
      type: 'zuk_attack'
      attack: 'jad_magic' | 'jad_range' | 'jad_melee' | 'jad_healer_melee'
      sourceId: string
      targetId: string
      sourcePosition: Tile
      targetPosition: Tile
      launchTick: number
      impactTick: number
      projectileArrivalCycles?: number
    }
  | { type: 'zuk_jad_cue'; sourceId: string; style: 'magic' | 'range' | 'melee' }
  | { type: 'zuk_hit'; actorId: string; npcKind: 'jad' | 'jad_healer'; position: Tile }
  | { type: 'zuk_death'; actorId: string; npcKind: 'jad' | 'jad_healer'; position: Tile }
  | { type: 'encounter_visual'; [k: string]: unknown }

export type SimEvent = SimEventBody & EventStamp

// ---------------------------------------------------------------------------
// Commands (what the UI calls; the input driver wraps them in input lag)
// ---------------------------------------------------------------------------

export type ItemOption = 'default' | 'guzzle'

/** Practice-panel debug actions (triple-Jad counterparts of scim's). */
export type EncounterCommand =
  | { type: 'restart-wave' }
  | { type: 'spawn-jad-healers'; jadId?: string }
  | { type: 'clear-healers' }
  | { type: 'set-jad-hp'; jadId?: string; hp: number }
  | { type: string; [k: string]: unknown }

/** scim `getAdjustedTheoreticalDps` ( ->), read by the HUD Max Hit row and the DPS Overlay. */
export interface DpsProjectionHit {
  planIndex: number
  accuracyProbability: number
  expectedAppliedDamage: number
  maximumAppliedDamage: number
  procChance: number
  gateProbability: number
}

export interface DpsProjection {
  style: 'melee_slash' | 'melee_stab' | 'melee_crush' | 'ranged' | 'magic'
  dps: number
  accuracy: number
  maxHit: number
  baseMaxHit: number | null
  profileMaxHit: number | null
  baseAttackRoll: number | null
  baseDefenceRoll: number | null
  outgoingDamageMultiplier: number
  specialAttackDamageMultiplier: number
  expectedAppliedDamagePerAttack: number
  attackSpeedTicks: number
  attackIntervalSeconds: number
  hits: DpsProjectionHit[]
}

export interface SimEngine {
  /** Theoretical DPS vs the current attack target (null when no target / no supported attack). */
  getAdjustedTheoreticalDps(): DpsProjection | null

  /** Advance one tick. `targetTile` = the current click-to-move destination (scim passes it every tick). */
  advanceTick(targetTile: Tile): void
  canAdvance(): boolean
  getState(): SimState
  /** Events produced by the last advanceTick (or reset / command). */
  readonly lastTickEvents: readonly SimEvent[]

  // Movement / targeting (tile clicks are not ops; the driver keeps the target tile).
  setCtrlClickOverride(ctrl: boolean): void
  applyAction(action: { attackTarget: string | null; manualCastSpell?: string | null }): void

  // Prayers
  queueProtectionPrayer(prayer: PrayerId | null): void
  queueOffensivePrayer(prayer: PrayerId | null): void
  queueIndependentPrayer(prayer: PrayerId): void
  queueQuickPrayerToggle(selections: PrayerId[]): void

  // Inventory / equipment
  queueEquipFromInventory(inventoryIndex: number, itemId: number, slot: EquipSlot): void
  queueEquipAmmoFromInventory(inventoryIndex: number, itemId: number): void
  queueUnequip(slot: EquipSlot): void
  queueUnequipAmmo(): void
  queueItemAction(inventoryIndex: number, option: ItemOption): void
  queueDropItem(inventoryIndex: number): void
  /** scim op (the UI also sets attackTarget null and the item tile as target). */
  queuePickupGroundItem(groundItemId: string): void
  /** Not lagged, immediate (scim applies drag-swaps instantly). */
  swapInventorySlots(a: number, b: number): void

  // Orbs / combat tab
  queueSpecialAttackToggle(): void
  queueRunToggle(): void
  setSelectedAttackStyleIndex(index: number): void
  setSelectedSpell(spell: string | null): void

  // Run setup
  setLoadout(loadout: Loadout): void
  setPlayerStats(baseLevels: Record<SkillName, number>): void
  setMechanicsConfig(config: Partial<MechanicsConfig>): void
  /** Re-seed and rebuild the world (Ctrl+R). */
  reset(options?: { combatSeed?: number; encounterSeed?: number }): void
  /** Practice panel actions; applied immediately, not lagged. */
  executeEncounterCommand(command: EncounterCommand): boolean
}
