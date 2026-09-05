/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 * Opcode layout follows the OSRS client's HitSplatDefinition (RuneLite reference).
 *
 * OSRS hitsplat config (index 2, archive 32).
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import {
  ConfigTypeLoader,
  decodeOpcodes,
  readTransforms,
  resolveTransform,
  type TransformTable,
  unknownOpcode,
  type VarProvider,
} from './Type'

const TYPE_NAME = 'HitsplatType'

export class HitsplatType {
  readonly id: number

  fontId = -1
  textColor = 0xffffff

  leftSpriteId = -1
  leftSprite2Id = -1
  backgroundSpriteId = -1
  rightSpriteId = -1

  scrollToOffsetX = 0
  scrollToOffsetY = 0

  /** Format string; "%1" is replaced with the damage. */
  stringFormat: string | null = null

  displayCycles = 70
  fadeStartCycle = -1

  useDamage = -1
  textOffsetY = 0

  transforms: number[] | null = null
  transformVarbit = -1
  transformVarp = -1

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): HitsplatType {
    const type = new HitsplatType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      this.fontId = r.bigSmart()
    } else if (opcode === 2) {
      this.textColor = r.u24()
    } else if (opcode === 3) {
      this.leftSpriteId = r.bigSmart()
    } else if (opcode === 4) {
      this.leftSprite2Id = r.bigSmart()
    } else if (opcode === 5) {
      this.backgroundSpriteId = r.bigSmart()
    } else if (opcode === 6) {
      this.rightSpriteId = r.bigSmart()
    } else if (opcode === 7) {
      this.scrollToOffsetX = r.i16()
    } else if (opcode === 8) {
      this.stringFormat = r.versionedString()
    } else if (opcode === 9) {
      this.displayCycles = r.u16()
    } else if (opcode === 10) {
      this.scrollToOffsetY = r.i16()
    } else if (opcode === 11) {
      this.fadeStartCycle = 0
    } else if (opcode === 12) {
      this.useDamage = r.u8()
    } else if (opcode === 13) {
      this.textOffsetY = r.i16()
    } else if (opcode === 14) {
      this.fadeStartCycle = r.u16()
    } else if (opcode === 17 || opcode === 18) {
      const table = readTransforms(r, opcode === 18)
      this.transformVarbit = table.varbit
      this.transformVarp = table.varp
      this.transforms = table.transforms
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  get transformTable(): TransformTable | null {
    if (!this.transforms) return null
    return { varbit: this.transformVarbit, varp: this.transformVarp, transforms: this.transforms }
  }

  transform(vars: VarProvider, loader: HitsplatTypeLoader): HitsplatType | undefined {
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

export class HitsplatTypeLoader extends ConfigTypeLoader<HitsplatType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.Hitsplat), HitsplatType.decode, (id) => new HitsplatType(id))
  }
}
