import { createAnimLoaders, type AnimLoaders } from '../../cache/anim'
import type { CacheSystem } from '../../cache/CacheSystem'
import { NpcTypeLoader, SeqTypeLoader, type NpcType, type SeqType } from '../../cache/config'
import type { Model } from '../../cache/model/Model'
import { ModelData } from '../../cache/model/ModelData'
import { ModelLoader } from '../../cache/model/ModelLoader'
import { buildModelMesh, type ModelMesh } from '../../cache/model/ModelMesh'

export interface NpcModel {
  npc: NpcType
  data: ModelData
  lit: Model
  mesh: ModelMesh
}

/**
 * Builds and caches lit NPC models the way the client does: merge the
 * config's models, apply recolours/retextures, scale by the NPC's width and
 * height, then light with its ambient/contrast offsets.
 */
export class NpcModelFactory {
  readonly npcs: NpcTypeLoader
  readonly seqs: SeqTypeLoader
  readonly models: ModelLoader
  readonly anim: AnimLoaders
  private readonly cache = new Map<number, NpcModel | null>()

  constructor(cache: CacheSystem) {
    this.npcs = new NpcTypeLoader(cache)
    this.seqs = new SeqTypeLoader(cache)
    this.models = new ModelLoader(cache)
    this.anim = createAnimLoaders(cache)
  }

  get(npcId: number): NpcModel | null {
    const cached = this.cache.get(npcId)
    if (cached !== undefined) return cached
    const built = this.build(npcId)
    this.cache.set(npcId, built)
    return built
  }

  seq(seqId: number): SeqType | undefined {
    if (seqId < 0) return undefined
    try {
      return this.seqs.load(seqId)
    } catch {
      return undefined
    }
  }

  private build(npcId: number): NpcModel | null {
    let npc: NpcType
    try {
      npc = this.npcs.load(npcId)
    } catch {
      return null
    }
    const parts = npc.modelIds.map((id) => this.models.load(id))
    if (!parts.length || parts.every((p) => !p)) return null
    const data = parts.length === 1 && parts[0] ? parts[0].copy() : ModelData.merge(parts)
    if (npc.recolorFrom.length) data.replaceColors(npc.recolorFrom, npc.recolorTo)
    if (npc.retextureFrom.length) data.replaceTextures(npc.retextureFrom, npc.retextureTo)
    if (npc.widthScale !== 128 || npc.heightScale !== 128) {
      data.scale(npc.widthScale, npc.heightScale, npc.widthScale)
    }
    const lit = data.light(npc.ambient + 64, npc.contrast + 850, -30, -50, -30)
    const mesh = buildModelMesh(lit)
    return { npc, data, lit, mesh }
  }
}
