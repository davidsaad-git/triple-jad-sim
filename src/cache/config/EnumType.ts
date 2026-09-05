/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS enum config (index 2, archive 8): an int-keyed map to ints or strings.
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { ConfigTypeLoader, decodeOpcodes, unknownOpcode } from './Type'

const TYPE_NAME = 'EnumType'

export class EnumType {
  readonly id: number

  inputType: string | null = null
  outputType: string | null = null

  defaultString = 'null'
  defaultInt = 0

  outputCount = 0

  keys: number[] = []
  intValues: number[] = []
  stringValues: string[] = []

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): EnumType {
    const type = new EnumType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      this.inputType = String.fromCharCode(r.u8())
    } else if (opcode === 2) {
      this.outputType = String.fromCharCode(r.u8())
    } else if (opcode === 3) {
      this.defaultString = r.string()
    } else if (opcode === 4) {
      this.defaultInt = r.i32()
    } else if (opcode === 5) {
      this.outputCount = r.u16()
      this.keys = new Array<number>(this.outputCount)
      this.stringValues = new Array<string>(this.outputCount)
      for (let i = 0; i < this.outputCount; i++) {
        this.keys[i] = r.i32()
        this.stringValues[i] = r.string()
      }
    } else if (opcode === 6) {
      this.outputCount = r.u16()
      this.keys = new Array<number>(this.outputCount)
      this.intValues = new Array<number>(this.outputCount)
      for (let i = 0; i < this.outputCount; i++) {
        this.keys[i] = r.i32()
        this.intValues[i] = r.i32()
      }
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  getInt(key: number): number {
    const index = this.keys.indexOf(key)
    return index === -1 ? this.defaultInt : (this.intValues[index] ?? this.defaultInt)
  }

  getString(key: number): string {
    const index = this.keys.indexOf(key)
    return index === -1 ? this.defaultString : (this.stringValues[index] ?? this.defaultString)
  }
}

export class EnumTypeLoader extends ConfigTypeLoader<EnumType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.Enum), EnumType.decode, (id) => new EnumType(id))
  }
}
