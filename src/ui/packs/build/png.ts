/**
 * Minimal PNG codec (8-bit RGBA out, most PNG flavours in) shared by
 * scripts/build-ui-assets.ts and tests. Pure TypeScript on top of fflate so it
 * runs in Node and the browser alike.
 */
import { unzlibSync, zlibSync } from 'fflate'

export interface RgbaImage {
  width: number
  height: number
  /** `width * height * 4` bytes, straight (non-premultiplied) alpha. */
  rgba: Uint8ClampedArray
}

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

function readU32(src: Uint8Array, offset: number): number {
  return ((src[offset]! << 24) | (src[offset + 1]! << 16) | (src[offset + 2]! << 8) | src[offset + 3]!) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  writeU32(out, 0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  writeU32(out, 8 + data.length, crc32(out, 4, 8 + data.length))
  return out
}

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Encode RGBA bytes as a PNG file (filter 0 per row, deflate level 9). */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, rgba } = image
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
  ihdr[8] = 8
  ihdr[9] = 6
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * Decode a (non-interlaced or Adam7) PNG of any colour type / bit depth into
 * 8-bit RGBA. 16-bit channels are truncated to their high byte.
 */
export function decodePng(file: Uint8Array): RgbaImage {
  for (let i = 0; i < 8; i++) if (file[i] !== SIGNATURE[i]) throw new Error('decodePng: not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 8
  let colorType = 6
  let interlace = 0
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (offset < file.length) {
    const len = readU32(file, offset)
    const type = String.fromCharCode(file[offset + 4]!, file[offset + 5]!, file[offset + 6]!, file[offset + 7]!)
    const data = file.subarray(offset + 8, offset + 8 + len)
    offset += 12 + len
    if (type === 'IHDR') {
      width = readU32(data, 0)
      height = readU32(data, 4)
      bitDepth = data[8]!
      colorType = data[9]!
      interlace = data[12]!
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
  }
  const total = idat.reduce((n, d) => n + d.length, 0)
  const compressed = new Uint8Array(total)
  let o = 0
  for (const d of idat) {
    compressed.set(d, o)
    o += d.length
  }
  const raw = unzlibSync(compressed)
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4
  const bitsPerPixel = channels * bitDepth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const out = new Uint8ClampedArray(width * height * 4)

  const passes =
    interlace === 1
      ? [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ]
      : [[0, 0, 1, 1]]
  let pos = 0
  for (const [x0, y0, dx, dy] of passes as [number, number, number, number][]) {
    const pw = Math.ceil((width - x0) / dx)
    const ph = Math.ceil((height - y0) / dy)
    if (pw <= 0 || ph <= 0) continue
    const stride = Math.ceil((pw * bitsPerPixel) / 8)
    let prev = new Uint8Array(stride)
    for (let row = 0; row < ph; row++) {
      const filter = raw[pos++]!
      const cur = raw.slice(pos, pos + stride)
      pos += stride
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp]! : 0
        const b = prev[i]!
        const c = i >= bpp ? prev[i - bpp]! : 0
        if (filter === 1) cur[i] = (cur[i]! + a) & 0xff
        else if (filter === 2) cur[i] = (cur[i]! + b) & 0xff
        else if (filter === 3) cur[i] = (cur[i]! + ((a + b) >> 1)) & 0xff
        else if (filter === 4) cur[i] = (cur[i]! + paeth(a, b, c)) & 0xff
      }
      const y = y0 + row * dy
      for (let col = 0; col < pw; col++) {
        const x = x0 + col * dx
        const di = (y * width + x) * 4
        const sample = (k: number): number => {
          if (bitDepth === 8) return cur[col * channels + k]!
          if (bitDepth === 16) return cur[(col * channels + k) * 2]!
          const bitIndex = (col * channels + k) * bitDepth
          const byte = cur[bitIndex >> 3]!
          const shift = 8 - bitDepth - (bitIndex & 7)
          return (byte >> shift) & ((1 << bitDepth) - 1)
        }
        const scale = bitDepth < 8 ? 255 / ((1 << bitDepth) - 1) : 1
        if (colorType === 3) {
          const idx = sample(0)
          out[di] = palette ? palette[idx * 3]! : 0
          out[di + 1] = palette ? palette[idx * 3 + 1]! : 0
          out[di + 2] = palette ? palette[idx * 3 + 2]! : 0
          out[di + 3] = trns && idx < trns.length ? trns[idx]! : 255
        } else if (colorType === 0 || colorType === 4) {
          const g = Math.round(sample(0) * scale)
          out[di] = g
          out[di + 1] = g
          out[di + 2] = g
          out[di + 3] = colorType === 4 ? sample(1) : trns && ((trns[0]! << 8) | trns[1]!) === sample(0) ? 0 : 255
        } else {
          out[di] = sample(0)
          out[di + 1] = sample(1)
          out[di + 2] = sample(2)
          if (colorType === 6) out[di + 3] = sample(3)
          else {
            const t = trns && trns.length >= 6 && trns[1] === sample(0) && trns[3] === sample(1) && trns[5] === sample(2)
            out[di + 3] = t ? 0 : 255
          }
        }
      }
      prev = cur
    }
  }
  return { width, height, rgba: out }
}
