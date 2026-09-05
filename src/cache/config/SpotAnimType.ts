/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS spotanim (graphic effect) config (index 2, archive 13).
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { ConfigTypeLoader, decodeOpcodes, readU16Pairs, unknownOpcode } from './Type'

const TYPE_NAME = 'SpotAnimType'

export class SpotAnimType {
  readonly id: number

  modelId = -1
  sequenceId = -1

  recolorFrom: number[] = []
  recolorTo: number[] = []

  retextureFrom: number[] = []
  retextureTo: number[] = []

  widthScale = 128
  heightScale = 128

  orientation = 0

  ambient = 0
  contrast = 0

  /** Opcode 9 (rev 230+). */
  debugName: string | null = null
  /** Opcode 10 (rev 240): boolean flag, semantics not yet known. */
  flag10 = false

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): SpotAnimType {
    const type = new SpotAnimType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      this.modelId = r.u16()
    } else if (opcode === 2) {
      this.sequenceId = r.u16()
    } else if (opcode === 3) {
      // 32-bit model id (rev 237+)
      this.modelId = r.i32()
    } else if (opcode === 4) {
      this.widthScale = r.u16()
    } else if (opcode === 5) {
      this.heightScale = r.u16()
    } else if (opcode === 6) {
      this.orientation = r.u16()
    } else if (opcode === 7) {
      this.ambient = r.u8()
    } else if (opcode === 8) {
      this.contrast = r.u8()
    } else if (opcode === 9) {
      this.debugName = r.string()
    } else if (opcode === 10) {
      // rev 240: payload-less flag (verified against the raw bytes); meaning unknown
      this.flag10 = true
    } else if (opcode === 40) {
      ;[this.recolorFrom, this.recolorTo] = readU16Pairs(r)
    } else if (opcode === 41) {
      ;[this.retextureFrom, this.retextureTo] = readU16Pairs(r)
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }
}

export class SpotAnimTypeLoader extends ConfigTypeLoader<SpotAnimType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.SpotAnim), SpotAnimType.decode, (id) => new SpotAnimType(id))
  }
}
