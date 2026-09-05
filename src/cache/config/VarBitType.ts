/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS varbit config (index 2, archive 14): a bit range within a varp.
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { ConfigTypeLoader, decodeOpcodes, unknownOpcode } from './Type'

const TYPE_NAME = 'VarBitType'

const BIT_MASKS: number[] = (() => {
  const masks: number[] = new Array<number>(33)
  for (let i = 0; i < 32; i++) {
    masks[i] = (1 << i) - 1
  }
  masks[32] = -1
  return masks
})()

export class VarBitType {
  readonly id: number

  baseVar = -1
  startBit = 0
  endBit = 0

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): VarBitType {
    const type = new VarBitType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      this.baseVar = r.u16()
      this.startBit = r.u8()
      this.endBit = r.u8()
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  /** Extracts this varbit's value from the raw varp value. */
  extract(varpValue: number): number {
    const mask = BIT_MASKS[this.endBit - this.startBit + 1] ?? -1
    return (varpValue >> this.startBit) & mask
  }

  /** Writes `value` into the varbit's bit range of `varpValue`. */
  pack(varpValue: number, value: number): number {
    const mask = (BIT_MASKS[this.endBit - this.startBit + 1] ?? -1) << this.startBit
    return (varpValue & ~mask) | ((value << this.startBit) & mask)
  }
}

export class VarBitTypeLoader extends ConfigTypeLoader<VarBitType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.Varbit), VarBitType.decode, (id) => new VarBitType(id))
  }
}
