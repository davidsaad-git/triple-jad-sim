/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Flattens one plane of scene tile models into the renderer's `MeshData`
 * layout: positions (x, y-up, z) in world units with 128 per tile, RGBA
 * colours from the client's packed-HSL palette, a per-vertex priority and,
 * when any face is textured, texcoords (u, v, textureId) with -1 for
 * untextured faces.
 */
import type { MeshData } from '../render/Mesh'
import { HSL_RGB_MAP, INVALID_HSL_COLOR } from './ColorUtil'
import type { Scene } from './Scene'
import { TILE_SIZE } from './Scene'

export interface TerrainMeshOptions {
  /** Scene-tile bounds (inclusive). Default: everything but the border ring. */
  minX?: number
  minY?: number
  maxX?: number
  maxY?: number
  /**
   * World-unit offset added to x / z. Default puts scene tile `borderSize`
   * (the region's south-west tile) at the origin.
   */
  offsetX?: number
  offsetZ?: number
  /** Priority written for every terrain vertex (default 0). */
  priority?: number
  /** Also emit tiles linked below bridge tiles (default true). */
  includeLinkedBelow?: boolean
}

export interface TerrainMeshStats {
  tiles: number
  triangles: number
  texturedTriangles: number
}

/** Packed HSL -> 0xRRGGBB, treating textured faces (lightness only) as grey light. */
function hslToRgb(hsl: number): number {
  return HSL_RGB_MAP[hsl & 0xffff]!
}

/**
 * Build the terrain mesh for `level`. Faces the client would not draw (no
 * colour and no texture) are skipped. Triangles are emitted counter-clockwise
 * when seen from above (+y), matching the renderer's front-face setting.
 */
export function buildTerrainMesh(scene: Scene, level: number, options: TerrainMeshOptions = {}): MeshData {
  return buildTerrainMeshWithStats(scene, level, options).mesh
}

export function buildTerrainMeshWithStats(
  scene: Scene,
  level: number,
  options: TerrainMeshOptions = {},
): { mesh: MeshData; stats: TerrainMeshStats } {
  const minX = options.minX ?? scene.borderSize
  const minY = options.minY ?? scene.borderSize
  const maxX = options.maxX ?? scene.sizeX - 1 - scene.borderSize
  const maxY = options.maxY ?? scene.sizeY - 1 - scene.borderSize
  const offsetX = options.offsetX ?? -scene.borderSize * TILE_SIZE
  const offsetZ = options.offsetZ ?? -scene.borderSize * TILE_SIZE
  const priority = options.priority ?? 0
  const includeLinkedBelow = options.includeLinkedBelow ?? true

  const positions: number[] = []
  const colors: number[] = []
  const texcoords: number[] = []
  let textured = false
  let tiles = 0
  let triangles = 0
  let texturedTriangles = 0

  const pushVertex = (
    model: { vertexX: Int32Array; vertexY: Int32Array; vertexZ: Int32Array; vertexU(v: number): number; vertexV(v: number): number },
    v: number,
    hsl: number,
    textureId: number,
  ): void => {
    positions.push(model.vertexX[v]! + offsetX, -model.vertexY[v]!, model.vertexZ[v]! + offsetZ)
    const rgb = hslToRgb(hsl)
    colors.push((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255)
    texcoords.push(model.vertexU(v), model.vertexV(v), textureId)
  }

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const tile = scene.getTile(level, x, y)
      if (!tile) continue
      const models = [tile.tileModel]
      if (includeLinkedBelow && tile.linkedBelowTile?.tileModel) models.push(tile.linkedBelowTile.tileModel)
      for (const model of models) {
        if (!model) continue
        tiles++
        for (let f = 0; f < model.faceCount; f++) {
          if (model.isFaceHidden(f)) continue
          const textureId = model.faceTextures[f]!
          if (textureId !== -1) {
            textured = true
            texturedTriangles++
          }
          triangles++
          const a = model.facesA[f]!
          const b = model.facesB[f]!
          const c = model.facesC[f]!
          let ca = model.faceColorsA[f]!
          let cb = model.faceColorsB[f]!
          let cc = model.faceColorsC[f]!
          if (ca === INVALID_HSL_COLOR) ca = 0
          if (cb === INVALID_HSL_COLOR) cb = 0
          if (cc === INVALID_HSL_COLOR) cc = 0
          // The client winds faces clockwise from above; the renderer culls back faces with CCW front.
          pushVertex(model, a, ca, textureId)
          pushVertex(model, c, cc, textureId)
          pushVertex(model, b, cb, textureId)
        }
      }
    }
  }

  const vertexCount = positions.length / 3
  const priorities = new Float32Array(vertexCount).fill(priority)
  return {
    mesh: {
      positions: Float32Array.from(positions),
      colors: Uint8Array.from(colors),
      priorities,
      texcoords: textured ? Float32Array.from(texcoords) : null,
      vertexCount,
    },
    stats: { tiles, triangles, texturedTriangles },
  }
}
