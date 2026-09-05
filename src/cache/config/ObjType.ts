/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS obj (item) config (index 2, archive 10).
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import {
  ConfigTypeLoader,
  decodeOpcodes,
  EntityOps,
  type ParamsMap,
  readConditionalOp,
  readConditionalSubOp,
  readParamsMap,
  readSubOp,
  readSubOpList,
  readU16Pairs,
  unknownOpcode,
} from './Type'

const TYPE_NAME = 'ObjType'

export const ObjStackability = {
  SOMETIMES: 0,
  ALWAYS: 1,
  NEVER: 2,
} as const
export type ObjStackability = (typeof ObjStackability)[keyof typeof ObjStackability]

export class ObjType {
  readonly id: number

  /** Inventory model id. */
  model = 0

  name = 'null'

  recolorFrom: number[] = []
  recolorTo: number[] = []

  retextureFrom: number[] = []
  retextureTo: number[] = []

  zoom2d = 2000
  xan2d = 0
  yan2d = 0
  zan2d = 0

  offsetX2d = 0
  offsetY2d = 0

  /** Unknown string (opcode 9). */
  op9: string | null = null

  stackability: ObjStackability = ObjStackability.SOMETIMES

  price = 1

  /** Wear positions (opcodes 13, 14, 27). */
  wearPos1 = -1
  wearPos2 = -1
  wearPos3 = -1

  isMembers = false

  groundActions: (string | null)[] = [null, null, 'Take', null, null]
  inventoryActions: (string | null)[] = [null, null, null, null, 'Drop']
  shiftClickIndex = -2

  maleModel = -1
  maleModel1 = -1
  maleOffset = 0

  femaleModel = -1
  femaleModel1 = -1
  femaleOffset = 0

  maleModel2 = -1
  femaleModel2 = -1

  maleHeadModel = -1
  maleHeadModel2 = -1

  femaleHeadModel = -1
  femaleHeadModel2 = -1

  /** Stack-count variants (opcodes 100-109): item id and count threshold. */
  countObj: number[] = []
  countCo: number[] = []

  /** Noted variant: the item this note stands for and the note template item. */
  note = -1
  noteTemplate = -1

  resizeX = 128
  resizeY = 128
  resizeZ = 128

  ambient = 0
  contrast = 0

  team = 0

  tradeable = true
  stockmarket = false

  /** Weight in grams (opcode 75). */
  weight = 0

  unnotedId = -1
  notedId = -1

  placeholder = -1
  placeholderTemplate = -1

  /** Inventory sub-menus (opcode 43); null when none. */
  inventoryOps: EntityOps | null = null
  /** Ground sub-menus and var-gated ops (opcodes 200-202); null when none. */
  groundOps: EntityOps | null = null

