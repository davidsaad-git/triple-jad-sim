/**
 * Mutable OSRS model used by every renderer path (terrain locs, NPCs, the
 * player, spot anims). It mirrors scim.gg's model class: the decoded geometry of `src/cache` ModelData plus the extra
 * state scim keeps on a model: per-face depth bias (`faceBias`), ground
 * contouring (`contourVerticesY`), merged loc normals (`mergedNormals`),
 * vertex normals with OSRS integer maths, bounds, the OSRS lighting model
 * (`computeLitColors`) and the legacy label animation transforms including
 * `animateInterleaved` (OSRS `animate2`).
 *
 * All maths is integer-exact to scim (which is the OSRS client maths).
 */
import type { SeqFrame } from '../../cache/anim/SeqFrame'
import type { ModelData } from '../../cache/model/ModelData'
import { COS, SIN } from './tables'

export interface VertexNormal {
  x: number
  y: number
  z: number
  magnitude: number
}

export interface FaceNormal {
  x: number
  y: number
  z: number
}

export interface LitColors {
  faceColors1: Int32Array
  faceColors2: Int32Array
  /** -1 = flat (use faceColors1 for all corners), -2 = hidden. */
  faceColors3: Int32Array
}

/** Legacy transform types (SeqBase). */
const T_ORIGIN = 0
const T_TRANSLATE = 1
const T_ROTATE = 2
const T_SCALE = 3
const T_ALPHA = 5

let originX = 0
let originY = 0
let originZ = 0

function resetOrigin(): void {
  originX = 0
  originY = 0
  originZ = 0
}

function newNormal(): VertexNormal {
  return { x: 0, y: 0, z: 0, magnitude: 0 }
}

export class RenderModel {
  verticesCount = 0
  usedVertexCount = 0
  verticesX: Int32Array = new Int32Array(0)
  verticesY: Int32Array = new Int32Array(0)
  verticesZ: Int32Array = new Int32Array(0)

  faceCount = 0
  indices1: Int32Array = new Int32Array(0)
  indices2: Int32Array = new Int32Array(0)
  indices3: Int32Array = new Int32Array(0)
  faceColors: Uint16Array = new Uint16Array(0)
  faceRenderTypes: Int8Array | undefined
  faceRenderPriorities: Int8Array | undefined
  priority = 0
  faceAlphas: Int8Array | undefined
  faceTextures: Int16Array | undefined
  textureCoords: Int8Array | undefined
  faceBias: Int8Array | undefined

  textureFaceCount = 0
  textureMappingP: Int16Array = new Int16Array(0)
  textureMappingM: Int16Array = new Int16Array(0)
  textureMappingN: Int16Array = new Int16Array(0)

  vertexSkins: Int32Array | undefined
  faceSkins: Int32Array | undefined
  vertexLabels: Int32Array[] | undefined
  faceLabels: Int32Array[] | undefined

  normals: VertexNormal[] | undefined
  mergedNormals: (VertexNormal | undefined)[] | undefined
  faceNormals: (FaceNormal | undefined)[] | undefined
  contourVerticesY: Int32Array | undefined

  private boundsValid = false
  /** Max upward extent (OSRS `height`, positive). */
  height = 0
  /** Largest y (lowest point, OSRS "bottom"). */
  minHeight = 0
  minX = 0
  maxX = 0
  minY = 0
  maxY = 0
  minZ = 0
  maxZ = 0

  // ------------------------------------------------------------ construction

  static fromData(data: ModelData, faceBias?: Int8Array): RenderModel {
    const m = new RenderModel()
    m.verticesCount = data.vertexCount
    m.usedVertexCount = data.usedVertexCount
    m.verticesX = data.verticesX.slice()
    m.verticesY = data.verticesY.slice()
    m.verticesZ = data.verticesZ.slice()
    m.faceCount = data.faceCount
    m.indices1 = data.indices1.slice()
    m.indices2 = data.indices2.slice()
    m.indices3 = data.indices3.slice()
    m.faceColors = data.faceColors.slice()
    m.faceRenderTypes = data.faceRenderTypes?.slice()
    m.faceRenderPriorities = data.faceRenderPriorities?.slice()
    m.priority = data.priority
    m.faceAlphas = data.faceAlphas?.slice()
    m.faceTextures = data.faceTextures?.slice()
    m.textureCoords = data.textureCoords?.slice()
    m.faceBias = faceBias?.slice()
    m.textureFaceCount = data.textureFaceCount
    m.textureMappingP = data.textureMappingP
    m.textureMappingM = data.textureMappingM
    m.textureMappingN = data.textureMappingN
    m.vertexSkins = data.vertexSkins
    m.faceSkins = data.faceSkins
    return m
  }

