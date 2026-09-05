/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Decoder for the terrain file (file 0) of an OSRS map region group.
 *
 * Format (OSRS >= 209, so every opcode and overlay id is a u16):
 *   for plane in 0..3, x in 0..63, y in 0..63:
 *     loop:
 *       op = u16
 *       0        -> no explicit height; end of tile
 *       1        -> u8 height (1 means 0); end of tile
 *       2..49    -> u16 overlay id (+1 encoded); shape = (op-2)/4, rotation = (op-2)&3
 *       50..81   -> tile settings = op - 49
 *       82+      -> underlay id (+1 encoded) = op - 81
 *
 * Heights are stored the way the client keeps them: negative-up world units
 * (8 per height step, 240 per plane). Plane 0 tiles without a height use the
 * procedural noise in HeightCalc; upper planes stack on the plane below.
 *
 * Build 240 terrain files carry one trailing byte after the last tile (always
 * 0 in the reference cache); it is kept as `trailer` and otherwise ignored.
 */
import { ByteReader } from '../ByteReader'
import { generateHeight } from '../../scene/HeightCalc'

export const REGION_SIZE = 64
export const PLANES = 4
export const TILES_PER_PLANE = REGION_SIZE * REGION_SIZE

/** World units per height step in the terrain file. */
export const UNITS_TILE_HEIGHT_BASIS = 8
/** World-unit gap between planes when the height is not given. */
export const UNITS_LEVEL_HEIGHT = 240

/** Tile settings bit flags ("render flags"). */
export const TileFlag = {
  /** Tile blocks movement (added to the collision map as FLOOR). */
  Blocked: 0x1,
  /** Bridge: this tile and anything on it belongs to the plane below. */
  Bridge: 0x2,
  /** Tile is under a roof / inside a building. */
  Roof: 0x4,
  /** Tile is always drawn on plane 0 (e.g. tall structures). */
  ForceLowestPlane: 0x8,
  /** Tile is hidden when the player is on a higher plane. */
  HideAbove: 0x10,
} as const
export type TileFlag = (typeof TileFlag)[keyof typeof TileFlag]

export interface RegionTerrain {
  readonly regionX: number
  readonly regionY: number
  /** Per plane, 64*64 entries indexed by `tileIndex(x, y)`. Negative-up world units. */
  readonly heights: readonly Int32Array[]
  /** 0 = none, otherwise overlay config id + 1. */
  readonly overlayIds: readonly Uint16Array[]
  /** Overlay shape ("path") 0..11; only meaningful when overlayIds != 0. Shape id for SceneTileModel is this + 1. */
  readonly overlayShapes: readonly Uint8Array[]
  /** Overlay rotation 0..3. */
  readonly overlayRotations: readonly Uint8Array[]
  /** 0 = none, otherwise underlay config id + 1. */
  readonly underlayIds: readonly Uint16Array[]
  /** Tile settings bit flags (see TileFlag). */
  readonly settings: readonly Uint8Array[]
  /** Value of the single trailing byte after the tile data, or -1 when absent. */
  readonly trailer: number
}

export function tileIndex(x: number, y: number): number {
  return x * REGION_SIZE + y
}

function makePlanes<T>(create: () => T): T[] {
  const out: T[] = []
  for (let p = 0; p < PLANES; p++) out.push(create())
  return out
}

/**
 * Decode a region terrain file. `regionX`/`regionY` are needed for the
 * procedural fallback heights (they seed the noise with world coordinates).
 */
export function decodeTerrain(data: Uint8Array, regionX: number, regionY: number): RegionTerrain {
  const reader = new ByteReader(data)
  const heights = makePlanes(() => new Int32Array(TILES_PER_PLANE))
  const overlayIds = makePlanes(() => new Uint16Array(TILES_PER_PLANE))
  const overlayShapes = makePlanes(() => new Uint8Array(TILES_PER_PLANE))
  const overlayRotations = makePlanes(() => new Uint8Array(TILES_PER_PLANE))
  const underlayIds = makePlanes(() => new Uint16Array(TILES_PER_PLANE))
  const settings = makePlanes(() => new Uint8Array(TILES_PER_PLANE))

  const baseX = regionX * REGION_SIZE
  const baseY = regionY * REGION_SIZE

  for (let plane = 0; plane < PLANES; plane++) {
    const h = heights[plane]!
    const below = plane > 0 ? heights[plane - 1]! : undefined
    for (let x = 0; x < REGION_SIZE; x++) {
      for (let y = 0; y < REGION_SIZE; y++) {
        const i = tileIndex(x, y)
        for (;;) {
          const op = reader.u16()
          if (op === 0) {
            if (below) {
              h[i] = below[i]! - UNITS_LEVEL_HEIGHT
            } else {
              h[i] = -generateHeight(baseX + x + 932731, baseY + y + 556238) * UNITS_TILE_HEIGHT_BASIS
            }
            break
          }
          if (op === 1) {
            let height = reader.u8()
            if (height === 1) height = 0
            if (below) {
              h[i] = below[i]! - height * UNITS_TILE_HEIGHT_BASIS
            } else {
              h[i] = -height * UNITS_TILE_HEIGHT_BASIS
            }
            break
          }
          if (op <= 49) {
            overlayIds[plane]![i] = reader.u16()
            overlayShapes[plane]![i] = ((op - 2) / 4) | 0
            overlayRotations[plane]![i] = (op - 2) & 3
          } else if (op <= 81) {
            settings[plane]![i] = op - 49
          } else {
            underlayIds[plane]![i] = op - 81
          }
        }
      }
    }
  }

  if (reader.remaining > 1) {
    throw new Error(`Terrain ${regionX},${regionY}: ${reader.remaining} trailing bytes`)
  }
  const trailer = reader.remaining === 1 ? reader.u8() : -1

  return { regionX, regionY, heights, overlayIds, overlayShapes, overlayRotations, underlayIds, settings, trailer }
}