  params: ParamsMap | null = null

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): ObjType {
    const type = new ObjType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      this.model = r.u16()
    } else if (opcode === 2) {
      this.name = r.string()
    } else if (opcode === 3) {
      // desc
      r.string()
    } else if (opcode === 4) {
      this.zoom2d = r.u16()
    } else if (opcode === 5) {
      this.xan2d = r.u16()
    } else if (opcode === 6) {
      this.yan2d = r.u16()
    } else if (opcode === 7) {
      this.offsetX2d = r.i16()
    } else if (opcode === 8) {
      this.offsetY2d = r.i16()
    } else if (opcode === 9) {
      this.op9 = r.string()
    } else if (opcode === 10) {
      r.u16()
    } else if (opcode === 11) {
      this.stackability = ObjStackability.ALWAYS
    } else if (opcode === 12) {
      this.price = r.i32()
    } else if (opcode === 13) {
      this.wearPos1 = r.u8()
    } else if (opcode === 14) {
      this.wearPos2 = r.u8()
    } else if (opcode === 15) {
      this.tradeable = false
    } else if (opcode === 16) {
      this.isMembers = true
    } else if (opcode === 23) {
      this.maleModel = r.u16()
      this.maleOffset = r.u8()
    } else if (opcode === 24) {
      this.maleModel1 = r.u16()
    } else if (opcode === 25) {
      this.femaleModel = r.u16()
      this.femaleOffset = r.u8()
    } else if (opcode === 26) {
      this.femaleModel1 = r.u16()
    } else if (opcode === 27) {
      this.wearPos3 = r.u8()
    } else if (opcode >= 30 && opcode < 35) {
      const action = r.string()
      this.groundActions[opcode - 30] = action.toLowerCase() === 'hidden' ? null : action
    } else if (opcode >= 35 && opcode < 40) {
      this.inventoryActions[opcode - 35] = r.string()
    } else if (opcode === 40) {
      ;[this.recolorFrom, this.recolorTo] = readU16Pairs(r)
    } else if (opcode === 41) {
      ;[this.retextureFrom, this.retextureTo] = readU16Pairs(r)
    } else if (opcode === 42) {
      this.shiftClickIndex = r.i8()
    } else if (opcode === 43) {
      readSubOpList(r, (this.inventoryOps ??= new EntityOps()))
    } else if (opcode === 44) {
      // 32-bit model ids (rev 237+)
      this.model = r.i32()
    } else if (opcode === 45) {
      this.maleModel = r.i32()
      this.maleOffset = r.u8()
    } else if (opcode === 46) {
      this.maleModel1 = r.i32()
    } else if (opcode === 47) {
      this.maleModel2 = r.i32()
    } else if (opcode === 48) {
      this.femaleModel = r.i32()
      this.femaleOffset = r.u8()
    } else if (opcode === 49) {
      this.femaleModel1 = r.i32()
    } else if (opcode === 50) {
      this.femaleModel2 = r.i32()
    } else if (opcode === 51) {
      this.maleHeadModel = r.i32()
    } else if (opcode === 52) {
      this.maleHeadModel2 = r.i32()
    } else if (opcode === 53) {
      this.femaleHeadModel = r.i32()
    } else if (opcode === 54) {
      this.femaleHeadModel2 = r.i32()
    } else if (opcode === 65) {
      this.stockmarket = true
    } else if (opcode === 75) {
      this.weight = r.i16()
    } else if (opcode === 78) {
      this.maleModel2 = r.u16()
    } else if (opcode === 79) {
      this.femaleModel2 = r.u16()
    } else if (opcode === 90) {
      this.maleHeadModel = r.u16()
    } else if (opcode === 91) {
      this.femaleHeadModel = r.u16()
    } else if (opcode === 92) {
      this.maleHeadModel2 = r.u16()
    } else if (opcode === 93) {
      this.femaleHeadModel2 = r.u16()
    } else if (opcode === 94) {
      // category
      r.u16()
    } else if (opcode === 95) {
      this.zan2d = r.u16()
    } else if (opcode === 96) {
      // dummy item flag
      r.u8()
    } else if (opcode === 97) {
      this.note = r.u16()
    } else if (opcode === 98) {
      this.noteTemplate = r.u16()
    } else if (opcode >= 100 && opcode < 110) {
      if (this.countObj.length === 0) {
        this.countObj = new Array<number>(10).fill(0)
        this.countCo = new Array<number>(10).fill(0)
      }
      this.countObj[opcode - 100] = r.u16()
      this.countCo[opcode - 100] = r.u16()
    } else if (opcode === 110) {
      this.resizeX = r.u16()
    } else if (opcode === 111) {
      this.resizeY = r.u16()
    } else if (opcode === 112) {
      this.resizeZ = r.u16()
    } else if (opcode === 113) {
      this.ambient = r.i8()
    } else if (opcode === 114) {
      this.contrast = r.i8() * 5
    } else if (opcode === 115) {
      this.team = r.u8()
    } else if (opcode === 139) {
      this.unnotedId = r.u16()
    } else if (opcode === 140) {
      this.notedId = r.u16()
    } else if (opcode === 148) {
      this.placeholder = r.u16()
    } else if (opcode === 149) {
      this.placeholderTemplate = r.u16()
    } else if (opcode === 160) {
      // rev 239+: never stacks, even when noted
      this.stackability = ObjStackability.NEVER
    } else if (opcode === 200) {
      readSubOp(r, (this.groundOps ??= new EntityOps()))
    } else if (opcode === 201) {
      readConditionalOp(r, (this.groundOps ??= new EntityOps()))
    } else if (opcode === 202) {
      readConditionalSubOp(r, (this.groundOps ??= new EntityOps()))
    } else if (opcode === 249) {
      this.params = readParamsMap(r, this.params)
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  /** Whether this item is a note (opcodes 97/98 present). */
  get isNoted(): boolean {
    return this.note !== -1 && this.noteTemplate !== -1
  }

  get isPlaceholder(): boolean {
    return this.placeholder !== -1 && this.placeholderTemplate !== -1
  }

  /** Copies the note template's appearance over this (noted) item, as the client does. */
  genCert(template: ObjType, original: ObjType): void {
    this.model = template.model
    this.zoom2d = template.zoom2d
    this.xan2d = template.xan2d
    this.yan2d = template.yan2d
    this.zan2d = template.zan2d
    this.offsetX2d = template.offsetX2d
    this.offsetY2d = template.offsetY2d
    this.recolorFrom = template.recolorFrom
    this.recolorTo = template.recolorTo
    this.retextureFrom = template.retextureFrom
    this.retextureTo = template.retextureTo
    this.name = original.name
    this.isMembers = original.isMembers
    this.tradeable = original.tradeable
    this.price = original.price
    this.stackability = ObjStackability.ALWAYS
  }

  genPlaceholder(template: ObjType, original: ObjType): void {
    this.model = template.model
    this.zoom2d = template.zoom2d
    this.xan2d = template.xan2d
    this.yan2d = template.yan2d
    this.zan2d = template.zan2d
    this.offsetX2d = template.offsetX2d
    this.offsetY2d = template.offsetY2d
    this.recolorFrom = template.recolorFrom
    this.recolorTo = template.recolorTo
    this.retextureFrom = template.retextureFrom
    this.retextureTo = template.retextureTo
    this.stackability = template.stackability
    this.name = original.name
    this.price = 0
    this.isMembers = false
    this.tradeable = false
    this.stockmarket = false
  }

  /** Picks the stack-count variant for `count` items. */
  getCountObj(loader: ObjTypeLoader, count: number): ObjType {
    if (this.countObj.length > 0 && count > 1) {
      let newId = -1
      for (let i = 0; i < 10; i++) {
        const threshold = this.countCo[i] ?? 0
        if (count >= threshold && threshold !== 0) {
          newId = this.countObj[i] ?? -1
        }
      }
      if (newId !== -1) {
        return loader.load(newId)
      }
    }
    return this
  }

  hasRecolor(): boolean {
    return this.recolorTo.length > 0
  }

  hasRetexture(): boolean {
    return this.retextureTo.length > 0
  }
}

/**
 * Loader that also resolves noted / placeholder items the way the client does
 * (the raw config only holds the template references).
 */
export class ObjTypeLoader extends ConfigTypeLoader<ObjType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.Item), ObjType.decode, (id) => new ObjType(id))
  }

  override load(id: number): ObjType {
    const type = super.load(id)
    if (type.isNoted && type.model === 0 && type.name === 'null') {
      type.genCert(super.load(type.noteTemplate), super.load(type.note))
    } else if (type.isPlaceholder && type.model === 0 && type.name === 'null') {
      type.genPlaceholder(super.load(type.placeholderTemplate), super.load(type.placeholder))
    }
    return type
  }
}
