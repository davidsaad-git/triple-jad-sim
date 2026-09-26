/**
 * INPUT fallback click crosses: builds animated PNGs (APNG) from the cache's
 * "cross" sprite group (sprite 299: frames 0-3 yellow, 4-7 red, 16x16) into
 * public/assets/input/{yellow,red}_click.png.
 *
 * scim.gg serves animated WebPs at /yellow_click.webp and /red_click.webp
 *. When those files are present in public/ (CLIENT-UI's
 * asset script) the input layer uses them; these PNGs are only the fallback.
 * Timing follows the replay renderer's hint (100 ms per frame) and the OSRS
 * client (4 frames); the last frame holds until the 600 ms hide.
 *
 * Usage: npx tsx scripts/build-input-assets.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zlibSync } from 'fflate'
import { CacheSystem, IndexId } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { decodeSpriteSheet } from '../src/cache/sprite/SpriteLoader'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CROSS_SPRITE = 299
const FRAME_DELAYS_MS = [100, 100, 100, 300]

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

function u16(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff])
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const body = concat([typeBytes, data])
  return concat([u32(data.length), body, u32(crc32(body))])
}

/** RGBA frames (w*h*4 each) -> APNG bytes, played once. */
function encodeApng(width: number, height: number, frames: Uint8Array[], delaysMs: number[]): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = chunk('IHDR', concat([u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0])]))
  const actl = chunk('acTL', concat([u32(frames.length), u32(1)]))
  const parts: Uint8Array[] = [signature, ihdr, actl]
  let seq = 0
  frames.forEach((rgba, i) => {
    const raw = new Uint8Array(height * (width * 4 + 1))
    for (let y = 0; y < height; y++) {
      raw[y * (width * 4 + 1)] = 0
      raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
    }
    const compressed = zlibSync(raw, { level: 9 })
    // fcTL: seq, w, h, x, y, delay num/den, dispose none, blend source (frames replace fully).
    parts.push(chunk('fcTL', concat([u32(seq++), u32(width), u32(height), u32(0), u32(0), u16(delaysMs[i] ?? 100), u16(1000), new Uint8Array([0, 0])])))
    if (i === 0) parts.push(chunk('IDAT', compressed))
    else parts.push(chunk('fdAT', concat([u32(seq++), compressed])))
  })
  parts.push(chunk('IEND', new Uint8Array(0)))
  return concat(parts)
}

function main(): void {
  const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync(join(ROOT, 'public/osrs-cache/disk.zip')))))
  const data = cache.getIndex(IndexId.Sprites).getFile(CROSS_SPRITE, 0)
  if (!data) throw new Error(`sprite ${CROSS_SPRITE} missing`)
  const sheet = decodeSpriteSheet(CROSS_SPRITE, data)
  if (sheet.sprites.length < 8) throw new Error(`sprite ${CROSS_SPRITE}: expected 8 frames, got ${sheet.sprites.length}`)
  const rgba = sheet.sprites.map((s) => new Uint8Array(s.getPixelsRgba().buffer))
  const outDir = join(ROOT, 'public/assets/input')
  mkdirSync(outDir, { recursive: true })
  const sets: [string, Uint8Array[]][] = [
    ['yellow_click.png', rgba.slice(0, 4)],
    ['red_click.png', rgba.slice(4, 8)],
  ]
  for (const [name, frames] of sets) {
    const png = encodeApng(sheet.width, sheet.height, frames, FRAME_DELAYS_MS)
    writeFileSync(join(outDir, name), png)
    console.log(`wrote public/assets/input/${name} (${png.length} bytes, ${frames.length} frames ${sheet.width}x${sheet.height})`)
  }
}

main()
