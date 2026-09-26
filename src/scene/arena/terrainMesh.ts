/**
 * Terrain mesh of one map square, as scim's TerrainBuilder (`Qb.buildMesh`): 11x11 underlay blend over the context window, OSRS
 * tile-corner lights minus loc occlusion, OSRS tile shapes, magenta /
 * missing-underlay holes, optional Smooth Terrain corner colours.
 *
 * Output positions are OSRS units relative to the square's SW corner
 * (x east, y = height (negative up), z north), non-indexed triangles.
 */
import {
  CONTEXT_CORNERS,
  CONTEXT_TILES,
  CORE_ORIGIN,
  type ContextTerrain,
} from './contextTerrain'
import {
  HIDDEN_HSL,
  mixHsl,
  overlayCorner,
  overlayHsl,
  packHsl,
  underlayCorner,
  underlayHsl,
  type UnderlayHsl,
} from './floorColors'
import { shapeGeometry } from './tileShapes'

export interface FloorDefs {
  /** Underlay config (0-based id) -> rgb, or undefined when missing. */
  underlayRgb(id: number): number
  /** Overlay config (0-based id): texture id (-1 none) and rgb. */
  overlay(id: number): { rgb: number; texture: number }
}

export interface TerrainMeshData {
  positions: Float32Array
  hslColors: Float32Array
  uvs: Float32Array
  /** Texture array layer (or -1 = untextured / unknown texture). */
  textureIds: Float32Array
  /** Raw cache texture id per vertex (-1 when none), for diagnostics. */
  cacheTextureIds: Int32Array
  vertexCount: number
}

const BLEND_RADIUS = 5
const SQUARE = 64

/** Blend result per core corner/tile (65x65), -1 = none. */
export function blendUnderlays(ctx: ContextTerrain, defs: FloorDefs): Int32Array {
  const size = SQUARE + 1
  const out = new Int32Array(size * size).fill(-1)
  const w = size + 10
  const h = size + 10
  const pitch = h + 1
  const cells = (w + 1) * pitch
  const hue = new Int32Array(cells)
  const sat = new Int32Array(cells)
  const light = new Int32Array(cells)
  const mul = new Int32Array(cells)
  const cnt = new Int32Array(cells)
  const cache = new Map<number, UnderlayHsl>()
  const defOf = (id: number): UnderlayHsl => {
    let d = cache.get(id)
    if (!d) {
      d = underlayHsl(defs.underlayRgb(id))
      cache.set(id, d)
    }
    return d
  }
  const underlayAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= CONTEXT_TILES || y >= CONTEXT_TILES) return 0
    return ctx.underlays[x * CONTEXT_TILES + y] ?? 0
  }
  for (let e = 0; e < w; e++) {
    for (let i = 0; i < h; i++) {
      const tx = CORE_ORIGIN + e - BLEND_RADIUS
      const ty = CORE_ORIGIN + i - BLEND_RADIUS
      const id = underlayAt(tx, ty)
      const d = id > 0 ? defOf(id - 1) : undefined
      const o = (e + 1) * pitch + i + 1
      const up = e * pitch + i + 1
      const left = (e + 1) * pitch + i
      const diag = e * pitch + i
      hue[o] = (d?.hue ?? 0) + hue[up]! + hue[left]! - hue[diag]!
      sat[o] = (d?.saturation ?? 0) + sat[up]! + sat[left]! - sat[diag]!
      light[o] = (d?.lightness ?? 0) + light[up]! + light[left]! - light[diag]!
      mul[o] = (d?.hueMultiplier ?? 0) + mul[up]! + mul[left]! - mul[diag]!
      cnt[o] = (d ? 1 : 0) + cnt[up]! + cnt[left]! - cnt[diag]!
    }
  }
  const box = (t: Int32Array, x0: number, y0: number, x1: number, y1: number): number =>
    t[x1 * pitch + y1]! - t[x0 * pitch + y1]! - t[x1 * pitch + y0]! + t[x0 * pitch + y0]!
  for (let e = 0; e < size; e++) {
    for (let i = 0; i < size; i++) {
      if (underlayAt(CORE_ORIGIN + e, CORE_ORIGIN + i) === 0) continue
      const x1 = e + 11
      const y1 = i + 11
      const m = box(mul, e, i, x1, y1)
      const c = box(cnt, e, i, x1, y1)
      if (m <= 0 || c <= 0) continue
      const hs = box(hue, e, i, x1, y1)
      const ss = box(sat, e, i, x1, y1)
      const ls = box(light, e, i, x1, y1)
      out[e * size + i] = packHsl(Math.floor((hs * 256) / m), Math.floor(ss / c), Math.floor(ls / c))
    }
  }
  return out
}

