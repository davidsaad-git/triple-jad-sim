/**
 * Reader for the classic JS5 disk store: `main_file_cache.dat2` plus one
 * `main_file_cache.idx<N>` per index (255 = the reference-table index).
 *
 * Each idx entry is 6 bytes: 24-bit size, 24-bit first sector. Data lives in
 * 520-byte sectors chained through their headers.
 */
export const REFERENCE_INDEX = 255

const SECTOR_SIZE = 520
const HEADER_SIZE = 8
const EXTENDED_HEADER_SIZE = 10
const DATA_SIZE = SECTOR_SIZE - HEADER_SIZE
const EXTENDED_DATA_SIZE = SECTOR_SIZE - EXTENDED_HEADER_SIZE

export interface DiskStoreFiles {
  dat2: Uint8Array
  /** Keyed by index id (0..254 and 255). */
  indexes: Map<number, Uint8Array>
}

export class DiskStore {
  private readonly dat2: Uint8Array
  private readonly indexes: Map<number, Uint8Array>

  constructor(files: DiskStoreFiles) {
    this.dat2 = files.dat2
    this.indexes = files.indexes
  }

  get indexIds(): number[] {
    return [...this.indexes.keys()].filter((id) => id !== REFERENCE_INDEX).sort((a, b) => a - b)
  }

  hasIndex(indexId: number): boolean {
    return this.indexes.has(indexId)
  }

  /** Number of archive slots in an index file (not all are populated). */
  archiveCount(indexId: number): number {
    const idx = this.indexes.get(indexId)
    return idx ? Math.floor(idx.length / 6) : 0
  }

  /** Raw (still compressed) container bytes for an archive, or null if absent. */
  read(indexId: number, archiveId: number): Uint8Array | null {
    const idx = this.indexes.get(indexId)
    if (!idx) return null
    const entry = archiveId * 6
    if (entry + 6 > idx.length) return null

    const size = (idx[entry]! << 16) | (idx[entry + 1]! << 8) | idx[entry + 2]!
    let sector = (idx[entry + 3]! << 16) | (idx[entry + 4]! << 8) | idx[entry + 5]!
    if (size <= 0 || sector <= 0) return null

    const extended = archiveId > 0xffff
    const headerSize = extended ? EXTENDED_HEADER_SIZE : HEADER_SIZE
    const dataSize = extended ? EXTENDED_DATA_SIZE : DATA_SIZE

    const out = new Uint8Array(size)
    let written = 0
    let chunk = 0
    const dat = this.dat2

    while (written < size) {
      if (sector === 0) {
        throw new Error(`Premature end of sector chain for ${indexId}/${archiveId}`)
      }
      const base = sector * SECTOR_SIZE
      if (base + SECTOR_SIZE > dat.length) {
        throw new Error(`Sector ${sector} out of range for ${indexId}/${archiveId}`)
      }

      let p = base
      let headerArchive: number
      if (extended) {
        headerArchive = ((dat[p]! << 24) | (dat[p + 1]! << 16) | (dat[p + 2]! << 8) | dat[p + 3]!) >>> 0
        p += 4
      } else {
        headerArchive = (dat[p]! << 8) | dat[p + 1]!
        p += 2
      }
      const headerChunk = (dat[p]! << 8) | dat[p + 1]!
      p += 2
      const nextSector = (dat[p]! << 16) | (dat[p + 1]! << 8) | dat[p + 2]!
      p += 3
      const headerIndex = dat[p]!
      p += 1

      if (headerArchive !== archiveId || headerChunk !== chunk || headerIndex !== indexId) {
        throw new Error(
          `Sector header mismatch reading ${indexId}/${archiveId} chunk ${chunk}: got ${headerIndex}/${headerArchive} chunk ${headerChunk}`,
        )
      }

      const n = Math.min(dataSize, size - written)
      out.set(dat.subarray(base + headerSize, base + headerSize + n), written)
      written += n
      sector = nextSector
      chunk++
    }
    return out
  }
}