  /** Deep copy of everything a transform, pose or lighting pass may mutate. */
  copy(): RenderModel {
    const m = new RenderModel()
    m.verticesCount = this.verticesCount
    m.usedVertexCount = this.usedVertexCount
    m.verticesX = this.verticesX.slice()
    m.verticesY = this.verticesY.slice()
    m.verticesZ = this.verticesZ.slice()
    m.faceCount = this.faceCount
    m.indices1 = this.indices1.slice()
    m.indices2 = this.indices2.slice()
    m.indices3 = this.indices3.slice()
    m.faceColors = this.faceColors.slice()
    m.faceRenderTypes = this.faceRenderTypes?.slice()
    m.faceRenderPriorities = this.faceRenderPriorities
    m.priority = this.priority
    m.faceAlphas = this.faceAlphas?.slice()
    m.faceTextures = this.faceTextures?.slice()
    m.textureCoords = this.textureCoords
    m.faceBias = this.faceBias
    m.textureFaceCount = this.textureFaceCount
    m.textureMappingP = this.textureMappingP
    m.textureMappingM = this.textureMappingM
    m.textureMappingN = this.textureMappingN
    m.vertexSkins = this.vertexSkins
    m.faceSkins = this.faceSkins
    m.vertexLabels = this.vertexLabels
    m.faceLabels = this.faceLabels
    return m
  }