/** OSRS tile-corner lights for the 65x65 core corners. */
export function tileLights(ctx: ContextTerrain): Int32Array {
  const size = SQUARE + 1
  const out = new Int32Array(size * size)
  const divisor = ((Math.sqrt(5100) | 0) * 768) >> 8
  const H = (x: number, y: number): number => ctx.heights[x * CONTEXT_CORNERS + y]!
  const O = (x: number, y: number): number => ctx.occlusion[x * CONTEXT_CORNERS + y] ?? 0
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const x = CORE_ORIGIN + i
      const y = CORE_ORIGIN + j
      if (x > 0 && x + 1 < CONTEXT_CORNERS && y > 0 && y + 1 < CONTEXT_CORNERS) {
        const dx = H(x + 1, y) - H(x - 1, y)
        const dy = H(x, y + 1) - H(x, y - 1)
        const len = Math.sqrt(dy * dy + dx * dx + 65536) | 0
        const nx = ((dx << 8) / len) | 0
        const ny = (65536 / len) | 0
        const nz = ((dy << 8) / len) | 0
        const light = ((nx * -50 + ny * -10 + nz * -50) / divisor + 96) | 0
        const occl = (O(x - 1, y) >> 2) + (O(x, y - 1) >> 2) + (O(x + 1, y) >> 3) + (O(x, y + 1) >> 3) + (O(x, y) >> 1)
        out[i * size + j] = light - occl
      } else {
        out[i * size + j] = 96
      }
    }
  }
  return out
}

/**
 * Build the level-0 terrain mesh of the context's core square.
 * `textureLayer` maps a cache texture id to a texture-array layer (-1 = missing).
 */
