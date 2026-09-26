/**
 * JalTok-Jad and Yt-HurKot
 * (`KO`) definitions, plus the shared factory `CO`
 * and target resolution.
 */
import type { Tile } from '../../api'
import { resolveNpcAttack, canNpcAttack } from '../../combat/npcAttack'
import { createRetaliation, setNextAction } from '../../combat/retaliation'
import { centreDistance } from '../../combat/formulas'
import type { Actor, NpcActor } from '../../core/types'
import type { WorldState } from '../../core/WorldState'
import { cloneFormulaStats, JALTOK_JAD, YT_HURKOT } from '../../data/monsters'
import { faceExact } from '../../map/facing'
import { blockedByNpcsCheck, cardinalMeleeReach, genericChase, isBound, stepTowardPoint } from '../../map/npcMovement'
import { defineNpc, type NpcContext, type NpcTickResult } from '../../npc/defineNpc'
import {
  HEALER_ARCHETYPE,
  HEALER_ATTACK_SPEED,
  HEALER_FIRST_ENGAGEMENT_RECOVERY,
  HEALER_HEAL_AMOUNT,
  HEALER_HEAL_INTERVAL,
  HEALER_MELEE_PLAN,
  HEALER_NPC_ID,
  HEALER_SIZE,
  JAD_ARCHETYPE,
  JAD_NPC_ID,
  JAD_REMOVE_DELAY,
  JAD_SIZE,
  type JadExecution,
  type JadStyle,
} from './constants'
import { animationOnly, emitVisual, emitZukAttack, emitZukDeath, hitReaction, jadMagicVolley } from './visuals'

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** scim for the two kinds this wave uses. */
export function createInfernoNpc(kind: 'jad' | 'jad_healer', id: string, position: Tile): NpcActor {
  const monster = kind === 'jad' ? JALTOK_JAD : YT_HURKOT
  return {
    kind: 'npc',
    id,
    npcTypeId: kind === 'jad' ? JAD_NPC_ID : HEALER_NPC_ID,
    size: kind === 'jad' ? JAD_SIZE : HEALER_SIZE,
    archetypeId: kind === 'jad' ? JAD_ARCHETYPE : HEALER_ARCHETYPE,
    role: 'minion',
    alive: true,
    position: [position[0], position[1]],
    previousPosition: [position[0], position[1]],
    facing: 0,
    vitals: { hp: monster.hitpoints, maxHp: monster.hitpoints },
    history: new Map(),
    movementPath: [],
    isMoving: false,
    isRunning: false,
    formulaStats: cloneFormulaStats(monster.formulaStats),
    combat: { attackSpeed: 1, attackRange: 0, attackStyle: 'typeless', nextActionTick: 0, targetId: null, lastAttackTick: null },
  }
}

/** scim: the current target if alive, else fall back to the (alive) player. */
function resolveTarget(npc: NpcActor, world: WorldState): Actor | null {
  const id = npc.combat.targetId
  if (id === null) return null
  const t = world.getPlayers().find((p) => p.id === id) ?? world.getNpc(id)
  if (t?.alive) return t
  const player = world.getPlayer()
  if (player?.alive) {
    npc.combat.targetId = player.id
    return player
  }
  return null
}

function findActor(world: WorldState, id: string): Actor | null {
  return world.getPlayers().find((p) => p.id === id) ?? world.getNpc(id)
}

// ---------------------------------------------------------------------------
// Yt-HurKot
// ---------------------------------------------------------------------------

export interface HealerState {
  parentId: string
  supportTargetId: string
  nextHealTick: number
  firstEngagementTick: number | null
}

export interface HealerConfig {
  presentHeal: (parent: NpcActor, ctx: NpcContext) => void
}


