/**
 * Software renderer for inventory item icons, reproducing the client's
 * `createItemSprite`: the obj config's inventory model is resized,
 * recoloured, retextured and lit with the item light parameters
 * (ambient + 64, contrast + 768, light vector (-50, -10, -50)), rotated by
 * zan2d / yan2d, pushed back by zoom2d along a camera pitched by xan2d,
 * offset by offsetX2d / offsetY2d, projected with the client's
 * `x * 512 / z` rule onto a 36x32 raster centred at (18, 16), then given the
 * 1 px black outline and the 0x302020 drop shadow the inventory uses.
 *
 * Faces are painted far-to-near with the client's render-priority
 * interleaving rather than z-buffered, so translucent vial glass drawn over
 * potion liquid comes out the same way it does in game. Runs anywhere
 * (no canvas / WebGL); the result is raw RGBA. Ported from the previous
 * build (attic/src/render/items) for scripts/build-ui-assets.ts.
 */
import type { CacheSystem } from '../../../cache/CacheSystem'
import { ObjTypeLoader, type ObjType } from '../../../cache/config/ObjType'
import { hsl16ToRgb } from '../../../cache/model/ColorPalette'
import { COSINE, SINE } from '../../../cache/model/MathTables'
import type { Model } from '../../../cache/model/Model'
import { ModelLoader } from '../../../cache/model/ModelLoader'
import { TextureLoader } from '../../../cache/texture/TextureLoader'

export const ICON_WIDTH = 36
export const ICON_HEIGHT = 32

export interface ItemIconImage {
  width: number
  height: number
  /** Row-major RGBA, alpha 0 where the sprite is transparent. */
  rgba: Uint8ClampedArray
}

export interface ItemIconOptions {
  /** 0 none, 1 black outline (inventory default), 2 black + white (selected). */
  border?: number
  /** 0xRRGGBB drop shadow colour, 0 for none. The inventory uses 0x302020. */
  shadow?: number
  /** Noted items are drawn 1.5x further away; unused here but kept for parity. */
  noted?: boolean
}

/** Shadow colour the client's inventory uses (`SpritePixels.DEFAULT_SHADOW_COLOR`). */
export const DEFAULT_SHADOW = 0x302020

const RASTER_MID_X = ICON_WIDTH >> 1
const RASTER_MID_Y = ICON_HEIGHT >> 1
const TEXTURE_SIZE = 128
const TEXTURE_BRIGHTNESS = 0.8

export class ItemIconRenderer {
  readonly objs: ObjTypeLoader
  readonly models: ModelLoader
  private readonly cache: CacheSystem
  private textures: TextureLoader | null = null
  private readonly litModels = new Map<number, { obj: ObjType; lit: Model } | null>()

  constructor(cache: CacheSystem) {
    this.cache = cache
    this.objs = new ObjTypeLoader(cache)
    this.models = new ModelLoader(cache)
  }

  /** Item name from the cache (`ObjType.name`). */
  name(itemId: number): string {
    return this.objs.has(itemId) ? this.objs.load(itemId).name : 'null'
  }

  /** The lit inventory model for an item (cached), or null when missing. */
  litModel(itemId: number): { obj: ObjType; lit: Model } | null {
    const cached = this.litModels.get(itemId)
    if (cached !== undefined) return cached
    let built: { obj: ObjType; lit: Model } | null = null
    if (this.objs.has(itemId)) {
      const obj = this.objs.load(itemId)
      const data = this.models.load(obj.model)?.copy()
      if (data) {
        if (obj.resizeX !== 128 || obj.resizeY !== 128 || obj.resizeZ !== 128) data.scale(obj.resizeX, obj.resizeY, obj.resizeZ)
        if (obj.hasRecolor()) data.replaceColors(obj.recolorFrom, obj.recolorTo)
        if (obj.hasRetexture()) data.replaceTextures(obj.retextureFrom, obj.retextureTo)
        // ItemComposition.getModel: toModel(ambient + 64, contrast + 768, -50, -10, -50)
        built = { obj, lit: data.light(obj.ambient + 64, obj.contrast + 768, -50, -10, -50) }
      }
    }
    this.litModels.set(itemId, built)
    return built
  }

