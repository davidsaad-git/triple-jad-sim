import { CacheSystem } from '../CacheSystem'
import { openDiskZip } from '../loadDiskZip'
import { publicUrl } from '../../app/publicUrl'

export interface CacheLoadProgress {
  phase: 'checking' | 'downloading' | 'unpacking' | 'ready'
  /** 0..1 when known, otherwise -1. */
  fraction: number
  loadedBytes: number
  totalBytes: number
  fromCache: boolean
}

// Versioned by OpenRS2 cache id so a cache switch never serves stale bytes.
const CACHE_STORAGE_NAME = 'zuk-osrs-cache-2720'

/**
 * Fetch the OpenRS2 `disk.zip` mirror served by our own origin, keeping a
 * copy in the browser's Cache Storage so reloads skip the download, then
 * open it as a CacheSystem.
 */
/**
 * Prefer the trimmed mirror (a few MB, built by scripts/trim-cache.ts) and
 * fall back to the full OpenRS2 zip when it is absent.
 */
export async function loadBestCache(onProgress: (p: CacheLoadProgress) => void): Promise<CacheSystem> {
  try {
    const head = await fetch(publicUrl('osrs-cache/trimmed/disk.zip'), { method: 'HEAD' })
    if (head.ok && (head.headers.get('content-type') ?? '').includes('zip')) {
      return await loadCacheFromUrl(publicUrl('osrs-cache/trimmed/disk.zip'), onProgress)
    }
  } catch {
    // fall through
  }
  return loadCacheFromUrl(publicUrl('osrs-cache/disk.zip'), onProgress)
}

export async function loadCacheFromUrl(
  url: string,
  onProgress: (p: CacheLoadProgress) => void,
): Promise<CacheSystem> {
  onProgress({ phase: 'checking', fraction: -1, loadedBytes: 0, totalBytes: 0, fromCache: false })

  let zipBytes: Uint8Array | null = null
  let fromCache = false
  const storage = await openCacheStorage()

  if (storage) {
    const hit = await storage.match(url)
    if (hit && hit.ok) {
      zipBytes = new Uint8Array(await hit.arrayBuffer())
      fromCache = true
    }
  }

  if (!zipBytes) {
    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`)
    }
    const totalBytes = Number(response.headers.get('content-length') ?? 0)
    const chunks: Uint8Array[] = []
    let loadedBytes = 0
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loadedBytes += value.length
      onProgress({
        phase: 'downloading',
        fraction: totalBytes > 0 ? loadedBytes / totalBytes : -1,
        loadedBytes,
        totalBytes,
        fromCache: false,
      })
    }
    zipBytes = concat(chunks, loadedBytes)
    if (storage) {
      try {
        await storage.put(url, new Response(zipBytes.slice().buffer as ArrayBuffer, { headers: { 'Content-Type': 'application/zip' } }))
      } catch {
        // Quota exceeded or private mode: fine, we just re-download next time.
      }
    }
  }

  onProgress({ phase: 'unpacking', fraction: -1, loadedBytes: zipBytes.length, totalBytes: zipBytes.length, fromCache })
  // Let the progress paint before the synchronous unzip.
  await new Promise((r) => setTimeout(r, 16))
  const store = openDiskZip(zipBytes)
  const cache = new CacheSystem(store)
  onProgress({ phase: 'ready', fraction: 1, loadedBytes: zipBytes.length, totalBytes: zipBytes.length, fromCache })
  return cache
}

async function openCacheStorage(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null
    // Drop copies of older cache versions (each is ~190 MB).
    for (const name of await caches.keys()) {
      if (name.startsWith('zuk-osrs-cache-') && name !== CACHE_STORAGE_NAME) await caches.delete(name)
    }
    return await caches.open(CACHE_STORAGE_NAME)
  } catch {
    return null
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