export const JAD_HEALER = defineNpc<HealerState, HealerConfig>({
  id: 'inferno-jad-healer',
  onDamageResolved: ({ actor, damage, context }) => hitReaction(actor, damage, context.tickEvents),
  move: ({ actor, context }) => {
    if (!actor.alive || context.tick < (actor.spawnTick ?? 0)) return []
    const player = context.world.getPlayer()
    if (actor.combat.targetId !== null && (player === null || actor.combat.targetId === player.id) && !player?.alive) {
      actor.combat.targetId = null
      actor.state!.firstEngagementTick = null
      if (actor.combat.retaliation) actor.combat.retaliation.lastIncomingAttackTick = null
    }
    if (actor.combat.targetId !== null) return !player?.alive || actor.combat.targetId !== player.id ? [] : genericChase(actor, context)
    if (isBound(actor, context.tick)) return []
    const jad = context.world.getNpc(actor.state!.supportTargetId)
    if (!jad?.alive || cardinalMeleeReach(context.arena, actor, jad)) return []
    const goal: Tile = [
      Math.max(jad.position[0], Math.min(actor.position[0], jad.position[0] + jad.size - 1)),
      Math.max(jad.position[1], Math.min(actor.position[1], jad.position[1] + jad.size - 1)),
    ]
    return stepTowardPoint(context.arena, actor, goal, {
      canOccupy: (t) => context.arena.isWalkable(t[0], t[1]),
      canStep: blockedByNpcsCheck(actor.id, context.world.getNpcs(), (n) => n.alive),
    })
  },
  tick: ({ actor, context, config }) => {
    const none: NpcTickResult = { environmentalDamages: [] }
    if (!actor.alive || context.tick < (actor.spawnTick ?? 0)) return none
    const state = actor.state!
    const jad = context.world.getNpc(state.supportTargetId)
    if (actor.combat.targetId === null && context.tick >= state.nextHealTick && jad?.alive && cardinalMeleeReach(context.arena, actor, jad)) {
      state.nextHealTick = context.tick + HEALER_HEAL_INTERVAL
      faceExact(actor, jad)
      emitVisual(context.tickEvents, animationOnly(actor.id, 'heal'))
      healNpc(jad, HEALER_HEAL_AMOUNT, context)
      config.presentHeal(jad, context)
    }
    const incoming = actor.combat.retaliation?.lastIncomingAttackTick
    if (state.firstEngagementTick === null && incoming != null) state.firstEngagementTick = incoming
    const canAct = context.tick >= actor.combat.nextActionTick
    const player = context.world.getPlayer()
    if (
      !canAct ||
      !player?.alive ||
      actor.combat.targetId !== player.id ||
      !canNpcAttack(context.arena, actor, player, HEALER_MELEE_PLAN) ||
      (state.firstEngagementTick !== null && context.tick < state.firstEngagementTick + HEALER_FIRST_ENGAGEMENT_RECOVERY)
    ) {
      return none
    }
    const attack = resolveNpcAttack({ attacker: actor, target: player, plan: HEALER_MELEE_PLAN, random: context.random })
    emitVisual(context.tickEvents, animationOnly(actor.id, 'melee'))
    emitZukAttack(context.tickEvents, {
      attack: 'jad_healer_melee',
      sourceId: actor.id,
      targetId: player.id,
      sourcePosition: actor.position,
      targetPosition: player.position,
      launchTick: context.tick,
      impactTick: context.tick + attack.impactDelayTicks,
    })
    actor.combat.lastAttackTick = context.tick
    setNextAction(actor.combat, context.tick, HEALER_ATTACK_SPEED)
    return { environmentalDamages: [], npcAttacks: [attack] }
  },
})


export function createHealer(args: { id: string; position: Tile; spawnTick: number; parentId: string }): NpcActor<HealerState> {
  const base = createInfernoNpc('jad_healer', args.id, args.position)
  base.spawnTick = args.spawnTick
  base.combat.attackSpeed = HEALER_ATTACK_SPEED
  base.combat.attackStyle = 'melee'
  base.combat.attackRange = 1
  base.combat.retaliation = createRetaliation('retarget')
  return JAD_HEALER.createActor(base, { parentId: args.parentId, supportTargetId: args.parentId, nextHealTick: args.spawnTick, firstEngagementTick: null })
}

/** scim: heal an NPC (no hitsplat when nothing was healed). */
export function healNpc(npc: NpcActor | null, amount: number, ctx: { tickEvents: NpcContext['tickEvents'] }): number {
  if (!npc || !npc.alive || amount <= 0) return 0
  const healed = Math.min(amount, npc.vitals.maxHp - npc.vitals.hp)
  if (healed <= 0) return 0
  npc.vitals = { ...npc.vitals, hp: npc.vitals.hp + healed }
  ctx.tickEvents.emit({ type: 'hitsplat_spawned', targetId: npc.id, amount: healed, hitsplatType: 'heal' })
  return healed
}

// ---------------------------------------------------------------------------
// JalTok-Jad
// ---------------------------------------------------------------------------

export interface PendingJadAttack {
  style: JadStyle
  targetId: string
  releaseTick: number
}

export interface JadState {
  healersSpawned: boolean
  removeAt: number | null
  pendingAttack: PendingJadAttack | null
  /** Wave-68 stagger: this Jad's own first-attack delay. */
  initialDelayTicks: number
}

export interface JadConfig {
  execution: JadExecution
  spawnHealers: (jadId: string, ctx: NpcContext) => void
}

/** scim: one encounter-RNG draw per windup. */
function selectStyle(jad: NpcActor, target: Actor, ctx: NpcContext, execution: JadExecution): JadStyle | null {
  if (!canNpcAttack(ctx.arena, jad, target, execution.profiles.magic.attack)) return null
  const r = ctx.random()
  if (cardinalMeleeReach(ctx.arena, jad, target)) return r < 1 / 3 ? 'magic' : r < 2 / 3 ? 'range' : 'melee'
  return r < 0.5 ? 'magic' : 'range'
}


