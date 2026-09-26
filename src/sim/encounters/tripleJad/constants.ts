/**
 * Wave-68 layout and the scim-derived Jad/healer configuration.
 * See "Deviations"
 */
import type { Tile } from '../../api'
import type { NpcAttackPlan } from '../../combat/npcAttack'
import type { ProjectileTiming } from '../../combat/timing'

export const ENCOUNTER_KIND = 'tripleJad'

/** Wave-68 npc ids (same data/models as scim's 7704/7705). */
export const JAD_NPC_ID = 7700
export const HEALER_NPC_ID = 7701
/** scim's archetype scheme ('zuk_' + kind) without the Zuk prefix: the boss bar shows "Jad", the HUD "Jad". */
export const JAD_ARCHETYPE = 'jad'
export const HEALER_ARCHETYPE = 'jad_healer'
export const JAD_SIZE = 5
export const HEALER_SIZE = 1

/** Player start (map-square-local SW tile), also the collision flood-fill seed. */
export const PLAYER_START: Tile = [31, 33]

/** Jad spawn SW tiles in spawn order (IT (18,24), (28,24), (23,35) converted with x+6, 60-y). */
export const JAD_SPAWN_TILES: readonly Tile[] = [
  [24, 36],
  [34, 36],
  [29, 25],
]

/** First-attack delays (3-tick stagger); which Jad gets which is shuffled with the encounter RNG. */
export const JAD_INITIAL_DELAYS: readonly number[] = [8, 11, 14]

/** Healer offsets from the Jad's current SW tile, in scim's spawn order ([30,41], [31,40], [30,40] for a Jad at [30,35]). */
export const HEALER_OFFSETS: readonly Tile[] = [
  [0, 6],
  [1, 5],
  [0, 5],
]

/** scim: Jad magic projectile timing. */
export const JAD_MAGIC_PROJECTILE: ProjectileTiming = { delay: 2, lengthAdjustment: 0, stepMultiplier: 8, progress: 32 }

export type JadStyle = 'magic' | 'range' | 'melee'

export interface JadProfile {
  windupTicks: number
  attack: NpcAttackPlan
}

export interface JadExecution {
  attackRange: number
  initialDelayTicks: number
  prayerCheckAtRelease: 'launch'
  /** scim 8; wave 68 uses 9. */
  rangedMagicPeriod: number
  meleePeriod: number
  profiles: Readonly<Record<JadStyle, JadProfile>>
}

/** scim with the wave-68 attack speed. */
export const JAD_EXECUTION: JadExecution = {
  attackRange: 15,
  initialDelayTicks: 8,
  prayerCheckAtRelease: 'launch',
  rangedMagicPeriod: 9,
  meleePeriod: 4,
  profiles: {
    magic: {
      windupTicks: 3,
      attack: { formulaStyle: 'magic', damageType: 'magic', attackKind: 'magic_fire', impactDelayTicks: 0, projectile: JAD_MAGIC_PROJECTILE, maxHit: 113 },
    },
    range: { windupTicks: 3, attack: { formulaStyle: 'ranged', damageType: 'range', attackKind: 'range_arrow', impactDelayTicks: 2, maxHit: 113 } },
    melee: { windupTicks: 0, attack: { formulaStyle: 'melee_stab', damageType: 'melee', attackKind: 'melee_stab', impactDelayTicks: 0, maxHit: 113 } },
  },
}

/** scim + the registered `melee` override. */
export const HEALER_MELEE_PLAN: NpcAttackPlan = { formulaStyle: 'melee_crush', damageType: 'melee', attackKind: 'melee_crush', impactDelayTicks: 0, maxHit: 18 }
/** scim heal interval, `GO` attack speed, heal amount, recovery. */
export const HEALER_HEAL_INTERVAL = 4
export const HEALER_ATTACK_SPEED = 4
export const HEALER_HEAL_AMOUNT = 10
export const HEALER_FIRST_ENGAGEMENT_RECOVERY = 3

/** Jad removal delay after its defeat. */
export const JAD_REMOVE_DELAY = 6
/** Victory flow: resolving -> victory after 6 ticks (scim Zuk flow). */
export const VICTORY_DELAY = 6

export const DAMAGE_SOURCE_LABEL = 'TripleJadAttack'