  /**
   * scim: concatenate faces, de-duplicate vertices by
   * exact position (first match wins), keep per-face attributes; parts
   * without an attribute get the neutral value (render type 0, priority =
   * part priority, alpha 0, skin -1, texture -1, face bias -1).
   */
  static merge(parts: readonly RenderModel[]): RenderModel {
    const out = new RenderModel()
    let vertexTotal = 0
    let faceTotal = 0
    let texTotal = 0
    let hasTypes = false
    let hasPriorities = false
    let hasAlphas = false
    let hasFaceSkins = false
    let hasTextures = false
    let hasTexCoords = false
    let hasBias = false
    out.priority = -1
    for (const p of parts) {
      vertexTotal += p.verticesCount
      faceTotal += p.faceCount
      texTotal += p.textureFaceCount
      if (p.faceRenderPriorities) hasPriorities = true
      else {
        if (out.priority === -1) out.priority = p.priority
        if (out.priority !== p.priority) hasPriorities = true
      }
      hasTypes ||= !!p.faceRenderTypes
      hasAlphas ||= !!p.faceAlphas
      hasFaceSkins ||= !!p.faceSkins
      hasTextures ||= !!p.faceTextures
      hasTexCoords ||= !!p.textureCoords
      hasBias ||= !!p.faceBias
    }
    out.verticesX = new Int32Array(vertexTotal)
    out.verticesY = new Int32Array(vertexTotal)
    out.verticesZ = new Int32Array(vertexTotal)
    const vertexSkins = new Int32Array(vertexTotal)
    out.indices1 = new Int32Array(faceTotal)
    out.indices2 = new Int32Array(faceTotal)
    out.indices3 = new Int32Array(faceTotal)
    out.faceColors = new Uint16Array(faceTotal)
    if (hasTypes) out.faceRenderTypes = new Int8Array(faceTotal)
    if (hasPriorities) out.faceRenderPriorities = new Int8Array(faceTotal)
    if (hasAlphas) out.faceAlphas = new Int8Array(faceTotal)
    const faceSkins = hasFaceSkins ? new Int32Array(faceTotal) : undefined
    if (hasTextures) out.faceTextures = new Int16Array(faceTotal)
    if (hasTexCoords) out.textureCoords = new Int8Array(faceTotal)
    if (hasBias) out.faceBias = new Int8Array(faceTotal)
    if (texTotal > 0) {
      out.textureMappingP = new Int16Array(texTotal)
      out.textureMappingM = new Int16Array(texTotal)
      out.textureMappingN = new Int16Array(texTotal)
    }

    // Vertex de-duplication by exact position; a map keyed on the packed
    // position is equivalent to scim's first-match linear scan.
    const lookup = new Map<string, number>()
    let vCount = 0
    const copyVertex = (p: RenderModel, index: number): number => {
      const x = p.verticesX[index]!
      const y = p.verticesY[index]!
      const z = p.verticesZ[index]!
      const key = `${x},${y},${z}`
      const found = lookup.get(key)
      if (found !== undefined) return found
      out.verticesX[vCount] = x
      out.verticesY[vCount] = y
      out.verticesZ[vCount] = z
      vertexSkins[vCount] = p.vertexSkins ? p.vertexSkins[index]! : -1
      lookup.set(key, vCount)
      return vCount++
    }

    let fCount = 0
    let tCount = 0
    for (const p of parts) {
      for (let f = 0; f < p.faceCount; f++) {
        if (out.faceRenderTypes) out.faceRenderTypes[fCount] = p.faceRenderTypes ? p.faceRenderTypes[f]! : 0
        if (out.faceRenderPriorities) {
          out.faceRenderPriorities[fCount] = p.faceRenderPriorities ? p.faceRenderPriorities[f]! : p.priority
        }
        if (out.faceAlphas && p.faceAlphas) out.faceAlphas[fCount] = p.faceAlphas[f]!
        if (faceSkins) faceSkins[fCount] = p.faceSkins ? p.faceSkins[f]! : -1
        if (out.faceTextures) out.faceTextures[fCount] = p.faceTextures ? p.faceTextures[f]! : -1
        if (out.textureCoords) {
          out.textureCoords[fCount] =
            p.textureCoords && p.textureCoords[f] !== -1 ? tCount + p.textureCoords[f]! : -1
        }
        if (out.faceBias) out.faceBias[fCount] = p.faceBias ? p.faceBias[f]! : -1
        out.faceColors[fCount] = p.faceColors[f]!
        out.indices1[fCount] = copyVertex(p, p.indices1[f]!)
        out.indices2[fCount] = copyVertex(p, p.indices2[f]!)
        out.indices3[fCount] = copyVertex(p, p.indices3[f]!)
        fCount++
      }
      for (let t = 0; t < p.textureFaceCount; t++) {
        out.textureMappingP[tCount] = copyVertex(p, p.textureMappingP[t]! & 0xffff)
        out.textureMappingM[tCount] = copyVertex(p, p.textureMappingM[t]! & 0xffff)
        out.textureMappingN[tCount] = copyVertex(p, p.textureMappingN[t]! & 0xffff)
        tCount++
      }
    }
    if (out.priority === -1) out.priority = 0
    out.verticesCount = vCount
    out.usedVertexCount = vCount
    out.faceCount = fCount
    out.textureFaceCount = tCount
    out.vertexSkins = vertexSkins
    out.faceSkins = faceSkins
    return out
  }

  // ------------------------------------------------------------ edits

  recolor(from: number, to: number): void {
    for (let i = 0; i < this.faceCount; i++) if (this.faceColors[i] === from) this.faceColors[i] = to
  }

  retexture(from: number, to: number): void {
    const t = this.faceTextures
    if (!t) return
    for (let i = 0; i < this.faceCount; i++) if (t[i] === from) t[i] = to
  }

  /** Y-axis rotation by a 0..2047 angle (fixed point, like the client). */
  rotate(angle: number): void {
    const s = SIN[angle & 2047]!
    const c = COS[angle & 2047]!
    for (let i = 0; i < this.verticesCount; i++) {
      const x = this.verticesX[i]!
      const z = this.verticesZ[i]!
      this.verticesX[i] = (s * z + c * x) >> 16
      this.verticesZ[i] = (c * z - s * x) >> 16
    }
    this.invalidate()
  }

