/**
 * Texture-array content as scim builds it (TextureArrayManager `nf`): every texture id of the cache's
 * texture archive in index order becomes layer i + 1 (layer 0 is opaque
 * white), 128x128 ARGB, palette colour 0 -> alpha 0, raw palette RGB
 * (brightness 1.0; the 0.6 gamma happens in the shader), 64 px sprites
 * nearest-upscaled 2x. Animated textures get a UV scroll per layer.
 */
import type { TextureLoader } from '../../cache/texture/TextureLoader'

export const TEXTURE_SIZE = 128

export interface TextureArrayData {
  /** Cache texture id -> layer (1-based). */
  layerOf: Map<number, number>
  /** Layers * 128 * 128 ARGB ints (layer 0 = 0xffffffff). */
  argb: Int32Array
  layers: number
  /** 128 vec4 = 256 layers of (du, dv) scroll per client cycle (layer 0 unused). */
  animations: Float32Array
}

/** ARGB pixels of one texture at 128x128 (scim with brightness 1). */
export function texturePixels(textures: TextureLoader, id: number, size = TEXTURE_SIZE): Int32Array {
  const sprite = textures.loadTextureSprite(id)
  const palette = new Int32Array(sprite.palette.length)
  for (let i = 0; i < palette.length; i++) {
    const c = sprite.palette[i]!
    palette[i] = c === 0 ? 0 : (0xff << 24) | (c & 0xffffff)
  }
  const out = new Int32Array(size * size)
  const src = sprite.pixels
  const w = sprite.subWidth
  if (size === w) {
    for (let i = 0; i < size * size; i++) out[i] = palette[src[i]!]!
  } else if (w === 64 && size === 128) {
    let o = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[o++] = palette[src[((y >> 1) << 6) + (x >> 1)]!]!
  } else if (w === 128 && size === 64) {
    let o = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[o++] = palette[src[(x << 1) + ((y << 1) << 7)]!]!
  } else {
    throw new Error(`texture ${id}: cannot resample ${w} -> ${size}`)
  }
  return out
}

export function buildTextureArray(textures: TextureLoader): TextureArrayData {
  const ids = textures.textureIds
  const layers = ids.length + 1
  const texels = TEXTURE_SIZE * TEXTURE_SIZE
  const argb = new Int32Array(layers * texels)
  argb.fill(-1, 0, texels)
  const layerOf = new Map<number, number>()
  ids.forEach((id, i) => {
    layerOf.set(id, i + 1)
    try {
      argb.set(texturePixels(textures, id), (i + 1) * texels)
    } catch (e) {
      console.warn(`texture ${id} failed: ${(e as Error).message}`)
    }
  })
  const animations = new Float32Array(512)
  const n = Math.min(ids.length, 255)
  for (let i = 0; i < n; i++) {
    const [du, dv] = textures.getAnimationUv(ids[i]!)
    if (du === 0 && dv === 0) continue
    const layer = i + 1
    const o = (layer >> 1) * 4 + (layer & 1) * 2
    animations[o] = du
    animations[o + 1] = dv
  }
  return { layerOf, argb, layers, animations }
}

/** Texture animation clock: (performance.now() / 20) mod 128. */
export function textureAnimTime(nowMs: number): number {
  return (nowMs / 20) % 128
}
