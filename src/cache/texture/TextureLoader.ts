/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS texture loader for the simplified texture format (revision 233+):
 * index 9, archive 0, one 7-byte file per texture referencing a single
 * sprite in index 8. Produces RGB/RGBA pixel arrays for WebGL/canvas.
 */
import { type CacheSystem, IndexId } from '../CacheSystem'
import type { IndexedSprite } from '../sprite/IndexedSprite'
import { SpriteLoader } from '../sprite/SpriteLoader'
import { brightenRgb } from '../util/ColorUtil'
import { ByteReader } from '../ByteReader'

export interface TextureDefinition {
  id: number
  spriteId: number
  /** Packed 16-bit HSL average, used for the low-detail/far colour of textured faces. */
  averageHsl: number
  opaque: boolean
  /** 0 = static, 1..4 = scroll direction (see ANIM_DIRECTION_UV). */
  animationDirection: number
  animationSpeed: number
}

export interface TextureMaterial {
  animU: number
  animV: number
  alphaCutOff: number
}

export function decodeTextureDefinition(id: number, data: Uint8Array): TextureDefinition {
  const r = new ByteReader(data)
  const spriteId = r.u16()
  const averageHsl = r.u16()
  const opaque = r.u8() === 1
  const animationDirection = r.u8()
  const animationSpeed = r.u8()
  return { id, spriteId, averageHsl, opaque, animationDirection, animationSpeed }
}

const ANIM_DIRECTION_UV: readonly (readonly [number, number])[] = [
  [0.0, 0.0],
  [0.0, -1.0],
  [-1.0, 0.0],
  [0.0, 1.0],
  [1.0, 0.0],
]

export class TextureLoader {
  readonly textureIds: number[]
  readonly definitions: Map<number, TextureDefinition>
  private readonly spriteLoader: SpriteLoader
  private readonly idIndexMap = new Map<number, number>()
  private readonly pixelCache = new Map<string, Int32Array>()

  static load(cache: CacheSystem, spriteLoader: SpriteLoader = new SpriteLoader(cache)): TextureLoader {
    const definitions = new Map<number, TextureDefinition>()
    const archive = cache.getIndex(IndexId.Textures).getArchive(0)
    if (!archive) {
      throw new Error('Texture archive 0 not found')
    }
    for (const [id, data] of archive) {
      definitions.set(id, decodeTextureDefinition(id, data))
    }
    return new TextureLoader(spriteLoader, archive.fileIds.slice(), definitions)
  }

  constructor(spriteLoader: SpriteLoader, textureIds: number[], definitions: Map<number, TextureDefinition>) {
    this.spriteLoader = spriteLoader
    this.textureIds = textureIds
    this.definitions = definitions
    for (let i = 0; i < textureIds.length; i++) {
      this.idIndexMap.set(textureIds[i]!, i)
    }
  }

  get count(): number {
    return this.textureIds.length
  }

  has(id: number): boolean {
    return this.definitions.has(id)
  }

  getDefinition(id: number): TextureDefinition | undefined {
    return this.definitions.get(id)
  }

  /** Dense index of a texture id (for texture arrays), or -1. */
  getTextureIndex(id: number): number {
    return this.idIndexMap.get(id) ?? -1
  }

  getAverageHsl(id: number): number {
    return this.definitions.get(id)?.averageHsl ?? 0
  }

  isTransparent(id: number): boolean {
    const def = this.definitions.get(id)
    return def ? !def.opaque : false
  }

  /** Native sprite size (64 or 128) of a texture. */
  getNativeSize(id: number): number {
    return this.loadTextureSprite(id).width
  }

  isSmall(id: number): boolean {
    return this.getNativeSize(id) === 64
  }

  /** Per-frame UV scroll for animated textures, in texture units per client tick. */
  getAnimationUv(id: number): [number, number] {
    const def = this.definitions.get(id)
    if (!def) {
      return [0, 0]
    }
    const uv = ANIM_DIRECTION_UV[def.animationDirection] ?? ANIM_DIRECTION_UV[0]!
    return [uv[0] * def.animationSpeed, uv[1] * def.animationSpeed]
  }

  getMaterial(id: number): TextureMaterial {
    const [animU, animV] = this.getAnimationUv(id)
    let alphaCutOff = 0.5
    if (animU !== 0 || animV !== 0) {
      alphaCutOff = 0.1
    }
    return { animU, animV, alphaCutOff }
  }

  /** The texture's source sprite, normalized to its full bounds, with a private palette. */
  loadTextureSprite(id: number): IndexedSprite {
    const def = this.definitions.get(id)
    if (!def) {
      throw new Error(`Texture definition not found: ${id}`)
    }
    const sprite = this.spriteLoader.loadSprite(def.spriteId)
    if (!sprite) {
      throw new Error(`Texture ${id} references missing sprite ${def.spriteId}`)
    }
    sprite.normalize()
    return sprite
  }

  /**
   * 0xAARRGGBB pixels of the texture resampled to `size` x `size` (64 or 128).
   * `brightness` is the client gamma (1.0 = raw palette, 0.8 = client default).
   * Transparent texels have alpha 0. Results are cached.
   */
  getPixelsArgb(id: number, size = 128, brightness = 1.0): Int32Array {
    const key = `${id}:${size}:${brightness}`
    const cached = this.pixelCache.get(key)
    if (cached) {
      return cached
    }

    const sprite = this.loadTextureSprite(id)
    const palettePixels = sprite.pixels
    const palette = sprite.palette
    const rgbPalette = new Int32Array(palette.length)
    for (let i = 0; i < palette.length; i++) {
      rgbPalette[i] = brightenRgb(palette[i]!, brightness)
    }
    // Native texel -> 0xAARRGGBB, honouring an explicit alpha plane when present.
    const texel = (i: number): number => {
      const a = sprite.texelAlpha(i)
      return a === 0 ? 0 : (a << 24) | rgbPalette[palettePixels[i]!]!
    }

    const pixelCount = size * size
    const pixels = new Int32Array(pixelCount)
    const spriteSize = sprite.width

    if (size === spriteSize) {
      for (let i = 0; i < pixelCount; i++) {
        pixels[i] = texel(i)
      }
    } else if (spriteSize === 64 && size === 128) {
      let pixelIndex = 0
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          pixels[pixelIndex++] = texel(((y >> 1) << 6) + (x >> 1))
        }
      }
    } else if (spriteSize === 128 && size === 64) {
      let pixelIndex = 0
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          pixels[pixelIndex++] = texel((x << 1) + ((y << 1) << 7))
        }
      }
    } else {
      throw new Error(`Texture ${id}: cannot resample ${spriteSize} -> ${size}`)
    }

    this.pixelCache.set(key, pixels)
    return pixels
  }

  /** RGBA bytes (`size * size * 4`) of the texture, for WebGL uploads / ImageData. */
  getPixelsRgba(id: number, size = 128, brightness = 1.0): Uint8ClampedArray {
    const argb = this.getPixelsArgb(id, size, brightness)
    const rgba = new Uint8ClampedArray(argb.length * 4)
    for (let i = 0, j = 0; i < argb.length; i++, j += 4) {
      const p = argb[i]!
      rgba[j] = (p >> 16) & 0xff
      rgba[j + 1] = (p >> 8) & 0xff
      rgba[j + 2] = p & 0xff
      rgba[j + 3] = (p >>> 24) & 0xff
    }
    return rgba
  }

  clearCache(): void {
    this.pixelCache.clear()
  }
}
