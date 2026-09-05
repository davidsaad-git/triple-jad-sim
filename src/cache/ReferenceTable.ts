import { ByteReader } from './ByteReader'

export interface FileEntry {
  id: number
  nameHash: number
}

export interface ArchiveEntry {
  id: number
  nameHash: number
  crc: number
  uncompressedCrc: number
  whirlpool: Uint8Array | null
  compressedSize: number
  uncompressedSize: number
  version: number
  /** Sorted file ids. */
  fileIds: number[]
  fileNameHashes: Map<number, number> | null
  /** Highest file id + 1, i.e. the size needed for a dense file array. */
  fileCapacity: number
}

/**
 * Decoded index-255 reference table for one index: which archives exist,
 * their checksums/versions and which files each archive contains.
 */
export class ReferenceTable {
  readonly format: number
  readonly version: number
  readonly flags: number
  readonly archives: Map<number, ArchiveEntry>
  private readonly byNameHash: Map<number, ArchiveEntry> | null

  constructor(format: number, version: number, flags: number, archives: Map<number, ArchiveEntry>) {
    this.format = format
    this.version = version
    this.flags = flags
    this.archives = archives
    this.byNameHash = (flags & 0x1) !== 0 ? new Map([...archives.values()].map((a) => [a.nameHash, a])) : null
  }

  get archiveIds(): number[] {
    return [...this.archives.keys()]
  }

  get archiveCapacity(): number {
    let max = -1
    for (const id of this.archives.keys()) if (id > max) max = id
    return max + 1
  }

  getArchive(id: number): ArchiveEntry | undefined {
    return this.archives.get(id)
  }

  findByName(name: string): ArchiveEntry | undefined {
    return this.byNameHash?.get(jagexHash(name))
  }

  static decode(data: Uint8Array): ReferenceTable {
    const r = new ByteReader(data)
    const format = r.u8()
    if (format < 5 || format > 7) {
      throw new Error(`Unsupported reference table format ${format}`)
    }
    const version = format >= 6 ? r.i32() : 0
    const flags = r.u8()
    const hasNames = (flags & 0x1) !== 0
    const hasWhirlpool = (flags & 0x2) !== 0
    const hasSizes = (flags & 0x4) !== 0
    const hasUncompressedCrc = (flags & 0x8) !== 0
    const readId = () => (format >= 7 ? r.bigSmart() : r.u16())

    const count = readId()
    const ids: number[] = new Array(count)
    let last = 0
    for (let i = 0; i < count; i++) {
      last += readId()
      ids[i] = last
    }

    const entries: ArchiveEntry[] = ids.map((id) => ({
      id,
      nameHash: 0,
      crc: 0,
      uncompressedCrc: 0,
      whirlpool: null,
      compressedSize: 0,
      uncompressedSize: 0,
      version: 0,
      fileIds: [],
      fileNameHashes: null,
      fileCapacity: 0,
    }))

    if (hasNames) for (const e of entries) e.nameHash = r.i32()
    for (const e of entries) e.crc = r.i32()
    if (hasUncompressedCrc) for (const e of entries) e.uncompressedCrc = r.i32()
    if (hasWhirlpool) for (const e of entries) e.whirlpool = new Uint8Array(r.bytes(64))
    if (hasSizes) {
      for (const e of entries) {
        e.compressedSize = r.i32()
        e.uncompressedSize = r.i32()
      }
    }
    for (const e of entries) e.version = r.i32()

    const fileCounts: number[] = new Array(count)
    for (let i = 0; i < count; i++) fileCounts[i] = readId()

    for (let i = 0; i < count; i++) {
      const e = entries[i]!
      const n = fileCounts[i]!
      const fileIds: number[] = new Array(n)
      let lastFile = 0
      for (let j = 0; j < n; j++) {
        lastFile += readId()
        fileIds[j] = lastFile
      }
      e.fileIds = fileIds
      e.fileCapacity = n > 0 ? fileIds[n - 1]! + 1 : 0
    }

    if (hasNames) {
      for (const e of entries) {
        const map = new Map<number, number>()
        for (const fileId of e.fileIds) map.set(r.i32(), fileId)
        e.fileNameHashes = map
      }
    }

    return new ReferenceTable(format, version, flags, new Map(entries.map((e) => [e.id, e])))
  }
}

/** Jagex string hash used for archive/file names (Java `String.hashCode` over CP-1252 bytes). */
export function jagexHash(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0
  }
  return h
}