export function buildTerrainMesh(
  ctx: ContextTerrain,
  defs: FloorDefs,
  opts: { smoothTerrain: boolean; textureLayer: (id: number) => number },
): TerrainMeshData {
  const size = SQUARE + 1
  const blended = blendUnderlays(ctx, defs)
  const lights = tileLights(ctx)
  const maxVerts = SQUARE * SQUARE * 18
  const pos = new Float32Array(maxVerts * 3)
  const hsl = new Float32Array(maxVerts)
  const uvs = new Float32Array(maxVerts * 2)
  const tex = new Float32Array(maxVerts)
  const rawTex = new Int32Array(maxVerts)
  let v = 0
  const overlayCache = new Map<number, { texture: number; color: number }>()
  const overlayDef = (id: number): { texture: number; color: number } => {
    let d = overlayCache.get(id)
    if (!d) {
      const o = defs.overlay(id)
      if (o.texture >= 0) d = { texture: o.texture, color: -1 }
      else if (o.rgb === 0xff00ff) d = { texture: -1, color: -2 }
      else {
        const c = overlayHsl(o.rgb)
        d = { texture: -1, color: packHsl(c.hue, c.saturation, c.lightness) }
      }
      overlayCache.set(id, d)
    }
    return d
  }
  const H = (x: number, y: number): number => ctx.heights[x * CONTEXT_CORNERS + y]!
  const L = (i: number, j: number): number => lights[i * size + j] ?? 96
  const B = (i: number, j: number): number => blended[i * size + j] ?? -1

  for (let y = CORE_ORIGIN; y < CORE_ORIGIN + SQUARE; y++) {
    for (let x = CORE_ORIGIN; x < CORE_ORIGIN + SQUARE; x++) {
      const t = x * CONTEXT_TILES + y
      const underlay = ctx.underlays[t]! - 1
      const overlay = ctx.overlays[t]! - 1
      if (underlay === -1 && overlay === -1) continue
      const hSW = H(x, y)
      const hSE = H(x + 1, y)
      const hNE = H(x + 1, y + 1)
      const hNW = H(x, y + 1)
      const ox = (x - CORE_ORIGIN) * 128
      const oz = (y - CORE_ORIGIN) * 128
      const i = x - CORE_ORIGIN
      const j = y - CORE_ORIGIN
      const lSW = L(i, j)
      const lSE = L(i + 1, j)
      const lNE = L(i + 1, j + 1)
      const lNW = L(i, j + 1)
      let uSW = -1
      let uSE = -1
      let uNE = -1
      let uNW = -1
      if (underlay !== -1) {
        uSW = B(i, j)
        uSE = B(i + 1, j)
        uNE = B(i + 1, j + 1)
        uNW = B(i, j + 1)
        if (uSE === -1 || !opts.smoothTerrain) uSE = uSW
        if (uNE === -1 || !opts.smoothTerrain) uNE = uSW
        if (uNW === -1 || !opts.smoothTerrain) uNW = uSW
      }
      const under = [underlayCorner(uSW, lSW), underlayCorner(uSE, lSE), underlayCorner(uNE, lNE), underlayCorner(uNW, lNW)]
      let shape = 0
      let rotation = 0
      let texture = -1
      let overlayColor = -2
      if (overlay !== -1) {
        shape = ctx.shapes[t]! + 1
        rotation = ctx.rotations[t]!
        const d = overlayDef(overlay)
        texture = d.texture
        overlayColor = d.color
      }
      const over = [
        overlayCorner(overlayColor, lSW),
        overlayCorner(overlayColor, lSE),
        overlayCorner(overlayColor, lNE),
        overlayCorner(overlayColor, lNW),
      ]
      const geom = shapeGeometry(shape, rotation, [hSW, hSE, hNE, hNW])
      const vertUnder = geom.vertices.map((p) =>
        p.cornerA === p.cornerB ? under[p.cornerA]! : mixHsl(under[p.cornerA]!, under[p.cornerB]!),
      )
      const vertOver = geom.vertices.map((p) =>
        p.cornerA === p.cornerB ? over[p.cornerA]! : (over[p.cornerA]! + over[p.cornerB]!) >> 1,
      )
      for (const f of geom.faces) {
        const cols = f.isOverlay ? vertOver : vertUnder
        const faceTexture = f.isOverlay ? texture : -1
        const ca = cols[f.a]!
        if (ca === HIDDEN_HSL && faceTexture === -1) continue
        const layer = faceTexture >= 0 ? opts.textureLayer(faceTexture) : -1
        for (const k of [f.a, f.b, f.c]) {
          const p = geom.vertices[k]!
          pos[v * 3] = ox + p.x
          pos[v * 3 + 1] = p.height
          pos[v * 3 + 2] = oz + p.y
          uvs[v * 2] = p.x / 128
          uvs[v * 2 + 1] = p.y / 128
          tex[v] = layer
          rawTex[v] = faceTexture
          hsl[v] = cols[k]!
          v++
        }
      }
    }
  }
  return {
    positions: pos.slice(0, v * 3),
    hslColors: hsl.slice(0, v),
    uvs: uvs.slice(0, v * 2),
    textureIds: tex.slice(0, v),
    cacheTextureIds: rawTex.slice(0, v),
    vertexCount: v,
  }
}
