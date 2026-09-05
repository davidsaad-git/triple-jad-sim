/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS loc (object/location) config (index 2, archive 6).
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { LocModelType } from './LocModelType'
import {
  ConfigTypeLoader,
  decodeOpcodes,
  EntityOps,
  type ParamsMap,
  readConditionalOp,
  readConditionalSubOp,
  readParamsMap,
  readSubOp,
  readTransforms,
  readU16Array,
  readU16OrNone,
  readU16Pairs,
  resolveTransform,
  type TransformTable,
  unknownOpcode,
  type VarProvider,
} from './Type'

const TYPE_NAME = 'LocType'

export const DEFAULT_DECOR_DISPLACEMENT = 16

export class LocType {
  readonly id: number

  /**
   * Model ids per shape. When `types` is null all models in `models[0]` are
   * used for every shape; otherwise `models[i]` belongs to shape `types[i]`.
   */
  models: number[][] = []
  types: number[] | null = null

  name = 'null'
  desc: string | null = null

  recolorFrom: number[] = []
  recolorTo: number[] = []

  retextureFrom: number[] = []
  retextureTo: number[] = []

  sizeX = 1
  sizeY = 1

  /** 0 = no clipping, 1 = blocks movement but not projectiles ("solid"), 2 = blocks all (default). */
  clipType = 2
  blocksProjectile = true

  /** -1 = derive in post(); 0/1 otherwise ("wallOrDoor" in the client). */
  isInteractive = -1

  /** -1 = flat; 0 = follow terrain (opcode 21); otherwise the opcode-81 height scale * 256. */
  contouredGround = -1
  contourGroundType = 0
  contourGroundParam = -1

  mergeNormals = false
  modelClipped = false

  seqId = -1

  decorDisplacement = DEFAULT_DECOR_DISPLACEMENT

  ambient = 0
  contrast = 0

  actions: (string | null)[] = [null, null, null, null, null]

  /** Map area/function id (opcode 82 in OSRS). */
  mapFunctionId = -1
  mapSceneId = -1
  flipMapSceneSprite = false

  isRotated = false

  clipped = true

  modelSizeX = 128
  modelSizeHeight = 128
  modelSizeY = 128

  offsetX = 0
  offsetHeight = 0
  offsetY = 0

  obstructsGround = false

  isHollow = false

  supportItems = -1

  transforms: number[] | null = null
  transformVarbit = -1
  transformVarp = -1

  ambientSoundId = -1
  ambientSoundDistance = 0
  ambientSoundChangeTicksMin = 0
  ambientSoundChangeTicksMax = 0
  ambientSoundRetain = 0
  ambientSoundIds: number[] = []

  seqRandomStart = true

  randomSeqIds: number[] = []
  randomSeqDelays: number[] = []

  /** Sub-menus and var-gated ops (opcodes 100-102); null when none. */
  ops: EntityOps | null = null

