/**
 * Floor colour maths exactly as scim.gg computes it. These differ in rounding from the rs-map-viewer helpers in
 * src/scene/ColorUtil.ts, so the arena terrain uses these.
 */

/** Hidden / no-colour sentinel. */
export const HIDDEN_HSL = 12345678

export interface UnderlayHsl {
  /** hue256 * hueMultiplier / 256 (floored), the value summed by the blend. */
  hue: number
  saturation: number
  lightness: number
  hueMultiplier: number
}

export interface OverlayHsl {
  hue: number
  saturation: number
  lightness: number
}

function rgbToHslFloat(rgb: number): { h: number; s: number; l: number } {
  const r = ((rgb >> 16) & 255) / 256
  const g = ((rgb >> 8) & 255) / 256
  const b = (rgb & 255) / 256
  let min = r
  if (g < min) min = g
  if (b < min) min = b
  let max = r
  if (g > max) max = g
  if (b > max) max = b
  let h = 0
  let s = 0
  const l = (min + max) / 2
  if (min !== max) {
    s = l < 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min)
    h = r === max ? (g - b) / (max - min) : g === max ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min)
  }
  h /= 6
  return { h, s, l }
}

/** Underlay definition colour. */
export function underlayHsl(rgb: number): UnderlayHsl {
  const { h, s, l } = rgbToHslFloat(rgb)
  let hue = Math.floor(h * 256)
  let saturation = Math.floor(s * 256)
  let lightness = Math.floor(l * 256)
  if (saturation < 0) saturation = 0
  else if (saturation > 255) saturation = 255
  if (lightness < 0) lightness = 0
  else if (lightness > 255) lightness = 255
  let hueMultiplier = Math.floor(l > 0.5 ? (1 - l) * s * 512 : l * s * 512)
  if (hueMultiplier < 1) hueMultiplier = 1
  hue = Math.floor((hue * hueMultiplier) / 256)
  return { hue, saturation, lightness, hueMultiplier }
}

/** Overlay definition colour. */
export function overlayHsl(rgb: number): OverlayHsl {
  const { h, s, l } = rgbToHslFloat(rgb)
  return { hue: Math.floor(h * 256), saturation: Math.floor(s * 256), lightness: Math.floor(l * 256) }
}

/**: pack 8-bit hue/sat/light into 16-bit OSRS HSL. */
export function packHsl(hue: number, sat: number, light: number): number {
  let s = sat
  if (light > 179) s = (s / 2) | 0
  if (light > 192) s = (s / 2) | 0
  if (light > 217) s = (s / 2) | 0
  if (light > 243) s = (s / 2) | 0
  return ((s / 32) << 7) + ((hue / 4) << 10) + ((light / 2) | 0)
}

/**: underlay corner colour. */
export function underlayCorner(hsl: number, light: number): number {
  if (hsl === -1) return HIDDEN_HSL
  let l = ((hsl & 127) * light) >> 7
  if (l < 2) l = 2
  else if (l > 126) l = 126
  return (hsl & 0xff80) + l
}

/** `kl`: overlay corner colour (-2 hidden, -1 textured). */
export function overlayCorner(hsl: number, light: number): number {
  if (hsl === -2) return HIDDEN_HSL
  if (hsl === -1) {
    let l = light
    if (l < 2) l = 2
    else if (l > 126) l = 126
    return l
  }
  let l = ((hsl & 127) * light) >> 7
  if (l < 2) l = 2
  else if (l > 126) l = 126
  return (hsl & 0xff80) + l
}

/** `jl`: component-wise average of two packed colours. */
export function mixHsl(a: number, b: number): number {
  if (a === HIDDEN_HSL || b === HIDDEN_HSL) return HIDDEN_HSL
  if (a === -1) return b
  if (b === -1) return a
  const h = (((a >> 10) & 63) + ((b >> 10) & 63)) >> 1
  const s = (((a >> 7) & 7) + ((b >> 7) & 7)) >> 1
  const l = ((a & 127) + (b & 127)) >> 1
  return (h << 10) + (s << 7) + l
}

/**: '#rrggbb' style 24-bit colour to packed HSL (overlay colours). */
export function rgbToPackedHsl(rgb: number): number {
  const { h, s, l } = rgbToHslFloat(rgb)
  let hue = (h * 256) | 0
  let sat = (s * 256) | 0
  let light = (l * 256) | 0
  hue = hue | 0
  if (sat < 0) sat = 0
  else if (sat > 255) sat = 255
  if (light < 0) light = 0
  else if (light > 255) light = 255
  return packHsl(hue, sat, light)
}
