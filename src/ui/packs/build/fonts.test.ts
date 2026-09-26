import { describe, expect, it } from 'vitest'
import { CACHE_PATH, testCache } from '../../../sim/testing/testCache'
import { BitmapFont, FontIds } from './bitmapFont'
import { buildTtf, traceContours } from './ttf'

interface FsLike {
  existsSync(path: string): boolean
  readFileSync(path: string): Uint8Array
}
const fs = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.('node:fs') as FsLike | undefined
const HAS_CACHE = !!fs?.existsSync(CACHE_PATH)

/** Minimal sfnt reader: table directory + a few header fields. */
function readSfnt(bytes: Uint8Array): { tables: Map<string, { offset: number; length: number }>; view: DataView } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = view.getUint16(4)
  const tables = new Map<string, { offset: number; length: number }>()
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16
    const tag = String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!)
    tables.set(tag, { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) })
  }
  return { tables, view }
}

/** Signed area of a closed contour (y up): negative = clockwise. */
function signedArea(pts: readonly (readonly [number, number])[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!
    const [x1, y1] = pts[(i + 1) % pts.length]!
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

describe('bitmap glyph tracing', () => {
  it('traces a square clockwise and a hole counter-clockwise', () => {
    const solid = traceContours(2, 2, () => true, 0, 2)
    expect(solid).toHaveLength(1)
    expect(signedArea(solid[0]!)).toBe(-4)
    const ring = traceContours(3, 3, (x, y) => !(x === 1 && y === 1), 0, 3)
    expect(ring).toHaveLength(2)
    const areas = ring.map(signedArea).sort((a, b) => a - b)
    expect(areas).toEqual([-9, 1])
  })
})

describe.skipIf(!HAS_CACHE)('RuneScape Small from the cache font (p11_full)', () => {
  it('builds a parseable TrueType font with 257 glyphs and unitsPerEm 16', () => {
    const font = BitmapFont.load(testCache(), FontIds.p11)
    expect(font).toBeDefined()
    const ttf = buildTtf(font!, { familyName: 'RuneScape Small', ascender: 14, descender: 2 })
    const { tables, view } = readSfnt(ttf)
    for (const t of ['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'OS/2', 'post']) expect(tables.has(t), t).toBe(true)
    expect(view.getUint32(0)).toBe(0x00010000)
    expect(view.getUint16(tables.get('head')!.offset + 18)).toBe(16)
    expect(view.getUint16(tables.get('maxp')!.offset + 4)).toBe(257)
    // digits have ink
    expect(font!.glyphs['5'.charCodeAt(0)]!.width).toBeGreaterThan(0)
  })
})
