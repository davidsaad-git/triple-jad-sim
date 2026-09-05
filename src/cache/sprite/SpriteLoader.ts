/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Decoder for the OSRS sprite index (8). Each archive holds one file (0)
 * containing a "sprite sheet": one or more palette-indexed frames sharing a
 * palette and outer bounds. The layout is footer-first: the frame count sits
 * in the last two bytes, the palette/offset tables before it, pixel data at
 * the front.
 */
import { ByteReader } from '../ByteReader'
import { type CacheSystem, IndexId } from '../CacheSystem'
import { IndexedSprite } from './IndexedSprite'
import { SpritePixels } from './SpritePixels'

export interface SpriteSheet {
  id: number
  width: number
  height: number
  palette: Int32Array
  sprites: IndexedSprite[]
}

const SPRITE_FLAG_VERTICAL = 1
const SPRITE_FLAG_ALPHA = 2

function readPlane(r: ByteReader, dst: Uint8Array, subWidth: number, subHeight: number, vertical: boolean): void {
  if (!vertical) {
    dst.set(r.bytes(dst.length))
    return
  }
  for (let x = 0; x < subWidth; x++) {
    for (let y = 0; y < subHeight; y++) {
      dst[x + y * subWidth] = r.u8()
    }
  }
}

export function decodeSpriteSheet(id: number, data: Uint8Array): SpriteSheet {
  const r = new ByteReader(data)

  r.seek(data.length - 2)
  const spriteCount = r.u16()

  const xOffsets = new Int32Array(spriteCount)
  const yOffsets = new Int32Array(spriteCount)
  const widths = new Int32Array(spriteCount)
  const heights = new Int32Array(spriteCount)

  r.seek(data.length - 7 - spriteCount * 8)
  const width = r.u16()
  const height = r.u16()
  const paletteSize = r.u8() + 1

  for (let i = 0; i < spriteCount; i++) {
    xOffsets[i] = r.u16()
  }
  for (let i = 0; i < spriteCount; i++) {
    yOffsets[i] = r.u16()
  }
  for (let i = 0; i < spriteCount; i++) {
    widths[i] = r.u16()
  }
  for (let i = 0; i < spriteCount; i++) {
    heights[i] = r.u16()
  }

  r.seek(data.length - 7 - spriteCount * 8 - (paletteSize - 1) * 3)
  const palette = new Int32Array(paletteSize)
  for (let i = 1; i < paletteSize; i++) {
    let rgb = r.u24()
    if (rgb === 0) {
      // 0 is reserved for transparency; pure black becomes near-black
      rgb = 1
    }
    palette[i] = rgb
  }

  r.seek(0)
  const sprites: IndexedSprite[] = new Array<IndexedSprite>(spriteCount)
  for (let i = 0; i < spriteCount; i++) {
    const subWidth = widths[i]!
    const subHeight = heights[i]!
    const pixelCount = subWidth * subHeight
    const pixels = new Uint8Array(pixelCount)
    // bit 0: column-major pixel order; bit 1: an alpha plane follows the indices
    const flags = r.u8()
    if ((flags & ~(SPRITE_FLAG_VERTICAL | SPRITE_FLAG_ALPHA)) !== 0) {
      throw new Error(`Sprite ${id}: unknown pixel flags ${flags}`)
    }
    const vertical = (flags & SPRITE_FLAG_VERTICAL) !== 0
    readPlane(r, pixels, subWidth, subHeight, vertical)
    let alpha: Uint8Array | null = null
    if ((flags & SPRITE_FLAG_ALPHA) !== 0) {
      alpha = new Uint8Array(pixelCount)
      readPlane(r, alpha, subWidth, subHeight, vertical)
    }
    sprites[i] = new IndexedSprite(
      pixels,
      palette,
      subWidth,
      subHeight,
      xOffsets[i]!,
      yOffsets[i]!,
      width,
      height,
      alpha,
    )
  }

  return { id, width, height, palette, sprites }
}

/**
 * Converts an indexed sprite frame to true-colour pixels (trimmed block
 * preserved). SpritePixels has no alpha plane, so alpha-sprite texels with
 * alpha 0 become transparent and everything else opaque.
 */
export function toSpritePixels(sprite: IndexedSprite): SpritePixels {
  const pixels = new Int32Array(sprite.subWidth * sprite.subHeight)
  for (let i = 0; i < pixels.length; i++) {
    const paletteIndex = sprite.pixels[i]!
    const transparent = sprite.alpha ? sprite.alpha[i] === 0 : paletteIndex === 0
    pixels[i] = transparent ? 0 : sprite.palette[paletteIndex]!
  }
  return new SpritePixels(
    pixels,
    sprite.subWidth,
    sprite.subHeight,
    sprite.xOffset,
    sprite.yOffset,
    sprite.width,
    sprite.height,
  )
}

/**
 * Cached access to the sprite index. Sprite ids are archive ids of index 8;
 * a "group" may hold several frames (e.g. head icons, fonts).
 */
export class SpriteLoader {
  private readonly cache: CacheSystem
  private readonly sheets = new Map<number, SpriteSheet | null>()

  constructor(cache: CacheSystem) {
    this.cache = cache
  }

  get spriteIds(): number[] {
    return this.cache.getIndex(IndexId.Sprites).archiveIds
  }

  get count(): number {
    return this.cache.getIndex(IndexId.Sprites).archiveIds.length
  }

  /** Loads the whole sheet (all frames) for a sprite id, or undefined if absent. */
  loadSheet(id: number): SpriteSheet | undefined {
    const cached = this.sheets.get(id)
    if (cached !== undefined) {
      return cached ?? undefined
    }
    const data = this.cache.getIndex(IndexId.Sprites).getFile(id, 0)
    const sheet = data ? decodeSpriteSheet(id, data) : null
    this.sheets.set(id, sheet)
    return sheet ?? undefined
  }

  /** Loads every frame of a sprite id. Palettes are shared between frames. */
  loadSprites(id: number): IndexedSprite[] | undefined {
    return this.loadSheet(id)?.sprites
  }

  /**
   * Loads one frame (default the first) as a fresh IndexedSprite with its own
   * palette copy, so callers may mutate it (e.g. texture brightness).
   */
  loadSprite(id: number, frame = 0): IndexedSprite | undefined {
    const sheet = this.loadSheet(id)
    const sprite = sheet?.sprites[frame]
    if (!sprite) {
      return undefined
    }
    return new IndexedSprite(
      sprite.pixels,
      new Int32Array(sprite.palette),
      sprite.subWidth,
      sprite.subHeight,
      sprite.xOffset,
      sprite.yOffset,
      sprite.width,
      sprite.height,
      sprite.alpha,
    )
  }

  /** Loads one frame as true-colour pixels. */
  loadSpritePixels(id: number, frame = 0): SpritePixels | undefined {
    const sprite = this.loadSheet(id)?.sprites[frame]
    return sprite ? toSpritePixels(sprite) : undefined
  }

  clearCache(): void {
    this.sheets.clear()
  }
}