  /**
   * Render the 36x32 icon of an item. `quantity` picks the stack-size model
   * variant (arrows, coins...) like the client does.
   */
  render(itemId: number, quantity = 1, options: ItemIconOptions = {}): ItemIconImage | null {
    if (!this.objs.has(itemId)) return null
    let obj = this.objs.load(itemId)
    if (quantity > 1) obj = obj.getCountObj(this.objs, quantity)
    const built = this.litModel(obj.id)
    if (!built) return null
    const pixels = new Int32Array(ICON_WIDTH * ICON_HEIGHT)
    this.draw(built.lit, obj, pixels, options.noted ? 1.5 : options.border === 2 ? 1.04 : 1)
    const border = options.border ?? 1
    if (border >= 1) outline(pixels, ICON_WIDTH, ICON_HEIGHT, 1)
    if (border >= 2) outline(pixels, ICON_WIDTH, ICON_HEIGHT, 0xffffff)
    const shadow = options.shadow ?? DEFAULT_SHADOW
    if (shadow !== 0) dropShadow(pixels, ICON_WIDTH, ICON_HEIGHT, shadow)
    const rgba = new Uint8ClampedArray(pixels.length * 4)
    for (let i = 0, o = 0; i < pixels.length; i++, o += 4) {
      const p = pixels[i]!
      if (p === 0) continue
      rgba[o] = (p >> 16) & 0xff
      rgba[o + 1] = (p >> 8) & 0xff
      rgba[o + 2] = p & 0xff
      rgba[o + 3] = 255
    }
    return { width: ICON_WIDTH, height: ICON_HEIGHT, rgba }
  }

  private texturePixels(id: number): Int32Array | null {
    try {
      this.textures ??= TextureLoader.load(this.cache)
      if (!this.textures.has(id)) return null
      return this.textures.getPixelsArgb(id, TEXTURE_SIZE, TEXTURE_BRIGHTNESS)
    } catch {
      return null
    }
  }

  private draw(model: Model, obj: ObjType, pixels: Int32Array, zoomScale: number): void {
    const zoom = Math.trunc(obj.zoom2d * zoomScale)
    const xan = obj.xan2d & 0x7ff
    const yan = obj.yan2d & 0x7ff
    const zan = obj.zan2d & 0x7ff
    const sinX = SINE[xan]!
    const cosX = COSINE[xan]!
    const sinY = SINE[yan]!
    const cosY = COSINE[yan]!
    const sinZ = SINE[zan]!
    const cosZ = COSINE[zan]!
    const pitchSin = (sinX * zoom) >> 16
    const pitchCos = (cosX * zoom) >> 16

    // Model.calculateBoundsCylinder: height = max(-y) over the vertices.
    let modelHeight = 0
    for (let i = 0; i < model.usedVertexCount; i++) {
      const y = -model.verticesY[i]!
      if (y > modelHeight) modelHeight = y
    }
    const tx = obj.offsetX2d
    const ty = Math.trunc(modelHeight / 2) + pitchSin + obj.offsetY2d
    const tz = pitchCos + obj.offsetY2d
    const depthBias = (sinX * ty + cosX * tz) >> 16

    const n = model.vertexCount
    const sx = new Float64Array(n)
    const sy = new Float64Array(n)
    const sz = new Float64Array(n)
    const ok = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      let x = model.verticesX[i]!
      let y = model.verticesY[i]!
      let z = model.verticesZ[i]!
      if (zan !== 0) {
        const t = (y * sinZ + x * cosZ) >> 16
        y = (y * cosZ - x * sinZ) >> 16
        x = t
      }
      if (yan !== 0) {
        const t = (z * sinY + x * cosY) >> 16
        z = (z * cosY - x * sinY) >> 16
        x = t
      }
      x += tx
      y += ty
      z += tz
      const t = (y * cosX - z * sinX) >> 16
      z = (y * sinX + z * cosX) >> 16
      y = t
      if (z < 50) continue
      ok[i] = 1
      sz[i] = z - depthBias
      sx[i] = RASTER_MID_X + Math.trunc((x << 9) / z)
      sy[i] = RASTER_MID_Y + Math.trunc((y << 9) / z)
    }

    // Visible faces, far to near.
    const faces: number[] = []
    const depth = new Float64Array(model.faceCount)
    for (let f = 0; f < model.faceCount; f++) {
      if (model.faceColors3[f] === -2) continue
      const a = model.indices1[f]!
      const b = model.indices2[f]!
      const c = model.indices3[f]!
      if (!ok[a] || !ok[b] || !ok[c]) continue
      // Client back-face test on screen winding.
      if ((sx[a]! - sx[b]!) * (sy[c]! - sy[b]!) - (sy[a]! - sy[b]!) * (sx[c]! - sx[b]!) <= 0) continue
      depth[f] = (sz[a]! + sz[b]! + sz[c]!) / 3
      faces.push(f)
    }
    faces.sort((p, q) => depth[q]! - depth[p]!)

    const drawFace = (f: number): void => this.drawFace(model, f, sx, sy, pixels)

