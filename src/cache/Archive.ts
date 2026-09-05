import type { ArchiveEntry } from './ReferenceTable'

/**
 * A decoded archive (a.k.a. group): its files split out of the container
 * payload according to the multi-file chunk layout.
 */
export class Archive {
  readonly id: number
  readonly entry: ArchiveEntry
  private readonly files: Map<number, Uint8Array>

  constructor(id: number, entry: ArchiveEntry, files: Map<number, Uint8Array>) {
    this.id = id
    this.entry = entry
    this.files = files
  }

  get fileIds(): number[] {
    return this.entry.fileIds
  }

  get fileCount(): number {
    return this.files.size
  }

  getFile(fileId: number): Uint8Array | undefined {
    return this.files.get(fileId)
  }

  /** Iterate files in id order. */
  *[Symbol.iterator](): IterableIterator<[number, Uint8Array]> {
    for (const id of this.entry.fileIds) {
      const f = this.files.get(id)
      if (f) yield [id, f]
    }
  }

  static split(id: number, entry: ArchiveEntry, data: Uint8Array): Archive {
    const fileIds = entry.fileIds
    const files = new Map<number, Uint8Array>()
    if (fileIds.length === 0) {
      return new Archive(id, entry, files)
    }
    if (fileIds.length === 1) {
      files.set(fileIds[0]!, data)
      return new Archive(id, entry, files)
    }

    const chunks = data[data.length - 1]!
    const fileCount = fileIds.length
    const sizeTable = data.length - 1 - chunks * fileCount * 4
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

    // First pass: total size per file.
    const sizes = new Int32Array(fileCount)
    let p = sizeTable
    for (let c = 0; c < chunks; c++) {
      let size = 0
      for (let f = 0; f < fileCount; f++) {
        size += view.getInt32(p)
        p += 4
        sizes[f] = sizes[f]! + size
      }
    }

    const buffers: Uint8Array[] = new Array(fileCount)
    const offsets = new Int32Array(fileCount)
    for (let f = 0; f < fileCount; f++) {
      buffers[f] = new Uint8Array(sizes[f]!)
    }

    // Second pass: copy chunk-major data into per-file buffers.
    p = sizeTable
    let dataOff = 0
    for (let c = 0; c < chunks; c++) {
      let size = 0
      for (let f = 0; f < fileCount; f++) {
        size += view.getInt32(p)
        p += 4
        buffers[f]!.set(data.subarray(dataOff, dataOff + size), offsets[f]!)
        offsets[f] = offsets[f]! + size
        dataOff += size
      }
    }

    for (let f = 0; f < fileCount; f++) {
      files.set(fileIds[f]!, buffers[f]!)
    }
    return new Archive(id, entry, files)
  }
}
