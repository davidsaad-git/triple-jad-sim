/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS overlay floor config (index 2, archive 4).
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { floorRgbToHsl } from '../util/ColorUtil'
import { ConfigTypeLoader, decodeOpcodes, unknownOpcode } from './Type'
import type { FloorType } from './UnderlayFloorType'

const TYPE_NAME = 'OverlayFloorType'

export class OverlayFloorType implements FloorType {
  readonly id: number

  primaryRgb = 0

  textureId = -1
  secondaryTextureId = -1

  hideUnderlay = true

  secondaryRgb = -1

  hue = 0
  saturation = 0
  lightness = 0

  hueBlend = 0
  hueMultiplier = 0

  secondaryHue = 0
  secondarySaturation = 0
  secondaryLightness = 0

  textureSize = 128
  blockShadow = true
  textureBrightness = 8
  blendTexture = false

  underwaterColor = 0x122b3d
  waterOpacity = 16

  readonly isOverlay = true
  name: string | null = null

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): OverlayFloorType {
    const type = new OverlayFloorType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    type.post()
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      this.primaryRgb = r.u24()
    } else if (opcode === 2) {
      this.textureId = r.u8()
    } else if (opcode === 3) {
      this.textureId = r.u16()
      if (this.textureId === 0xffff) {
        this.textureId = -1
      }
    } else if (opcode === 5) {
      this.hideUnderlay = false
    } else if (opcode === 6) {
      this.name = r.string()
    } else if (opcode === 7) {
      this.secondaryRgb = r.u24()
    } else if (opcode === 8) {
      // nothing
    } else if (opcode === 9) {
      this.textureSize = r.u16()
    } else if (opcode === 10) {
      this.blockShadow = false
    } else if (opcode === 11) {
      this.textureBrightness = r.u8()
    } else if (opcode === 12) {
      this.blendTexture = true
    } else if (opcode === 13) {
      this.underwaterColor = r.u24()
    } else if (opcode === 14) {
      this.waterOpacity = r.u8()
    } else if (opcode === 15) {
      this.secondaryTextureId = r.u16()
      if (this.secondaryTextureId === 0xffff) {
        this.secondaryTextureId = -1
      }
    } else if (opcode === 16) {
      r.u8()
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  private post(): void {
    if (this.secondaryRgb !== -1) {
      this.setHsl(this.secondaryRgb)
      this.secondaryHue = this.hue
      this.secondarySaturation = this.saturation
      this.secondaryLightness = this.lightness
    }

    this.setHsl(this.primaryRgb)
  }

  getHueBlend(): number {
    return this.hueBlend
  }

  getHueMultiplier(): number {
    return this.hueMultiplier
  }

  setHsl(rgb: number): void {
    const hsl = floorRgbToHsl(rgb)
    this.hue = hsl.hue
    this.saturation = hsl.saturation
    this.lightness = hsl.lightness
    this.hueMultiplier = hsl.hueMultiplier
    this.hueBlend = hsl.hueBlend
  }
}

export class OverlayFloorTypeLoader extends ConfigTypeLoader<OverlayFloorType> {
  constructor(cache: CacheSystem) {
    super(
      TYPE_NAME,
      cache.getConfigArchive(ConfigArchive.Overlay),
      OverlayFloorType.decode,
      (id) => new OverlayFloorType(id),
    )
  }
}
