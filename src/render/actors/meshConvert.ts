import type { ModelMesh } from '../../cache/model/ModelMesh'
import type { MeshData } from '../Mesh'

/**
 * Client model space is Y-down; the renderer is Y-up. Mirroring Y flips the
 * winding, so corners 2 and 3 of every triangle are swapped to keep faces
 * front-facing under back-face culling.
 */
export function modelMeshToMeshData(mesh: ModelMesh): MeshData {
  const n = mesh.vertexCount
  const positions = new Float32Array(n * 3)
  const colors = new Uint8Array(n * 4)
  const priorities = new Float32Array(n)
  const texcoords = mesh.texcoords ? new Float32Array(n * 3) : null
  for (let tri = 0; tri < n / 3; tri++) {
    for (let k = 0; k < 3; k++) {
      const src = tri * 3 + (k === 0 ? 0 : k === 1 ? 2 : 1)
      const dst = tri * 3 + k
      positions[dst * 3] = mesh.positions[src * 3]!
      positions[dst * 3 + 1] = -mesh.positions[src * 3 + 1]!
      positions[dst * 3 + 2] = mesh.positions[src * 3 + 2]!
      colors[dst * 4] = mesh.colors[src * 4]!
      colors[dst * 4 + 1] = mesh.colors[src * 4 + 1]!
      colors[dst * 4 + 2] = mesh.colors[src * 4 + 2]!
      colors[dst * 4 + 3] = mesh.colors[src * 4 + 3]!
      priorities[dst] = mesh.priorities[src]!
      if (texcoords && mesh.texcoords) {
        texcoords[dst * 3] = mesh.texcoords[src * 3]!
        texcoords[dst * 3 + 1] = mesh.texcoords[src * 3 + 1]!
        texcoords[dst * 3 + 2] = mesh.texcoords[src * 3 + 2]!
      }
    }
  }
  return { positions, colors, priorities, texcoords, vertexCount: n }
}

/** Convert client-space corner positions (from buildMeshPositions) into renderer space, same reordering as above. */
export function convertPositions(src: Float32Array, out: Float32Array): Float32Array {
  const n = src.length / 3
  for (let tri = 0; tri < n / 3; tri++) {
    for (let k = 0; k < 3; k++) {
      const s = tri * 3 + (k === 0 ? 0 : k === 1 ? 2 : 1)
      const d = tri * 3 + k
      out[d * 3] = src[s * 3]!
      out[d * 3 + 1] = -src[s * 3 + 1]!
      out[d * 3 + 2] = src[s * 3 + 2]!
    }
  }
  return out
}
