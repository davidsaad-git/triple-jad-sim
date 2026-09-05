/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 * Opcode layout follows the OSRS client's HealthBarDefinition (RuneLite reference).
 *
 * OSRS health bar config (index 2, archive 33).
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { ConfigTypeLoader, decodeOpcodes, unknownOpcode } from './Type'

const TYPE_NAME = 'HealthBarType'

export class HealthBarType {
  readonly id: number

  /** Opcode 2: draw priority / sort order. */
  int1 = 255
  /** Opcode 3. */
  int2 = 255
  /** Opcode 4 (sets 0) / 11: cycles until the bar hides. */
  int3 = -1
  /** Opcode 5: cycles the bar stays after the last update. */
  int4 = 70

  frontSpriteId = -1
  backSpriteId = -1

  /** Bar width in pixels. */
  width = 30
  widthPadding = 0

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): HealthBarType {
    const type = new HealthBarType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      r.u16()
    } else if (opcode === 2) {
      this.int1 = r.u8()
    } else if (opcode === 3) {
      this.int2 = r.u8()
    } else if (opcode === 4) {
      this.int3 = 0
    } else if (opcode === 5) {
      this.int4 = r.u16()
    } else if (opcode === 6) {
      r.u8()
    } else if (opcode === 7) {
      this.frontSpriteId = r.bigSmart()
    } else if (opcode === 8) {
      this.backSpriteId = r.bigSmart()
    } else if (opcode === 11) {
      this.int3 = r.u16()
    } else if (opcode === 14) {
      this.width = r.u8()
    } else if (opcode === 15) {
      this.widthPadding = r.u8()
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }
}

export class HealthBarTypeLoader extends ConfigTypeLoader<HealthBarType> {
  constructor(cache: CacheSystem) {
    super(
      TYPE_NAME,
      cache.getConfigArchive(ConfigArchive.HealthBar),
      HealthBarType.decode,
      (id) => new HealthBarType(id),
    )
  }
}
