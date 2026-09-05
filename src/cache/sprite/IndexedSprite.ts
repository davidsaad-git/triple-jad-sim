/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * A palette-indexed sprite as stored in the OSRS sprite index (8). Palette
 * index 0 is transparent unless the sprite carries an explicit alpha plane.
 * `width`/`height` are the full sprite-sheet bounds, `subWidth`/`subHeight`
 * the trimmed pixel block at `xOffset`/`yOffset`.
 */
export class IndexedSprite {
  /** Palette indices, `subWidth * subHeight` entries, row-major. */
  pixels: Uint8Array
  /** 0xRRGGBB per palette index; entry 0 is transparent. */
  palette: Int32Array
  /** Optional per-texel alpha (same layout as `pixels`); null = derive from index 0. */
  alpha: Uint8Array | null

  subWidth: number
  subHeight: number

  xOffset: number
  yOffset: number

  width: number
  height: number

  constructor(
    pixels: Uint8Array,
    palette: Int32Array,
    subWidth: number,
    subHeight: number,
    xOffset: number,
    yOffset: number,
    width: number,
    height: number,
    alpha: Uint8Array | null = null,
  ) {
    this.pixels = pixels
    this.palette = palette
    this.alpha = alpha
    this.subWidth = subWidth
    this.subHeight = subHeight
    this.xOffset = xOffset
    this.yOffset = yOffset
    this.width = width
    this.height = height
  }

  /** Expands the trimmed pixel block to the full `width * height` bounds. */
  normalize(): void {
    if (this.subWidth !== this.width || this.subHeight !== this.height) {
      const pixels = new Uint8Array(this.width * this.height)
      const alpha = this.alpha ? new Uint8Array(this.width * this.height) : null
      let index = 0

      for (let y = 0; y < this.subHeight; y++) {
        for (let x = 0; x < this.subWidth; x++) {
          const dst = x + (y + this.yOffset) * this.width + this.xOffset
          pixels[dst] = this.pixels[index]!
          if (alpha) alpha[dst] = this.alpha![index]!
          index++
        }
      }

      this.pixels = pixels
      this.alpha = alpha
      this.subWidth = this.width
      this.subHeight = this.height
      this.xOffset = 0
      this.yOffset = 0
    }
  }

  /** Adds per-channel offsets to every palette entry (clamped). */
  shiftColors(rOffset: number, gOffset: number, bOffset: number): void {
    for (let i = 0; i < this.palette.length; i++) {
      const color = this.palette[i]!
      let r = (color >> 16) & 255
      r += rOffset
      if (r < 0) {
        r = 0
      } else if (r > 255) {
        r = 255
      }

      let g = (color >> 8) & 255
      g += gOffset
      if (g < 0) {
        g = 0
      } else if (g > 255) {
        g = 255
      }

      let b = color & 255
      b += bOffset
      if (b < 0) {
        b = 0
      } else if (b > 255) {
        b = 255
      }

      this.palette[i] = b + (g << 8) + (r << 16)
    }
  }

  /**
   * Full-size 0xAARRGGBB pixels (`width * height`), alpha 0 where the palette
   * index is 0.
   */
  getPixelsArgb(): Int32Array {
    const dst = new Int32Array(this.width * this.height)
    let srcIndex = 0
    for (let y = 0; y < this.subHeight; y++) {
      let dstIndex = this.xOffset + (y + this.yOffset) * this.width
      for (let x = 0; x < this.subWidth; x++) {
        const a = this.texelAlpha(srcIndex)
        if (a !== 0) {
          dst[dstIndex] = (a << 24) | this.palette[this.pixels[srcIndex]!]!
        }
        srcIndex++
        dstIndex++
      }
    }
    return dst
  }

  /** Alpha (0..255) of the texel at `index` into `pixels`. */
  texelAlpha(index: number): number {
    if (this.alpha) {
      return this.alpha[index]!
    }
    return this.pixels[index] === 0 ? 0 : 0xff
  }

  /**
   * Full-size RGBA bytes (`width * height * 4`), ready for
   * `gl.texImage2D(..., RGBA, UNSIGNED_BYTE, ...)` or `new ImageData(...)`.
   */
  getPixelsRgba(): Uint8ClampedArray {
    const dst = new Uint8ClampedArray(this.width * this.height * 4)
    let srcIndex = 0
    for (let y = 0; y < this.subHeight; y++) {
      let dstIndex = (this.xOffset + (y + this.yOffset) * this.width) * 4
      for (let x = 0; x < this.subWidth; x++) {
        const a = this.texelAlpha(srcIndex)
        if (a !== 0) {
          const rgb = this.palette[this.pixels[srcIndex]!]!
          dst[dstIndex] = (rgb >> 16) & 0xff
          dst[dstIndex + 1] = (rgb >> 8) & 0xff
          dst[dstIndex + 2] = rgb & 0xff
          dst[dstIndex + 3] = a
        }
        srcIndex++
        dstIndex += 4
      }
    }
    return dst
  }
}
