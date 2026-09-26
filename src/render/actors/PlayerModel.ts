/**
 * Player model assembly as scim's PlayerModelLoader (`_l`, bundle
 *): default male identikit, equipment in
 * the order head, cape, amulet, weapon, body, shield, legs, hands, boots;
 * an item writes its wearPos1 slot (default slot when -1) and its wearPos2/3
 * slots; each slot loads worn model 0/1/2 by which wear position it is; no
 * player colours, no male/female offsets; lit (64, 850, -30, -50, -30).
 */
import type { IdkTypeLoader } from '../../cache/config/IdkType'
import type { ObjType, ObjTypeLoader } from '../../cache/config/ObjType'
import type { Equipment } from '../../sim/api'
import type { ModelSource } from '../model/ModelSource'
import { RenderModel, type LitColors } from '../model/RenderModel'
import { baseItemId } from './weaponData'

/** scim's default appearance `gl`. */
export const DEFAULT_APPEARANCE = { gender: 0, hair: 0, jaw: 10, torso: 18, arms: 26, hands: 33, legs: 36, feet: 42 } as const

const EQUIPMENT_ORDER: readonly [keyof Equipment, number][] = [
  ['head', 0],
  ['cape', 1],
  ['amulet', 2],
  ['weapon', 3],
  ['body', 4],
  ['shield', 5],
  ['legs', 7],
  ['hands', 9],
  ['boots', 10],
]

export interface PlayerModelData {
  model: RenderModel
  lit: LitColors
  /** 1 for faces that came from the weapon (3) or shield (5) slot. */
  weaponShieldMask: Uint8Array
  /** Largest y of the rest pose (lowest point, OSRS `minHeight`). */
  bottomY: number
  restX: Int32Array
  restY: Int32Array
  restZ: Int32Array
  restAlphas: Int8Array | null
}

export interface PlayerModelDeps {
  objs: ObjTypeLoader
  kits: IdkTypeLoader
  models: ModelSource
}

function wornModelId(obj: ObjType, gender: number, index: number): number {
  if (gender === 1) {
    const f = index === 0 ? obj.femaleModel : index === 1 ? obj.femaleModel1 : obj.femaleModel2
    if (f !== -1) return f
  }
  return index === 0 ? obj.maleModel : index === 1 ? obj.maleModel1 : obj.maleModel2
}

function hasCompleteWornModels(obj: ObjType, gender: number, deps: PlayerModelDeps): boolean {
  if (wornModelId(obj, gender, 0) < 0) return false
  const pos = [obj.wearPos1, obj.wearPos2, obj.wearPos3]
  for (const r of [0, 1, 2]) {
    if (r > 0 && pos[r]! < 0) continue
    const id = wornModelId(obj, gender, r)
    if (id >= 0 && deps.models.get(id) === undefined) return false
  }
  return true
}

/** `loadWornObj`: variants without complete worn models use their base item. */
function wornObj(id: number, gender: number, deps: PlayerModelDeps): ObjType {
  const obj = deps.objs.load(id)
  const base = baseItemId(id)
  if (base === id || hasCompleteWornModels(obj, gender, deps)) return obj
  const b = deps.objs.load(base)
  return hasCompleteWornModels(b, gender, deps) ? b : obj
}

export function buildPlayerModel(equipment: Equipment, deps: PlayerModelDeps): PlayerModelData | null {
  const gender = DEFAULT_APPEARANCE.gender
  const comp: (number | undefined)[] = new Array(12).fill(undefined)
  comp[8] = 256 + DEFAULT_APPEARANCE.hair
  comp[11] = 256 + DEFAULT_APPEARANCE.jaw
  comp[4] = 256 + DEFAULT_APPEARANCE.torso
  comp[6] = 256 + DEFAULT_APPEARANCE.arms
  comp[9] = 256 + DEFAULT_APPEARANCE.hands
  comp[7] = 256 + DEFAULT_APPEARANCE.legs
  comp[10] = 256 + DEFAULT_APPEARANCE.feet
  const objs = new Map<number, ObjType>()
  for (const [slot, defaultPos] of EQUIPMENT_ORDER) {
    const id = equipment[slot]
    if (id === undefined) continue
    const obj = wornObj(id, gender, deps)
    objs.set(obj.id, obj)
    const value = 512 + obj.id
    if (obj.wearPos1 === -1) comp[defaultPos] = value
    else comp[obj.wearPos1] = value
    if (obj.wearPos2 !== -1) comp[obj.wearPos2] = value
    if (obj.wearPos3 !== -1) comp[obj.wearPos3] = value
  }
  const parts: RenderModel[] = []
  const partSlots: number[] = []
  for (let slot = 0; slot < 12; slot++) {
    const v = comp[slot]
    if (v === undefined) continue
    if (v >= 512) {
      const obj = objs.get(v - 512) ?? deps.objs.load(v - 512)
      const index = obj.wearPos1 === slot ? 0 : obj.wearPos2 === slot ? 1 : obj.wearPos3 === slot ? 2 : 0
      const modelId = wornModelId(obj, gender, index)
      if (modelId === -1) continue
      const m = deps.models.copy(modelId)
      if (!m) continue
      for (let i = 0; i < obj.recolorFrom.length; i++) m.recolor(obj.recolorFrom[i]!, obj.recolorTo[i]!)
      for (let i = 0; i < obj.retextureFrom.length; i++) m.retexture(obj.retextureFrom[i]!, obj.retextureTo[i]!)
      parts.push(m)
      partSlots.push(slot)
    } else if (v >= 256) {
      const kit = deps.kits.load(v - 256)
      for (const modelId of kit.modelIds) {
        if (modelId === -1) continue
        const m = deps.models.copy(modelId)
        if (!m) continue
        for (let i = 0; i < kit.recolorFrom.length; i++) m.recolor(kit.recolorFrom[i]!, kit.recolorTo[i]!)
        for (let i = 0; i < kit.retextureFrom.length; i++) m.retexture(kit.retextureFrom[i]!, kit.retextureTo[i]!)
        parts.push(m)
        partSlots.push(slot)
      }
    }
  }
  if (parts.length === 0) return null
  const model = parts.length === 1 ? parts[0]! : RenderModel.merge(parts)
  model.computeAnimationTables()
  const mask = new Uint8Array(model.faceCount)
  let offset = 0
  parts.forEach((p, i) => {
    const slot = partSlots[i]!
    if (slot === 3 || slot === 5) mask.fill(1, offset, offset + p.faceCount)
    offset += p.faceCount
  })
  const lit = model.computeLitColors(64, 850, -30, -50, -30)
  model.calculateBounds()
  return {
    model,
    lit,
    weaponShieldMask: mask,
    bottomY: model.minHeight,
    restX: model.verticesX.slice(),
    restY: model.verticesY.slice(),
    restZ: model.verticesZ.slice(),
    restAlphas: model.faceAlphas ? model.faceAlphas.slice() : null,
  }
}

/** Stable key of the parts that affect the model. */
export function equipmentKey(e: Equipment): string {
  return EQUIPMENT_ORDER.map(([slot]) => e[slot] ?? -1).join(',')
}
