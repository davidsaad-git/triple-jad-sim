/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Colour helpers matching the OSRS client: the packed 16-bit HSL colour format
 * (6 bits hue, 3 bits saturation, 7 bits lightness) used by models and floors,
 * the HSL -> RGB palette with gamma ("brightness") adjustment, and the lighting
 * blend helpers used when shading terrain.
 */

/** Sentinel for "no colour" results from the HSL blend helpers. */
export const INVALID_HSL_COLOR = 12345678

/**
 * Gamma-adjusts a packed 0xRRGGBB colour the way the client's
 * `Rasterizer3D.setBrightness` does (component ** brightness).
 */
export function brightenRgb(rgb: number, brightness: number): number {
  let r = ((rgb >> 16) & 255) / 256.0
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

/**
 * Builds the 65536-entry packed-HSL -> 0xRRGGBB lookup table for the given
 * brightness (the client uses 0.8 by default). `from`/`to` select the hue/sat
 * rows (0..512) to fill.
 */
export function buildPalette(brightness: number, from = 0, to = 512): Int32Array {
  const palette = new Int32Array(0x10000)

  let paletteIndex = from * 128

  for (let hs = from; hs < to; hs++) {
    const hue = (hs >> 3) / 64.0 + 0.0078125
    const sat = (hs & 7) / 8.0 + 0.0625

    for (let l = 0; l < 128; l++) {
      const light = l / 128.0
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
        let tr = hue + 0.3333333333333333
        if (tr > 1.0) {
          tr--
        }

        let tb = hue - 0.3333333333333333
        if (tb < 0.0) {
          tb++
        }

        if (6.0 * tr < 1.0) {
          r = p + (q - p) * 6.0 * tr
        } else if (2.0 * tr < 1.0) {
          r = q
        } else if (3.0 * tr < 2.0) {
          r = p + (q - p) * (0.6666666666666666 - tr) * 6.0
        } else {
          r = p
        }

        if (6.0 * hue < 1.0) {
          g = p + (q - p) * 6.0 * hue
        } else if (2.0 * hue < 1.0) {
          g = q
        } else if (3.0 * hue < 2.0) {
          g = p + (q - p) * (0.6666666666666666 - hue) * 6.0
        } else {
          g = p
        }

        if (6.0 * tb < 1.0) {
          b = p + (q - p) * 6.0 * tb
        } else if (2.0 * tb < 1.0) {
          b = q
        } else if (3.0 * tb < 2.0) {
          b = p + (q - p) * (0.6666666666666666 - tb) * 6.0
        } else {
          b = p
        }
      }

      const ri = (r * 256.0) | 0
      const gi = (g * 256.0) | 0
      const bi = (b * 256.0) | 0
      const rgb = (ri << 16) + (gi << 8) + bi

      palette[paletteIndex++] = brightenRgb(rgb, brightness)
    }
  }

  return palette
}

/** Default client palette (brightness 0.8): packed HSL -> 0xRRGGBB. */
export const HSL_RGB_MAP: Int32Array = buildPalette(0.8, 0, 512)

/** Looks up a packed 16-bit HSL colour in the default palette. */
export function hslToRgb(hsl: number): number {
  return HSL_RGB_MAP[hsl & 0xffff]!
}

/** Packs 8-bit hue/saturation/lightness into the client's 16-bit HSL format. */
export function packHsl(hue: number, saturation: number, lightness: number): number {
  if (lightness > 179) {
    saturation = (saturation / 2) | 0
  }

  if (lightness > 192) {
    saturation = (saturation / 2) | 0
  }

  if (lightness > 217) {
    saturation = (saturation / 2) | 0
  }

  if (lightness > 243) {
    saturation = (saturation / 2) | 0
  }

  return ((saturation / 32) << 7) + ((hue / 4) << 10) + ((lightness / 2) | 0)
}

export interface Hsl {
  /** 0..63 */
  hue: number
  /** 0..7 */
  saturation: number
  /** 0..127 */
  lightness: number
}

/** Splits a packed 16-bit HSL colour into its components. */
export function unpackHsl(hsl: number): Hsl {
  return {
    hue: (hsl >> 10) & 0x3f,
    saturation: (hsl >> 7) & 0x7,
    lightness: hsl & 0x7f,
  }
}

/** Averages two packed HSL colours (component-wise). */
export function mixHsl(hslA: number, hslB: number): number {
  if (hslA === INVALID_HSL_COLOR || hslB === INVALID_HSL_COLOR) {
    return INVALID_HSL_COLOR
  }
  if (hslA === -1) {
    return hslB
  } else if (hslB === -1) {
    return hslA
  } else {
    let hue = (hslA >> 10) & 0x3f
    let saturation = (hslA >> 7) & 0x7
    let lightness = hslA & 0x7f

    const hueB = (hslB >> 10) & 0x3f
    const saturationB = (hslB >> 7) & 0x7
    const lightnessB = hslB & 0x7f

    hue += hueB
    saturation += saturationB
    lightness += lightnessB

    hue >>= 1
    saturation >>= 1
    lightness >>= 1

    return (hue << 10) + (saturation << 7) + lightness
  }
}

