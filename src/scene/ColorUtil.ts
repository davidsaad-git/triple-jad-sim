/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Packed-HSL colour helpers used by terrain and model shading.
 *
 * A packed HSL value is a 16-bit integer: hue (6 bits) << 10 | saturation
 * (3 bits) << 7 | lightness (7 bits). `HSL_RGB_MAP` converts a packed value to
 * 0xRRGGBB with the client's default brightness (0.8).
 */

/** Sentinel for "no colour" faces (hidden / textured-only). */
export const INVALID_HSL_COLOR = 12345678

export function brightenRgb(rgb: number, brightness: number): number {
  let r = (rgb >> 16) / 256.0
  let g = ((rgb >> 8) & 255) / 256.0
  let b = (rgb & 255) / 256.0
  r = Math.pow(r, brightness)
  g = Math.pow(g, brightness)
  b = Math.pow(b, brightness)
  const newR = (r * 256.0) | 0
  const newG = (g * 256.0) | 0
  const newB = (b * 256.0) | 0
  return (newR << 16) | (newG << 8) | newB
}

/** Build the 65536-entry packed-HSL -> RGB palette for the given brightness. */
export function buildPalette(brightness: number, start: number, end: number): Int32Array {
  const palette = new Int32Array(0xffff)
  let paletteIndex = start * 128

  for (let hs = start; hs < end; hs++) {
    const hue = (hs >> 3) / 64.0 + 0.0078125
    const sat = (hs & 7) / 8.0 + 0.0625

    for (let li = 0; li < 128; li++) {
      const light = li / 128.0
      let r = light
      let g = light
      let b = light
      if (sat !== 0.0) {
        let q: number
        if (light < 0.5) {
          q = light * (1.0 + sat)
        } else {
          q = light + sat - light * sat
        }
        const p = 2.0 * light - q
        let tr = hue + 1 / 3
        if (tr > 1.0) tr--
        let tb = hue - 1 / 3
        if (tb < 0.0) tb++

        if (6.0 * tr < 1.0) r = p + (q - p) * 6.0 * tr
        else if (2.0 * tr < 1.0) r = q
        else if (3.0 * tr < 2.0) r = p + (q - p) * (2 / 3 - tr) * 6.0
        else r = p

        if (6.0 * hue < 1.0) g = p + (q - p) * 6.0 * hue
        else if (2.0 * hue < 1.0) g = q
        else if (3.0 * hue < 2.0) g = p + (q - p) * (2 / 3 - hue) * 6.0
        else g = p

        if (6.0 * tb < 1.0) b = p + (q - p) * 6.0 * tb
        else if (2.0 * tb < 1.0) b = q
        else if (3.0 * tb < 2.0) b = p + (q - p) * (2 / 3 - tb) * 6.0
        else b = p
      }

      const rgb = (((r * 256.0) | 0) << 16) + (((g * 256.0) | 0) << 8) + ((b * 256.0) | 0)
      palette[paletteIndex++] = brightenRgb(rgb, brightness)
    }
  }
  return palette
}

/** Packed HSL -> 0xRRGGBB at the client's default brightness. */
export const HSL_RGB_MAP: Int32Array = buildPalette(0.8, 0, 512)

/** Pack 8-bit hue/saturation/lightness into the 16-bit HSL format. */
export function packHsl(hue: number, saturation: number, lightness: number): number {
  if (lightness > 179) saturation = (saturation / 2) | 0
  if (lightness > 192) saturation = (saturation / 2) | 0
  if (lightness > 217) saturation = (saturation / 2) | 0
  if (lightness > 243) saturation = (saturation / 2) | 0
  return ((saturation / 32) << 7) + ((hue / 4) << 10) + ((lightness / 2) | 0)
}