    if (!model.faceRenderPriorities) {
      for (const f of faces) drawFace(f)
      return
    }
    // Priority interleaving (Model.draw0): priorities 0..9 in order, with
    // 10 and 11 slotted in by depth relative to the averages of 1+2, 3+4, 6+8.
    const groups: number[][] = Array.from({ length: 12 }, () => [])
    const sums = new Float64Array(12)
    for (const f of faces) {
      const p = Math.min(11, Math.max(0, model.faceRenderPriorities[f]!))
      groups[p]!.push(f)
      sums[p] = sums[p]! + depth[f]!
    }
    const avg = (i: number, j: number): number => {
      const count = groups[i]!.length + groups[j]!.length
      return count > 0 ? (sums[i]! + sums[j]!) / count : 0
    }
    const avg12 = avg(1, 2)
    const avg34 = avg(3, 4)
    const avg68 = avg(6, 8)
    let dyn = groups[10]!
    let dynIndex = 0
    if (dyn.length === 0) dyn = groups[11]!
    const NONE = -1e9
    let dynDepth = dynIndex < dyn.length ? depth[dyn[dynIndex]!]! : NONE
    const advance = (): void => {
      drawFace(dyn[dynIndex++]!)
      if (dynIndex === dyn.length && dyn !== groups[11]) {
        dyn = groups[11]!
        dynIndex = 0
      }
      dynDepth = dynIndex < dyn.length ? depth[dyn[dynIndex]!]! : NONE
    }
    for (let p = 0; p < 10; p++) {
      while (p === 0 && dynDepth > avg12) advance()
      while (p === 3 && dynDepth > avg34) advance()
      while (p === 5 && dynDepth > avg68) advance()
      for (const f of groups[p]!) drawFace(f)
    }
    while (dynDepth !== NONE) advance()
  }

  private drawFace(model: Model, f: number, sx: Float64Array, sy: Float64Array, pixels: Int32Array): void {
    const a = model.indices1[f]!
    const b = model.indices2[f]!
    const c = model.indices3[f]!
    const alpha = model.faceAlphas ? model.faceAlphas[f]! & 0xff : 0
    const texture = model.faceTextures ? model.faceTextures[f]! : -1
    const flat = model.faceColors3[f] === -1
    const c1 = model.faceColors1[f]!
    const c2 = flat ? c1 : model.faceColors2[f]!
    const c3 = flat ? c1 : model.faceColors3[f]!
    const tri: Triangle = { x0: sx[a]!, y0: sy[a]!, x1: sx[b]!, y1: sy[b]!, x2: sx[c]!, y2: sy[c]! }
    if (texture !== -1 && model.uvs) {
      const tex = this.texturePixels(texture)
      if (tex) {
        const o = f * 6
        fillTextured(pixels, tri, [c1, c2, c3], [model.uvs[o]!, model.uvs[o + 2]!, model.uvs[o + 4]!], [model.uvs[o + 1]!, model.uvs[o + 3]!, model.uvs[o + 5]!], tex, alpha)
        return
      }
      // Texture missing: fall back to the face colour at the lit lightness.
      const base = model.faceColors[f]! & 0xff80
      fillGouraud(pixels, tri, [base | (c1 & 0x7f), base | (c2 & 0x7f), base | (c3 & 0x7f)], alpha)
      return
    }
    fillGouraud(pixels, tri, [c1 & 0xffff, c2 & 0xffff, c3 & 0xffff], alpha)
  }
}

