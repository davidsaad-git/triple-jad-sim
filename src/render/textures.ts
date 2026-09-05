import type { TextureLoader } from '../cache/texture/TextureLoader'

export const TEXTURE_SIZE = 128

/**
 * Upload every cache texture into one 2D array texture, layer = texture id,
 * so meshes can carry the raw texture id as their third texcoord component.
 */
export function buildTextureArray(gl: WebGL2RenderingContext, textures: TextureLoader, brightness = 0.8): WebGLTexture {
  const ids = textures.textureIds
  const layers = ids.length ? Math.max(...ids) + 1 : 1
  const tex = gl.createTexture()
  if (!tex) throw new Error('createTexture failed')
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, TEXTURE_SIZE, TEXTURE_SIZE, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  for (const id of ids) {
    let pixels: Uint8ClampedArray
    try {
      pixels = textures.getPixelsRgba(id, TEXTURE_SIZE, brightness)
    } catch {
      continue
    }
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      id,
      TEXTURE_SIZE,
      TEXTURE_SIZE,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    )
  }
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY)
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
  return tex
}
