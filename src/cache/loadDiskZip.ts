import { unzipSync } from 'fflate'
import { DiskStore, type DiskStoreFiles } from './DiskStore'

const DAT2 = /(^|\/)main_file_cache\.dat2$/
const IDX = /(^|\/)main_file_cache\.idx(\d+)$/

/** Split an OpenRS2 `disk.zip` (already in memory) into the dat2 and idx buffers. */
export function parseDiskZip(zip: Uint8Array): DiskStoreFiles {
  const entries = unzipSync(zip)
  let dat2: Uint8Array | null = null
  const indexes = new Map<number, Uint8Array>()
  for (const [name, data] of Object.entries(entries)) {
    if (DAT2.test(name)) {
      dat2 = data
      continue
    }
    const m = IDX.exec(name)
    if (m) {
      indexes.set(Number(m[2]), data)
    }
  }
  if (!dat2) {
    throw new Error('disk.zip does not contain main_file_cache.dat2')
  }
  if (!indexes.has(255)) {
    throw new Error('disk.zip does not contain main_file_cache.idx255')
  }
  return { dat2, indexes }
}

export function openDiskZip(zip: Uint8Array): DiskStore {
  return new DiskStore(parseDiskZip(zip))
}
