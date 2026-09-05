import type { MonsterDef } from '../data/inferno/monsters'
import { Actor } from './Actor'
import type { World } from './World'

/** Per-monster behaviour, invoked in the NPC phase of every tick. */
export interface NpcBehaviour {
  onSpawn?(world: World, npc: Npc): void
  onTick(world: World, npc: Npc): void
  onDamaged?(world: World, npc: Npc, amount: number, source: Actor | null): void
  onDeath?(world: World, npc: Npc): void
}

export class Npc extends Actor {
  readonly def: MonsterDef
  npcId: number
  behaviour: NpcBehaviour
  target: Actor | null = null
  spawnTick = 0
  /** Free-form per-behaviour state (dig timers, scan results...). */
  readonly memory: Record<string, number> = {}
  /** Monster-specific: whether a Jal-Zek has already revived this NPC. */
  revived = false
  /** Combat level etc. come from def; hitpoints initialised from it. */

  constructor(def: MonsterDef, behaviour: NpcBehaviour, npcId = def.npcIds[0]!) {
    super()
    this.def = def
    this.npcId = npcId
    this.behaviour = behaviour
    this.size = def.size
    this.maxHitpoints = def.levels.hitpoints
    this.hitpoints = def.levels.hitpoints
    this.removeWhenDead = false
  }

  override get name(): string {
    return this.def.name
  }

  override applyDamage(amount: number, tick: number, kind: 'damage' | 'block' | 'poison' | 'venom' | 'heal' | 'disease' = 'damage'): number {
    const dealt = super.applyDamage(amount, tick, kind)
    return dealt
  }
}
