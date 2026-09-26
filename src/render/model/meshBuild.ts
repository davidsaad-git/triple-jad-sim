/**
 * Flattening of a lit RenderModel into the per-vertex attribute arrays the
 * renderer draws (scim / `buildAnimatedMesh`
 *), the model texture-coordinate projection (`nc`)
 * and the opaque/transparent split.
 *
 * Positions stay in OSRS model units (y down); the command's model matrix
 * maps them to world space. Normals are not emitted: scim's shaders never
 * read them.
 */
import type { LitColors, RenderModel } from './RenderModel'

export type TextureLayerResolver = (textureId: number) => number

export interface MeshArrays {
  /** 3 floats per vertex (3 vertices per face). */
  positions: Float32Array
  /** Packed 16-bit OSRS HSL (lit), or the 2..126 light for textured faces. */
  hslColors: Float32Array
  /** 0..1 per vertex. */
  alphas: Float32Array
  faceBias?: Float32Array | undefined
  uvs?: Float32Array | undefined
  textureIds?: Float32Array | undefined
  /** Model face index per emitted triangle. */
  modelFaceIndices?: Uint32Array | undefined
}

/** Geometry needed by the texture projection. */
export interface UvGeometry {
  verticesX: ArrayLike<number>
  verticesY: ArrayLike<number>
  verticesZ: ArrayLike<number>
  indices1: ArrayLike<number>
  indices2: ArrayLike<number>
  indices3: ArrayLike<number>
  textureCoords: Int8Array | undefined
  textureMappingP: ArrayLike<number>
  textureMappingM: ArrayLike<number>
  textureMappingN: ArrayLike<number>
}

/** True when any face has a texture. */
export function hasAnyTexture(model: RenderModel): boolean {
  const t = model.faceTextures
  if (!t) return false
  const n = Math.min(model.faceCount, t.length)
  for (let i = 0; i < n; i++) if (t[i] !== -1) return true
  return false
}

/** Texture-array layer of a face, 0 when untextured or unknown. */
export function faceTextureLayer(model: RenderModel, face: number, resolve: TextureLayerResolver | undefined): number {
  const t = model.faceTextures
  if (!t || !resolve) return 0
  const id = t[face]
  if (id === undefined || id < 0) return 0
  const layer = resolve(id)
  return layer > 0 ? layer : 0
}

function defaultUvs(out: Float32Array, o: number): void {
  out[o] = 0
  out[o + 1] = 0
  out[o + 2] = 1
  out[o + 3] = 0
  out[o + 4] = 0
  out[o + 5] = 1
}

/**
 * PMN texture projection for one face. Faces without a
 * texture-coordinate mapping get (0,0) (1,0) (0,1).
 */
export function faceUvs(g: UvGeometry, face: number, out: Float32Array, o: number): void {
  const coords = g.textureCoords
  if (!coords || coords[face] === -1 || coords[face] === undefined) {
    defaultUvs(out, o)
    return
  }
  const c = coords[face]! & 255
  const p = g.textureMappingP[c]
  const m = g.textureMappingM[c]
  const n = g.textureMappingN[c]
  if (p === undefined || m === undefined || n === undefined) {
    defaultUvs(out, o)
    return
  }
  const vx = g.verticesX
  const vy = g.verticesY
  const vz = g.verticesZ
  const a = g.indices1[face]!
  const b = g.indices2[face]!
  const cc = g.indices3[face]!
  const px = vx[p]!
  const py = vy[p]!
  const pz = vz[p]!
  const mx = vx[m]! - px
  const my = vy[m]! - py
  const mz = vz[m]! - pz
  const nx = vx[n]! - px
  const ny = vy[n]! - py
  const nz = vz[n]! - pz
  const ax = vx[a]! - px
  const ay = vy[a]! - py
  const az = vz[a]! - pz
  const bx = vx[b]! - px
  const by = vy[b]! - py
  const bz = vz[b]! - pz
  const cx = vx[cc]! - px
  const cy = vy[cc]! - py
  const cz = vz[cc]! - pz
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
  if (
    !Number.isFinite(u0) ||
    !Number.isFinite(u1) ||
    !Number.isFinite(u2) ||
    !Number.isFinite(v0) ||
    !Number.isFinite(v1) ||
    !Number.isFinite(v2)
  ) {
    defaultUvs(out, o)
    return
  }
  out[o] = u0
  out[o + 1] = v0
  out[o + 2] = u1
  out[o + 3] = v1
  out[o + 4] = u2
  out[o + 5] = v2
}