  rotate90(): void {
    for (let i = 0; i < this.verticesCount; i++) {
      const x = this.verticesX[i]!
      this.verticesX[i] = this.verticesZ[i]!
      this.verticesZ[i] = -x
    }
    this.invalidate()
  }

  rotate180(): void {
    for (let i = 0; i < this.verticesCount; i++) {
      this.verticesX[i] = -this.verticesX[i]!
      this.verticesZ[i] = -this.verticesZ[i]!
    }
    this.invalidate()
  }

  rotate270(): void {
    for (let i = 0; i < this.verticesCount; i++) {
      const z = this.verticesZ[i]!
      this.verticesZ[i] = this.verticesX[i]!
      this.verticesX[i] = -z
    }
    this.invalidate()
  }

  translate(x: number, y: number, z: number): void {
    for (let i = 0; i < this.verticesCount; i++) {
      this.verticesX[i] = this.verticesX[i]! + x
      this.verticesY[i] = this.verticesY[i]! + y
      this.verticesZ[i] = this.verticesZ[i]! + z
    }
    this.invalidate()
  }

  /** Scale by 128ths, truncating. */
  resize(x: number, y: number, z: number): void {
    for (let i = 0; i < this.verticesCount; i++) {
      this.verticesX[i] = ((this.verticesX[i]! * x) / 128) | 0
      this.verticesY[i] = ((this.verticesY[i]! * y) / 128) | 0
      this.verticesZ[i] = ((this.verticesZ[i]! * z) / 128) | 0
    }
    this.invalidate()
  }

  /** Mirror along z and flip winding. */
  mirror(): void {
    for (let i = 0; i < this.verticesCount; i++) this.verticesZ[i] = -this.verticesZ[i]!
    for (let i = 0; i < this.faceCount; i++) {
      const a = this.indices1[i]!
      this.indices1[i] = this.indices3[i]!
      this.indices3[i] = a
    }
    this.invalidate()
  }

  invalidate(): void {
    this.normals = undefined
    this.mergedNormals = undefined
    this.faceNormals = undefined
    this.boundsValid = false
  }

  // ------------------------------------------------------------ normals & bounds

  /** OSRS vertex normals: integer cross products, halved to fit, length 256. */
  calculateVertexNormals(): void {
    if (this.normals) return
    const normals: VertexNormal[] = new Array(this.usedVertexCount)
    for (let i = 0; i < this.usedVertexCount; i++) normals[i] = newNormal()
    const vy = this.contourVerticesY ?? this.verticesY
    const vx = this.verticesX
    const vz = this.verticesZ
    for (let f = 0; f < this.faceCount; f++) {
      const a = this.indices1[f]!
      const b = this.indices2[f]!
      const c = this.indices3[f]!
      const abx = vx[b]! - vx[a]!
      const aby = vy[b]! - vy[a]!
      const abz = vz[b]! - vz[a]!
      const acx = vx[c]! - vx[a]!
      const acy = vy[c]! - vy[a]!
      const acz = vz[c]! - vz[a]!
      let nx = aby * acz - acy * abz
      let ny = abz * acx - acz * abx
      let nz = abx * acy - acx * aby
      while (nx > 8192 || ny > 8192 || nz > 8192 || nx < -8192 || ny < -8192 || nz < -8192) {
        nx >>= 1
        ny >>= 1
        nz >>= 1
      }
      let len = Math.sqrt(nx * nx + ny * ny + nz * nz) | 0
      if (len <= 0) len = 1
      nx = ((nx * 256) / len) | 0
      ny = ((ny * 256) / len) | 0
      nz = ((nz * 256) / len) | 0
      const type = this.faceRenderTypes ? this.faceRenderTypes[f]! : 0
      if (type === 0) {
        for (const v of [a, b, c]) {
          const n = normals[v]
          if (!n) continue
          n.x += nx
          n.y += ny
          n.z += nz
          n.magnitude++
        }
      } else if (type === 1) {
        if (!this.faceNormals) this.faceNormals = new Array(this.faceCount)
        this.faceNormals[f] = { x: nx, y: ny, z: nz }
      }
    }
    this.normals = normals
  }

