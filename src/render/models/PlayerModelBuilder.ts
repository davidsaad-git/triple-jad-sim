/**
 * Assembles a player model the way the client's `PlayerComposition.getModel()`
 * does, from an identikit body plus worn equipment wear models:
 *
 *  1. Resolve the twelve appearance slots. A worn item fills its `wearPos1`
 *     slot with its wear model (`maleModel`/`femaleModel`, plus `*Model1`/`*Model2`
 *     merged, shifted by `maleOffset`/`femaleOffset`, recoloured/retextured
 *     per the item config). Its `wearPos2` / `wearPos3` (opcodes 14 / 27) name
 *     the slots the item covers: a full helm is `0/8/11` (hides hair and jaw),
 *     a platebody `4/6` (hides arms), a bow `3/5` (two-handed, blocks the
 *     shield). This is what the server applies before building the appearance
 *     block. Uncovered body slots fall back to the identikit models.
 *  2. Merge all parts (`ModelData.merge`), then apply the five body colours
 *     (`BODY_COLOR_FROM[i] -> BODY_COLOR_TABLES[i][colors[i]]`).
 *  3. Light with the client's player parameters `light(64, 850, -30, -50, -30)`.
 *
 * Built models are cached per appearance key.
 */
import type { CacheSystem } from '../../cache/CacheSystem'
import { IdkTypeLoader, ObjTypeLoader, type ObjType } from '../../cache/config'
import type { Model } from '../../cache/model/Model'
import { ModelData } from '../../cache/model/ModelData'
import { ModelLoader } from '../../cache/model/ModelLoader'
import {
  APPEARANCE_SLOT_COUNT,
  appearanceKey,
  bodyColor,
  BODY_COLOR_FROM,
  EQUIPMENT_WEAR_POS,
  KIT_APPEARANCE_SLOT,
  KitIndex,
  type EquipmentSlotName,
  type PlayerAppearance,
} from './PlayerAppearance'

export interface PlayerModel {
  /** Merged, recoloured, unlit geometry (animate against this / `lit.source`). */
  data: ModelData
  /** Lit model ready for `buildModelMesh`. */
  lit: Model
}

/** What ended up in one of the twelve appearance slots. */
export type ResolvedSlot =
  | { kind: 'item'; id: number; name: string; modelIds: number[] }
  | { kind: 'kit'; id: number; bodyPart: number; modelIds: number[] }
  | { kind: 'empty'; hiddenBy?: number }

/** Player lighting: the client's `PlayerComposition` uses ambient 64, contrast 850 and the standard light vector. */
export const PLAYER_LIGHT = { ambient: 64, contrast: 850, x: -30, y: -50, z: -30 } as const

const EQUIPMENT_SLOTS = Object.keys(EQUIPMENT_WEAR_POS) as EquipmentSlotName[]

export class PlayerModelBuilder {
  private readonly objs: ObjTypeLoader
  private readonly kits: IdkTypeLoader
  private readonly models: ModelLoader
  private readonly built = new Map<string, PlayerModel>()

  constructor(cache: CacheSystem, models: ModelLoader = new ModelLoader(cache)) {
    this.objs = new ObjTypeLoader(cache)
    this.kits = new IdkTypeLoader(cache)
    this.models = models
  }

  /** Builds (or returns the cached) model for `appearance`. */
  build(appearance: PlayerAppearance): PlayerModel {
    const key = appearanceKey(appearance)
    const cached = this.built.get(key)
    if (cached) return cached

    const parts: ModelData[] = []
    for (const slot of this.resolveSlots(appearance)) {
      if (slot.kind === 'item') {
        const m = this.itemWearModel(this.objs.load(slot.id), appearance.male)
        if (m) parts.push(m)
      } else if (slot.kind === 'kit') {
        const m = this.kitModel(slot.id)
        if (m) parts.push(m)
      }
    }

    const data = parts.length === 1 && parts[0] ? parts[0] : trimVertexArrays(ModelData.merge(parts))
    for (let i = 0; i < BODY_COLOR_FROM.length; i++) {
      const to = bodyColor(i, appearance.colors[i] ?? 0)
      const from = BODY_COLOR_FROM[i]!
      if (to !== from) data.recolor(from, to)
    }
    const lit = data.light(PLAYER_LIGHT.ambient, PLAYER_LIGHT.contrast, PLAYER_LIGHT.x, PLAYER_LIGHT.y, PLAYER_LIGHT.z)
    const result: PlayerModel = { data, lit }
    this.built.set(key, result)
    return result
  }

