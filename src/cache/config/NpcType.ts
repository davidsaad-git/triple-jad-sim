/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS npc config (index 2, archive 9).
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
  readTransforms,
  readU16Pairs,
  readUSmartMin1,
  resolveTransform,
  type TransformTable,
  unknownOpcode,
  type VarProvider,
} from './Type'

const TYPE_NAME = 'NpcType'

export class NpcType {
  readonly id: number

  name = 'null'
  size = 1

  modelIds: number[] = []
  chatheadModelIds: number[] = []

  idleSeqId = -1
  turnLeftSeqId = -1
  turnRightSeqId = -1

  walkSeqId = -1
  walkBackSeqId = -1
  walkLeftSeqId = -1
  walkRightSeqId = -1

  runSeqId = -1
  runBackSeqId = -1
  runLeftSeqId = -1
  runRightSeqId = -1

  crawlSeqId = -1
  crawlBackSeqId = -1
  crawlLeftSeqId = -1
  crawlRightSeqId = -1

  recolorFrom: number[] = []
  recolorTo: number[] = []

  retextureFrom: number[] = []
  retextureTo: number[] = []

  actions: (string | null)[] = [null, null, null, null, null]

  drawMapDot = true

  combatLevel = -1

  /** Attack, defence, strength, hitpoints, ranged, magic (opcodes 74-79). */
  stats: number[] = [1, 1, 1, 1, 1, 1]

  widthScale = 128
  heightScale = 128

  /** "hasRenderPriority" in the client. */
  isVisible = false

  ambient = 0
  contrast = 0

  headIconSpriteIds: number[] = []
  headIconSpriteIndices: number[] = []

  rotationSpeed = 32

  transforms: number[] | null = null
  transformVarbit = -1
  transformVarp = -1

  isInteractable = true
  isClickable = true
  isFollower = false
  lowPriorityFollowerOps = false

  category = -1

  /** Opcode 124; -1 when unset. */
  height = -1

  /** Opcode 126 (rev 224+): footprint radius in 1/128 tiles; -1 when unset. */
  footprintSize = -1
  /** Opcode 129: unknown flag. */
  unknown129 = false
  /** Opcode 130: restart the idle animation when the npc stops moving. */
  idleAnimRestart = false
  /** Opcode 145: can be hidden when overlapping the player. */
  canHideForOverlap = false
  /** Opcode 146: packed HSL tint applied while overlapping; -1 when unset. */
  overlapTintHsl = -1
  /** Opcode 147 clears this: render without depth testing. */
  zbuf = true

  /** Sub-menus and var-gated ops (opcodes 251-253); null when none. */
  ops: EntityOps | null = null