  /**: bounds over used vertices (contoured y when present). */
  calculateBounds(): void {
    if (this.boundsValid) return
    this.height = 0
    this.minHeight = 0
    this.minX = 999999
    this.maxX = -999999
    this.minY = 999999
    this.maxY = -999999
    this.minZ = 99999
    this.maxZ = -99999
    const vy = this.contourVerticesY ?? this.verticesY
    for (let i = 0; i < this.usedVertexCount; i++) {
      const x = this.verticesX[i]!
      const y = vy[i]!
      const z = this.verticesZ[i]!
      if (x < this.minX) this.minX = x
      if (x > this.maxX) this.maxX = x
      if (y < this.minY) this.minY = y
      if (y > this.maxY) this.maxY = y
      if (z < this.minZ) this.minZ = z
      if (z > this.maxZ) this.maxZ = z
      if (-y > this.height) this.height = -y
      if (y > this.minHeight) this.minHeight = y
    }
    this.boundsValid = true
  }

  // ------------------------------------------------------------ lighting

  /**
   * OSRS `Model.light` as scim's: smooth faces
   * per-vertex (merged normals win), flat faces with 1.5x divisor, render
   * type 3 unlit (128), type 2 / alpha -1 hidden. Textured faces store the
   * clamped light only. Returns fresh colour arrays; the model is not changed.
   */
  computeLitColors(ambient: number, contrast: number, lx: number, ly: number, lz: number): LitColors {
    this.calculateVertexNormals()
    const normals = this.normals!
    const merged = this.mergedNormals
    const mag = ((Math.sqrt(lz * lz + lx * lx + ly * ly) | 0) * contrast) >> 8
    const c1 = new Int32Array(this.faceCount)
    const c2 = new Int32Array(this.faceCount)
    const c3 = new Int32Array(this.faceCount)
    const normalOf = (v: number): VertexNormal => merged?.[v] ?? normals[v] ?? ZERO_NORMAL
    const vertexLight = (v: number): number => {
      const n = normalOf(v)
      return ambient + (ly * n.y + lz * n.z + lx * n.x) / (mag * n.magnitude)
    }
    for (let f = 0; f < this.faceCount; f++) {
      let type = this.faceRenderTypes ? this.faceRenderTypes[f]! : 0
      const alpha = this.faceAlphas ? this.faceAlphas[f]! : 0
      const texture = this.faceTextures ? this.faceTextures[f]! : -1
      if (alpha === -2) type = 3
      if (alpha === -1) type = 2
      if (texture === -1) {
        if (type === 0) {
          const color = this.faceColors[f]! & 0xffff
          c1[f] = adjustLightness(color, toInt(vertexLight(this.indices1[f]!)))
          c2[f] = adjustLightness(color, toInt(vertexLight(this.indices2[f]!)))
          c3[f] = adjustLightness(color, toInt(vertexLight(this.indices3[f]!)))
        } else if (type === 1 && this.faceNormals) {
          const n = this.faceNormals[f] ?? ZERO_NORMAL
          const l = toInt(ambient + (ly * n.y + lz * n.z + lx * n.x) / ((mag >> 1) + mag))
          c1[f] = adjustLightness(this.faceColors[f]! & 0xffff, l)
          c3[f] = -1
        } else if (type === 3) {
          c1[f] = 128
          c3[f] = -1
        } else {
          c3[f] = -2
        }
      } else if (type === 0) {
        c1[f] = clampLightness(vertexLight(this.indices1[f]!))
        c2[f] = clampLightness(vertexLight(this.indices2[f]!))
        c3[f] = clampLightness(vertexLight(this.indices3[f]!))
      } else if (type === 1 && this.faceNormals) {
        const n = this.faceNormals[f] ?? ZERO_NORMAL
        c1[f] = clampLightness(ambient + (ly * n.y + lz * n.z + lx * n.x) / ((mag >> 1) + mag))
        c3[f] = -1
      } else {
        c3[f] = -2
      }
    }
    return { faceColors1: c1, faceColors2: c2, faceColors3: c3 }
  }

