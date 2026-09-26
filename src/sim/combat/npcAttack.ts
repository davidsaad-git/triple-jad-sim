/**
 * NPC attack plans and resolution.
 */
import type { RandomFn } from '../core/rng'
import type { Actor, NpcActor } from '../core/types'
import type { Arena } from '../map/Arena'
import { npcInReach } from '../map/npcMovement'
import { centreDistance, npcFormulaView, npcRollVsPlayer, rollNpcAttack } from './formulas'
import { npcHitDelayFromCycles, projectileCycles, type ProjectileTiming } from './timing'
import type { DamageStyle, FormulaStyle, NpcAttackRequest, PrayerCheckAt } from './types'

export interface NpcAttackPlan {
  formulaStyle: FormulaStyle
  damageType: DamageStyle
  attackKind: string
  impactDelayTicks: number
  projectile?: ProjectileTiming
  maxHit?: number
  windupTicks?: number
  alwaysHits?: boolean
  prayerCheckAt?: PrayerCheckAt
}

/** scim: may the NPC start this attack now (range + LOS, not overlapping at turn start)? */
export function canNpcAttack(arena: Arena, npc: NpcActor, target: Actor, plan: { damageType: DamageStyle }): boolean {
  return (
    npc.combat.startedTurnOverlappingTarget !== true &&
    npcInReach(arena, npc, target, plan.damageType === 'melee' ? 1 : npc.combat.attackRange)
  )
}

/** scim: roll an NPC attack (two draws: accuracy, damage). */
export function resolveNpcAttack(args: { attacker: NpcActor; target: Actor; plan: NpcAttackPlan; random: RandomFn }): NpcAttackRequest {
  const { attacker, target, plan, random } = args
  const roll =
    target.kind === 'player'
      ? npcRollVsPlayer(attacker, target, plan.formulaStyle, random, plan.maxHit)
      : rollNpcAttack({
          attacker: npcFormulaView(attacker),
          target: npcFormulaView(target),
          style: plan.formulaStyle,
          random,
          ...(plan.maxHit === undefined ? {} : { maxHitOverride: plan.maxHit }),
        })
  const delay =
    (plan.windupTicks ?? 0) +
    (plan.projectile ? npcHitDelayFromCycles(projectileCycles(plan.projectile, centreDistance(attacker, target))) : plan.impactDelayTicks)
  return {
    attackerId: attacker.id,
    targetId: target.id,
    style: plan.damageType,
    attackKind: plan.attackKind,
    rolledDamage: roll.rolledDamage,
    accuracySucceeded: plan.alwaysHits === true || roll.accuracySucceeded,
    impactDelayTicks: delay,
    ...(plan.prayerCheckAt === undefined ? {} : { prayerCheckAt: plan.prayerCheckAt }),
  }
}
