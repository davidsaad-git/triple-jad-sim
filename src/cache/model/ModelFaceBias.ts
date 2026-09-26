/**
 * Per-face depth bias ("face bias") as scim.gg's model decoder reads it
 *. It is not part of the OSRS client model; scim uses
 * it as a small per-face depth offset in its vertex shader.
 *
 * - newest layout (footer -3,-1): when the model has face textures and
 *   texture triangles, one byte per textured face is read (value - 1) from
 *   the bytes that follow the texture translation block; untextured faces
 *   get -1.
 * - footer -2,-1 and the legacy layout: when the model uses textures, a
 *   textured face (info flag bit 2) gets `flag >> 2` (its texture-coordinate
 *   index), other faces -1.
 * - footer -1,-1: no face bias.
 *
 * Returns undefined when the layout carries none. Bytes read past the end
 * of the buffer behave like scim's reader (NaN, stored as 0).
 */
import { ByteReader } from '../ByteReader'

export function decodeModelFaceBias(data: Uint8Array): Int8Array | undefined {
  const last = data[data.length - 1]
  const secondLast = data[data.length - 2]
  if (last === 0xfd && secondLast === 0xff) return newestFaceBias(data)
  if (last === 0xfe && secondLast === 0xff) return legacyFaceBias(data, 23, true)
  if (last === 0xff && secondLast === 0xff) return undefined
  return legacyFaceBias(data, 18, false)
}

function newestFaceBias(data: Uint8Array): Int8Array | undefined {
  const h = new ByteReader(data, data.length - 26)
  const vertexCount = h.u16()
  const faceCount = h.u16()
  const texFaceCount = h.u8()
  const hasFaceRenderTypes = h.u8() === 1
  const modelPriority = h.u8()
  const hasFaceAlphas = h.u8() === 1
  const hasFaceSkins = h.u8() === 1
  const hasFaceTextures = h.u8() === 1
  h.u8() // vertex skins
  h.u8() // maya groups
  const vertexXBytes = h.u16()
  const vertexYBytes = h.u16()
  const vertexZBytes = h.u16()
  const faceIndexBytes = h.u16()
  const textureIndexBytes = h.u16()
  const skinBytes = h.u16()
  if (!hasFaceTextures || texFaceCount <= 0) return undefined

  let simple = 0
  let complex = 0
  let cube = 0
  for (let i = 0; i < texFaceCount; i++) {
    const t = (data[i]! << 24) >> 24
    if (t === 0) simple++
    if (t >= 1 && t <= 3) complex++
    if (t === 2) cube++
  }

  let off = texFaceCount + vertexCount
  if (hasFaceRenderTypes) off += faceCount
  off += faceCount // compress types
  if (modelPriority === 255) off += faceCount
  if (hasFaceSkins) off += faceCount
  off += skinBytes
  if (hasFaceAlphas) off += faceCount
  off += faceIndexBytes
  const faceTexturesOff = off
  off += faceCount * 2
  off += textureIndexBytes
  off += faceCount * 2 // colours
  off += vertexXBytes + vertexYBytes + vertexZBytes
  off += simple * 6 + complex * 6 + complex * 6 + complex * 2 + complex + complex * 2 + cube * 2
  const biasOff = off

  const bias = new Int8Array(faceCount).fill(-1)
  const tex = new ByteReader(data, faceTexturesOff)
  let b = biasOff
  for (let f = 0; f < faceCount; f++) {
    const texture = tex.u16() - 1
    if (texture !== -1) {
      const v = data[b++]
      bias[f] = v === undefined ? 0 : v - 1
    }
  }
  return bias
}

function legacyFaceBias(data: Uint8Array, headerSize: number, v2: boolean): Int8Array | undefined {
  const h = new ByteReader(data, data.length - headerSize)
  const vertexCount = h.u16()
  const faceCount = h.u16()
  h.u8() // tex face count
  const usesTextures = h.u8() === 1
  const modelPriority = h.u8()
  h.u8() // alphas
  const hasFaceSkins = h.u8() === 1
  if (!usesTextures) return undefined
  let off = vertexCount
  off += faceCount // compress types
  if (modelPriority === 255) off += faceCount
  if (hasFaceSkins) off += faceCount
  const infoOff = off
  void v2
  const bias = new Int8Array(faceCount)
  for (let f = 0; f < faceCount; f++) {
    const flag = data[infoOff + f] ?? 0
    bias[f] = (flag & 2) === 2 ? flag >> 2 : -1
  }
  return bias
}
