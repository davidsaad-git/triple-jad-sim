// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.

import type { ModelData } from './ModelData'

/**
 * A lit model: `ModelData` geometry plus the baked per-vertex HSL16 colours
 * produced by `ModelData.light()`. Plain data, ready to be flattened for WebGL
 * (see `ModelMesh.ts`) and re-positioned per animation frame.
 *
 * Per face `i`:
 *  - `faceColors3[i] === -2` -> face is hidden;
 *  - `faceColors3[i] === -1` -> flat shaded, `faceColors1[i]` applies to all corners;
 *  - otherwise smooth shaded with `faceColors1/2/3[i]` per corner.
 * Untextured faces hold packed HSL16 in those slots; textured faces hold just
 * a 2..126 lightness to modulate the texture with.
 */
export class Model {
  vertexCount = 0
  usedVertexCount = 0
  verticesX: Int32Array = new Int32Array(0)
  verticesY: Int32Array = new Int32Array(0)
  verticesZ: Int32Array = new Int32Array(0)

  faceCount = 0
  indices1: Int32Array = new Int32Array(0)
  indices2: Int32Array = new Int32Array(0)
  indices3: Int32Array = new Int32Array(0)

  /** Original (unlit) packed HSL16 face colours. */
  faceColors: Uint16Array = new Uint16Array(0)
  faceColors1: Int32Array = new Int32Array(0)
  faceColors2: Int32Array = new Int32Array(0)
  faceColors3: Int32Array = new Int32Array(0)

  faceRenderPriorities: Int8Array | undefined
  priority = 0
  faceAlphas: Int8Array | undefined
  faceTextures: Int16Array | undefined
  textureCoords: Int8Array | undefined

  textureFaceCount = 0
  textureRenderTypes: Int8Array = new Int8Array(0)
  textureMappingP: Int16Array = new Int16Array(0)
  textureMappingM: Int16Array = new Int16Array(0)
  textureMappingN: Int16Array = new Int16Array(0)

  /** Per-face-corner (u, v) pairs, 6 floats per face; undefined when the model has no textures. */
  uvs: Float32Array | undefined

  /** The geometry this model was lit from (shares vertex arrays); used for animation. */
  source: ModelData | undefined

  facePriority(i: number): number {
    return this.faceRenderPriorities ? this.faceRenderPriorities[i]! : this.priority
  }

  /**
   * Texture coordinates via the client's P/M/N mapping-triangle projection
   * (texture render type 0 only, which is all OSRS models use).
   */
  computeTextureCoords(): Float32Array | undefined {
    const faceTextures = this.faceTextures
    if (!faceTextures) return undefined

    const vx = this.verticesX
    const vy = this.verticesY
    const vz = this.verticesZ
    const uvs = new Float32Array(this.faceCount * 6)

    for (let i = 0; i < this.faceCount; i++) {
      if (faceTextures[i] === -1) continue
      const i0 = this.indices1[i]!
      const i1 = this.indices2[i]!
      const i2 = this.indices3[i]!

      let p: number
      let m: number
      let n: number
      const coord = this.textureCoords ? this.textureCoords[i]! : -1
      if (coord !== -1) {
        const c = coord & 0xff
        p = this.textureMappingP[c]! & 0xffff
        m = this.textureMappingM[c]! & 0xffff
        n = this.textureMappingN[c]! & 0xffff
      } else {
        p = i0
        m = i1
        n = i2
      }

      const px = vx[p]!
      const py = vy[p]!
      const pz = vz[p]!
      const mx = vx[m]! - px
      const my = vy[m]! - py
      const mz = vz[m]! - pz
      const nx = vx[n]! - px
      const ny = vy[n]! - py
      const nz = vz[n]! - pz
      const ax = vx[i0]! - px
      const ay = vy[i0]! - py
      const az = vz[i0]! - pz
      const bx = vx[i1]! - px
      const by = vy[i1]! - py
      const bz = vz[i1]! - pz
      const cx = vx[i2]! - px
      const cy = vy[i2]! - py
      const cz = vz[i2]! - pz

      const crossX = my * nz - mz * ny
      const crossY = mz * nx - mx * nz
      const crossZ = mx * ny - my * nx
      let ux = ny * crossZ - nz * crossY
      let uy = nz * crossX - nx * crossZ
      let uz = nx * crossY - ny * crossX
      let inv = 1 / (ux * mx + uy * my + uz * mz)
      const u0 = (ux * ax + uy * ay + uz * az) * inv
      const u1 = (ux * bx + uy * by + uz * bz) * inv
      const u2 = (ux * cx + uy * cy + uz * cz) * inv

      ux = my * crossZ - mz * crossY
      uy = mz * crossX - mx * crossZ
      uz = mx * crossY - my * crossX
      inv = 1 / (ux * nx + uy * ny + uz * nz)
      const v0 = (ux * ax + uy * ay + uz * az) * inv
      const v1 = (ux * bx + uy * by + uz * bz) * inv
      const v2 = (ux * cx + uy * cy + uz * cz) * inv

      const o = i * 6
      uvs[o] = u0
      uvs[o + 1] = v0
      uvs[o + 2] = u1
      uvs[o + 3] = v1
      uvs[o + 4] = u2
      uvs[o + 5] = v2
    }
    return uvs
  }
}
