/**
 * Minimal PNG encoder (8-bit RGBA, no filtering) so sprites can become data
 * URLs in both the browser and Node without a canvas. Deflate comes from
 * fflate, which is already a dependency.
 */
import { zlibSync } from 'fflate'

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = -1
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function writeU32(dst: Uint8Array, offset: number, value: number): void {
  dst[offset] = (value >>> 24) & 0xff
  dst[offset + 1] = (value >>> 16) & 0xff
  dst[offset + 2] = (value >>> 8) & 0xff
  dst[offset + 3] = value & 0xff
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  writeU32(out, 0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  writeU32(out, 8 + data.length, crc32(out, 4, 8 + data.length))
  return out
}

/** Encode `width * height * 4` RGBA bytes as a PNG file. */
export function encodePng(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${rgba.length}`)
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  writeU32(ihdr, 0, width)
  writeU32(ihdr, 4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 without relying on `btoa` (Node) or `Buffer` (browser). */
export function base64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  if (i < bytes.length) {
    const b0 = bytes[i]!
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const n = (b0 << 16) | (b1 << 8)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += '='
  }
  return out
}

export function pngDataUrl(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): string {
  return `data:image/png;base64,${base64(encodePng(rgba, width, height))}`
}
