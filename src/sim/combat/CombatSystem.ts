/**
 * Combat system: player attack timers,
 * attack commit, pending hits, hit application.
 */
import type { PrayerId } from '../api'
import type { RandomFn } from '../core/rng'
import type { Actor, NpcActor, PlayerActor } from '../core/types'
import type { WorldState } from '../core/WorldState'
import { protects } from '../data/prayers'
import {
  applyPostHitEffects,
  applyProtection,
  appliesOnAccurateZero,
  clearBurns,
  clearPoison,
  notePlayerDamage,
  powerOfDeathFactor,
  pulseBurns,
  pulsePoison,
  rollDamageValue,
  rollEclipseBurn,
} from './effects'
import { queueRetaliation } from './retaliation'
import type {
  CombatBridge,
  DamageResult,
  DamageStyle,
  LaunchDamageMultipliers,
  PendingHit,
  PrayerCheckAt,
  PrayerReduction,
  ResolvedAttack,
} from './types'

const NO_LAUNCH_MULTIPLIERS: LaunchDamageMultipliers = {
  incomingDamageMultiplier: undefined,
  outgoingDamageMultiplier: undefined,
  specDamageMultiplier: undefined,
}

interface PendingHitRuntime {
  source: Actor
  target: Actor
  prayerReduction?: PrayerReduction | undefined
}

export interface AttackRequest {
  attacker: Actor
  target: Actor
  attack: ResolvedAttack
}

/** Elysian spirit shield (scim, `_U` = 0.7 = 0.75). */
const ELYSIAN_ID = 12817

function nonNegInt(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
}

export class CombatSystem {
  private readonly nextAttackTickByActor = new Map<string, number>()
  private readonly scheduledAttackCycleByActor = new Map<string, number>()
  private readonly appliedAttackSpeedupByActor = new Map<string, number>()
  private pendingHitRuntime = new WeakMap<PendingHit, PendingHitRuntime>()
  readonly random: RandomFn

  constructor(random: RandomFn) {
    this.random = random
  }

  reset(): void {
    this.nextAttackTickByActor.clear()
    this.scheduledAttackCycleByActor.clear()
    this.appliedAttackSpeedupByActor.clear()
    this.pendingHitRuntime = new WeakMap()
  }

  getNextAttackTick(actorId: string): number | undefined {
    return this.nextAttackTickByActor.get(actorId)
  }

  getScheduledAttackCycle(actorId: string): number | undefined {
    return this.scheduledAttackCycleByActor.get(actorId)
  }

  /** On-kill spec effect: `next = min(next, max(tick + 1, next - n))`. */
  reduceNextAttackTick(actorId: string, ticks: number, tick: number): void {
    const next = this.nextAttackTickByActor.get(actorId)
    if (next === undefined || ticks <= 0) return
    this.nextAttackTickByActor.set(actorId, Math.min(next, Math.max(tick + 1, next - ticks)))
  }

  /** Eating/drinking pushes a running attack timer back. */
  extendNextAttackTickIfActive(actorId: string, tick: number, ticks: number): void {
    if (ticks <= 0) return
    const next = this.nextAttackTickByActor.get(actorId)
    if (next !== undefined && tick < next) this.nextAttackTickByActor.set(actorId, next + ticks)
  }

  /** Player path: check and set the attack timer, then commit. */
  processAttack(world: WorldState, attacker: Actor, target: Actor, bridge: CombatBridge): boolean {
    if (!attacker.alive || !target.alive) return false
    if (!this.canAttack(world.tick, attacker, bridge)) return false
    return this.commitAttack(world, { attacker, target, attack: this.resolveAttack(attacker, bridge) }, bridge)
  }

  processAttackRequest(world: WorldState, req: AttackRequest, bridge: CombatBridge): boolean {
    if (!req.attacker.alive || !req.target.alive) return false
    return this.commitAttack(world, req, bridge)
  }

  processSupplementalHitRequest(world: WorldState, req: AttackRequest, bridge: CombatBridge): boolean {
    if (!req.attacker.alive || !req.target.alive) return false
    return this.commitAttack(world, req, bridge, false)
  }