  // ------------------------------------------------------------ animation

  /** Build the label tables ( `computeAnimationTables`). */
  computeAnimationTables(): void {
    if (this.vertexSkins && !this.vertexLabels) {
      this.vertexLabels = groupByLabel(this.vertexSkins, this.usedVertexCount)
    }
    if (this.faceSkins && !this.faceLabels) {
      this.faceLabels = groupByLabel(this.faceSkins, this.faceCount)
    }
  }

  /** Apply one legacy frame. */
  animate(frame: SeqFrame): void {
    if (!this.vertexLabels) return
    resetOrigin()
    const base = frame.base
    for (let i = 0; i < frame.transformCount; i++) {
      const group = frame.transformGroups[i]!
      const type = base.types[group] ?? 0
      const reset = frame.resetOriginGroups[i]!
      if (reset !== -1) this.applyTransform(T_ORIGIN, base.labels[reset] ?? EMPTY, 0, 0, 0)
      this.applyTransform(type, base.labels[group] ?? EMPTY, frame.transformX[i]!, frame.transformY[i]!, frame.transformZ[i]!)
    }
  }

  /**
   * OSRS `animate2`: the primary frame drives every label group not
   * in `masks`; the secondary (base) frame drives the groups in `masks`.
   * `masks` must end with the 9999999 sentinel.
   */
  animateInterleaved(primary: SeqFrame, secondary: SeqFrame, masks: readonly number[]): void {
    if (!this.vertexLabels) return
    const base = primary.base
    resetOrigin()
    let mi = 0
    let mask = masks[mi++] ?? 9999999
    for (let i = 0; i < primary.transformCount; i++) {
      const group = primary.transformGroups[i]!
      const type = base.types[group] ?? 0
      while (group > mask) mask = masks[mi++] ?? 9999999
      const reset = primary.resetOriginGroups[i]!
      if (reset !== -1) this.applyTransform(T_ORIGIN, base.labels[reset] ?? EMPTY, 0, 0, 0)
      if (group !== mask || type === T_ORIGIN) {
        this.applyTransform(type, base.labels[group] ?? EMPTY, primary.transformX[i]!, primary.transformY[i]!, primary.transformZ[i]!)
      }
    }
    resetOrigin()
    mi = 0
    mask = masks[mi++] ?? 9999999
    for (let i = 0; i < secondary.transformCount; i++) {
      const group = secondary.transformGroups[i]!
      if (group >= base.types.length) continue
      const type = base.types[group] ?? 0
      while (group > mask) mask = masks[mi++] ?? 9999999
      const reset = secondary.resetOriginGroups[i]!
      if (reset !== -1) this.applyTransform(T_ORIGIN, base.labels[reset] ?? EMPTY, 0, 0, 0)
      if (group === mask || type === T_ORIGIN) {
        this.applyTransform(
          type,
          base.labels[group] ?? EMPTY,
          secondary.transformX[i]!,
          secondary.transformY[i]!,
          secondary.transformZ[i]!,
        )
      }
    }
  }