/** Converts 0xRRGGBB to the client's packed 16-bit HSL. */
export function rgbToHsl(rgb: number): number {
  const r = ((rgb >> 16) & 255) / 256.0
  const g = ((rgb >> 8) & 255) / 256.0
  const b = (rgb & 255) / 256.0

  let minRgb = r
  if (g < r) {
    minRgb = g
  }
  if (b < minRgb) {
    minRgb = b
  }

  let maxRgb = r
  if (g > r) {
    maxRgb = g
  }
  if (b > maxRgb) {
    maxRgb = b
  }

  let hueTemp = 0.0
  let sat = 0.0
  const light = (minRgb + maxRgb) / 2.0
  if (minRgb !== maxRgb) {
    if (light < 0.5) {
      sat = (maxRgb - minRgb) / (minRgb + maxRgb)
    }

    if (light >= 0.5) {
      sat = (maxRgb - minRgb) / (2.0 - maxRgb - minRgb)
    }

    if (maxRgb === r) {
      hueTemp = (g - b) / (maxRgb - minRgb)
    } else if (maxRgb === g) {
      hueTemp = 2.0 + (b - r) / (maxRgb - minRgb)
    } else if (maxRgb === b) {
      hueTemp = 4.0 + (r - g) / (maxRgb - minRgb)
    }
  }

  hueTemp /= 6.0

  const hue = (hueTemp * 256.0) | 0
  let saturation = (sat * 256.0) | 0
  let lightness = (light * 256.0) | 0
  if (saturation < 0) {
    saturation = 0
  } else if (saturation > 255) {
    saturation = 255
  }

  if (lightness < 0) {
    lightness = 0
  } else if (lightness > 255) {
    lightness = 255
  }

  return packHsl(hue, saturation, lightness)
}

/** Scales the lightness of a packed HSL colour by `lightness` (128 = 1.0), clamped to 2..126. */
export function blendLight(hsl: number, lightness: number): number {
  lightness = ((hsl & 127) * lightness) >> 7
  if (lightness < 2) {
    lightness = 2
  } else if (lightness > 126) {
    lightness = 126
  }

  return (hsl & 0xff80) + lightness
}

export function adjustUnderlayLight(hsl: number, light: number): number {
  if (hsl === -1) {
    return INVALID_HSL_COLOR
  } else {
    light = ((hsl & 127) * light) >> 7
    if (light < 2) {
      light = 2
    } else if (light > 126) {
      light = 126
    }

    return (hsl & 0xff80) + light
  }
}

export function adjustOverlayLight(hsl: number, light: number): number {
  if (hsl === -2) {
    return INVALID_HSL_COLOR
  } else if (hsl === -1) {
    if (light < 2) {
      light = 2
    } else if (light > 126) {
      light = 126
    }

    return light
  } else {
    light = ((hsl & 127) * light) >> 7
    if (light < 2) {
      light = 2
    } else if (light > 126) {
      light = 126
    }

    return (hsl & 0xff80) + light
  }
}

/**
 * Floor colour -> HSL components as computed by the floor configs
 * (`UnderlayFloorType.setHsl` / `OverlayFloorType.setHsl` in the client).
 */
export interface FloorHsl {
  /** 0..255 hue, or the hue weighted by `hueMultiplier` when `weightedHue` is true. */
  hue: number
  saturation: number
  lightness: number
  hueMultiplier: number
  /** hue * hueMultiplier, used when blending underlays. */
  hueBlend: number
}

export function floorRgbToHsl(rgb: number): FloorHsl {
  const r = ((rgb >> 16) & 0xff) / 256.0
  const g = ((rgb >> 8) & 0xff) / 256.0
  const b = (rgb & 0xff) / 256.0

  let minRgb = r
  if (g < minRgb) {
    minRgb = g
  }
  if (b < minRgb) {
    minRgb = b
  }

  let maxRgb = r
  if (g > maxRgb) {
    maxRgb = g
  }
  if (b > maxRgb) {
    maxRgb = b
  }

  let hue = 0.0
  let sat = 0.0
  const light = (maxRgb + minRgb) / 2.0

  if (maxRgb !== minRgb) {
    if (light < 0.5) {
      sat = (maxRgb - minRgb) / (maxRgb + minRgb)
    }

    if (light >= 0.5) {
      sat = (maxRgb - minRgb) / (2.0 - maxRgb - minRgb)
    }

    if (maxRgb === r) {
      hue = (g - b) / (maxRgb - minRgb)
    } else if (maxRgb === g) {
      hue = 2.0 + (b - r) / (maxRgb - minRgb)
    } else if (maxRgb === b) {
      hue = 4.0 + (r - g) / (maxRgb - minRgb)
    }
  }
  hue /= 6.0

  let saturation = (sat * 256.0) | 0
  let lightness = (light * 256.0) | 0
  if (saturation < 0) {
    saturation = 0
  } else if (saturation > 255) {
    saturation = 255
  }
  if (lightness < 0) {
    lightness = 0
  } else if (lightness > 255) {
    lightness = 255
  }

  let hueMultiplier: number
  if (light > 0.5) {
    hueMultiplier = (512.0 * (sat * (1.0 - light))) | 0
  } else {
    hueMultiplier = (512.0 * (sat * light)) | 0
  }
  if (hueMultiplier < 1) {
    hueMultiplier = 1
  }

  return {
    hue: (hue * 256.0) | 0,
    saturation,
    lightness,
    hueMultiplier,
    hueBlend: (hueMultiplier * hue) | 0,
  }
}
