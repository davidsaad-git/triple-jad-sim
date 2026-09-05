/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Geometry for one terrain tile: one of the client's 13 tile shapes (0 = flat
 * quad, 1..12 = the overlay "path" shapes) with per-vertex packed HSL for the
 * underlay and overlay halves, in world units (128 per tile, negative-up Y).
 */
import { INVALID_HSL_COLOR, adjustOverlayLight, adjustUnderlayLight, mixHsl } from './ColorUtil'

export const TILE_SIZE = 128
const HALF_TILE_SIZE = TILE_SIZE / 2
const QUARTER_TILE_SIZE = TILE_SIZE / 4
const THREE_QTR_TILE_SIZE = (TILE_SIZE * 3) / 4

/** Which of the 16 canonical tile points each shape uses (1-based, see vertex layout below). */
const TILE_SHAPE_VERTEX_INDICES: readonly (readonly number[])[] = [
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

/** Per shape: groups of 4 = [isOverlay, a, b, c] indexing the shape's vertex list. */
const TILE_SHAPE_FACES: readonly (readonly number[])[] = [
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

export const TILE_SHAPE_COUNT = TILE_SHAPE_VERTEX_INDICES.length

export interface SceneTileModelParams {
  /** 0 = plain quad, 1..12 = overlay shape (terrain shape + 1). */
  shape: number
  rotation: number
  /** Overlay texture id or -1. */
  textureId: number
  /** Tile position in scene tiles. */
  x: number
  y: number
  heightSw: number
  heightSe: number
  heightNe: number
  heightNw: number
  lightSw: number
  lightSe: number
  lightNe: number
  lightNw: number
  /** Blended underlay packed HSL per corner, or -1 for none. */
  underlayHslSw: number
  underlayHslSe: number
  underlayHslNe: number
  underlayHslNw: number
  /** Overlay packed HSL, -1 = textured (lightness only), -2 = hidden. */
  overlayHsl: number
  /** Minimap overlay colour (secondary colour / texture average), same encoding. */
  overlayMinimapHsl: number
  /** Pre-lit 0xRRGGBB for the underlay (minimap), 0 if none. */
  underlayRgb: number
  overlayRgb: number
}

export class SceneTileModel {
  readonly shape: number
  readonly rotation: number
  readonly textureId: number
  readonly underlayRgb: number
  readonly overlayRgb: number

  readonly underlayHslSw: number
  readonly underlayHslSe: number
  readonly underlayHslNe: number
  readonly underlayHslNw: number
  readonly overlayHslSw: number
  readonly overlayHslSe: number
  readonly overlayHslNe: number
  readonly overlayHslNw: number
  readonly overlayMinimapHslSw: number
  readonly overlayMinimapHslSe: number
  readonly overlayMinimapHslNe: number
  readonly overlayMinimapHslNw: number

  /** World-unit vertex positions (y is the negative-up height). */
  readonly vertexX: Int32Array
  readonly vertexY: Int32Array
  readonly vertexZ: Int32Array
  /** Triangle vertex indices into the vertex arrays. */
  readonly facesA: Int32Array
  readonly facesB: Int32Array
  readonly facesC: Int32Array
  /** Packed HSL per face corner; INVALID_HSL_COLOR when the corner has no colour. */
  readonly faceColorsA: Int32Array
  readonly faceColorsB: Int32Array
  readonly faceColorsC: Int32Array
  /** Minimap colours (underlay Sw for every corner, overlay minimap hsl). */
  readonly minimapFaceColorsA: Int32Array
  readonly minimapFaceColorsB: Int32Array
  readonly minimapFaceColorsC: Int32Array
  /** Per-face texture id or -1. */
  readonly faceTextures: Int32Array
  /** True per face when the overlay half of the shape is used. */
  readonly faceIsOverlay: Uint8Array
  /** World-unit tile origin. */
  readonly originX: number
  readonly originZ: number

  constructor(p: SceneTileModelParams) {
    this.shape = p.shape
    this.rotation = p.rotation
    this.textureId = p.textureId
    this.underlayRgb = p.underlayRgb
    this.overlayRgb = p.overlayRgb

    const underlayHslSw = (this.underlayHslSw = adjustUnderlayLight(p.underlayHslSw, p.lightSw))
    const underlayHslSe = (this.underlayHslSe = adjustUnderlayLight(p.underlayHslSe, p.lightSe))
    const underlayHslNe = (this.underlayHslNe = adjustUnderlayLight(p.underlayHslNe, p.lightNe))
    const underlayHslNw = (this.underlayHslNw = adjustUnderlayLight(p.underlayHslNw, p.lightNw))

    const underlayMinimapHslSw = adjustUnderlayLight(p.underlayHslSw, p.lightSw)
    const underlayMinimapHslSe = adjustUnderlayLight(p.underlayHslSw, p.lightSe)
    const underlayMinimapHslNe = adjustUnderlayLight(p.underlayHslSw, p.lightNe)
    const underlayMinimapHslNw = adjustUnderlayLight(p.underlayHslSw, p.lightNw)

    const overlayHslSw = (this.overlayHslSw = adjustOverlayLight(p.overlayHsl, p.lightSw))
    const overlayHslSe = (this.overlayHslSe = adjustOverlayLight(p.overlayHsl, p.lightSe))
    const overlayHslNe = (this.overlayHslNe = adjustOverlayLight(p.overlayHsl, p.lightNe))
    const overlayHslNw = (this.overlayHslNw = adjustOverlayLight(p.overlayHsl, p.lightNw))

    const overlayMinimapHslSw = (this.overlayMinimapHslSw = adjustOverlayLight(p.overlayMinimapHsl, p.lightSw))
    const overlayMinimapHslSe = (this.overlayMinimapHslSe = adjustOverlayLight(p.overlayMinimapHsl, p.lightSe))
    const overlayMinimapHslNe = (this.overlayMinimapHslNe = adjustOverlayLight(p.overlayMinimapHsl, p.lightNe))
    const overlayMinimapHslNw = (this.overlayMinimapHslNw = adjustOverlayLight(p.overlayMinimapHsl, p.lightNw))

    const vertexIndices = TILE_SHAPE_VERTEX_INDICES[p.shape]
    if (!vertexIndices) throw new Error(`Bad tile shape ${p.shape}`)
    const vertexCount = vertexIndices.length
    this.vertexX = new Int32Array(vertexCount)
    this.vertexY = new Int32Array(vertexCount)
    this.vertexZ = new Int32Array(vertexCount)
    const underlayHsls = new Int32Array(vertexCount)
    const underlayMinimapHsls = new Int32Array(vertexCount)
    const overlayHsls = new Int32Array(vertexCount)
    const overlayMinimapHsls = new Int32Array(vertexCount)

    const tileX = (this.originX = p.x * TILE_SIZE)
    const tileY = (this.originZ = p.y * TILE_SIZE)
    const { heightSw, heightSe, heightNe, heightNw } = p
    const rotation = p.rotation

    for (let i = 0; i < vertexCount; i++) {
      let vertexIndex = vertexIndices[i]!
      // Rotate the canonical point around the tile.
      if ((vertexIndex & 1) === 0 && vertexIndex <= 8) {
        vertexIndex = ((vertexIndex - rotation - rotation - 1) & 7) + 1
      }
      if (vertexIndex > 8 && vertexIndex <= 12) {
        vertexIndex = ((vertexIndex - 9 - rotation) & 3) + 9
      }
      if (vertexIndex > 12 && vertexIndex <= 16) {
        vertexIndex = ((vertexIndex - 13 - rotation) & 3) + 13
      }

      let vx: number
      let vz: number
      let vy: number
      let uHsl: number
      let uMini: number
      let oHsl: number
      let oMini: number
      switch (vertexIndex) {
        case 1: // SW corner
          vx = tileX; vz = tileY; vy = heightSw
          uHsl = underlayHslSw; uMini = underlayMinimapHslSw; oHsl = overlayHslSw; oMini = overlayMinimapHslSw
          break
        case 2: // S edge midpoint
          vx = tileX + HALF_TILE_SIZE; vz = tileY; vy = (heightSe + heightSw) >> 1
          uHsl = mixHsl(underlayHslSe, underlayHslSw); uMini = (underlayMinimapHslSe + underlayMinimapHslSw) >> 1
          oHsl = (overlayHslSe + overlayHslSw) >> 1; oMini = (overlayMinimapHslSe + overlayMinimapHslSw) >> 1
          break
        case 3: // SE corner
          vx = tileX + TILE_SIZE; vz = tileY; vy = heightSe
          uHsl = underlayHslSe; uMini = underlayMinimapHslSe; oHsl = overlayHslSe; oMini = overlayMinimapHslSe
          break
        case 4: // E edge midpoint
          vx = tileX + TILE_SIZE; vz = tileY + HALF_TILE_SIZE; vy = (heightNe + heightSe) >> 1
          uHsl = mixHsl(underlayHslSe, underlayHslNe); uMini = (underlayMinimapHslSe + underlayMinimapHslNe) >> 1
          oHsl = (overlayHslSe + overlayHslNe) >> 1; oMini = (overlayMinimapHslSe + overlayMinimapHslNe) >> 1
          break
        case 5: // NE corner
          vx = tileX + TILE_SIZE; vz = tileY + TILE_SIZE; vy = heightNe
          uHsl = underlayHslNe; uMini = underlayMinimapHslNe; oHsl = overlayHslNe; oMini = overlayMinimapHslNe
          break
        case 6: // N edge midpoint
          vx = tileX + HALF_TILE_SIZE; vz = tileY + TILE_SIZE; vy = (heightNe + heightNw) >> 1
          uHsl = mixHsl(underlayHslNw, underlayHslNe); uMini = (underlayMinimapHslNw + underlayMinimapHslNe) >> 1
          oHsl = (overlayHslNw + overlayHslNe) >> 1; oMini = (overlayMinimapHslNw + overlayMinimapHslNe) >> 1
          break
        case 7: // NW corner
          vx = tileX; vz = tileY + TILE_SIZE; vy = heightNw
          uHsl = underlayHslNw; uMini = underlayMinimapHslNw; oHsl = overlayHslNw; oMini = overlayMinimapHslNw
          break
        case 8: // W edge midpoint
          vx = tileX; vz = tileY + HALF_TILE_SIZE; vy = (heightNw + heightSw) >> 1
          uHsl = mixHsl(underlayHslNw, underlayHslSw); uMini = (underlayMinimapHslNw + underlayMinimapHslSw) >> 1
          oHsl = (overlayHslNw + overlayHslSw) >> 1; oMini = (overlayMinimapHslNw + overlayMinimapHslSw) >> 1
          break
        case 9: // inner S
          vx = tileX + HALF_TILE_SIZE; vz = tileY + QUARTER_TILE_SIZE; vy = (heightSe + heightSw) >> 1
          uHsl = mixHsl(underlayHslSe, underlayHslSw); uMini = (underlayMinimapHslSe + underlayMinimapHslSw) >> 1
          oHsl = (overlayHslSe + overlayHslSw) >> 1; oMini = (overlayMinimapHslSe + overlayMinimapHslSw) >> 1
          break
        case 10: // inner E
          vx = tileX + THREE_QTR_TILE_SIZE; vz = tileY + HALF_TILE_SIZE; vy = (heightNe + heightSe) >> 1
          uHsl = mixHsl(underlayHslSe, underlayHslNe); uMini = (underlayMinimapHslSe + underlayMinimapHslNe) >> 1
          oHsl = (overlayHslSe + overlayHslNe) >> 1; oMini = (overlayMinimapHslSe + overlayMinimapHslNe) >> 1
          break
        case 11: // inner N
          vx = tileX + HALF_TILE_SIZE; vz = tileY + THREE_QTR_TILE_SIZE; vy = (heightNe + heightNw) >> 1
          uHsl = mixHsl(underlayHslNw, underlayHslNe); uMini = (underlayMinimapHslNw + underlayMinimapHslNe) >> 1
          oHsl = (overlayHslNw + overlayHslNe) >> 1; oMini = (overlayMinimapHslNw + overlayMinimapHslNe) >> 1
          break
        case 12: // inner W
          vx = tileX + QUARTER_TILE_SIZE; vz = tileY + HALF_TILE_SIZE; vy = (heightNw + heightSw) >> 1
          uHsl = mixHsl(underlayHslNw, underlayHslSw); uMini = (underlayMinimapHslNw + underlayMinimapHslSw) >> 1
          oHsl = (overlayHslNw + overlayHslSw) >> 1; oMini = (overlayMinimapHslNw + overlayMinimapHslSw) >> 1
          break
        case 13: // inner SW
          vx = tileX + QUARTER_TILE_SIZE; vz = tileY + QUARTER_TILE_SIZE; vy = heightSw
          uHsl = underlayHslSw; uMini = underlayMinimapHslSw; oHsl = overlayHslSw; oMini = overlayMinimapHslSw
          break
        case 14: // inner SE
          vx = tileX + THREE_QTR_TILE_SIZE; vz = tileY + QUARTER_TILE_SIZE; vy = heightSe
          uHsl = underlayHslSe; uMini = underlayMinimapHslSe; oHsl = overlayHslSe; oMini = overlayMinimapHslSe
          break
        case 15: // inner NE
          vx = tileX + THREE_QTR_TILE_SIZE; vz = tileY + THREE_QTR_TILE_SIZE; vy = heightNe
          uHsl = underlayHslNe; uMini = underlayMinimapHslNe; oHsl = overlayHslNe; oMini = overlayMinimapHslNe
          break
        default: // 16: inner NW
          vx = tileX + QUARTER_TILE_SIZE; vz = tileY + THREE_QTR_TILE_SIZE; vy = heightNw
          uHsl = underlayHslNw; uMini = underlayMinimapHslNw; oHsl = overlayHslNw; oMini = overlayMinimapHslNw
          break
      }

      this.vertexX[i] = vx
      this.vertexY[i] = vy
      this.vertexZ[i] = vz
      underlayHsls[i] = uHsl
      underlayMinimapHsls[i] = uMini
      overlayHsls[i] = oHsl
      overlayMinimapHsls[i] = oMini
    }

    const tileFaces = TILE_SHAPE_FACES[p.shape]!
    const faceCount = tileFaces.length / 4
    this.facesA = new Int32Array(faceCount)
    this.facesB = new Int32Array(faceCount)
    this.facesC = new Int32Array(faceCount)
    this.faceColorsA = new Int32Array(faceCount)
    this.faceColorsB = new Int32Array(faceCount)
    this.faceColorsC = new Int32Array(faceCount)
    this.minimapFaceColorsA = new Int32Array(faceCount)
    this.minimapFaceColorsB = new Int32Array(faceCount)
    this.minimapFaceColorsC = new Int32Array(faceCount)
    this.faceTextures = new Int32Array(faceCount).fill(-1)
    this.faceIsOverlay = new Uint8Array(faceCount)

    let k = 0
    for (let i = 0; i < faceCount; i++) {
      const isOverlay = tileFaces[k++] === 1
      let a = tileFaces[k++]!
      let b = tileFaces[k++]!
      let c = tileFaces[k++]!
      // The four corners rotate with the tile; extra points were rotated above.
      if (a < 4) a = (a - rotation) & 3
      if (b < 4) b = (b - rotation) & 3
      if (c < 4) c = (c - rotation) & 3
      this.facesA[i] = a
      this.facesB[i] = b
      this.facesC[i] = c
      this.faceIsOverlay[i] = isOverlay ? 1 : 0
      if (isOverlay) {
        this.faceColorsA[i] = overlayHsls[a]!
        this.faceColorsB[i] = overlayHsls[b]!
        this.faceColorsC[i] = overlayHsls[c]!
        this.minimapFaceColorsA[i] = overlayMinimapHsls[a]!
        this.minimapFaceColorsB[i] = overlayMinimapHsls[b]!
        this.minimapFaceColorsC[i] = overlayMinimapHsls[c]!
        this.faceTextures[i] = p.textureId
      } else {
        this.faceColorsA[i] = underlayHsls[a]!
        this.faceColorsB[i] = underlayHsls[b]!
        this.faceColorsC[i] = underlayHsls[c]!
        this.minimapFaceColorsA[i] = underlayMinimapHsls[a]!
        this.minimapFaceColorsB[i] = underlayMinimapHsls[b]!
        this.minimapFaceColorsC[i] = underlayMinimapHsls[c]!
      }
    }
  }

  get faceCount(): number {
    return this.facesA.length
  }

  /** A face with no colour and no texture is not drawn (hidden overlay / missing underlay). */
  isFaceHidden(face: number): boolean {
    return this.faceColorsA[face] === INVALID_HSL_COLOR && this.faceTextures[face] === -1
  }

  /** Texture u/v of a vertex: its position within the tile, 0..1. */
  vertexU(vertex: number): number {
    return (this.vertexX[vertex]! - this.originX) / TILE_SIZE
  }

  vertexV(vertex: number): number {
    return (this.vertexZ[vertex]! - this.originZ) / TILE_SIZE
  }
}
