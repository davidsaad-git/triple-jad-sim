/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * A true-colour sprite (0xRRGGBB per pixel, 0 = transparent) with the same
 * trimmed-block layout as IndexedSprite, plus the client's pixel transforms.
 */
export class SpritePixels {
  pixels: Int32Array

  subWidth: number
  subHeight: number

  xOffset: number
  yOffset: number

  width: number
  height: number

  constructor(
    pixels: Int32Array,
    subWidth: number,
    subHeight: number,
    xOffset: number,
    yOffset: number,
    width: number,
    height: number,
  ) {
    this.pixels = pixels
    this.subWidth = subWidth
    this.subHeight = subHeight
    this.xOffset = xOffset
    this.yOffset = yOffset
    this.width = width
    this.height = height
  }

  static fromPixels(pixels: Int32Array, width: number, height: number): SpritePixels {
    return new SpritePixels(pixels, width, height, 0, 0, width, height)
  }

  static fromDimensions(width: number, height: number): SpritePixels {
    return SpritePixels.fromPixels(new Int32Array(width * height), width, height)
  }

  mirrorHorizontally(): SpritePixels {
    const mirrored = SpritePixels.fromDimensions(this.subWidth, this.subHeight)
    mirrored.width = this.width
    mirrored.height = this.height
    mirrored.xOffset = this.width - this.subWidth - this.xOffset
    mirrored.yOffset = this.yOffset

    for (let y = 0; y < this.subHeight; y++) {
      for (let x = 0; x < this.subWidth; x++) {
        mirrored.pixels[x + y * this.subWidth] = this.pixels[y * this.subWidth + this.subWidth - 1 - x]!
      }
    }

    return mirrored
  }

  copyNormalized(): SpritePixels {
    const normalized = SpritePixels.fromDimensions(this.width, this.height)

    for (let y = 0; y < this.subHeight; y++) {
      for (let x = 0; x < this.subWidth; x++) {
        normalized.pixels[x + (y + this.yOffset) * this.width + this.xOffset] = this.pixels[x + y * this.subWidth]!
      }
    }

    return normalized
  }

  normalize(): void {
    if (this.subWidth !== this.width || this.subHeight !== this.height) {
      const pixels = new Int32Array(this.width * this.height)

      for (let y = 0; y < this.subHeight; y++) {
        for (let x = 0; x < this.subWidth; x++) {
          pixels[x + (y + this.yOffset) * this.width + this.xOffset] = this.pixels[x + y * this.subWidth]!
        }
      }

      this.pixels = pixels
      this.subWidth = this.width
      this.subHeight = this.height
      this.xOffset = 0
      this.yOffset = 0
    }
  }

  pad(padding: number): void {
    if (this.subWidth !== this.width || this.subHeight !== this.height) {
      let left = padding
      if (padding > this.xOffset) {
        left = this.xOffset
      }

      let right = padding
      if (padding + this.xOffset + this.subWidth > this.width) {
        right = this.width - this.xOffset - this.subWidth
      }

      let top = padding
      if (padding > this.yOffset) {
        top = this.yOffset
      }

      let bottom = padding
      if (padding + this.yOffset + this.subHeight > this.height) {
        bottom = this.height - this.yOffset - this.subHeight
      }

      const width = left + right + this.subWidth
      const height = top + bottom + this.subHeight
      const pixels = new Int32Array(width * height)

      for (let y = 0; y < this.subHeight; y++) {
        for (let x = 0; x < this.subWidth; x++) {
          pixels[width * (y + top) + x + left] = this.pixels[x + y * this.subWidth]!
        }
      }

      this.pixels = pixels
      this.subWidth = width
      this.subHeight = height
      this.xOffset -= left
      this.yOffset -= top
    }
  }

  flipHorizontally(): void {
    const pixels = new Int32Array(this.subWidth * this.subHeight)
    let index = 0

    for (let y = 0; y < this.subHeight; y++) {
      for (let x = this.subWidth - 1; x >= 0; x--) {
        pixels[index++] = this.pixels[x + y * this.subWidth]!
      }
    }

    this.pixels = pixels
    this.xOffset = this.width - this.subWidth - this.xOffset
  }

  flipVertically(): void {
    const pixels = new Int32Array(this.subWidth * this.subHeight)
    let index = 0

    for (let y = this.subHeight - 1; y >= 0; y--) {
      for (let x = 0; x < this.subWidth; x++) {
        pixels[index++] = this.pixels[x + y * this.subWidth]!
      }
    }

    this.pixels = pixels
    this.yOffset = this.height - this.subHeight - this.yOffset
  }

  /** Draws a 1px outline of `rgb` around every opaque region. */
  outline(rgb: number): void {
    const pixels = new Int32Array(this.subWidth * this.subHeight)
    let index = 0

    for (let y = 0; y < this.subHeight; y++) {
      for (let x = 0; x < this.subWidth; x++) {
        let newRgb = this.pixels[index]!
        if (newRgb === 0) {
          if (x > 0 && this.pixels[index - 1] !== 0) {
            newRgb = rgb
          } else if (y > 0 && this.pixels[index - this.subWidth] !== 0) {
            newRgb = rgb
          } else if (x < this.subWidth - 1 && this.pixels[index + 1] !== 0) {
            newRgb = rgb
          } else if (y < this.subHeight - 1 && this.pixels[index + this.subWidth] !== 0) {
            newRgb = rgb
          }
        }

        pixels[index++] = newRgb
      }
    }

    this.pixels = pixels
  }

  /** Adds a 1px drop shadow of `rgb` down-right of every opaque pixel. */
  shadow(rgb: number): void {
    for (let y = this.subHeight - 1; y > 0; y--) {
      const yOffset = y * this.subWidth

      for (let x = this.subWidth - 1; x > 0; x--) {
        if (this.pixels[x + yOffset] === 0 && this.pixels[x + yOffset - 1 - this.subWidth] !== 0) {
          this.pixels[x + yOffset] = rgb
        }
      }
    }
  }

  /** Full-size RGBA bytes (`width * height * 4`); 0 pixels are transparent. */
  getPixelsRgba(): Uint8ClampedArray {
    const dst = new Uint8ClampedArray(this.width * this.height * 4)
    let srcIndex = 0
    for (let y = 0; y < this.subHeight; y++) {
      let dstIndex = (this.xOffset + (y + this.yOffset) * this.width) * 4
      for (let x = 0; x < this.subWidth; x++) {
        const rgb = this.pixels[srcIndex++]!
        if (rgb !== 0) {
          dst[dstIndex] = (rgb >> 16) & 0xff
          dst[dstIndex + 1] = (rgb >> 8) & 0xff
          dst[dstIndex + 2] = rgb & 0xff
          dst[dstIndex + 3] = 0xff
        }
        dstIndex += 4
      }
    }
    return dst
  }
}
