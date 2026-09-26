/**
 * Minimap raster of one 64x64 map square at 4 px per tile (
 *; scim underlay blending, `m_e` lighting, `o_e` tile shapes,
 * `s_e` Gouraud fill), i.e. the OSRS client's classic
 * minimap: blended underlays, lit overlays cut by the 13 tile shapes. No
 * walls or map icons are drawn (scim does not draw them either).
 */
import { HSL_RGB_MAP } from '../../cache/model/ColorPalette'

export const SQUARE = 64
export const TILE_PX = 4
export const RASTER_SIZE = SQUARE * TILE_PX
const INVALID = 12345678
const DEFAULT_LIGHT = 96

/** Packed HSL16 from hue/sat/light 0..255 (scim, the client's hslToRgbHsl). */
export function packHsl(hue: number, saturation: number, lightness: number): number {
  let s = saturation
  if (lightness > 179) s = (s / 2) | 0
  if (lightness > 192) s = (s / 2) | 0
  if (lightness > 217) s = (s / 2) | 0
  if (lightness > 243) s = (s / 2) | 0
  return (((s / 32) | 0) << 7) + (((hue / 4) | 0) << 10) + ((lightness / 2) | 0)
}

/** Underlay colour lit by a corner light. */
export function litColor(hsl: number, light: number): number {
  if (hsl === -1) return INVALID
  let l = ((hsl & 127) * light) >> 7
  if (l < 2) l = 2
  else if (l > 126) l = 126
  return (hsl & 0xff80) + l
}

/** Overlay colour lit by a corner light (scim; -1 = lightness only). */
export function litOverlay(hsl: number, light: number): number {
  if (hsl === -2) return INVALID
  if (hsl === -1) {
    let l = light
    if (l < 2) l = 2
    else if (l > 126) l = 126
    return l
  }
  let l = ((hsl & 127) * light) >> 7
  if (l < 2) l = 2
  else if (l > 126) l = 126
  return (hsl & 0xff80) + l
}

export interface UnderlayColor {
  hue: number
  saturation: number
  lightness: number
  hueMultiplier: number
}

/**
 * Underlay colours blended over a 5-tile radius (scim, the client's
 * scene build blend). `underlayIds[x * 64 + y]` is 0 or the underlay id + 1.
 * Returns packed HSL per tile (x * 64 + y) or -1.
 */
export function blendUnderlays(underlayIds: ArrayLike<number>, underlay: (id: number) => UnderlayColor | null): Int32Array {
  const out = new Int32Array(SQUARE * SQUARE).fill(-1)
  const hue = new Int32Array(SQUARE)
  const sat = new Int32Array(SQUARE)
  const light = new Int32Array(SQUARE)
  const mult = new Int32Array(SQUARE)
  const count = new Int32Array(SQUARE)
  const at = (x: number, y: number): number => underlayIds[x * SQUARE + y] ?? 0
  for (let x = -5; x < SQUARE + 5; x++) {
    for (let y = 0; y < SQUARE; y++) {
      const xr = x + 5
      if (xr >= 0 && xr < SQUARE) {
        const id = at(xr, y)
        if (id > 0) {
          const u = underlay(id - 1)
          if (u) {
            hue[y] = hue[y]! + u.hue
            sat[y] = sat[y]! + u.saturation
            light[y] = light[y]! + u.lightness
            mult[y] = mult[y]! + u.hueMultiplier
            count[y] = count[y]! + 1
          }
        }
      }
      const xl = x - 5
      if (xl >= 0 && xl < SQUARE) {
        const id = at(xl, y)
        if (id > 0) {
          const u = underlay(id - 1)
          if (u) {
            hue[y] = hue[y]! - u.hue
            sat[y] = sat[y]! - u.saturation
            light[y] = light[y]! - u.lightness
            mult[y] = mult[y]! - u.hueMultiplier
            count[y] = count[y]! - 1
          }
        }
      }
    }
    if (x < 0 || x >= SQUARE) continue
    let h = 0
    let s = 0
    let l = 0
    let m = 0
    let c = 0
    for (let y = -5; y < SQUARE + 5; y++) {
      const yu = y + 5
      if (yu >= 0 && yu < SQUARE) {
        h += hue[yu]!
        s += sat[yu]!
        l += light[yu]!
        m += mult[yu]!
        c += count[yu]!
      }
      const yd = y - 5
      if (yd >= 0 && yd < SQUARE) {
        h -= hue[yd]!
        s -= sat[yd]!
        l -= light[yd]!
        m -= mult[yd]!
        c -= count[yd]!
      }
      if (y < 0 || y >= SQUARE) continue
      if (at(x, y) > 0 && c > 0 && m > 0) out[x * SQUARE + y] = packHsl(((h * 256) / m) | 0, (s / c) | 0, (l / c) | 0)
    }
  }
  return out
}

