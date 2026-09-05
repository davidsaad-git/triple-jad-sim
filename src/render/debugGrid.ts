import { TILE_SIZE } from './Camera'
import { MeshBuilder, rgba, type MeshData } from './Mesh'

/** A flat checkerboard of tiles, used until real terrain is wired in. */
export function buildDebugGrid(size = 64, heightFn: (x: number, z: number) => number = () => 0): MeshData {
  const b = new MeshBuilder()
  const dark = rgba(52, 40, 34)
  const light = rgba(70, 54, 46)
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const c = (x + z) % 2 === 0 ? dark : light
      const x0 = x * TILE_SIZE
      const x1 = x0 + TILE_SIZE
      const z0 = z * TILE_SIZE
      const z1 = z0 + TILE_SIZE
      const h00 = heightFn(x, z)
      const h10 = heightFn(x + 1, z)
      const h01 = heightFn(x, z + 1)
      const h11 = heightFn(x + 1, z + 1)
      // Counter-clockwise when viewed from above (+y).
      b.triangle(x0, h00, z0, x0, h01, z1, x1, h11, z1, c, c, c)
      b.triangle(x0, h00, z0, x1, h11, z1, x1, h10, z0, c, c, c)
    }
  }
  return b.build()
}