  /**
   * The twelve appearance slots for `appearance`: worn items in their wear
   * position, kits wherever no item covers the body part, `empty` otherwise.
   */
  resolveSlots(appearance: PlayerAppearance): ResolvedSlot[] {
    const slots: ResolvedSlot[] = []
    for (let i = 0; i < APPEARANCE_SLOT_COUNT; i++) slots.push({ kind: 'empty' })
    const covered = new Map<number, number>()

    // Items first: each claims wearPos1 and covers wearPos2 / wearPos3.
    for (const name of EQUIPMENT_SLOTS) {
      const id = appearance.equipment[name]
      if (id === undefined || id < 0 || !this.objs.has(id)) continue
      const obj = this.objs.load(id)
      const pos = obj.wearPos1 >= 0 ? obj.wearPos1 : EQUIPMENT_WEAR_POS[name]
      if (pos < 0 || pos >= APPEARANCE_SLOT_COUNT) continue // ring / ammo: no appearance slot
      slots[pos] = { kind: 'item', id, name: obj.name, modelIds: wearModelIds(obj, appearance.male) }
      for (const extra of [obj.wearPos2, obj.wearPos3]) {
        if (extra >= 0 && extra < APPEARANCE_SLOT_COUNT && extra !== pos) covered.set(extra, id)
      }
    }
    // A covered slot loses whatever it held (e.g. a shield under a two-handed weapon).
    for (const [slot, by] of covered) slots[slot] = { kind: 'empty', hiddenBy: by }

    // Kits fill the uncovered body slots.
    for (const kitIndex of Object.values(KitIndex)) {
      const slot = KIT_APPEARANCE_SLOT[kitIndex]
      if (slots[slot]!.kind !== 'empty' || covered.has(slot)) continue
      const kitId = appearance.kits[kitIndex]
      if (kitId === undefined || kitId < 0 || !this.kits.has(kitId)) continue
      const kit = this.kits.load(kitId)
      slots[slot] = { kind: 'kit', id: kitId, bodyPart: kit.bodyPartId, modelIds: [...kit.modelIds] }
    }
    return slots
  }

  /** `KitDefinition.getModel()`: merged kit models with the kit's recolours. */
  kitModel(kitId: number): ModelData | undefined {
    if (!this.kits.has(kitId)) return undefined
    const kit = this.kits.load(kitId)
    const parts = this.models.loadAll(kit.modelIds)
    if (parts.length === 0) return undefined
    const model = parts.length === 1 && parts[0] ? parts[0].copy() : trimVertexArrays(ModelData.merge(parts))
    model.replaceColors(kit.recolorFrom, kit.recolorTo)
    model.replaceTextures(kit.retextureFrom, kit.retextureTo)
    return model
  }

  /** `ItemDefinition.getModel(gender)`: the worn model, offset and recoloured. */
  itemWearModel(obj: ObjType, male: boolean): ModelData | undefined {
    const ids = wearModelIds(obj, male)
    if (ids.length === 0) return undefined
    const parts = this.models.loadAll(ids)
    if (parts.length === 0) return undefined
    const model = parts.length === 1 && parts[0] ? parts[0].copy() : trimVertexArrays(ModelData.merge(parts))
    const offset = male ? obj.maleOffset : obj.femaleOffset
    if (offset !== 0) model.translate(0, offset, 0)
    model.replaceColors(obj.recolorFrom, obj.recolorTo)
    model.replaceTextures(obj.retextureFrom, obj.retextureTo)
    return model
  }

  clear(): void {
    this.built.clear()
  }
}

/**
 * `ModelData.merge` allocates the summed vertex count and de-duplicates shared
 * vertices, leaving the position arrays longer than `vertexCount`; the
 * animator sizes its output by `vertexCount` and copies whole arrays, so trim
 * them to the used length.
 */
