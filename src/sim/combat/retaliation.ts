/**
 * NPC retaliation (scim queue promote, `ZO` apply).
 */
import type { NpcActor, NpcCombat, RetaliationMode } from '../core/types'
import type { WorldState } from '../core/WorldState'
import type { DamageStyle } from './types'

export function createRetaliation(mode: RetaliationMode = 'standard'): NonNullable<NpcCombat['retaliation']> {
  return { mode, pending: [], lastIncomingAttackTick: null }
}


export function setNextAction(combat: NpcCombat, tick: number, ticks: number): void {
  combat.nextActionTick = tick + ticks
}


export function applyRetaliation(npc: NpcActor, sourceId: string, tick: number): void {
  const r = npc.combat.retaliation
  if (!r) return
  switch (r.mode) {
    case 'standard': {
      const busyWithSource = npc.combat.targetId === sourceId && npc.combat.nextActionTick + 8 >= tick
      if (!busyWithSource) npc.combat.nextActionTick = Math.max(npc.combat.nextActionTick, tick + Math.floor(npc.combat.attackSpeed / 2))
      break
    }
    case 'one-tick':
      setNextAction(npc.combat, tick, 1)
      break
    case 'retarget':
      break
  }
  r.lastIncomingAttackTick = tick
  npc.combat.targetId = sourceId
}

/** scim: notify an NPC of a player attack. */
export function queueRetaliation(
  npc: NpcActor,
  hit: { sourceId: string; launchTick: number; impactTick: number; style: DamageStyle; accuracySucceeded: boolean },
): void {
  const r = npc.combat.retaliation
  if (!npc.alive || !r) return
  const splash = hit.style === 'magic' && !hit.accuracySucceeded
  const when = r.mode === 'standard' ? (splash ? hit.launchTick + 1 : hit.impactTick) : splash ? hit.launchTick : hit.impactTick
  if (when > hit.launchTick) r.pending.push({ tick: when, sourceId: hit.sourceId })
  else applyRetaliation(npc, hit.sourceId, when)
}

/** scim: deliver due retaliations at the start of the tick (stage 5). */
export function promoteRetaliation(world: WorldState): void {
  for (const npc of world.getNpcs()) {
    const r = npc.combat.retaliation
    if (!r) continue
    const pending = r.pending
    r.pending = []
    if (!npc.alive) continue
    for (const p of pending) {
      if (p.tick > world.tick) r.pending.push(p)
      else if (world.actors.get(p.sourceId)?.alive) applyRetaliation(npc, p.sourceId, world.tick)
    }
  }
}
