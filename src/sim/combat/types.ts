import type { HitsplatType, PrayerId } from '../api'
import type { EventBus } from '../core/EventBus'
import type { BurnSeverity } from '../core/types'

export type DamageStyle = 'magic' | 'range' | 'melee' | 'typeless'

/** Player/NPC formula styles (scim output). */
export type FormulaStyle = 'melee_stab' | 'melee_slash' | 'melee_crush' | 'ranged' | 'magic'

export type PrayerCheckAt = 'launch' | 'impact' | { afterLaunchTicks: number }

export type PrayerReduction =
  | { type: 'block' }
  | { type: 'cap'; value?: number }
  | { type: 'reduce'; value?: number }
  | { type: 'bypass' }

/** Special-attack / spell post-hit and on-fire effects. */
export type PostHitEffect =
  | { effect: 'drain_defence'; percent?: number; flat?: boolean }
  | { effect: 'condemn' }
  | { effect: 'freeze'; durationTicks: number }
  | { effect: 'poison'; severity: number; chancePercent?: number }
  | { effect: 'weaken' }
  | { effect: 'heal_hp'; percentOfDamage: number; minimumHeal?: number }
  | { effect: 'restore_prayer'; percentOfDamage: number }
  | { effect: 'drain_magic'; base: number; percentOfDamage: number }
  | { effect: 'drain_attack'; percent: number }
  | { effect: 'bind'; delayTicks?: number; durationTicks: number }
  | {
      effect: 'burn'
      pulses: number
      severity: BurnSeverity
      firstPulseDelayTicks?: number
      chancePercentByBranch?: number[]
    }

export interface OnKillEffect {
  refundSpecEnergy?: number
  reduceAttackDelayTicks?: number
}

export interface EquipmentHitEffects {
  eclipseBurn: boolean
}

export interface Fraction {
  numerator: number
  denominator: number
}

export interface LaunchDamageMultipliers {
  incomingDamageMultiplier: number | undefined
  outgoingDamageMultiplier: number | undefined
  specDamageMultiplier: number | undefined
}

/** A resolved attack handed to `commitAttack` (scim's attack request payload). */
export interface ResolvedAttack {
  style: DamageStyle
  attackKind: string
  /** A number, or [min, max] rolled on the combat stream. */
  rolledDamage: number | readonly [number, number]
  accuracySucceeded: boolean
  impactDelayTicks: number
  spellId?: string | undefined
  usingSpecialAttack?: boolean | undefined
  onKillEffect?: OnKillEffect | undefined
  postHitEffects?: PostHitEffect[] | undefined
  equipmentHitEffects?: EquipmentHitEffects | undefined
  weaponId?: number | undefined
  ammoId?: number | undefined
  ammoSource?: string | undefined
  expectedHit?: number | undefined
  sourceSelfDamageRatio?: Fraction | undefined
  prayerCheckAt?: PrayerCheckAt | undefined
  damageBonusPercent?: number | undefined
  damageCap?: 'none' | undefined
  prayerReduction?: PrayerReduction | undefined
  applyPoison?: number | undefined
  hitsplatType?: HitsplatType | undefined
}

/** NPC attack request returned by encounter NPC ticks (scim result). */
export interface NpcAttackRequest extends ResolvedAttack {
  attackerId: string
  targetId: string
  isContinuation?: boolean
}

export interface PendingHit {
  sourceId: string
  targetId: string
  style: DamageStyle
  attackKind: string
  launchTick: number
  impactTick: number
  rolledDamage: number
  damageCapAtCalculation: number | undefined
  accuracySucceeded: boolean
  damageBonusPercent: number | undefined
  prayerCheckAt: PrayerCheckAt
  judgedProtectionPrayer: PrayerId | null
  applyPoison: number | undefined
  usingSpecialAttack: boolean | undefined
  onKillEffect: OnKillEffect | undefined
  postHitEffects: PostHitEffect[] | undefined
  expectedHit: number | undefined
  sourceSelfDamageRatio: Fraction | undefined
  launchDamageMultipliers: LaunchDamageMultipliers | undefined
  equipmentHitEffects: EquipmentHitEffects | undefined
}

/** scim's damage result (`applyDamage` return). */
export interface DamageResult {
  tick: number
  sourceId: string
  targetId: string
  attackType: DamageStyle
  baseDamage: number
  effectiveDamage: number
  activePrayer: PrayerId | null
  prayedCorrectly: boolean | null
  hpBefore: number
  hpAfter: number
  applyPoison: number | undefined
  onKillEffect: OnKillEffect | undefined
  expectedHit: number | undefined
}

/** scim's combat bridge (`buildCombatBridge` + per-call overrides). */
export interface CombatBridge {
  events: EventBus
  infiniteHealth: boolean
  incomingDamageMultiplier?: number | undefined
  outgoingDamageMultiplier?: number | undefined
  specDamageMultiplier?: number | undefined
  enablePendingHits?: boolean
  onDamageApplied?: (result: DamageResult) => void
  onSourceSelfDamageApplied?: () => void
  getAttackSpeed?: () => number
  resolveAttack?: () => Partial<ResolvedAttack>
  onAttackStarted?: () => void
}
