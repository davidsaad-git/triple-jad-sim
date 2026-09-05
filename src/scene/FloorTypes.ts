/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Minimal floor-type (underlay / overlay config) interfaces the scene needs.
 * The full config decoders live in src/cache/config; anything that can
 * produce these shapes can drive the scene builder.
 */
import { rgbToFloorHsl, type FloorHsl } from './ColorUtil'

export interface UnderlayFloor {
  readonly id: number
  /** 0xRRGGBB (config opcode 1). */
  readonly rgb: number
}

export interface OverlayFloor {
  readonly id: number
  /** Primary 0xRRGGBB (opcode 1). 0xff00ff means "hidden" (no floor drawn). */
  readonly rgb: number
  /** Texture id (opcode 2) or -1. */
  readonly textureId: number
  /** Opcode 5 clears this: the underlay shows through the non-overlay half of shaped tiles. */
  readonly hideUnderlay: boolean
  /** Secondary colour used for the minimap (opcode 7) or -1. */
  readonly secondaryRgb: number
}

export interface FloorTypeProvider {
  underlay(id: number): UnderlayFloor | undefined
  overlay(id: number): OverlayFloor | undefined
}

/** Memoises the client's rgb -> hue/sat/light/hue-multiplier decomposition per floor id. */
export class FloorColorCache {
  private readonly provider: FloorTypeProvider
  private readonly underlays = new Map<number, FloorHsl | null>()
  private readonly overlays = new Map<number, FloorHsl | null>()
  private readonly overlaySecondary = new Map<number, FloorHsl | null>()

  constructor(provider: FloorTypeProvider) {
    this.provider = provider
  }

  underlay(id: number): UnderlayFloor | undefined {
    return this.provider.underlay(id)
  }

  overlay(id: number): OverlayFloor | undefined {
    return this.provider.overlay(id)
  }

  underlayHsl(id: number): FloorHsl | null {
    let hsl = this.underlays.get(id)
    if (hsl === undefined) {
      const u = this.provider.underlay(id)
      hsl = u ? rgbToFloorHsl(u.rgb) : null
      this.underlays.set(id, hsl)
    }
    return hsl
  }

  overlayHsl(id: number): FloorHsl | null {
    let hsl = this.overlays.get(id)
    if (hsl === undefined) {
      const o = this.provider.overlay(id)
      hsl = o ? rgbToFloorHsl(o.rgb) : null
      this.overlays.set(id, hsl)
    }
    return hsl
  }

  overlaySecondaryHsl(id: number): FloorHsl | null {
    let hsl = this.overlaySecondary.get(id)
    if (hsl === undefined) {
      const o = this.provider.overlay(id)
      hsl = o && o.secondaryRgb !== -1 ? rgbToFloorHsl(o.secondaryRgb) : null
      this.overlaySecondary.set(id, hsl)
    }
    return hsl
  }
}

/** Overlay id the client treats as water when filling empty terrain. */
export const WATER_OVERLAY_ID = 5
