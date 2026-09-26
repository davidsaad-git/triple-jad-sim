/**
 * CPU mirror of the shader colour maths, used by
 * tests and by anything that needs the exact on-screen colour of a packed
 * OSRS HSL value (e.g. the 2D debug view).
 */

/** OSRS 16-bit HSL -> linear-ish RGB in 0..1 with the 0.6 palette gamma (vertex shader `hslToRgb`). */
export function hslToRgb(hsl: number): [number, number, number] {
  const hue = (hsl >> 10) / 64 + 0.0078125
  const sat = ((hsl >> 7) & 7) / 8 + 0.0625
  const lum = (hsl & 127) / 128
  let x: [number, number, number]
  if (hue < 1 / 3) x = [6 * (1 / 3 - hue), 6 * hue, 0]
  else if (hue < 2 / 3) x = [0, 6 * (2 / 3 - hue), 6 * (hue - 1 / 3)]
  else x = [6 * (hue - 2 / 3), 0, 6 * (1 - hue)]
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const c = 2 * sat * Math.min(x[i]!, 1) + (1 - sat)
    const v = lum < 0.5 ? lum * c : (1 - lum) * c + (2 * lum - 1)
    out[i] = Math.pow(v, 0.6)
  }
  return out
}

export interface DisplaySettings {
  brightness: number
  contrast: number
  saturation: number
}

/** Fragment post-processing: gain, contrast, saturation, 8-bit rounding, clamp (framebuffer). */
export function postProcess(rgb: readonly [number, number, number], s: DisplaySettings): [number, number, number] {
  const g = s.brightness / 0.6
  let r = rgb[0] * g
  let gr = rgb[1] * g
  let b = rgb[2] * g
  r = (r - 0.5) * s.contrast + 0.5
  gr = (gr - 0.5) * s.contrast + 0.5
  b = (b - 0.5) * s.contrast + 0.5
  const luma = r * 0.299 + gr * 0.587 + b * 0.114
  r = luma + (r - luma) * s.saturation
  gr = luma + (gr - luma) * s.saturation
  b = luma + (b - luma) * s.saturation
  const q = (v: number): number => Math.min(1, Math.max(0, Math.round(v * 255) / 255))
  return [q(r), q(gr), q(b)]
}

/** Final 8-bit colour of an untextured vertex colour. */
export function shadeHsl(hsl: number, s: DisplaySettings): [number, number, number] {
  const c = postProcess(hslToRgb(hsl), s)
  return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)]
}

/** Final colour of a textured texel (0..255 rgb) shaded by an OSRS light 2..126. */
export function shadeTexel(texel: readonly [number, number, number], light: number, s: DisplaySettings): [number, number, number] {
  const shade = (light & 127) / 127
  const base: [number, number, number] = [
    Math.pow(texel[0] / 255, 0.6) * shade,
    Math.pow(texel[1] / 255, 0.6) * shade,
    Math.pow(texel[2] / 255, 0.6) * shade,
  ]
  const c = postProcess(base, s)
  return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)]
}

/**
 * `hexToPackedHsl`: '#rrggbb' -> packed OSRS HSL, used for
 * tile indicators, markers and NPC highlights.
 */
export function hexToPackedHsl(hex: string): number {
  let h = hex.startsWith('#') ? hex.slice(1) : hex
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return packHsl8(0, 0, 127)
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  let hue = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) hue = 60 * (((g - b) / d) % 6)
    else if (max === g) hue = 60 * ((b - r) / d + 2)
    else hue = 60 * ((r - g) / d + 4)
  }
  if (hue < 0) hue += 360
  const c255 = (v: number): number => Math.max(0, Math.min(255, v))
  return packHsl8(c255(Math.round((hue / 360) * 255)), c255(Math.round(s * 255)), c255(Math.round(l * 255)))
}

/**: pack 8-bit hue/sat/light into OSRS 16-bit HSL. */
export function packHsl8(hue: number, sat: number, light: number): number {
  let s = sat
  if (light > 179) s = (s / 2) | 0
  if (light > 192) s = (s / 2) | 0
  if (light > 217) s = (s / 2) | 0
  if (light > 243) s = (s / 2) | 0
  return ((s / 32) << 7) + ((hue / 4) << 10) + ((light / 2) | 0)
}

/** scim's clear colour #0a0b10 (never adjusted by brightness/contrast/saturation). */
export const CLEAR_COLOR: readonly [number, number, number] = [10 / 255, 11 / 255, 16 / 255]