/** `rc`: uvs for a textured face (layer > 0), zeros otherwise, and the layer id per vertex. */
export function writeFaceTexture(
  g: UvGeometry,
  face: number,
  layer: number,
  uvs: Float32Array,
  textureIds: Float32Array,
  vertexOffset: number,
): void {
  if (layer > 0) faceUvs(g, face, uvs, vertexOffset * 2)
  else uvs.fill(0, vertexOffset * 2, vertexOffset * 2 + 6)
  textureIds[vertexOffset] = layer
  textureIds[vertexOffset + 1] = layer
  textureIds[vertexOffset + 2] = layer
}

export function faceAlpha(model: RenderModel, face: number): number {
  return model.faceAlphas ? (255 - (model.faceAlphas[face]! & 255)) / 255 : 1
}

export function faceBiasValue(model: RenderModel, face: number): number {
  if (!model.faceBias) return 0
  const b = model.faceBias[face]!
  return b === -1 ? 0 : b & 255
}

export interface BuildMeshOptions {
  resolveTextureLayer?: TextureLayerResolver | undefined
  /** Faces whose lit colour is hidden (-2) are drawn black instead of skipped (spot anims). */
  renderTexturedAsBlack?: boolean
  /** Emit only these faces, in this order. */
  faceOrder?: ArrayLike<number> | undefined
  /** Alternative Y positions (contoured ground). */
  verticesY?: ArrayLike<number> | undefined
}

/**
 * Flatten `model` with `lit` colours. Hidden faces
 * (faceColors3 === -2) are skipped unless `renderTexturedAsBlack`.
 */
export function buildModelMesh(model: RenderModel, lit: LitColors | null, opts: BuildMeshOptions = {}): MeshArrays {
  const order = opts.faceOrder
  const count = order ? order.length : model.faceCount
  const vy = opts.verticesY ?? model.verticesY
  let emitted = 0
  for (let i = 0; i < count; i++) {
    const f = order ? order[i]! : i
    const c3 = lit ? lit.faceColors3[f]! : model.faceColors[f]!
    if (c3 === -2 && !opts.renderTexturedAsBlack) continue
    emitted++
  }
  const textured = opts.resolveTextureLayer !== undefined && hasAnyTexture(model)
  const positions = new Float32Array(emitted * 9)
  const hslColors = new Float32Array(emitted * 3)
  const alphas = new Float32Array(emitted * 3)
  const faceBias = new Float32Array(emitted * 3)
  const modelFaceIndices = new Uint32Array(emitted)
  const uvs = textured ? new Float32Array(emitted * 6) : undefined
  const textureIds = textured ? new Float32Array(emitted * 3) : undefined
  const geom: UvGeometry = { ...model, verticesY: vy } as UvGeometry
  const tmp = new Float32Array(6)
  let t = 0
  for (let i = 0; i < count; i++) {
    const f = order ? order[i]! : i
    let c1 = lit ? lit.faceColors1[f]! : model.faceColors[f]!
    let c2 = lit ? lit.faceColors2[f]! : model.faceColors[f]!
    let c3 = lit ? lit.faceColors3[f]! : model.faceColors[f]!
    if (c3 === -2) {
      if (opts.renderTexturedAsBlack) c1 = c2 = c3 = 0
      else continue
    }
    if (c3 === -1) c3 = c2 = c1
    const a = faceAlpha(model, f)
    const bias = faceBiasValue(model, f)
    const idx = [model.indices1[f]!, model.indices2[f]!, model.indices3[f]!]
    const cols = [c1, c2, c3]
    let layer = 0
    if (textured) {
      layer = faceTextureLayer(model, f, opts.resolveTextureLayer)
      if (layer > 0) faceUvs(geom, f, tmp, 0)
      else tmp.fill(0)
    }
    for (let k = 0; k < 3; k++) {
      const v = idx[k]!
      const o = (t * 3 + k) * 3
      positions[o] = model.verticesX[v]!
      positions[o + 1] = vy[v]!
      positions[o + 2] = model.verticesZ[v]!
      const vi = t * 3 + k
      hslColors[vi] = cols[k]! & 0xffff
      alphas[vi] = a
      faceBias[vi] = bias
      if (uvs && textureIds) {
        uvs[vi * 2] = tmp[k * 2]!
        uvs[vi * 2 + 1] = tmp[k * 2 + 1]!
        textureIds[vi] = layer
      }
    }
    modelFaceIndices[t] = f
    t++
  }
  return { positions, hslColors, alphas, faceBias, uvs, textureIds, modelFaceIndices }
}