  private canAttack(tick: number, attacker: Actor, bridge: CombatBridge): boolean {
    if (tick < (this.nextAttackTickByActor.get(attacker.id) ?? -Infinity)) return false
    const speed = Math.max(1, this.getAttackSpeed(attacker, bridge))
    this.nextAttackTickByActor.set(attacker.id, tick + speed)
    this.scheduledAttackCycleByActor.set(attacker.id, speed)
    this.appliedAttackSpeedupByActor.delete(attacker.id)
    return true
  }

  private getAttackSpeed(attacker: Actor, bridge: CombatBridge): number {
    const s = bridge.getAttackSpeed?.()
    if (typeof s === 'number' && s > 0) return Math.floor(s)
    if (attacker.kind === 'npc') return Math.max(1, Math.floor(attacker.combat.attackSpeed))
    return 1
  }

  private resolveAttack(attacker: Actor, bridge: CombatBridge): ResolvedAttack {
    const style: DamageStyle = attacker.kind === 'npc' ? (attacker.combat.attackStyle as DamageStyle) : 'melee'
    const kind = style === 'magic' ? 'magic_fire' : style === 'range' ? 'range_arrow' : style === 'melee' ? 'melee_crush' : 'magic_shadow'
    const base: ResolvedAttack = { style, attackKind: kind, rolledDamage: 0, accuracySucceeded: true, impactDelayTicks: 0 }
    const r = bridge.resolveAttack?.()
    if (!r) return base
    return {
      style: r.style ?? base.style,
      attackKind: r.attackKind ?? base.attackKind,
      rolledDamage: r.rolledDamage ?? base.rolledDamage,
      accuracySucceeded: r.accuracySucceeded ?? base.accuracySucceeded,
      impactDelayTicks: nonNegInt(r.impactDelayTicks ?? base.impactDelayTicks),
      applyPoison: r.applyPoison,
      prayerReduction: r.prayerReduction,
      spellId: r.spellId,
      usingSpecialAttack: r.usingSpecialAttack,
      onKillEffect: r.onKillEffect,
      postHitEffects: r.postHitEffects,
      weaponId: r.weaponId,
      ammoId: r.ammoId,
      ammoSource: r.ammoSource,
      expectedHit: r.expectedHit,
      sourceSelfDamageRatio: r.sourceSelfDamageRatio,
      equipmentHitEffects: r.equipmentHitEffects,
      prayerCheckAt: r.prayerCheckAt,
      damageBonusPercent: r.damageBonusPercent,
      damageCap: r.damageCap,
    }
  }

  
  commitAttack(world: WorldState, req: AttackRequest, bridge: CombatBridge, emitAttackStarted = true): boolean {
    const { attacker, target } = req
    const npcVsPlayer = attacker.kind === 'npc' && target.kind === 'player'
    const capAtLaunch = npcVsPlayer && req.attack.damageCap !== 'none' ? target.vitals.hp : undefined
    let attack = req.attack
    if (npcVsPlayer) {
      const rolled = nonNegInt(rollDamageValue(attack.rolledDamage, this.random))
      const base = attack.accuracySucceeded ? rolled : 0
      const bonus = base + Math.floor((base * (attack.damageBonusPercent ?? 0)) / 100)
      const scaled = Math.max(0, Math.floor(bonus * (bridge.incomingDamageMultiplier ?? 1)))
      attack = { ...attack, rolledDamage: scaled, damageBonusPercent: undefined }
    }
    const applyBridge: CombatBridge = npcVsPlayer ? { ...bridge, incomingDamageMultiplier: undefined } : bridge
    const tick = world.tick
    bridge.events.setTick(tick)
    if (emitAttackStarted) {
      const withCast = attack.spellId !== undefined || (attacker.kind === 'player' && attack.style !== 'melee')
      bridge.events.emit({
        type: 'attack_started',
        sourceId: attacker.id,
        targetId: target.id,
        style: attack.style,
        attackKind: attack.attackKind,
        ...(attack.spellId === undefined ? {} : { spellId: attack.spellId }),
        ...(withCast
          ? {
              spellCast: {
                sourcePosition: [attacker.position[0], attacker.position[1]],
                targetPosition: [target.position[0], target.position[1]],
                targetSize: target.size,
                accurate: attack.accuracySucceeded,
              },
            }
          : {}),
        ...(attack.usingSpecialAttack === undefined ? {} : { usingSpecialAttack: attack.usingSpecialAttack }),
        impactDelayTicks: attack.impactDelayTicks,
        ...(attack.weaponId === undefined ? {} : { weaponId: attack.weaponId }),
        ...(attack.ammoId === undefined ? {} : { ammoId: attack.ammoId }),
        ...(attack.ammoSource === undefined ? {} : { ammoSource: attack.ammoSource }),
      })
      bridge.onAttackStarted?.()
    } else if (attacker.kind === 'player' && attack.spellId !== undefined) {
      bridge.events.emit({
        type: 'spell_targeted',
        sourceId: attacker.id,
        targetId: target.id,
        spellId: attack.spellId,
        spellCast: {
          sourcePosition: [attacker.position[0], attacker.position[1]],
          targetPosition: [target.position[0], target.position[1]],
          targetSize: target.size,
          accurate: attack.accuracySucceeded,
        },
        impactDelayTicks: attack.impactDelayTicks,
        ...(attack.weaponId === undefined ? {} : { weaponId: attack.weaponId }),
      })
    }
    const pending = (bridge.enablePendingHits ?? false) && attack.impactDelayTicks > 0
    const npcTarget = attacker.kind === 'player' ? world.getNpc(target.id) : null
    if (npcTarget) {
      queueRetaliation(npcTarget, {
        sourceId: attacker.id,
        launchTick: tick,
        impactTick: tick + (pending ? attack.impactDelayTicks : 0),
        style: attack.style,
        accuracySucceeded: attack.accuracySucceeded,
      })
    }
    if (pending) {
      const rolled = rollDamageValue(attack.rolledDamage, this.random)
      const hit: PendingHit = {
        sourceId: attacker.id,
        targetId: target.id,
        style: attack.style,
        attackKind: attack.attackKind,
        launchTick: tick,
        impactTick: tick + attack.impactDelayTicks,
        rolledDamage: attack.accuracySucceeded ? rolled : 0,
        damageCapAtCalculation: capAtLaunch,
        accuracySucceeded: attack.accuracySucceeded,
        damageBonusPercent: attack.damageBonusPercent,
        prayerCheckAt: attack.prayerCheckAt ?? 'launch',
        judgedProtectionPrayer: activePrayerOf(target),
        applyPoison: attack.applyPoison,
        usingSpecialAttack: attack.usingSpecialAttack,
        onKillEffect: attack.onKillEffect,
        postHitEffects: attack.postHitEffects,
        expectedHit: attack.expectedHit,
        sourceSelfDamageRatio: attack.sourceSelfDamageRatio,
        launchDamageMultipliers: {
          incomingDamageMultiplier: applyBridge.incomingDamageMultiplier,
          outgoingDamageMultiplier: bridge.outgoingDamageMultiplier,
          specDamageMultiplier: bridge.specDamageMultiplier,
        },
        equipmentHitEffects: attack.equipmentHitEffects,
      }
      this.queuePendingHit(world, hit, { source: attacker, target, prayerReduction: attack.prayerReduction })
      return true
    }
    this.applyResolvedHit(world, attacker, target, attack, applyBridge, undefined, capAtLaunch)
    return true
  }

