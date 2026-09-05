// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.

/**
 * The client's 16-bit HSL -> 24-bit RGB palette
 * (hue 6 bits << 10 | saturation 3 bits << 7 | lightness 7 bits).
 */
export function buildPalette(brightness: number, from: number, to: number): Int32Array {
  const palette = new Int32Array(0x10000)
  let index = from * 128

  for (let hs = from; hs < to; hs++) {
    const hue = (hs >> 3) / 64 + 0.0078125
    const saturation = (hs & 7) / 8 + 0.0625

    for (let l = 0; l < 128; l++) {
      const lightness = l / 128
      let r = lightness
      let g = lightness
      let b = lightness
      if (saturation !== 0) {
        let q: number
        if (lightness < 0.5) {
          q = lightness * (1 + saturation)
        } else {
          q = lightness + saturation - lightness * saturation
        }
        const p = 2 * lightness - q
        let tr = hue + 1 / 3
        if (tr > 1) tr--
        let tb = hue - 1 / 3
        if (tb < 0) tb++

        r = hueToChannel(p, q, tr)
        g = hueToChannel(p, q, hue)
        b = hueToChannel(p, q, tb)
      }

      const rgb = (((r * 256) | 0) << 16) + (((g * 256) | 0) << 8) + ((b * 256) | 0)
      let out = brightenRgb(rgb, brightness)
      if (out === 0) out = 1
      palette[index++] = out
    }
  }
  return palette
}

function hueToChannel(p: number, q: number, t: number): number {
  if (6 * t < 1) return p + (q - p) * 6 * t
  if (2 * t < 1) return q
  if (3 * t < 2) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

export function brightenRgb(rgb: number, brightness: number): number {
  let r = (rgb >> 16) / 256
  let g = ((rgb >> 8) & 255) / 256
  let b = (rgb & 255) / 256
  r = Math.pow(r, brightness)
  g = Math.pow(g, brightness)
  b = Math.pow(b, brightness)
  return (((r * 256) | 0) << 16) | (((g * 256) | 0) << 8) | ((b * 256) | 0)
}

/** Default client brightness (0.8). */
export const HSL_RGB_MAP: Int32Array = buildPalette(0.8, 0, 512)

/** Resolve a packed HSL16 colour to 0xRRGGBB. */
export function hsl16ToRgb(hsl: number): number {
  return HSL_RGB_MAP[hsl & 0xffff]!
}

/** Replace the lightness (low 7 bits) of a packed HSL16 colour, clamped like the client. */
export function adjustLightness(hsl: number, lightness: number): number {
  lightness = ((hsl & 127) * lightness) >> 7
  if (lightness < 2) {
    lightness = 2
  } else if (lightness > 126) {
    lightness = 126
  }
  return (hsl & 0xff80) + lightness
}

export function clampLightness(lightness: number): number {
  lightness |= 0
  if (lightness < 2) return 2
  if (lightness > 126) return 126
  return lightness
}
