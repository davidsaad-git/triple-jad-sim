/**
 * Small RGBA raster helpers for building UI assets from cache sprites at build
 * time (no canvas needed).
 */
import type { SpriteLoader } from '../../../cache/sprite/SpriteLoader'
import type { RgbaImage } from './png'

export function newImage(width: number, height: number, fill = 0): RgbaImage {
  const rgba = new Uint8ClampedArray(width * height * 4)
  if (fill !== 0) {
    const a = (fill >>> 24) & 0xff
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = (fill >> 16) & 0xff
      rgba[i + 1] = (fill >> 8) & 0xff
      rgba[i + 2] = fill & 0xff
      rgba[i + 3] = a
    }
  }
  return { width, height, rgba }
}

/** One sprite frame at its full sheet bounds (what RuneLite / resource packs use). */
export function spriteImage(loader: SpriteLoader, id: number, frame = 0): RgbaImage | null {
  const sprite = loader.loadSheet(id)?.sprites[frame]
  if (!sprite || sprite.width <= 0 || sprite.height <= 0) return null
  return { width: sprite.width, height: sprite.height, rgba: sprite.getPixelsRgba() }
}

/** Alpha-composite `src` over `dst` at (x, y). */
export function blit(dst: RgbaImage, src: RgbaImage, x: number, y: number): void {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy
    if (dy < 0 || dy >= dst.height) continue
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx
      if (dx < 0 || dx >= dst.width) continue
      const si = (sy * src.width + sx) * 4
      const a = src.rgba[si + 3]!
      if (a === 0) continue
      const di = (dy * dst.width + dx) * 4
      if (a === 255 || dst.rgba[di + 3] === 0) {
        dst.rgba[di] = src.rgba[si]!
        dst.rgba[di + 1] = src.rgba[si + 1]!
        dst.rgba[di + 2] = src.rgba[si + 2]!
        dst.rgba[di + 3] = a
        continue
      }
      const da = dst.rgba[di + 3]! / 255
      const sa = a / 255
      const oa = sa + da * (1 - sa)
      for (let k = 0; k < 3; k++) dst.rgba[di + k] = (src.rgba[si + k]! * sa + dst.rgba[di + k]! * da * (1 - sa)) / oa
      dst.rgba[di + 3] = oa * 255
    }
  }
}

export function crop(src: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  const out = newImage(w, h)
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const sx = x + xx
      const sy = y + yy
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue
      const si = (sy * src.width + sx) * 4
      const di = (yy * w + xx) * 4
      out.rgba[di] = src.rgba[si]!
      out.rgba[di + 1] = src.rgba[si + 1]!
      out.rgba[di + 2] = src.rgba[si + 2]!
      out.rgba[di + 3] = src.rgba[si + 3]!
    }
  }
  return out
}

export function scaleNearest(src: RgbaImage, w: number, h: number): RgbaImage {
  const out = newImage(w, h)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w))
      const si = (sy * src.width + sx) * 4
      const di = (y * w + x) * 4
      out.rgba[di] = src.rgba[si]!
      out.rgba[di + 1] = src.rgba[si + 1]!
      out.rgba[di + 2] = src.rgba[si + 2]!
      out.rgba[di + 3] = src.rgba[si + 3]!
    }
  }
  return out
}

/** Flip horizontally and/or vertically. */
export function flip(src: RgbaImage, horizontal: boolean, vertical: boolean): RgbaImage {
  const out = newImage(src.width, src.height)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const sx = horizontal ? src.width - 1 - x : x
      const sy = vertical ? src.height - 1 - y : y
      const si = (sy * src.width + sx) * 4
      const di = (y * src.width + x) * 4
      out.rgba.set(src.rgba.subarray(si, si + 4), di)
    }
  }
  return out
}

/** Multiply alpha by `opacity` (0..1). */
export function withOpacity(src: RgbaImage, opacity: number): RgbaImage {
  const out = { width: src.width, height: src.height, rgba: new Uint8ClampedArray(src.rgba) }
  for (let i = 3; i < out.rgba.length; i += 4) out.rgba[i] = Math.round(out.rgba[i]! * opacity)
  return out
}

/** True when every pixel is fully transparent. */
export function isBlank(img: RgbaImage): boolean {
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] !== 0) return false
  return true
}