  private applyTransform(type: number, labels: readonly number[], tx: number, ty: number, tz: number): void {
    const vl = this.vertexLabels
    if (!vl) return
    const vx = this.verticesX
    const vy = this.verticesY
    const vz = this.verticesZ
    switch (type) {
      case T_ORIGIN: {
        resetOrigin()
        let count = 0
        for (const label of labels) {
          if (label >= vl.length) continue
          const verts = vl[label]!
          for (let k = 0; k < verts.length; k++) {
            const v = verts[k]!
            originX += vx[v]!
            originY += vy[v]!
            originZ += vz[v]!
            count++
          }
        }
        if (count > 0) {
          originX = tx + ((originX / count) | 0)
          originY = ty + ((originY / count) | 0)
          originZ = tz + ((originZ / count) | 0)
        } else {
          originX = tx
          originY = ty
          originZ = tz
        }
        break
      }
      case T_TRANSLATE:
        for (const label of labels) {
          if (label >= vl.length) continue
          const verts = vl[label]!
          for (let k = 0; k < verts.length; k++) {
            const v = verts[k]!
            vx[v] = vx[v]! + tx
            vy[v] = vy[v]! + ty
            vz[v] = vz[v]! + tz
          }
        }
        break
      case T_ROTATE: {
        const ax = (tx & 255) * 8
        const ay = (ty & 255) * 8
        const az = (tz & 255) * 8
        for (const label of labels) {
          if (label >= vl.length) continue
          const verts = vl[label]!
          for (let k = 0; k < verts.length; k++) {
            const v = verts[k]!
            let x = vx[v]! - originX
            let y = vy[v]! - originY
            let z = vz[v]! - originZ
            if (az !== 0) {
              const s = SIN[az]!
              const c = COS[az]!
              const t = (s * y + c * x) >> 16
              y = (c * y - s * x) >> 16
              x = t
            }
            if (ax !== 0) {
              const s = SIN[ax]!
              const c = COS[ax]!
              const t = (c * y - s * z) >> 16
              z = (s * y + c * z) >> 16
              y = t
            }
            if (ay !== 0) {
              const s = SIN[ay]!
              const c = COS[ay]!
              const t = (s * z + c * x) >> 16
              z = (c * z - s * x) >> 16
              x = t
            }
            vx[v] = x + originX
            vy[v] = y + originY
            vz[v] = z + originZ
          }
        }
        break
      }
      case T_SCALE:
        for (const label of labels) {
          if (label >= vl.length) continue
          const verts = vl[label]!
          for (let k = 0; k < verts.length; k++) {
            const v = verts[k]!
            vx[v] = (((vx[v]! - originX) * tx) / 128 | 0) + originX
            vy[v] = (((vy[v]! - originY) * ty) / 128 | 0) + originY
            vz[v] = (((vz[v]! - originZ) * tz) / 128 | 0) + originZ
          }
        }
        break
      case T_ALPHA: {
        const fl = this.faceLabels
        const alphas = this.faceAlphas
        if (!fl || !alphas) break
        for (const label of labels) {
          if (label >= fl.length) continue
          const faces = fl[label]!
          for (let k = 0; k < faces.length; k++) {
            const f = faces[k]!
            const a = alphas[f]!
            if (a === -1 || a === -2) continue
            let n = (a & 255) + tx * 8
            if (n < 0) n = 0
            else if (n > 255) n = 255
            alphas[f] = n
          }
        }
        break
      }
      default:
        break
    }
  }
}

const EMPTY: readonly number[] = []
const ZERO_NORMAL: VertexNormal = { x: 0, y: 0, z: 0, magnitude: 1 }

function toInt(v: number): number {
  // `<< 17 >> 17` in scim: ToInt32 truncation.
  return v | 0
}

/** (hsl & 0xFF80) + clamp(((hsl & 127) * light) >> 7, 2, 126). */
export function adjustLightness(hsl: number, light: number): number {
  let l = ((hsl & 127) * light) >> 7
  if (l < 2) l = 2
  else if (l > 126) l = 126
  return (hsl & 0xff80) + l
}

/** clamp(L, 2, 126) then truncate. */
export function clampLightness(light: number): number {
  let l = light
  if (l < 2) l = 2
  else if (l > 126) l = 126
  return l | 0
}

function groupByLabel(skins: Int32Array, count: number): Int32Array[] {
  const counts = new Int32Array(256)
  let highest = 0
  for (let i = 0; i < count; i++) {
    const s = skins[i]!
    if (s >= 0) {
      counts[s] = counts[s]! + 1
      if (s > highest) highest = s
    }
  }
  const out: Int32Array[] = new Array(highest + 1)
  for (let i = 0; i <= highest; i++) {
    out[i] = new Int32Array(counts[i]!)
    counts[i] = 0
  }
  for (let i = 0; i < count; i++) {
    const s = skins[i]!
    if (s >= 0) {
      out[s]![counts[s]!] = i
      counts[s] = counts[s]! + 1
    }
  }
  return out
}