/** Per-tile light from terrain slope; `heights[x * 64 + y]`, occlusion optional. */
export function computeLights(heights: ArrayLike<number>, occlusion?: ArrayLike<number>): Int32Array {
  const out = new Int32Array(SQUARE * SQUARE).fill(DEFAULT_LIGHT)
  const base = ((Math.sqrt(5100) | 0) * 768) >> 8
  const h = (x: number, y: number): number => heights[x * SQUARE + y] ?? 0
  const o = (x: number, y: number): number => (occlusion ? (occlusion[x * SQUARE + y] ?? 0) : 0)
  for (let x = 1; x < 63; x++) {
    for (let y = 1; y < 63; y++) {
      const dx = h(x + 1, y) - h(x - 1, y)
      const dy = h(x, y + 1) - h(x, y - 1)
      const len = Math.sqrt(dy * dy + dx * dx + 65536) | 0
      const nx = ((dx << 8) / len) | 0
      const ny = (65536 / len) | 0
      const nz = ((dy << 8) / len) | 0
      const light = ((nx * -50 + ny * -10 + nz * -50) / base + DEFAULT_LIGHT) | 0
      const occl = (o(x - 1, y) >> 2) + (o(x, y - 1) >> 2) + (o(x + 1, y) >> 3) + (o(x, y + 1) >> 3) + (o(x, y) >> 1)
      out[x * SQUARE + y] = light - occl
    }
  }
  for (let x = 1; x < 63; x++) {
    out[x * SQUARE + 0] = out[x * SQUARE + 1]!
    out[x * SQUARE + 63] = out[x * SQUARE + 62]!
  }
  for (let y = 0; y < SQUARE; y++) {
    out[0 * SQUARE + y] = out[1 * SQUARE + y]!
    out[63 * SQUARE + y] = out[62 * SQUARE + y]!
  }
  return out
}

/** Vertex lists per tile shape (scim, the client's tile shape vertices). */
const SHAPE_VERTICES: readonly (readonly number[])[] = [
  [1, 3, 5, 7],
  [1, 3, 5, 7],
  [1, 3, 5, 7],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 2, 6],
  [1, 3, 5, 7, 2, 8],
  [1, 3, 5, 7, 2, 8],
  [1, 3, 5, 7, 11, 12],
  [1, 3, 5, 7, 11, 12],
  [1, 3, 5, 7, 13, 14],
]