export const JALTOK_JAD_DEF = defineNpc<JadState, JadConfig>({
  id: 'inferno-jad',
  onDamageResolved: ({ actor, damage, config, context }) => {
    hitReaction(actor, damage, context.tickEvents)
    if (damage.sourceId !== 'player' || damage.effectiveDamage <= 0 || damage.hpAfter <= 0) return
    const state = actor.state!
    if (!state.healersSpawned && damage.hpAfter <= actor.vitals.maxHp / 2) {
      state.healersSpawned = true
      config.spawnHealers(actor.id, context)
    }
  },
  onDefeated: ({ actor, defeat, context }) => {
    actor.state!.removeAt = defeat.tick + JAD_REMOVE_DELAY
    actor.state!.pendingAttack = null
    emitZukDeath(context.tickEvents, actor.id, 'jad', actor.position)
  },
  onDespawn: ({ actor, context }) => {
    actor.state!.pendingAttack = null
    for (const npc of context.world.getNpcs()) if (JAD_HEALER.getState(npc)?.parentId === actor.id) context.despawnNpc(npc.id)
  },
  tick: ({ actor, context, config }) => {
    const none: NpcTickResult = { environmentalDamages: [] }
    const state = actor.state!
    if (state.removeAt !== null && context.tick >= state.removeAt) {
      context.despawnNpc(actor.id)
      return none
    }
    if (!actor.alive || context.tick < (actor.spawnTick ?? 0)) return none
    const canAct = context.tick >= actor.combat.nextActionTick
    const exec = config.execution
    if (context.tick < (actor.spawnTick ?? 0) + (state.initialDelayTicks ?? exec.initialDelayTicks)) return none
    actor.combat.attackRange = exec.attackRange
    const pendingTargetId = state.pendingAttack?.targetId
    const target = pendingTargetId === undefined ? (canAct ? resolveTarget(actor, context.world) : null) : findActor(context.world, pendingTargetId)
    if (!state.pendingAttack && canAct && target?.alive) {
      const style = selectStyle(actor, target, context, exec)
      if (style === null) return none
      const profile = exec.profiles[style]
      if (!canNpcAttack(context.arena, actor, target, profile.attack)) return none
      state.pendingAttack = { style, targetId: target.id, releaseTick: context.tick + profile.windupTicks }
      actor.combat.attackStyle = style
      actor.combat.attackSpeed = style === 'melee' ? exec.meleePeriod : exec.rangedMagicPeriod
      setNextAction(actor.combat, context.tick, actor.combat.attackSpeed)
      emitVisual(context.tickEvents, animationOnly(actor.id, style))
      context.tickEvents.emit({ type: 'zuk_jad_cue', sourceId: actor.id, style })
    }
    const pending = state.pendingAttack
    if (!pending || context.tick < pending.releaseTick) return none
    state.pendingAttack = null
    if (!target?.alive || target.id !== pending.targetId) return none
    const attack = resolveNpcAttack({
      attacker: actor,
      target,
      random: context.random,
      plan: { ...exec.profiles[pending.style].attack, prayerCheckAt: exec.prayerCheckAtRelease },
    })
    if (pending.style === 'magic') {
      const v = jadMagicVolley(actor, target)
      emitVisual(context.tickEvents, {
        animations: [],
        graphics: [],
        projectiles: v.projectiles.map((pr) => ({ ...pr, startDelayCycles: pr.startDelayCycles - 90, endDelayCycles: pr.endDelayCycles - 90 })),
      })
    }
    if (pending.style === 'range') {
      emitVisual(context.tickEvents, {
        animations: [],
        projectiles: [],
        graphics: [{ spotAnimId: 451, target: { kind: 'tile', position: [target.position[0], target.position[1]] }, height: 92, delayCycles: 0 }],
      })
    }
    actor.combat.lastAttackTick = context.tick
    emitZukAttack(context.tickEvents, {
      attack: pending.style === 'magic' ? 'jad_magic' : pending.style === 'range' ? 'jad_range' : 'jad_melee',
      sourceId: actor.id,
      targetId: target.id,
      sourcePosition: actor.position,
      targetPosition: target.position,
      launchTick: context.tick,
      impactTick: context.tick + attack.impactDelayTicks,
      ...(pending.style === 'magic' ? { projectileArrivalCycles: 2 + 8 * centreDistance(actor, target) } : {}),
    })
    return { environmentalDamages: [], npcAttacks: [attack] }
  },
})

/** scim (initial target = the player for wave 68; per-Jad first-attack delay). */
export function createJad(args: { id: string; position: Tile; spawnTick: number; targetId: string; initialDelayTicks: number }): NpcActor<JadState> {
  const base = createInfernoNpc('jad', args.id, args.position)
  base.spawnTick = args.spawnTick
  base.combat.attackSpeed = 8
  base.combat.targetId = args.targetId
  base.combat.retaliation = createRetaliation('retarget')
  return JALTOK_JAD_DEF.createActor(base, { healersSpawned: false, removeAt: null, pendingAttack: null, initialDelayTicks: args.initialDelayTicks })
}