  params: ParamsMap | null = null

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): NpcType {
    const type = new NpcType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      const count = r.u8()
      this.modelIds = new Array<number>(count)
      for (let i = 0; i < count; i++) {
        this.modelIds[i] = r.u16()
      }
    } else if (opcode === 2) {
      this.name = r.string()
    } else if (opcode === 3) {
      // desc (unused in OSRS)
      r.string()
    } else if (opcode === 12) {
      this.size = r.u8()
    } else if (opcode === 13) {
      this.idleSeqId = r.u16()
    } else if (opcode === 14) {
      this.walkSeqId = r.u16()
    } else if (opcode === 15) {
      this.turnLeftSeqId = r.u16()
    } else if (opcode === 16) {
      this.turnRightSeqId = r.u16()
    } else if (opcode === 17) {
      this.walkSeqId = r.u16()
      this.walkBackSeqId = r.u16()
      this.walkLeftSeqId = r.u16()
      this.walkRightSeqId = r.u16()
    } else if (opcode === 18) {
      this.category = r.u16()
    } else if (opcode >= 30 && opcode < 35) {
      const action = r.string()
      this.actions[opcode - 30] = action.toLowerCase() === 'hidden' ? null : action
    } else if (opcode === 40) {
      ;[this.recolorFrom, this.recolorTo] = readU16Pairs(r)
    } else if (opcode === 41) {
      ;[this.retextureFrom, this.retextureTo] = readU16Pairs(r)
    } else if (opcode === 60) {
      const count = r.u8()
      this.chatheadModelIds = new Array<number>(count)
      for (let i = 0; i < count; i++) {
        this.chatheadModelIds[i] = r.u16()
      }
    } else if (opcode === 61) {
      // 32-bit model ids (rev 237+)
      const count = r.u8()
      this.modelIds = new Array<number>(count)
      for (let i = 0; i < count; i++) {
        this.modelIds[i] = r.i32()
      }
    } else if (opcode === 62) {
      const count = r.u8()
      this.chatheadModelIds = new Array<number>(count)
      for (let i = 0; i < count; i++) {
        this.chatheadModelIds[i] = r.i32()
      }
    } else if (opcode >= 74 && opcode <= 79) {
      this.stats[opcode - 74] = r.u16()
    } else if (opcode === 93) {
      this.drawMapDot = false
    } else if (opcode === 95) {
      this.combatLevel = r.u16()
    } else if (opcode === 97) {
      this.widthScale = r.u16()
    } else if (opcode === 98) {
      this.heightScale = r.u16()
    } else if (opcode === 99) {
      this.isVisible = true
    } else if (opcode === 100) {
      this.ambient = r.i8()
    } else if (opcode === 101) {
      this.contrast = r.i8() * 5
    } else if (opcode === 102) {
      // rev 210+: bitfield of present head icons, each a (sprite group, frame) pair
      const flag = r.u8()
      let count = 0
      for (let n = flag; n !== 0; n >>= 1) {
        count++
      }
      this.headIconSpriteIds = new Array<number>(count)
      this.headIconSpriteIndices = new Array<number>(count)
      for (let i = 0; i < count; i++) {
        if ((flag & (1 << i)) === 0) {
          this.headIconSpriteIds[i] = -1
          this.headIconSpriteIndices[i] = -1
        } else {
          this.headIconSpriteIds[i] = r.bigSmart()
          this.headIconSpriteIndices[i] = readUSmartMin1(r)
        }
      }
    } else if (opcode === 103) {
      this.rotationSpeed = r.u16()
    } else if (opcode === 106 || opcode === 118) {
      const table = readTransforms(r, opcode === 118)
      this.transformVarbit = table.varbit
      this.transformVarp = table.varp
      this.transforms = table.transforms
    } else if (opcode === 107) {
      this.isInteractable = false
    } else if (opcode === 109) {
      this.isClickable = false
    } else if (opcode === 111) {
      this.isFollower = true
    } else if (opcode === 114) {
      this.runSeqId = r.u16()
    } else if (opcode === 115) {
      this.runSeqId = r.u16()
      this.runBackSeqId = r.u16()
      this.runLeftSeqId = r.u16()
      this.runRightSeqId = r.u16()
    } else if (opcode === 116) {
      this.crawlSeqId = r.u16()
    } else if (opcode === 117) {
      this.crawlSeqId = r.u16()
      this.crawlBackSeqId = r.u16()
      this.crawlLeftSeqId = r.u16()
      this.crawlRightSeqId = r.u16()
    } else if (opcode === 122) {
      this.isFollower = true
    } else if (opcode === 123) {
      this.lowPriorityFollowerOps = true
    } else if (opcode === 124) {
      this.height = r.u16()
    } else if (opcode === 126) {
      this.footprintSize = r.u16()
    } else if (opcode === 129) {
      this.unknown129 = true
    } else if (opcode === 130) {
      this.idleAnimRestart = true
    } else if (opcode === 145) {
      this.canHideForOverlap = true
    } else if (opcode === 146) {
      this.overlapTintHsl = r.u16()
    } else if (opcode === 147) {
      this.zbuf = false
    } else if (opcode === 249) {
      this.params = readParamsMap(r, this.params)
    } else if (opcode === 251) {
      readSubOp(r, (this.ops ??= new EntityOps()))
    } else if (opcode === 252) {
      readConditionalOp(r, (this.ops ??= new EntityOps()))
    } else if (opcode === 253) {
      readConditionalSubOp(r, (this.ops ??= new EntityOps()))
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  get transformTable(): TransformTable | null {
    if (!this.transforms) return null
    return { varbit: this.transformVarbit, varp: this.transformVarp, transforms: this.transforms }
  }

  /** Resolves multi-npc transforms; undefined when this npc is hidden for the current vars. */
  transform(vars: VarProvider, loader: NpcTypeLoader): NpcType | undefined {
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

export class NpcTypeLoader extends ConfigTypeLoader<NpcType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.Npc), NpcType.decode, (id) => new NpcType(id))
  }
}
