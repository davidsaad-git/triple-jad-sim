/**
 * The client's bitmap fonts: a 256-frame glyph sprite group in index 8
 * (p11_full 494, p12_full 495, b12_full 496, q8_full 497) plus a metrics file
 * of the same id in index 13 (256 advances followed by the ascent).
 *
 * Used at build time (labels on contact sheets, the RuneScape-Small TTF built
 * from the cache font). Text is placed like AbstractFont.draw: glyph at
 * (x + xOffset, baseline - ascent + yOffset), x advances by `advances[c]`.
 */
import { type CacheSystem, IndexId } from '../../../cache/CacheSystem'
import { SpriteLoader } from '../../../cache/sprite/SpriteLoader'

export const FontIds = { p11: 494, p12: 495, b12: 496, q8: 497 } as const

export interface Glyph {
  readonly width: number
  readonly height: number
  /** Offset of the trimmed glyph inside the font's cell (sprite x/yOffset). */
  readonly left: number
  readonly top: number
  /** `width * height` alpha bytes (0 = transparent). */
  readonly alpha: Uint8Array
}

const EMPTY: Glyph = { width: 0, height: 0, left: 0, top: 0, alpha: new Uint8Array(0) }

/** CP-1252-ish mapping used by the client for the glyph index. */
export function glyphIndex(ch: string): number {
  const code = ch.charCodeAt(0)
  return code < 256 ? code : 63
}

export class BitmapFont {
  readonly id: number
  readonly ascent: number
  readonly advances: Uint8Array
  readonly glyphs: readonly Glyph[]
  /** Font cell height (sprite sheet height). */
  readonly cellHeight: number

  constructor(id: number, glyphs: readonly Glyph[], advances: Uint8Array, ascent: number, cellHeight: number) {
    this.id = id
    this.glyphs = glyphs
    this.advances = advances
    this.ascent = ascent
    this.cellHeight = cellHeight
  }

  static load(cache: CacheSystem, id: number): BitmapFont | undefined {
    const sheet = new SpriteLoader(cache).loadSheet(id)
    if (!sheet || sheet.sprites.length < 256) return undefined
    const metrics = cache.getIndex(IndexId.FontMetrics).getFile(id, 0)
    if (!metrics || metrics.length < 257) return undefined
    const advances = new Uint8Array(256)
    for (let i = 0; i < 256; i++) advances[i] = metrics[i]!
    const ascent = metrics[256]!
    const glyphs: Glyph[] = []
    for (let i = 0; i < 256; i++) {
      const s = sheet.sprites[i]!
      if (s.subWidth <= 0 || s.subHeight <= 0) {
        glyphs.push(EMPTY)
        continue
      }
      const alpha = new Uint8Array(s.subWidth * s.subHeight)
      for (let k = 0; k < alpha.length; k++) alpha[k] = s.texelAlpha(k)
      glyphs.push({ width: s.subWidth, height: s.subHeight, left: s.xOffset, top: s.yOffset, alpha })
    }
    return new BitmapFont(id, glyphs, advances, ascent, sheet.height)
  }

  measure(text: string): number {
    let w = 0
    for (let i = 0; i < text.length; i++) w += this.advances[glyphIndex(text[i]!)]!
    return w
  }
}

function blendGlyph(dst: Uint8ClampedArray, dstW: number, dstH: number, glyph: Glyph, x: number, y: number, rgb: number): void {
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = rgb & 0xff
  for (let gy = 0; gy < glyph.height; gy++) {
    const py = y + gy
    if (py < 0 || py >= dstH) continue
    for (let gx = 0; gx < glyph.width; gx++) {
      const px = x + gx
      if (px < 0 || px >= dstW) continue
      const a = glyph.alpha[gy * glyph.width + gx]!
      if (a === 0) continue
      const di = (py * dstW + px) * 4
      const inv = 255 - a
      dst[di] = (r * a + dst[di]! * inv) / 255
      dst[di + 1] = (g * a + dst[di + 1]! * inv) / 255
      dst[di + 2] = (b * a + dst[di + 2]! * inv) / 255
      dst[di + 3] = Math.max(dst[di + 3]!, a)
    }
  }
}

/** Draw `text` with its baseline at `y` into an RGBA buffer; returns the end x. */
export function drawText(dst: Uint8ClampedArray, dstW: number, dstH: number, font: BitmapFont, text: string, x: number, y: number, rgb: number, shadow = true): number {
  let cx = x
  for (let i = 0; i < text.length; i++) {
    const c = glyphIndex(text[i]!)
    const glyph = font.glyphs[c]!
    if (glyph.width > 0) {
      const gx = cx + glyph.left
      const gy = y - font.ascent + glyph.top
      if (shadow) blendGlyph(dst, dstW, dstH, glyph, gx + 1, gy + 1, 0)
      blendGlyph(dst, dstW, dstH, glyph, gx, gy, rgb)
    }
    cx += font.advances[c]!
  }
  return cx
}
