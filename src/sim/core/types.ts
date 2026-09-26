/**
 * Internal actor model (scim and the
 * fields its factories/engine add). Everything the public snapshot exposes is
 * projected from these in `Engine.getState`.
 */
import type {
  CombatSupplies,
  CooldownTracks,
  Equipment,
  EquipmentStats,
  Inventory,
  NpcRole,
  PlayerStats,
  PrayerId,
  PrayerState,
  RunEnergyState,
  SkillName,
  SpecialAttackState,
  Tile,
} from '../api'
import type { MeleeReach } from '../map/reach'

export interface Vitals {
  hp: number
  maxHp: number
}

interface ActorBase {
  id: string
  alive: boolean
  position: Tile
  previousPosition: Tile
  /** 0..2047, 0 = south. */
  facing: number
  size: number
  vitals: Vitals
  history: Map<number, Tile>
  movementPath: Tile[]
  isMoving: boolean
  isRunning: boolean
}

// ---------------------------------------------------------------------------
// NPC
// ---------------------------------------------------------------------------

export type RetaliationMode = 'standard' | 'one-tick' | 'retarget'

export interface Retaliation {
  mode: RetaliationMode
  pending: { tick: number; sourceId: string }[]
  lastIncomingAttackTick: number | null
}

export interface NpcCombat {
  attackSpeed: number
  attackRange: number
  attackStyle: string
  nextActionTick: number
  targetId: string | null
  lastAttackTick: number | null
  retaliation?: Retaliation
  meleeReach?: MeleeReach
  startedTurnOverlappingTarget?: boolean
}

export type BurnImmunity = 'Weak' | 'Normal' | 'Strong' | null

/** scim monster formula view. */
export interface NpcFormulaStats {
  burnImmunity: BurnImmunity
  freezeResistance: number
  poisonResistance: number
  attributes: string[]
  levels: { attack: number; strength: number; defence: number; ranged: number; magic: number }
  offensive: { atk: number; ranged: number; magic: number; str: number; rangedStr: number; magicStr: number }
  defensive: { stab: number; slash: number; crush: number; ranged: number; magic: number }
  maxHit?: number
  alwaysAccuratePlayerHit?: boolean
  alwaysMaximumPlayerHit?: boolean
  demonbaneVulnerability?: number
}

export interface NpcDebuffs {
  boundFromTick?: number | undefined
  boundUntilTick?: number | undefined
  attackDrain?: number | undefined
  strengthDrain?: number | undefined
  defenceDrain?: number | undefined
  magicDrain?: number | undefined
}

export type BurnSeverity = 'weak' | 'normal' | 'strong' | 'incendiary'

export interface BurnStack {
  origin: string
  sourceId: string
  pulsesRemaining: number
}

export interface NpcPoison {
  sourceId: string
  severity: number
  nextPulseTick: number
}

export interface NpcDefinitionIdentity {
  readonly id: string
}

export interface NpcActor<S = unknown> extends ActorBase {
  kind: 'npc'
  npcTypeId: number
  archetypeId: string
  role: NpcRole
  formulaStats: NpcFormulaStats
  combat: NpcCombat
  spawnTick?: number | undefined
  despawnTick?: number | undefined
  lockedFacing?: number | undefined
  actionFacing?: number | undefined
  debuffs?: NpcDebuffs
  attackBlockedUntilTick?: number | undefined
  burnStacks?: BurnStack[]
  burnNextPulseTick?: number | undefined
  poison?: NpcPoison | undefined
  passThruNpcs?: boolean
  defenceDrainFloor?: number
  outline?: unknown
  definition?: NpcDefinitionIdentity
  state?: S
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface PoisonState {
  poisonVarp: number
  poisonTickCounter: number
  startedTick: number | null
}

export interface CombatTimers {
  vengeanceCooldownTicks: number
  vengeanceActive: boolean
  saturatedHeartCooldownTicks: number
  surgePotionCooldownTicks: number
  saturatedHeartActiveTicks: number
  markOfDarknessCooldownTicks: number
  markOfDarknessActiveTicks: number
  deathChargeCooldownTicks: number
  deathChargeActiveTicks: number
  deathChargeProcsRemaining: number
  statBoostDecayTick: number
  statBoostDecayExtended: boolean
}

/** scim's internal boost record (`KU`). */
export interface BoostRecord {
  stat: SkillName
  boostAmount: number
  isDivine: boolean
  ticksRemaining: number
}

export interface ActiveEffect {
  id: string
  type: string
  ticksRemaining: number
  tickDuration: number
  startedTick: number
  data?: { amount: number; group?: string | undefined }
}

export type InputOp =
  | { type: 'protection'; prayer: PrayerId | null }
  | { type: 'offensive'; prayer: PrayerId | null }
  | { type: 'independent'; prayer: PrayerId }
  | { type: 'quickPrayers'; selections: PrayerId[] }
  | { type: 'equip'; inventoryIndex: number; itemId: number; slot: string }
  | { type: 'equip_ammo'; inventoryIndex: number; itemId: number }
  | { type: 'unequip'; slot: string }
  | { type: 'unequip_ammo' }
  | { type: 'use_item'; inventoryIndex: number; option: 'default' | 'guzzle' }
  | { type: 'drop_item'; inventoryIndex: number }
  | { type: 'special_attack_toggle' }
  | { type: 'run_toggle' }
  | { type: 'attack_target'; targetId: string | null; manualCastSpell: string | null }
  | { type: 'pickup_ground_item'; groundItemId: string }

export type PrayerOp = Extract<InputOp, { type: 'protection' | 'offensive' | 'independent' | 'quickPrayers' }>

export interface ConflictionAttack {
  kind: 'spell' | 'charged_staff'
  spellId?: string
  weaponId?: number
  targetId: string
}

export interface PlayerActor extends ActorBase {
  kind: 'player'
  activePrayer: PrayerId | null
  offensivePrayer: PrayerId | null
  independentPrayers: PrayerId[]
  prayerState: PrayerState
  stats: PlayerStats
  poisonState: PoisonState
  specialAttack: SpecialAttackState
  combatTimers: CombatTimers
  potionBoosts: BoostRecord[]
  inventory: Inventory
  combatSupplies: CombatSupplies
  isRunEnabled: boolean
  isSpecialAttackActive: boolean
  runEnergy: RunEnergyState
  ctrlClickOverride: boolean
  equipment: Equipment
  equipmentStats: EquipmentStats
  /** kg */
  weight: number
  pendingInputOps: InputOp[]
  cooldownTracks: CooldownTracks
  pendingItemPickup: { groundItemId: string } | null
  activeEffects: ActiveEffect[]
  quickPrayersActive: boolean
  outline: unknown
  attackTarget: string | null
  lastAttackTarget?: string | undefined
  autoAttackPause: { targetId: string; resumeTick: number } | null
  attackInteractionActive: boolean
  manualCastSpell: string | null
  selectedAttackStyleIndex: number
  pendingConflictionAttack: ConflictionAttack | null
  xpCounters: Partial<Record<SkillName, number>>
  powerOfDeathUntilTick?: number | undefined
}

export type Actor = PlayerActor | NpcActor

export interface GroundItemRecord {
  id: string
  itemId: number
  quantity: number
  position: Tile
  droppedTick: number
}