/** Triangles per shape: [isOverlay, a, b, c] quads. */
const SHAPE_FACES: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 0, 0, 1, 3],
  [1, 1, 2, 3, 1, 0, 1, 3],
  [0, 1, 2, 3, 1, 0, 1, 3],
  [0, 0, 1, 2, 0, 0, 2, 4, 1, 0, 4, 3],
  [0, 0, 1, 4, 0, 0, 4, 3, 1, 1, 2, 4],
  [0, 0, 4, 3, 1, 0, 1, 2, 1, 0, 2, 4],
  [0, 1, 2, 4, 1, 0, 1, 4, 1, 0, 4, 3],
  [0, 4, 1, 2, 0, 4, 2, 5, 1, 0, 4, 5, 1, 0, 5, 3],
  [0, 4, 1, 2, 0, 4, 2, 3, 0, 4, 3, 5, 1, 0, 4, 5],
  [0, 0, 4, 5, 1, 4, 1, 2, 1, 4, 2, 3, 1, 4, 3, 5],
  [0, 0, 1, 5, 0, 1, 4, 5, 0, 1, 2, 4, 1, 0, 5, 3, 1, 5, 4, 3, 1, 4, 2, 3],
  [1, 0, 1, 5, 1, 1, 4, 5, 1, 1, 2, 4, 0, 0, 5, 3, 0, 5, 4, 3, 0, 4, 2, 3],
  [1, 0, 5, 4, 1, 0, 1, 5, 0, 0, 4, 3, 0, 4, 5, 3, 0, 5, 2, 3, 0, 1, 2, 5],
]

const SIZE = 128
const HALF = SIZE / 2
const QUARTER = SIZE / 4
const THREE_QUARTER = 96

function mix(a: number, b: number): number {
  return a === INVALID || b === INVALID || a < 0 || b < 0 ? INVALID : (a + b) >> 1
}

export interface TileTriangle {
  x: [number, number, number]
  y: [number, number, number]
  hsl: [number, number, number]
}

/**
 * Screen triangles of one tile in 0..4 px local coordinates.
 * `shape` is 0 for no overlay, else overlay shape + 1; lights are the SW,
 * SE, NE, NW corner lights.
 */
