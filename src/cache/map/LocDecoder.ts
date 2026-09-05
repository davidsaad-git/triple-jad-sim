/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Decoder for the loc (object placement) file (file 1) of an OSRS map region.
 *
 * Format:
 *   loop:
 *     idDelta = extended unsigned smart (chained 32767s); 0 ends the file
 *     id += idDelta                          (id starts at -1)
 *     loop:
 *       posDelta = unsigned smart; 0 ends this id's placements
 *       pos += posDelta - 1                  (pos starts at 0)
 *       plane = pos >> 12, x = (pos >> 6) & 63, y = pos & 63
 *       attributes = u8: type = attributes >> 2 (0..22), rotation = attributes & 3
 *
 * Unlike the pre-237 caches there is no XTEA on this file.
 */
import { ByteReader } from '../ByteReader'

export interface RegionLoc {
  /** Loc (object) config id. */
  readonly id: number
  /** Loc model type / shape 0..22 (see LocModelType in src/scene). */
  readonly type: number
  /** Rotation 0..3. */
  readonly rotation: number
  /** Plane 0..3 as stored (before bridge adjustment). */
  readonly plane: number
  /** Local tile x within the region, 0..63. */
  readonly x: number
  /** Local tile y within the region, 0..63. */
  readonly y: number
}

export function decodeLocs(data: Uint8Array): RegionLoc[] {
  const reader = new ByteReader(data)
  const locs: RegionLoc[] = []

  let id = -1
  for (;;) {
    const idDelta = reader.uSmartExtended()
    if (idDelta === 0) break
    id += idDelta

    let pos = 0
    for (;;) {
      const posDelta = reader.uSmart()
      if (posDelta === 0) break
      pos += posDelta - 1

      const x = (pos >> 6) & 0x3f
      const y = pos & 0x3f
      const plane = pos >> 12
      const attributes = reader.u8()
      locs.push({ id, type: attributes >> 2, rotation: attributes & 3, plane, x, y })
    }
  }

  return locs
}