  params: ParamsMap | null = null

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): LocType {
    const type = new LocType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    type.post()
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1 || opcode === 6) {
      // one model per shape; opcode 6 uses 32-bit model ids (rev 237+)
      const count = r.u8()
      if (count > 0) {
        this.models = new Array<number[]>(count)
        this.types = new Array<number>(count)
        for (let i = 0; i < count; i++) {
          this.models[i] = [opcode === 6 ? r.i32() : r.u16()]
          this.types[i] = r.u8()
        }
      }
    } else if (opcode === 2) {
      this.name = r.string()
    } else if (opcode === 3) {
      this.desc = r.string()
    } else if (opcode === 5 || opcode === 7) {
      // shape-less model list; opcode 7 uses 32-bit model ids (rev 237+)
      const count = r.u8()
      if (count > 0) {
        this.types = null
        const models: number[] = new Array<number>(count)
        for (let i = 0; i < count; i++) {
          models[i] = opcode === 7 ? r.i32() : r.u16()
        }
        this.models = [models]
      }
    } else if (opcode === 14) {
      this.sizeX = r.u8()
    } else if (opcode === 15) {
      this.sizeY = r.u8()
    } else if (opcode === 17) {
      this.clipType = 0
      this.blocksProjectile = false
    } else if (opcode === 18) {
      this.blocksProjectile = false
    } else if (opcode === 19) {
      this.isInteractive = r.u8()
    } else if (opcode === 21) {
      this.contouredGround = 0
      this.contourGroundType = 1
    } else if (opcode === 22) {
      this.mergeNormals = true
    } else if (opcode === 23) {
      this.modelClipped = true
    } else if (opcode === 24) {
      this.seqId = readU16OrNone(r)
    } else if (opcode === 27) {
      this.clipType = 1
    } else if (opcode === 28) {
      this.decorDisplacement = r.u8()
    } else if (opcode === 29) {
      this.ambient = r.i8()
    } else if (opcode === 39) {
      this.contrast = r.i8() * 25
    } else if (opcode >= 30 && opcode < 35) {
      const action = r.string()
      this.actions[opcode - 30] = action.toLowerCase() === 'hidden' ? null : action
    } else if (opcode === 40) {
      ;[this.recolorFrom, this.recolorTo] = readU16Pairs(r)
    } else if (opcode === 41) {
      ;[this.retextureFrom, this.retextureTo] = readU16Pairs(r)
    } else if (opcode === 61) {
      // category
      r.u16()
    } else if (opcode === 62) {
      this.isRotated = true
    } else if (opcode === 64) {
      this.clipped = false
    } else if (opcode === 65) {
      this.modelSizeX = r.u16()
    } else if (opcode === 66) {
      this.modelSizeHeight = r.u16()
    } else if (opcode === 67) {
      this.modelSizeY = r.u16()
    } else if (opcode === 68) {
      this.mapSceneId = r.u16()
    } else if (opcode === 69) {
      // blocked directions bitmask
      r.u8()
    } else if (opcode === 70) {
      this.offsetX = r.i16()
    } else if (opcode === 71) {
      this.offsetHeight = r.i16()
    } else if (opcode === 72) {
      this.offsetY = r.i16()
    } else if (opcode === 73) {
      this.obstructsGround = true
    } else if (opcode === 74) {
      this.isHollow = true
    } else if (opcode === 75) {
      this.supportItems = r.u8()
    } else if (opcode === 77 || opcode === 92) {
      const table = readTransforms(r, opcode === 92)
      this.transformVarbit = table.varbit
      this.transformVarp = table.varp
      this.transforms = table.transforms
    } else if (opcode === 78) {
      this.ambientSoundId = r.u16()
      this.ambientSoundDistance = r.u8()
      this.ambientSoundRetain = r.u8()
    } else if (opcode === 79) {
      this.ambientSoundChangeTicksMin = r.u16()
      this.ambientSoundChangeTicksMax = r.u16()
      this.ambientSoundDistance = r.u8()
      this.ambientSoundRetain = r.u8()
      this.ambientSoundIds = readU16Array(r, r.u8())
    } else if (opcode === 81) {
      this.contouredGround = r.u8() * 256
      this.contourGroundType = 2
      this.contourGroundParam = (this.contouredGround << 16) >> 16
    } else if (opcode === 82) {
      this.mapFunctionId = r.u16()
    } else if (opcode === 89) {
      this.seqRandomStart = false
    } else if (opcode === 90) {
      // unknown boolean
    } else if (opcode === 91) {
      // bgsound drop-off easing
      r.u8()
    } else if (opcode === 93) {
      // bgsound ease in/out: type u8, duration u16, type u8, duration u16
      r.skip(6)
    } else if (opcode === 94) {
      // unknown boolean
    } else if (opcode === 95) {
      // crossworld sound
      r.u8()
    } else if (opcode === 96) {
      // thickness
      r.u8()
    } else if (opcode === 100) {
      readSubOp(r, (this.ops ??= new EntityOps()))
    } else if (opcode === 101) {
      readConditionalOp(r, (this.ops ??= new EntityOps()))
    } else if (opcode === 102) {
      readConditionalSubOp(r, (this.ops ??= new EntityOps()))
    } else if (opcode === 106) {
      const count = r.u8()
      this.randomSeqIds = new Array<number>(count)
      this.randomSeqDelays = new Array<number>(count)
      for (let i = 0; i < count; i++) {
        this.randomSeqIds[i] = r.u16()
        this.randomSeqDelays[i] = r.u8()
      }
    } else if (opcode >= 150 && opcode < 155) {
      const action = r.string()
      this.actions[opcode - 150] = action.toLowerCase() === 'hidden' ? null : action
    } else if (opcode === 249) {
      this.params = readParamsMap(r, this.params)
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  private post(): void {
    if (this.isInteractive === -1) {
      this.isInteractive = 0
      if (this.models.length > 0 && (!this.types || this.types[0] === LocModelType.NORMAL)) {
        this.isInteractive = 1
      }

      for (let i = 0; i < 5; i++) {
        if (this.actions[i]) {
          this.isInteractive = 1
        }
      }
    }

    if (this.supportItems === -1) {
      this.supportItems = this.clipType !== 0 ? 1 : 0
    }
  }

  /** Model ids used for the given shape, or an empty array when the shape has none. */
  getModelIds(type: number): number[] {
    if (!this.types) {
      return this.models[0] ?? []
    }
    for (let i = 0; i < this.types.length; i++) {
      if (this.types[i] === type) {
        return this.models[i] ?? []
      }
    }
    return []
  }

  get transformTable(): TransformTable | null {
    if (!this.transforms) return null
    return { varbit: this.transformVarbit, varp: this.transformVarp, transforms: this.transforms }
  }

  /** Resolves multi-loc transforms; undefined when this loc is hidden for the current vars. */
  transform(vars: VarProvider, loader: LocTypeLoader): LocType | undefined {
    if (!this.transforms) {
      return undefined
    }
    const transformId = resolveTransform(this.transformTable, vars)
    if (transformId === -1) {
      return undefined
    }
    return loader.load(transformId)
  }
}

export class LocTypeLoader extends ConfigTypeLoader<LocType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.Object), LocType.decode, (id) => new LocType(id))
  }
}