export interface SplitMesh {
  opaque: MeshArrays | null
  transparent: MeshArrays | null
}

/**: split triangles by alpha >= 0.999 (checked on the first vertex). */
export function splitOpaqueTransparent(mesh: MeshArrays, threshold = 0.999): SplitMesh {
  const tris = mesh.positions.length / 9
  if (tris === 0) return { opaque: null, transparent: null }
  let opaqueCount = 0
  let transCount = 0
  for (let i = 0; i < tris; i++) {
    if (mesh.alphas[i * 3]! >= threshold) opaqueCount++
    else transCount++
  }
  if (transCount === 0) return { opaque: mesh, transparent: null }
  if (opaqueCount === 0) return { opaque: null, transparent: mesh }
  const make = (n: number): MeshArrays => ({
    positions: new Float32Array(n * 9),
    hslColors: new Float32Array(n * 3),
    alphas: new Float32Array(n * 3),
    faceBias: mesh.faceBias ? new Float32Array(n * 3) : undefined,
    uvs: mesh.uvs ? new Float32Array(n * 6) : undefined,
    textureIds: mesh.textureIds ? new Float32Array(n * 3) : undefined,
    modelFaceIndices: mesh.modelFaceIndices ? new Uint32Array(n) : undefined,
  })
  const op = make(opaqueCount)
  const tr = make(transCount)
  let oi = 0
  let ti = 0
  for (let i = 0; i < tris; i++) {
    const isOpaque = mesh.alphas[i * 3]! >= threshold
    const dst = isOpaque ? op : tr
    const d = isOpaque ? oi++ : ti++
    copyTriangle(mesh, i, dst, d)
  }
  return { opaque: op, transparent: tr }
}

export function copyTriangle(src: MeshArrays, s: number, dst: MeshArrays, d: number): void {
  dst.positions.set(src.positions.subarray(s * 9, s * 9 + 9), d * 9)
  dst.hslColors.set(src.hslColors.subarray(s * 3, s * 3 + 3), d * 3)
  dst.alphas.set(src.alphas.subarray(s * 3, s * 3 + 3), d * 3)
  if (src.faceBias && dst.faceBias) dst.faceBias.set(src.faceBias.subarray(s * 3, s * 3 + 3), d * 3)
  if (src.uvs && dst.uvs) dst.uvs.set(src.uvs.subarray(s * 6, s * 6 + 6), d * 6)
  if (src.textureIds && dst.textureIds) dst.textureIds.set(src.textureIds.subarray(s * 3, s * 3 + 3), d * 3)
  if (src.modelFaceIndices && dst.modelFaceIndices) dst.modelFaceIndices[d] = src.modelFaceIndices[s]!
}