/** Average two packed HSL colours component-wise (used for tile mid-edge vertices). */
export function mixHsl(hslA: number, hslB: number): number {
  if (hslA === INVALID_HSL_COLOR || hslB === INVALID_HSL_COLOR) {
    return INVALID_HSL_COLOR
  }
  if (hslA === -1) return hslB
  if (hslB === -1) return hslA
  const hue = (((hslA >> 10) & 0x3f) + ((hslB >> 10) & 0x3f)) >> 1
  const saturation = (((hslA >> 7) & 0x7) + ((hslB >> 7) & 0x7)) >> 1
  const lightness = ((hslA & 0x7f) + (hslB & 0x7f)) >> 1
  return (hue << 10) + (saturation << 7) + lightness
}

/** Scale the lightness of a packed HSL by `light`/128, clamped to 2..126. */
export function blendLight(hsl: number, light: number): number {
  light = ((hsl & 127) * light) >> 7
  if (light < 2) light = 2
  else if (light > 126) light = 126
  return (hsl & 0xff80) + light
}

export function adjustUnderlayLight(hsl: number, light: number): number {
  if (hsl === -1) return INVALID_HSL_COLOR
  return blendLight(hsl, light)
}

/**
 * Overlay colour: -2 = hidden (magenta 0xff00ff), -1 = textured (lightness
 * only), otherwise a packed HSL.
 */
export function adjustOverlayLight(hsl: number, light: number): number {
  if (hsl === -2) return INVALID_HSL_COLOR
  if (hsl === -1) {
    if (light < 2) light = 2
    else if (light > 126) light = 126
    return light
  }
  return blendLight(hsl, light)
}

/** Floor-colour decomposition the client computes for underlays/overlays. */
export interface FloorHsl {
  /** 0..255 hue (overlay) or hue * hueMultiplier (underlay `hueBlend`). */
  hue: number
  saturation: number
  lightness: number
  /** Weight of this floor's hue in the blur (underlay `hueMultiplier`). */
  hueMultiplier: number
  /** hue (0..255) * hueMultiplier, the value summed in the underlay blur. */
  hueBlend: number
}

/** The client's rgb -> hue/sat/light + hue multiplier for floor types. */
export function rgbToFloorHsl(rgb: number): FloorHsl {
  const r = ((rgb >> 16) & 255) / 256.0
  const g = ((rgb >> 8) & 255) / 256.0
  const b = (rgb & 255) / 256.0

  let minRgb = r
  if (g < minRgb) minRgb = g
  if (b < minRgb) minRgb = b
  let maxRgb = r
  if (g > maxRgb) maxRgb = g
  if (b > maxRgb) maxRgb = b

  let hue = 0.0
  let sat = 0.0
  const light = (maxRgb + minRgb) / 2.0
  if (maxRgb !== minRgb) {
    if (light < 0.5) sat = (maxRgb - minRgb) / (maxRgb + minRgb)
    if (light >= 0.5) sat = (maxRgb - minRgb) / (2.0 - maxRgb - minRgb)
    if (maxRgb === r) hue = (g - b) / (maxRgb - minRgb)
    else if (maxRgb === g) hue = 2.0 + (b - r) / (maxRgb - minRgb)
    else if (maxRgb === b) hue = 4.0 + (r - g) / (maxRgb - minRgb)
  }
  hue /= 6.0

  let saturation = (sat * 256.0) | 0
  let lightness = (light * 256.0) | 0
  if (saturation < 0) saturation = 0
  else if (saturation > 255) saturation = 255
  if (lightness < 0) lightness = 0
  else if (lightness > 255) lightness = 255

  let hueMultiplier: number
  if (light > 0.5) hueMultiplier = (512.0 * (sat * (1.0 - light))) | 0
  else hueMultiplier = (512.0 * (sat * light)) | 0
  if (hueMultiplier < 1) hueMultiplier = 1

  return {
    hue: (hue * 256.0) | 0,
    saturation,
    lightness,
    hueMultiplier,
    hueBlend: (hueMultiplier * hue) | 0,
  }
}

/** Convenience: 0xRRGGBB -> packed HSL (no blur). */
export function rgbToHsl(rgb: number): number {
  const f = rgbToFloorHsl(rgb)
  return packHsl(f.hue, f.saturation, f.lightness)
}
