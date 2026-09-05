import type { CacheSystem } from '../../cache/CacheSystem'
import type { Model } from '../../cache/model/Model'
import { buildModelMesh, type ModelMesh } from '../../cache/model/ModelMesh'
import type { Actor } from '../../engine/Actor'
import { Pillar } from '../../engine/inferno/Pillar'
import type { Loadout } from '../../engine/Loadout'
import { Npc } from '../../engine/Npc'
import { Player } from '../../engine/Player'
import type { LocModelLoader } from '../../scene'
import { appearanceKey, defaultAppearance, type PlayerAppearance } from '../models/PlayerAppearance'
import { buildPlayerModel } from '../models/PlayerModelBuilder'
import { NpcModelFactory } from './NpcModelFactory'

export interface ResolvedModel {
  /** Changes when the visual identity changes (gear swap, NPC transform). */
  key: string
  lit: Model
  mesh: ModelMesh
  /** False for static props that never animate. */
  animated: boolean
}

/** Object id of a standing Rocky support pillar. */
export const PILLAR_LOC_ID = 30353

/**
 * Maps engine actors to renderable models: NPCs through their config, the
 * player through identikit + worn equipment, pillars through their object.
 */
export class ActorModelResolver {
  readonly npcs: NpcModelFactory
  private readonly cache: CacheSystem
  private readonly locModels: LocModelLoader
  private readonly loadoutOf: (player: Player) => Loadout
  private readonly playerMeshes = new Map<string, ResolvedModel>()
  private pillarModel: ResolvedModel | null | undefined

  constructor(cache: CacheSystem, locModels: LocModelLoader, loadoutOf: (player: Player) => Loadout) {
    this.cache = cache
    this.npcs = new NpcModelFactory(cache)
    this.locModels = locModels
    this.loadoutOf = loadoutOf
  }

  resolve(actor: Actor): ResolvedModel | null {
    if (actor instanceof Npc) {
      const m = this.npcs.get(actor.npcId)
      return m ? { key: `npc:${actor.npcId}`, lit: m.lit, mesh: m.mesh, animated: true } : null
    }
    if (actor instanceof Player) return this.player(actor)
    if (actor instanceof Pillar) return this.pillar()
    return null
  }

  /** Sequence to play when the actor has no explicit animation. */
  defaultSequence(actor: Actor): number {
    if (actor instanceof Npc) {
      const anims = actor.def.animations
      const type = this.npcs.get(actor.npcId)?.npc
      const walk = anims.walk >= 0 ? anims.walk : (type?.walkSeqId ?? -1)
      const idle = anims.idle >= 0 ? anims.idle : (type?.idleSeqId ?? -1)
      return actor.stepsThisTick > 0 && walk >= 0 ? walk : idle
    }
    if (actor instanceof Player) {
      const w = this.loadoutOf(actor).weapon
      if (actor.stepsThisTick >= 2) return w.runAnimation
      if (actor.stepsThisTick === 1) return w.walkAnimation
      return w.idleAnimation
    }
    return -1
  }

  private player(player: Player): ResolvedModel | null {
    const loadout = this.loadoutOf(player)
    const appearance: PlayerAppearance = defaultAppearance(true)
    for (const [slot, item] of Object.entries(loadout.equipment)) {
      if (item) (appearance.equipment as Record<string, number>)[slot] = item.id
    }
    const key = `player:${appearanceKey(appearance)}`
    const cached = this.playerMeshes.get(key)
    if (cached) return cached
    try {
      const model = buildPlayerModel(this.cache, appearance)
      const resolved: ResolvedModel = { key, lit: model.lit, mesh: buildModelMesh(model.lit), animated: true }
      this.playerMeshes.set(key, resolved)
      return resolved
    } catch (e) {
      console.warn('player model failed', e)
      this.playerMeshes.set(key, null as unknown as ResolvedModel)
      return null
    }
  }

  private pillar(): ResolvedModel | null {
    if (this.pillarModel !== undefined) return this.pillarModel
    const type = this.locModels.resolveLocType(PILLAR_LOC_ID)
    const lit = type ? this.locModels.getModel(type, 10, 0) : undefined
    this.pillarModel = lit ? { key: `loc:${PILLAR_LOC_ID}`, lit, mesh: buildModelMesh(lit), animated: false } : null
    return this.pillarModel
  }
}
