/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS struct config (index 2, archive 34): a bag of params.
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { ConfigTypeLoader, decodeOpcodes, type ParamsMap, readParamsMap, unknownOpcode } from './Type'

const TYPE_NAME = 'StructType'

export class StructType {
  readonly id: number

  params: ParamsMap | null = null

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): StructType {
    const type = new StructType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 249) {
      this.params = readParamsMap(r, this.params)
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  getInt(key: number, fallback = 0): number {
    const v = this.params?.get(key)
    return typeof v === 'number' ? v : fallback
  }

  getString(key: number, fallback = ''): string {
    const v = this.params?.get(key)
    return typeof v === 'string' ? v : fallback
  }
}

export class StructTypeLoader extends ConfigTypeLoader<StructType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.Struct), StructType.decode, (id) => new StructType(id))
  }
}