function trimVertexArrays(m: ModelData): ModelData {
  if (m.verticesX.length !== m.vertexCount) {
    m.verticesX = m.verticesX.slice(0, m.vertexCount)
    m.verticesY = m.verticesY.slice(0, m.vertexCount)
    m.verticesZ = m.verticesZ.slice(0, m.vertexCount)
    if (m.vertexSkins) m.vertexSkins = m.vertexSkins.slice(0, m.vertexCount)
    if (m.animMayaGroups) m.animMayaGroups.length = m.vertexCount
    if (m.animMayaScales) m.animMayaScales.length = m.vertexCount
  }
  return m
}

/** Wear model ids of an item for a gender (primary first), empty when it has no wear model. */
export function wearModelIds(obj: ObjType, male: boolean): number[] {
  const primary = male ? obj.maleModel : obj.femaleModel
  if (primary < 0) return []
  const ids = [primary]
  const m1 = male ? obj.maleModel1 : obj.femaleModel1
  const m2 = male ? obj.maleModel2 : obj.femaleModel2
  if (m1 >= 0) ids.push(m1)
  if (m2 >= 0) ids.push(m2)
  return ids
}

const builders = new WeakMap<CacheSystem, PlayerModelBuilder>()

/** Builder bound to `cache` (one per cache, shared model cache). */
export function playerModelBuilder(cache: CacheSystem): PlayerModelBuilder {
  let b = builders.get(cache)
  if (!b) {
    b = new PlayerModelBuilder(cache)
    builders.set(cache, b)
  }
  return b
}

/** Convenience: build (cached) the model for `appearance` from `cache`. */
export function buildPlayerModel(cache: CacheSystem, appearance: PlayerAppearance): PlayerModel {
  return playerModelBuilder(cache).build(appearance)
}

// ------------------------------------------------------------- weapon stances

/** Sequence ids a player uses while holding a weapon (the server-sent stance set). */
export interface WeaponStance {
  idle: number
  walk: number
  walkBack: number
  sideLeft: number
  sideRight: number
  turn: number
  run: number
  attack: number
  /** Attack speed in ticks (ObjType param 14), undefined when the item has none. */
  attackSpeed?: number
  /** Attack range in tiles (ObjType param 13), undefined when the item has none. */
  attackRange?: number
  /** How the set was chosen: which table / fallback applied. */
  source: string
}

type StanceSet = Readonly<Omit<WeaponStance, 'source' | 'attackSpeed' | 'attackRange'>>

/** `human_ready` 808, `human_walk_f/b/l/r` 819-822, `human_turnonspot` 823, `human_running` 824, `human_unarmedpunch` 422. */
export const UNARMED_STANCE: StanceSet = {
  idle: 808,
  walk: 819,
  walkBack: 820,
  sideLeft: 821,
  sideRight: 822,
  turn: 823,
  run: 824,
  attack: 422,
}

/** `xbows_human_ready` 4591, `xbows_human_walk_f/b` 4226/4227, `xbows_human_run` 4228, `xbows_human_fire_and_reload_pvn` 7552. */
const CROSSBOW_STANCE: StanceSet = {
  idle: 4591,
  walk: 4226,
  walkBack: 4227,
  sideLeft: 821,
  sideRight: 822,
  turn: 823,
  run: 4228,
  attack: 7552,
}

/** Bows use the unarmed movement set with `human_bow` 426 as the attack. */
const BOW_STANCE: StanceSet = { ...UNARMED_STANCE, attack: 426 }

/** `ballista_ready` 7220, `ballista_walk` 7223, `ballista_run` 7221, `ballista_attack_pvn` 7555. */
const BALLISTA_STANCE: StanceSet = {
  idle: 7220,
  walk: 7223,
  walkBack: 7223,
  sideLeft: 7223,
  sideRight: 7223,
  turn: 7220,
  run: 7221,
  attack: 7555,
}

/**
 * Per-item stance sets where the weapon deviates from its class.
 * `xbows_human_fire_and_reload_pvn` 7552 is what the twisted bow fires with;
 * `snakeboss_blowpipe_attack` 5061; `zcb_attack_pvn` 9168; `ii_human_dart_throw_pvn` 7554;
 * `human_chinchompa_attack_pvn` 7618.
 */
