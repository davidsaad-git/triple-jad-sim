// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// Flattens a lit Model into per-face-corner arrays a WebGL2 renderer can
// upload directly. Hidden faces (faceColors3 === -2) are dropped. Coordinates
// are the client's (Y down); flipping is left to the renderer.

import { hsl16ToRgb } from './ColorPalette'
import type { Model } from './Model'

export interface ModelMesh {
  /** 3 floats per corner (x, y, z in client units, Y down). */
  positions: Float32Array
  /** 4 bytes per corner (r, g, b, a). */
  colors: Uint8Array
  /** 1 float per corner: face render priority (0..10). */
  priorities: Float32Array
  /** 3 floats per corner (u, v, textureId) or null when nothing is textured. */
  texcoords: Float32Array | null
  /** Packed HSL16 face colour per corner (already lit for untextured faces). */
  hsl: Uint16Array
  /** Face index (into the Model) each corner came from; 1 per corner. */
  faceIds: Int32Array
  vertexCount: number
}

export interface VertexPositions {
  verticesX: Int32Array
  verticesY: Int32Array
  verticesZ: Int32Array
}

/** Indices of the faces that will be emitted, in emission order. */
export function visibleFaces(model: Model): Int32Array {
  const out = new Int32Array(model.faceCount)
  let n = 0
  for (let i = 0; i < model.faceCount; i++) {
    if (model.faceColors3[i] !== -2) out[n++] = i
  }
  return out.subarray(0, n)
}

export function buildModelMesh(model: Model, positions: VertexPositions = model): ModelMesh {
  const faces = visibleFaces(model)
  const vertexCount = faces.length * 3
  const textured = model.faceTextures !== undefined && model.uvs !== undefined

  const pos = new Float32Array(vertexCount * 3)
  const colors = new Uint8Array(vertexCount * 4)
  const priorities = new Float32Array(vertexCount)
  const hsl = new Uint16Array(vertexCount)
  const faceIds = new Int32Array(vertexCount)
  const texcoords = textured ? new Float32Array(vertexCount * 3) : null

  let corner = 0
  for (const f of faces) {
    const texture = model.faceTextures ? model.faceTextures[f]! : -1
    const alphaByte = model.faceAlphas ? model.faceAlphas[f]! : 0
    const alpha = alphaByte === -1 || alphaByte === -2 ? 255 : 255 - (alphaByte & 0xff)
    const priority = model.facePriority(f)
    const flat = model.faceColors3[f] === -1
    const c1 = model.faceColors1[f]!
    const c2 = flat ? c1 : model.faceColors2[f]!
    const c3 = flat ? c1 : model.faceColors3[f]!
    const cornerColors = [c1, c2, c3]
    const cornerIndices = [model.indices1[f]!, model.indices2[f]!, model.indices3[f]!]

    for (let k = 0; k < 3; k++) {
      const v = cornerIndices[k]!
      const c = cornerColors[k]!
      const o = corner * 3
      pos[o] = positions.verticesX[v]!
      pos[o + 1] = positions.verticesY[v]!
      pos[o + 2] = positions.verticesZ[v]!

      let rgb: number
      let packed: number
      if (texture === -1) {
        packed = c & 0xffff
        rgb = hsl16ToRgb(packed)
      } else {
        // Textured: c is a lightness in 2..126, emit a grey the shader multiplies the texel by.
        const grey = Math.min(255, c * 2)
        packed = (model.faceColors[f]! & 0xff80) | (c & 0x7f)
        rgb = (grey << 16) | (grey << 8) | grey
      }
      const co = corner * 4
      colors[co] = (rgb >> 16) & 0xff
      colors[co + 1] = (rgb >> 8) & 0xff
      colors[co + 2] = rgb & 0xff
      colors[co + 3] = alpha
      priorities[corner] = priority
      hsl[corner] = packed
      faceIds[corner] = f
      if (texcoords) {
        const uo = f * 6 + k * 2
        texcoords[o] = texture === -1 ? 0 : model.uvs![uo]!
        texcoords[o + 1] = texture === -1 ? 0 : model.uvs![uo + 1]!
        texcoords[o + 2] = texture
      }
      corner++
    }
  }

  return { positions: pos, colors, priorities, texcoords, hsl, faceIds, vertexCount }
}

/**
 * Positions only, in the same corner order as `buildModelMesh`, for
 * re-uploading an animated frame into an existing mesh.
 */
export function buildMeshPositions(
  model: Model,
  positions: VertexPositions,
  out?: Float32Array,
): Float32Array {
  const faces = visibleFaces(model)
  const result = out ?? new Float32Array(faces.length * 9)
  let o = 0
  for (const f of faces) {
    for (const v of [model.indices1[f]!, model.indices2[f]!, model.indices3[f]!]) {
      result[o++] = positions.verticesX[v]!
      result[o++] = positions.verticesY[v]!
      result[o++] = positions.verticesZ[v]!
    }
  }
  return result
}