export function tileTriangles(shape: number, rotation: number, lightSW: number, lightSE: number, lightNE: number, lightNW: number, underlayHsl: number, overlayHsl: number): TileTriangle[] {
  const verts = SHAPE_VERTICES[shape] ?? SHAPE_VERTICES[0]!
  const n = verts.length
  const vx = new Int32Array(n)
  const vy = new Int32Array(n)
  const under = new Int32Array(n)
  const over = new Int32Array(n)
  const hasUnder = underlayHsl !== -1
  const hasOver = overlayHsl >= 0
  const uSW = hasUnder ? litColor(underlayHsl, lightSW) : INVALID
  const uSE = hasUnder ? litColor(underlayHsl, lightSE) : INVALID
  const uNE = hasUnder ? litColor(underlayHsl, lightNE) : INVALID
  const uNW = hasUnder ? litColor(underlayHsl, lightNW) : INVALID
  const oSW = hasOver ? litOverlay(overlayHsl, lightSW) : INVALID
  const oSE = hasOver ? litOverlay(overlayHsl, lightSE) : INVALID
  const oNE = hasOver ? litOverlay(overlayHsl, lightNE) : INVALID
  const oNW = hasOver ? litOverlay(overlayHsl, lightNW) : INVALID
  for (let i = 0; i < n; i++) {
    let v = verts[i]!
    if ((v & 1) === 0 && v <= 8) v = ((v - rotation * 2 - 1) & 7) + 1
    if (v > 8 && v <= 12) v = ((v - 9 - rotation) & 3) + 9
    if (v > 12 && v <= 16) v = ((v - 13 - rotation) & 3) + 13
    let x = 0
    let y = 0
    let u = INVALID
    let o = INVALID
    switch (v) {
      case 1:
        x = 0; y = 0; u = uSW; o = oSW
        break
      case 2:
        x = HALF; y = 0; u = mix(uSE, uSW); o = mix(oSE, oSW)
        break
      case 3:
        x = SIZE; y = 0; u = uSE; o = oSE
        break
      case 4:
        x = SIZE; y = HALF; u = mix(uSE, uNE); o = mix(oSE, oNE)
        break
      case 5:
        x = SIZE; y = SIZE; u = uNE; o = oNE
        break
      case 6:
        x = HALF; y = SIZE; u = mix(uNW, uNE); o = mix(oNW, oNE)
        break
      case 7:
        x = 0; y = SIZE; u = uNW; o = oNW
        break
      case 8:
        x = 0; y = HALF; u = mix(uNW, uSW); o = mix(oNW, oSW)
        break
      case 9:
        x = HALF; y = QUARTER; u = mix(uSE, uSW); o = mix(oSE, oSW)
        break
      case 10:
        x = THREE_QUARTER; y = HALF; u = mix(uSE, uNE); o = mix(oSE, oNE)
        break
      case 11:
        x = HALF; y = THREE_QUARTER; u = mix(uNW, uNE); o = mix(oNW, oNE)
        break
      case 12:
        x = QUARTER; y = HALF; u = mix(uNW, uSW); o = mix(oNW, oSW)
        break
      case 13:
        x = QUARTER; y = QUARTER; u = uSW; o = oSW
        break
      case 14:
        x = THREE_QUARTER; y = QUARTER; u = uSE; o = oSE
        break
      case 15:
        x = THREE_QUARTER; y = THREE_QUARTER; u = uNE; o = oNE
        break
      default:
        x = QUARTER; y = THREE_QUARTER; u = uNW; o = oNW
    }
    vx[i] = x
    vy[i] = y
    under[i] = u
    over[i] = o
  }
  const faces = SHAPE_FACES[shape] ?? SHAPE_FACES[0]!
  const out: TileTriangle[] = []
  for (let f = 0; f < faces.length; f += 4) {
    const isOverlay = faces[f] === 1
    let a = faces[f + 1]!
    let b = faces[f + 2]!
    let c = faces[f + 3]!
    if (a < 4) a = (a - rotation) & 3
    if (b < 4) b = (b - rotation) & 3
    if (c < 4) c = (c - rotation) & 3
    if ((isOverlay && !hasOver) || (!isOverlay && !hasUnder)) continue
    const col = isOverlay ? over : under
    const ca = col[a]!
    const cb = col[b]!
    const cc = col[c]!
    if (ca === INVALID || cb === INVALID || cc === INVALID) continue
    out.push({
      x: [(vx[a]! * TILE_PX) >> 7, (vx[b]! * TILE_PX) >> 7, (vx[c]! * TILE_PX) >> 7],
      y: [((SIZE - vy[a]!) * TILE_PX) >> 7, ((SIZE - vy[b]!) * TILE_PX) >> 7, ((SIZE - vy[c]!) * TILE_PX) >> 7],
      hsl: [ca, cb, cc],
    })
  }
  return out
}

/** ABGR (little-endian ImageData word) from packed HSL16 through the client palette. */
function paletteAbgr(hsl: number): number {
  const rgb = HSL_RGB_MAP[hsl] ?? 0
  return (0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)) >>> 0
}

/**
 * Gouraud-shaded triangle into a 32-bit ABGR buffer (scim, the client's
 * software rasteriser with 14/8-bit fixed point). y0..y2 / x0..x2 in pixels.
 */