const ITEM_STANCES: Record<number, StanceSet> = {
  20997: { ...BOW_STANCE, attack: 7552 }, // Twisted bow
  12926: { ...UNARMED_STANCE, attack: 5061 }, // Toxic blowpipe
  28688: { ...UNARMED_STANCE, attack: 5061 }, // Blazing blowpipe
  26374: { ...CROSSBOW_STANCE, attack: 9168 }, // Zaryte crossbow
  25865: BOW_STANCE, // Bow of faerdhinen (c)
  25867: BOW_STANCE, // Bow of faerdhinen
  11785: CROSSBOW_STANCE, // Armadyl crossbow
  21902: CROSSBOW_STANCE, // Dragon hunter crossbow
  9185: CROSSBOW_STANCE, // Rune crossbow
  11230: { ...UNARMED_STANCE, attack: 7554 }, // Dragon dart
  10034: { ...UNARMED_STANCE, attack: 7618 }, // Red chinchompa
  11959: { ...UNARMED_STANCE, attack: 7618 }, // Black chinchompa
  19481: BALLISTA_STANCE, // Heavy ballista
  19478: BALLISTA_STANCE, // Light ballista
}

const PARAM_ATTACK_RANGE = 13
const PARAM_ATTACK_SPEED = 14

function paramNumber(obj: ObjType, key: number): number | undefined {
  const v = obj.params?.get(key)
  return typeof v === 'number' ? v : undefined
}

/** Stance set for a weapon by class, inferred from its name. */
function stanceByName(name: string): { set: StanceSet; cls: string } | undefined {
  const n = name.toLowerCase()
  if (n.includes('ballista')) return { set: BALLISTA_STANCE, cls: 'ballista' }
  if (n.includes('crossbow') || n.includes("c'bow")) return { set: CROSSBOW_STANCE, cls: 'crossbow' }
  if (n.includes('blowpipe')) return { set: { ...UNARMED_STANCE, attack: 5061 }, cls: 'blowpipe' }
  if (n.includes('bow')) return { set: BOW_STANCE, cls: 'bow' }
  if (n.includes('chinchompa')) return { set: { ...UNARMED_STANCE, attack: 7618 }, cls: 'chinchompa' }
  if (n.includes('dart') || n.includes('knife') || n.includes('javelin')) {
    return { set: { ...UNARMED_STANCE, attack: 7554 }, cls: 'thrown' }
  }
  return undefined
}

/**
 * Stance / movement / attack sequences for a weapon item.
 *
 * The build-240 item configs carry no stance sequence ids: no item, struct or
 * enum param holds 808 / 4591 / 7552 / ..., and params 644-646 exist on no
 * item at all. The client only ever receives the stance set from the server's
 * appearance block, so this resolves it from a table keyed by item id, then by
 * weapon class inferred from the item name, and finally falls back to the
 * unarmed set. Attack speed and range do come from the item params (14 / 13).
 */
export function weaponStanceSequence(cache: CacheSystem, weaponItemId: number | undefined): WeaponStance {
  const objs = new ObjTypeLoader(cache)
  if (weaponItemId === undefined || weaponItemId < 0 || !objs.has(weaponItemId)) {
    return { ...UNARMED_STANCE, source: 'unarmed' }
  }
  const obj = objs.load(weaponItemId)
  const speed = paramNumber(obj, PARAM_ATTACK_SPEED)
  const range = paramNumber(obj, PARAM_ATTACK_RANGE)

  let set: StanceSet
  let source: string
  const override = ITEM_STANCES[weaponItemId]
  if (override) {
    set = override
    source = `item table (${obj.name})`
  } else {
    const byName = stanceByName(obj.name)
    if (byName) {
      set = byName.set
      source = `class ${byName.cls} (${obj.name})`
    } else {
      set = UNARMED_STANCE
      source = `unarmed fallback (${obj.name})`
    }
  }

  const out: WeaponStance = { ...set, source }
  if (speed !== undefined) out.attackSpeed = speed
  if (range !== undefined) out.attackRange = range
  return out
}

/** Item params of a weapon (sorted by key), for diagnostics of the stance derivation. */
export function describeWeaponParams(
  cache: CacheSystem,
  weaponItemId: number,
): { name: string; params: [number, number | string | bigint][] } {
  const objs = new ObjTypeLoader(cache)
  if (!objs.has(weaponItemId)) return { name: 'missing', params: [] }
  const obj = objs.load(weaponItemId)
  return { name: obj.name, params: obj.params ? [...obj.params.entries()].sort((a, b) => a[0] - b[0]) : [] }
}
