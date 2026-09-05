/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS underlay floor config (index 2, archive 1).
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { floorRgbToHsl } from '../util/ColorUtil'
import { ConfigTypeLoader, decodeOpcodes, unknownOpcode } from './Type'

const TYPE_NAME = 'UnderlayFloorType'

export interface FloorType {
  readonly id: number
  hue: number
  saturation: number
  lightness: number
  isOverlay: boolean
  getHueBlend(): number
  getHueMultiplier(): number
}

export class UnderlayFloorType implements FloorType {
  readonly id: number

  rgbColor = 0

  /** For underlays `hue` is already weighted by `hueMultiplier` (client behaviour). */
  hue = 0
  saturation = 0
  lightness = 0
  hueMultiplier = 0

  readonly isOverlay = false

  textureId = -1
  textureSize = 128
  blockShadow = true

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): UnderlayFloorType {
    const type = new UnderlayFloorType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    type.post()
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      this.rgbColor = r.u24()
    } else if (opcode === 2) {
      this.textureId = r.u16()
      if (this.textureId === 0xffff) {
        this.textureId = -1
      }
    } else if (opcode === 3) {
      this.textureSize = r.u16()
    } else if (opcode === 4) {
      this.blockShadow = false
    } else if (opcode === 5) {
      // unused
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  private post(): void {
    this.setHsl(this.rgbColor)
  }

  getHueBlend(): number {
    return this.hue
  }

  getHueMultiplier(): number {
    return this.hueMultiplier
  }

  setHsl(rgb: number): void {
    const hsl = floorRgbToHsl(rgb)
    this.saturation = hsl.saturation
    this.lightness = hsl.lightness
    this.hueMultiplier = hsl.hueMultiplier
    this.hue = hsl.hueBlend
  }
}

export class UnderlayFloorTypeLoader extends ConfigTypeLoader<UnderlayFloorType> {
  constructor(cache: CacheSystem) {
    super(
      TYPE_NAME,
      cache.getConfigArchive(ConfigArchive.Underlay),
      UnderlayFloorType.decode,
      (id) => new UnderlayFloorType(id),
    )
  }
}
