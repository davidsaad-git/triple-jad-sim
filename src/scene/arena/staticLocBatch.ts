/**
 * Static loc batching: every non-animated loc
 * part is lit with the loc light (-50, -10, -50), transformed to world space
 * on the CPU (float32 inputs) and appended to one opaque and one
 * transparent mesh (identity model matrix, back-face culling).
 */
import type { MeshCommand } from '../../render/gl/types'
import { identityMatrix } from '../../render/gl/types'
import { faceAlpha, faceBiasValue, faceTextureLayer, faceUvs, hasAnyTexture, type TextureLayerResolver, type UvGeometry } from '../../render/model/meshBuild'
import type { LitColors, RenderModel } from '../../render/model/RenderModel'

export const LOC_LIGHT_X = -50
export const LOC_LIGHT_Y = -10
export const LOC_LIGHT_Z = -50

export interface StaticLocPart {
  model: RenderModel
  modelMatrix: Float32Array
  ambient: number
  contrast: number
}

export function batchStaticLocs(parts: readonly StaticLocPart[], resolveLayer: TextureLayerResolver): MeshCommand[] {
  const litCache = new Map<RenderModel, { ambient: number; contrast: number; colors: LitColors }>()
  const lits: LitColors[] = []
  let opaqueFaces = 0
  let transFaces = 0
  for (const p of parts) {
    const c = litCache.get(p.model)
    const same = !!(c && c.ambient === p.ambient && c.contrast === p.contrast)
    const colors = c && same ? c.colors : p.model.computeLitColors(p.ambient, p.contrast, LOC_LIGHT_X, LOC_LIGHT_Y, LOC_LIGHT_Z)
    if (!same) litCache.set(p.model, { ambient: p.ambient, contrast: p.contrast, colors })
    lits.push(colors)
    for (let f = 0; f < p.model.faceCount; f++) {
      if (colors.faceColors3[f] === -2) continue
      if (faceAlpha(p.model, f) >= 0.999) opaqueFaces++
      else transFaces++
    }
  }
  const everyBias = parts.length > 0 && parts.every((p) => p.model.faceBias)
  const anyTexture = parts.some((p) => hasAnyTexture(p.model))
  const alloc = (faces: number) => ({
    positions: new Float32Array(faces * 9),
    hslColors: new Float32Array(faces * 3),
    alphas: new Float32Array(faces * 3),
    faceBias: everyBias ? new Float32Array(faces * 3) : undefined,
    uvs: anyTexture ? new Float32Array(faces * 6) : undefined,
    textureIds: anyTexture ? new Float32Array(faces * 3) : undefined,
  })
  const op = alloc(opaqueFaces)
  const tr = alloc(transFaces)
  let ov = 0
  let tv = 0
  const tmpUv = new Float32Array(6)
  for (let n = 0; n < parts.length; n++) {
    const part = parts[n]!
    const lit = lits[n]!
    const m = part.model
    const mat = part.modelMatrix
    const vy = m.contourVerticesY ?? m.verticesY
    const simple = mat[2] === 0 && mat[4] === 0 && mat[5] === 0 && mat[10] === 0
    const world = new Float32Array(m.usedVertexCount * 3)
    for (let v = 0; v < m.usedVertexCount; v++) {
      const x = Math.fround(m.verticesX[v]!)
      const y = Math.fround(vy[v]!)
      const z = Math.fround(m.verticesZ[v]!)
      world[v * 3] = simple ? mat[0]! * x + mat[8]! * z + mat[12]! : mat[0]! * x + mat[4]! * y + mat[8]! * z + mat[12]!
      world[v * 3 + 1] = simple ? mat[1]! * x + mat[9]! * z + mat[13]! : mat[1]! * x + mat[5]! * y + mat[9]! * z + mat[13]!
      world[v * 3 + 2] = simple ? mat[6]! * y + mat[14]! : mat[2]! * x + mat[6]! * y + mat[10]! * z + mat[14]!
    }
    const geom: UvGeometry | null = anyTexture
      ? {
          verticesX: m.verticesX,
          verticesY: vy,
          verticesZ: m.verticesZ,
          indices1: m.indices1,
          indices2: m.indices2,
          indices3: m.indices3,
          textureCoords: m.textureCoords,
          textureMappingP: m.textureMappingP,
          textureMappingM: m.textureMappingM,
          textureMappingN: m.textureMappingN,
        }
      : null
    for (let f = 0; f < m.faceCount; f++) {
      let c1 = lit.faceColors1[f]!
      let c2 = lit.faceColors2[f]!
      let c3 = lit.faceColors3[f]!
      if (c3 === -2) continue
      if (c3 === -1) c3 = c2 = c1
      const a = faceAlpha(m, f)
      const opaque = a >= 0.999
      const dst = opaque ? op : tr
      const vi = opaque ? ov : tv
      const bias = faceBiasValue(m, f)
      dst.hslColors[vi] = c1 & 0xffff
      dst.hslColors[vi + 1] = c2 & 0xffff
      dst.hslColors[vi + 2] = c3 & 0xffff
      dst.alphas[vi] = a
      dst.alphas[vi + 1] = a
      dst.alphas[vi + 2] = a
      if (dst.faceBias) {
        dst.faceBias[vi] = bias
        dst.faceBias[vi + 1] = bias
        dst.faceBias[vi + 2] = bias
      }
      if (geom && dst.uvs && dst.textureIds) {
        const layer = faceTextureLayer(m, f, resolveLayer)
        if (layer > 0) faceUvs(geom, f, tmpUv, 0)
        else tmpUv.fill(0)
        dst.uvs.set(tmpUv, vi * 2)
        dst.textureIds[vi] = layer
        dst.textureIds[vi + 1] = layer
        dst.textureIds[vi + 2] = layer
      }
      const idx = [m.indices1[f]!, m.indices2[f]!, m.indices3[f]!]
      for (let k = 0; k < 3; k++) {
        const s = idx[k]! * 3
        const d = (vi + k) * 3
        dst.positions[d] = world[s]!
        dst.positions[d + 1] = world[s + 1]!
        dst.positions[d + 2] = world[s + 2]!
      }
      if (opaque) ov += 3
      else tv += 3
    }
  }
  const out: MeshCommand[] = []
  const make = (meshId: string, d: ReturnType<typeof alloc>, transparent: boolean): MeshCommand => ({
    meshId,
    modelMatrix: identityMatrix(),
    positions: d.positions,
    hslColors: d.hslColors,
    alphas: d.alphas,
    faceBias: d.faceBias,
    uvs: d.uvs,
    textureIds: d.textureIds,
    ...(transparent ? { depth: 'read' as const, blend: 'normal' as const } : {}),
    cullFace: 'back',
  })
  if (opaqueFaces > 0) out.push(make('merged-static-locs-opaque', op, false))
  if (transFaces > 0) out.push(make('merged-static-locs-transparent', tr, true))
  return out
}