interface Triangle {
  x0: number
  y0: number
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Blend `rgb` over the current pixel with the client's alpha rule (0 = opaque). */
function blend(dst: number, rgb: number, alpha: number): number {
  if (alpha === 0) return rgb
  const inv = 256 - alpha
  return ((((rgb & 0xff00ff) * inv + (dst & 0xff00ff) * alpha) >> 8) & 0xff00ff) | ((((rgb & 0xff00) * inv + (dst & 0xff00) * alpha) >> 8) & 0xff00)
}

/**
 * Scanline walk shared by the fill routines: rows are integer y from the top
 * vertex (inclusive) to the bottom (exclusive), spans fill from floor(xl) to
 * floor(xr) exclusive, which is how the client's `>> 16` edge stepping lands.
 * `attrs` are per-vertex attributes interpolated linearly.
 */
function scan(tri: Triangle, attrs: number[][], emit: (x: number, y: number, values: number[]) => void): void {
  const v = [
    { x: tri.x0, y: tri.y0, a: attrs.map((r) => r[0]!) },
    { x: tri.x1, y: tri.y1, a: attrs.map((r) => r[1]!) },
    { x: tri.x2, y: tri.y2, a: attrs.map((r) => r[2]!) },
  ].sort((p, q) => p.y - q.y)
  const [top, mid, bot] = v as [(typeof v)[0], (typeof v)[0], (typeof v)[0]]
  const yStart = Math.max(0, Math.ceil(top.y))
  const yEnd = Math.min(ICON_HEIGHT, Math.ceil(bot.y))
  if (yEnd <= yStart) return
  const count = attrs.length
  const left = new Array<number>(count)
  const right = new Array<number>(count)
  const values = new Array<number>(count)
  for (let y = yStart; y < yEnd; y++) {
    // Long edge top->bot, short edges top->mid then mid->bot.
    const tLong = (y - top.y) / (bot.y - top.y || 1)
    let xl = top.x + (bot.x - top.x) * tLong
    for (let k = 0; k < count; k++) left[k] = top.a[k]! + (bot.a[k]! - top.a[k]!) * tLong
    let xr: number
    if (y < mid.y) {
      const t = (y - top.y) / (mid.y - top.y || 1)
      xr = top.x + (mid.x - top.x) * t
      for (let k = 0; k < count; k++) right[k] = top.a[k]! + (mid.a[k]! - top.a[k]!) * t
    } else {
      const t = (y - mid.y) / (bot.y - mid.y || 1)
      xr = mid.x + (bot.x - mid.x) * t
      for (let k = 0; k < count; k++) right[k] = mid.a[k]! + (bot.a[k]! - mid.a[k]!) * t
    }
    if (xl > xr) {
      const tx = xl
      xl = xr
      xr = tx
      for (let k = 0; k < count; k++) {
        const ta = left[k]!
        left[k] = right[k]!
        right[k] = ta
      }
    }
    const xStart = Math.max(0, Math.floor(xl))
    const xEnd = Math.min(ICON_WIDTH, Math.floor(xr))
    if (xEnd <= xStart) continue
    const span = xr - xl || 1
    for (let x = xStart; x < xEnd; x++) {
      const t = (x - xl) / span
      for (let k = 0; k < count; k++) values[k] = left[k]! + (right[k]! - left[k]!) * t
      emit(x, y, values)
    }
  }
}

function fillGouraud(pixels: Int32Array, tri: Triangle, hsl: [number, number, number], alpha: number): void {
  scan(tri, [hsl], (x, y, v) => {
    const i = y * ICON_WIDTH + x
    const rgb = hsl16ToRgb(Math.round(v[0]!) & 0xffff)
    pixels[i] = blend(pixels[i]!, rgb, alpha)
  })
}

function fillTextured(
  pixels: Int32Array,
  tri: Triangle,
  lightness: [number, number, number],
  us: [number, number, number],
  vs: [number, number, number],
  texture: Int32Array,
  alpha: number,
): void {
  scan(tri, [lightness, us, vs], (x, y, v) => {
    const u = Math.floor(v[1]! * TEXTURE_SIZE) & (TEXTURE_SIZE - 1)
    const tv = Math.floor(v[2]! * TEXTURE_SIZE) & (TEXTURE_SIZE - 1)
    const texel = texture[tv * TEXTURE_SIZE + u]!
    if ((texel >>> 24) === 0) return
    // Same convention as the scene mesh: lightness 0..127 doubles into a 0..255 multiplier.
    const l = Math.min(255, Math.round(v[0]!) * 2)
    const rgb = ((((texel & 0xff00ff) * l) >> 8) & 0xff00ff) | ((((texel & 0xff00) * l) >> 8) & 0xff00)
    const i = y * ICON_WIDTH + x
    pixels[i] = blend(pixels[i]!, rgb === 0 ? 1 : rgb, alpha)
  })
}

/** SpritePixels.outline: paint transparent pixels next to opaque ones. */
function outline(pixels: Int32Array, width: number, height: number, color: number): void {
  const out = new Int32Array(pixels.length)
  let i = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      let p = pixels[i]!
      if (p === 0) {
        if (x > 0 && pixels[i - 1] !== 0) p = color
        else if (y > 0 && pixels[i - width] !== 0) p = color
        else if (x < width - 1 && pixels[i + 1] !== 0) p = color
        else if (y < height - 1 && pixels[i + width] !== 0) p = color
      }
      out[i] = p
    }
  }
  pixels.set(out)
}

/** SpritePixels.drawShadow: one pixel down-right of every opaque pixel. */
function dropShadow(pixels: Int32Array, width: number, height: number, color: number): void {
  for (let y = height - 1; y > 0; y--) {
    const row = y * width
    for (let x = width - 1; x > 0; x--) {
      if (pixels[row + x] === 0 && pixels[row + x - 1 - width] !== 0) pixels[row + x] = color
    }
  }
}
