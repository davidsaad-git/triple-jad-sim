/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Locates and decodes map regions in the maps index (5) of an OSRS >= 237
 * cache: group id = (regionX << 8) | regionY, file 0 = terrain, file 1 = locs.
 * Build 240 groups also carry files 2..4 (a ~200 byte, a 2 byte and a 1 byte
 * file of unknown purpose); they are exposed raw through `getFiles().extra`.
 */
import { IndexId, type CacheSystem } from '../CacheSystem'
import { decodeLocs, type RegionLoc } from './LocDecoder'
import { decodeTerrain, type RegionTerrain } from './TerrainDecoder'

/** Group in the maps index that is *not* a region (world-area data). */
const WORLDAREA_GROUP_ID = (98 << 8) | 199

export const TERRAIN_FILE = 0
export const LOCS_FILE = 1

export function regionId(regionX: number, regionY: number): number {
  return (regionX << 8) | regionY
}

export function regionCoords(id: number): { regionX: number; regionY: number } {
  return { regionX: id >> 8, regionY: id & 0xff }
}

export interface RegionFiles {
  readonly terrain: Uint8Array | undefined
  readonly locs: Uint8Array | undefined
  /** Any further files in the group (build 240: ids 2, 3, 4), undecoded. */
  readonly extra: ReadonlyMap<number, Uint8Array>
}

export interface DecodedRegion {
  readonly regionX: number
  readonly regionY: number
  readonly terrain: RegionTerrain | undefined
  readonly locs: RegionLoc[]
}

export class RegionLoader {
  private readonly cache: CacheSystem

  constructor(cache: CacheSystem) {
    this.cache = cache
  }

  hasRegion(regionX: number, regionY: number): boolean {
    const id = regionId(regionX, regionY)
    return id !== WORLDAREA_GROUP_ID && this.cache.getIndex(IndexId.Maps).hasArchive(id)
  }

  /** Raw terrain/loc files, or undefined for both when the region does not exist. */
  getFiles(regionX: number, regionY: number): RegionFiles {
    const extra = new Map<number, Uint8Array>()
    if (!this.hasRegion(regionX, regionY)) {
      return { terrain: undefined, locs: undefined, extra }
    }
    const archive = this.cache.getIndex(IndexId.Maps).getArchive(regionId(regionX, regionY))
    if (archive) {
      for (const [fileId, data] of archive) {
        if (fileId !== TERRAIN_FILE && fileId !== LOCS_FILE) extra.set(fileId, data)
      }
    }
    return { terrain: archive?.getFile(TERRAIN_FILE), locs: archive?.getFile(LOCS_FILE), extra }
  }

  getTerrain(regionX: number, regionY: number): RegionTerrain | undefined {
    const data = this.getFiles(regionX, regionY).terrain
    return data ? decodeTerrain(data, regionX, regionY) : undefined
  }

  getLocs(regionX: number, regionY: number): RegionLoc[] {
    const data = this.getFiles(regionX, regionY).locs
    return data ? decodeLocs(data) : []
  }

  load(regionX: number, regionY: number): DecodedRegion {
    return { regionX, regionY, terrain: this.getTerrain(regionX, regionY), locs: this.getLocs(regionX, regionY) }
  }
}