export function fillGouraud(buffer: Uint32Array, width: number, height: number, y0: number, y1: number, y2: number, x0: number, x1: number, x2: number, c0: number, c1: number, c2: number): void {
  let t: number
  if (y0 > y1) {
    t = y0; y0 = y1; y1 = t
    t = x0; x0 = x1; x1 = t
    t = c0; c0 = c1; c1 = t
  }
  if (y1 > y2) {
    t = y1; y1 = y2; y2 = t
    t = x1; x1 = x2; x2 = t
    t = c1; c1 = c2; c2 = t
  }
  if (y0 > y1) {
    t = y0; y0 = y1; y1 = t
    t = x0; x0 = x1; x1 = t
    t = c0; c0 = c1; c1 = t
  }
  if (y0 >= height || y2 < 0) return
  const dx1 = x1 - x0
  const dy1 = y1 - y0
  const dx2 = x2 - x0
  const dy2 = y2 - y0
  const det = dx1 * dy2 - dx2 * dy1
  if (det === 0) return
  const dc1 = c1 - c0
  const dc2 = c2 - c0
  const cStepX = (((dc1 * dy2 - dc2 * dy1) << 8) / det) | 0
  const cStepY = (((dc2 * dx1 - dc1 * dx2) << 8) / det) | 0
  const longStep = ((dx2 << 14) / dy2) | 0
  const upperStep = dy1 > 0 ? ((dx1 << 14) / dy1) | 0 : 0
  const lowerStep = y2 - y1 > 0 ? (((x2 - x1) << 14) / (y2 - y1)) | 0 : 0
  let longX = x0 << 14
  let shortX = x0 << 14
  let rowColor = (c0 << 8) + cStepX - x0 * cStepX
  let y = y0
  if (y < 0) {
    longX -= y * longStep
    shortX -= y * upperStep
    rowColor -= y * cStepY
    y = 0
  }
  for (let pass = 0; pass < 2; pass++) {
    const yEnd = Math.min(pass === 0 ? y1 : y2, height)
    const step = pass === 0 ? upperStep : lowerStep
    if (pass === 1) {
      shortX = x1 << 14
      if (y1 < 0) shortX -= y1 * lowerStep
    }
    for (let row = pass === 0 ? y : Math.max(y1, 0); row < yEnd; row++) {
      const a = longX >> 14
      const b = shortX >> 14
      let left = a < b ? a : b
      let right = a < b ? b : a
      if (left < 0) left = 0
      if (right > width) right = width
      if (left < right) {
        const base = row * width
        let color = rowColor + left * cStepX
        for (let x = left; x < right; x++) {
          const idx = color >> 8
          if (idx >= 0 && idx < HSL_RGB_MAP.length) buffer[base + x] = paletteAbgr(idx)
          color += cStepX
        }
      }
      longX += longStep
      shortX += step
      rowColor += cStepY
    }
  }
}

export interface MapSquareData {
  /** Plane 0, indexed x * 64 + y. */
  heights: ArrayLike<number>
  underlayIds: ArrayLike<number>
  overlayIds: ArrayLike<number>
  overlayShapes: ArrayLike<number>
  overlayRotations: ArrayLike<number>
}

/** Rasterise a map square (north up) into `RASTER_SIZE`^2 ABGR words. */
export function rasterizeMinimap(sq: MapSquareData, underlay: (id: number) => UnderlayColor | null, overlayHsl: (overlayIdPlusOne: number) => number): Uint32Array {
  const buf = new Uint32Array(RASTER_SIZE * RASTER_SIZE)
  const blended = blendUnderlays(sq.underlayIds, underlay)
  const lights = computeLights(sq.heights)
  const L = (x: number, y: number): number => lights[x * SQUARE + y]!
  for (let x = 0; x < SQUARE; x++) {
    for (let y = 0; y < SQUARE; y++) {
      const i = x * SQUARE + y
      const overlayId = sq.overlayIds[i] ?? 0
      const underlayId = sq.underlayIds[i] ?? 0
      const shape = overlayId > 0 ? (sq.overlayShapes[i] ?? 0) + 1 : 0
      const rotation = (sq.overlayRotations[i] ?? 0) & 3
      const xe = x < 63 ? x + 1 : x
      const ye = y < 63 ? y + 1 : y
      const tris = tileTriangles(shape, rotation, L(x, y), L(xe, y), L(xe, ye), L(x, ye), underlayId > 0 ? blended[i]! : -1, overlayId > 0 ? overlayHsl(overlayId) : -1)
      if (tris.length === 0) continue
      const sx = x * TILE_PX
      const sy = (63 - y) * TILE_PX
      for (const t of tris) fillGouraud(buf, RASTER_SIZE, RASTER_SIZE, sy + t.y[0], sy + t.y[1], sy + t.y[2], sx + t.x[0], sx + t.x[1], sx + t.x[2], t.hsl[0], t.hsl[1], t.hsl[2])
    }
  }
  return buf
}
