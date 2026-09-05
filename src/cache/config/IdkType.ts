/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS identity-kit config (index 2, archive 3): player body-part models.
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { ConfigTypeLoader, decodeOpcodes, readU16Pairs, unknownOpcode } from './Type'

const TYPE_NAME = 'IdkType'

export class IdkType {
  readonly id: number

  bodyPartId = -1

  modelIds: number[] = []

  recolorFrom: number[] = []
  recolorTo: number[] = []

  retextureFrom: number[] = []
  retextureTo: number[] = []

  /** Chat-head models (opcodes 60-69). */
  ifModelIds: number[] = [-1, -1, -1, -1, -1]

  nonSelectable = false

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): IdkType {
    const type = new IdkType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      this.bodyPartId = r.u8()
    } else if (opcode === 2) {
      const count = r.u8()
      this.modelIds = new Array<number>(count)
      for (let i = 0; i < count; i++) {
        this.modelIds[i] = r.u16()
      }
    } else if (opcode === 3) {
      this.nonSelectable = true
    } else if (opcode === 5) {
      // 32-bit model ids (rev 237+)
      const count = r.u8()
      this.modelIds = new Array<number>(count)
      for (let i = 0; i < count; i++) {
        this.modelIds[i] = r.i32()
      }
    } else if (opcode === 40) {
      ;[this.recolorFrom, this.recolorTo] = readU16Pairs(r)
    } else if (opcode === 41) {
      ;[this.retextureFrom, this.retextureTo] = readU16Pairs(r)
    } else if (opcode >= 60 && opcode < 70) {
      this.ifModelIds[opcode - 60] = r.u16()
    } else if (opcode >= 70 && opcode < 80) {
      // 32-bit chat-head model ids (rev 237+)
      this.ifModelIds[opcode - 70] = r.i32()
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }
}

export class IdkTypeLoader extends ConfigTypeLoader<IdkType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.Identkit), IdkType.decode, (id) => new IdkType(id))
  }
}
