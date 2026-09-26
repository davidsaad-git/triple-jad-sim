import type { PendingHit } from '../combat/types'
import type { Actor, GroundItemRecord, NpcActor, PlayerActor } from './types'

/**
 * World state. The actor map's insertion order is the
 * processing order for every per-NPC loop.
 */
export class WorldState {
  tick = 0
  actors = new Map<string, Actor>()
  pendingHits: PendingHit[] = []
  groundItems: GroundItemRecord[] = []
  groundItemSeq = 0

  nextGroundItemId(): string {
    this.groundItemSeq += 1
    return `gi-${this.groundItemSeq}`
  }

  getPlayer(): PlayerActor | null {
    for (const a of this.actors.values()) if (a.kind === 'player') return a
    return null
  }

  getPlayers(): PlayerActor[] {
    const out: PlayerActor[] = []
    for (const a of this.actors.values()) if (a.kind === 'player') out.push(a)
    return out
  }

  getNpc(id: string): NpcActor | null {
    const a = this.actors.get(id)
    return a && a.kind === 'npc' ? a : null
  }

  getNpcs(): NpcActor[] {
    const out: NpcActor[] = []
    for (const a of this.actors.values()) if (a.kind === 'npc') out.push(a)
    return out
  }

  removePendingHitsBySource(id: string): void {
    this.pendingHits = this.pendingHits.filter((h) => h.sourceId !== id)
  }
}