  queuePendingHit(world: WorldState, hit: PendingHit, runtime: PendingHitRuntime): void {
    this.pendingHitRuntime.set(hit, runtime)
    world.pendingHits.push(hit)
  }

  
  static prayerCheckTick(hit: { prayerCheckAt: PrayerCheckAt; launchTick: number; impactTick: number }): number {
    const at = hit.prayerCheckAt
    if (at === 'launch') return hit.launchTick
    if (at === 'impact') return hit.impactTick
    return Math.min(hit.impactTick, hit.launchTick + at.afterLaunchTicks)
  }

  /** scim; `band` filters by target kind. */
  processPendingHits(world: WorldState, bridge: CombatBridge, band?: 'npc' | 'player'): void {
    if (world.pendingHits.length === 0) return
    const keep: PendingHit[] = []
    for (const hit of world.pendingHits) {
      const target = world.actors.get(hit.targetId)
      const source = world.actors.get(hit.sourceId)
      const rt = this.pendingHitRuntime.get(hit)
      if (rt && (rt.target !== target || rt.source !== source)) continue
      if (band !== undefined && target !== undefined && target.kind !== band) {
        keep.push(hit)
        continue
      }
      if (target && CombatSystem.prayerCheckTick(hit) === world.tick) hit.judgedProtectionPrayer = activePrayerOf(target)
      if (hit.impactTick > world.tick) {
        keep.push(hit)
        continue
      }
      if (!target || !target.alive || !source || !source.alive) continue
      this.applyResolvedHit(
        world,
        source,
        target,
        {
          style: hit.style,
          attackKind: hit.attackKind,
          rolledDamage: hit.rolledDamage,
          accuracySucceeded: hit.accuracySucceeded,
          impactDelayTicks: Math.max(0, hit.impactTick - hit.launchTick),
          damageBonusPercent: hit.damageBonusPercent,
          applyPoison: hit.applyPoison,
          prayerReduction: rt?.prayerReduction,
          usingSpecialAttack: hit.usingSpecialAttack,
          onKillEffect: hit.onKillEffect,
          postHitEffects: hit.postHitEffects,
          expectedHit: hit.expectedHit,
          sourceSelfDamageRatio: hit.sourceSelfDamageRatio,
          equipmentHitEffects: hit.equipmentHitEffects,
          prayerCheckAt: hit.prayerCheckAt,
        },
        { ...bridge, ...(hit.launchDamageMultipliers ?? NO_LAUNCH_MULTIPLIERS) },
        hit.judgedProtectionPrayer,
        hit.damageCapAtCalculation,
      )
    }
    world.pendingHits = keep
  }

  
  processBurnStacks(world: WorldState, bridge: CombatBridge): void {
    bridge.events.setTick(world.tick)
    for (const npc of world.getNpcs()) {
      const pulse = pulseBurns(npc, world.tick)
      if (pulse === null) continue
      const source = world.actors.get(pulse.sourceId)
      if (source === undefined) continue
      this.applyResolvedHit(
        world,
        source,
        npc,
        { style: 'typeless', attackKind: 'typeless', rolledDamage: pulse.stackCount, accuracySucceeded: true, impactDelayTicks: 0, hitsplatType: 'burn' },
        bridge,
        undefined,
        undefined,
        'fixed',
      )
      if (!npc.alive) clearBurns(npc)
    }
  }

  
  processNpcPoison(world: WorldState, bridge: CombatBridge): void {
    bridge.events.setTick(world.tick)
    for (const npc of world.getNpcs()) {
      const pulse = pulsePoison(npc, world.tick)
      if (pulse === null) continue
      const source = world.actors.get(pulse.sourceId)
      if (source === undefined) continue
      this.applyResolvedHit(
        world,
        source,
        npc,
        { style: 'typeless', attackKind: 'typeless', rolledDamage: pulse.damage, accuracySucceeded: true, impactDelayTicks: 0, hitsplatType: 'poison' },
        bridge,
        undefined,
        undefined,
        'fixed',
      )
      if (!npc.alive) clearPoison(npc)
    }
  }

  
  applyResolvedHit(
    world: WorldState,
    source: Actor,
    target: Actor,
    hit: ResolvedAttack,
    bridge: CombatBridge,
    judgedPrayer: PrayerId | null | undefined,
    cap: number | undefined,
    mode: 'standard' | 'fixed' = 'standard',
  ): void {
    const rolled = nonNegInt(rollDamageValue(hit.rolledDamage, this.random))
    const minDamage = source.kind === 'player' ? 1 : 0
    let dmg = hit.accuracySucceeded ? Math.max(minDamage, rolled) : 0
    if (hit.damageBonusPercent) dmg += Math.floor((dmg * hit.damageBonusPercent) / 100)
    if (mode === 'standard' && bridge.outgoingDamageMultiplier !== undefined && source.kind === 'player') {
      dmg = Math.max(0, Math.floor(dmg * bridge.outgoingDamageMultiplier))
    }
    if (mode === 'standard' && bridge.specDamageMultiplier !== undefined && hit.usingSpecialAttack && source.kind === 'player') {
      dmg = Math.max(0, Math.floor(dmg * bridge.specDamageMultiplier))
    }
    const result = this.applyDamage(
      source,
      target,
      dmg,
      hit.style,
      world.tick,
      bridge,
      hit.prayerReduction,
      hit.accuracySucceeded ? hit.applyPoison : undefined,
      hit,
      judgedPrayer,
      cap,
    )
    bridge.events.setTick(world.tick)
    bridge.events.emit({
      type: 'hit_applied',
      targetId: target.id,
      targetPosition: [target.position[0], target.position[1]],
      damage: result.effectiveDamage,
      blocked: result.effectiveDamage === 0,
      attackKind: hit.attackKind,
      prayedCorrectly: result.prayedCorrectly,
      accurate: hit.accuracySucceeded,
    })
    bridge.events.emit({
      type: 'hitsplat_spawned',
      targetId: target.id,
      amount: result.effectiveDamage,
      hitsplatType: hit.hitsplatType ?? (result.effectiveDamage > 0 ? 'damage' : 'block'),
    })
    bridge.onDamageApplied?.(result)
    if (hit.postHitEffects && source.kind === 'player' && target.kind === 'npc') {
      const effects = result.effectiveDamage > 0 ? hit.postHitEffects : hit.accuracySucceeded ? hit.postHitEffects.filter(appliesOnAccurateZero) : []
      if (effects.length > 0) applyPostHitEffects(source, target, result.effectiveDamage, effects, world.tick, 'on-hit')
    }
    if (hit.equipmentHitEffects && source.kind === 'player' && target.kind === 'npc') {
      rollEclipseBurn({
        snapshot: hit.equipmentHitEffects,
        accurate: hit.accuracySucceeded,
        target,
        sourceId: source.id,
        impactTick: world.tick,
        roll: this.random,
      })
    }
    if (hit.accuracySucceeded && hit.sourceSelfDamageRatio !== undefined && source.kind === 'player') {
      const ratio = hit.sourceSelfDamageRatio
      const self = Math.min(source.vitals.hp - 1, Math.floor((source.vitals.hp * ratio.numerator) / ratio.denominator))
      if (self > 0) {
        notePlayerDamage(source, self)
        source.vitals.hp -= self
        source.stats.hitpoints.current = source.vitals.hp
        bridge.events.emit({ type: 'hitsplat_spawned', targetId: source.id, amount: self, hitsplatType: 'damage' })
        bridge.onSourceSelfDamageApplied?.()
      }
    }
    if (!target.alive) bridge.events.emit({ type: 'actor_died', actorId: target.id })
  }

  
  private applyDamage(
    source: Actor,
    target: Actor,
    damage: number,
    style: DamageStyle,
    tick: number,
    bridge: CombatBridge,
    reduction: PrayerReduction | undefined,
    applyPoison: number | undefined,
    hit: ResolvedAttack,
    judged: PrayerId | null | undefined,
    cap: number | undefined,
  ): DamageResult {
    const hpBefore = target.vitals.hp
    const prayer = judged === undefined ? activePrayerOf(target) : judged
    let d = damage
    if (target.kind === 'player' && style === 'melee') d = Math.floor(d * powerOfDeathFactor(target, tick))
    if (bridge.incomingDamageMultiplier !== undefined && target.kind === 'player') d = Math.max(0, Math.floor(d * bridge.incomingDamageMultiplier))
    const base = d
    let eff = applyProtection(d, style, prayer, reduction)
    if (cap !== undefined) eff = Math.min(eff, cap)
    if (eff > 0 && source.kind === 'npc' && target.kind === 'player' && target.equipment.shield === ELYSIAN_ID) {
      if (this.random() < 0.7) eff = Math.floor(eff * 0.75)
    }
    const infinite = bridge.infiniteHealth && target.kind === 'player'
    if (!infinite && target.kind === 'player') notePlayerDamage(target, eff)
    if (!infinite) {
      target.vitals.hp -= eff
      if (target.vitals.hp < 0) target.vitals.hp = 0
    }
    const prayedCorrectly = style === 'typeless' ? null : protects(style, prayer)
    if (!infinite && target.vitals.hp <= 0) target.alive = false
    return {
      tick,
      sourceId: source.id,
      targetId: target.id,
      attackType: style,
      baseDamage: base,
      effectiveDamage: eff,
      activePrayer: prayer,
      prayedCorrectly,
      hpBefore,
      hpAfter: target.vitals.hp,
      applyPoison,
      onKillEffect: target.alive ? undefined : hit.onKillEffect,
      expectedHit: hit.expectedHit,
    }
  }
}

/** scim: only actors with a prayer slot (the player) have one. */
function activePrayerOf(actor: Actor): PrayerId | null {
  return actor.kind === 'player' ? (actor as PlayerActor).activePrayer : null
}

export type { NpcActor }
