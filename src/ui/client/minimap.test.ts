import { describe, expect, it } from 'vitest'
import { CACHE_PATH, testCache } from '../../sim/testing/testCache'
import { minimapImageFor } from './minimapData'
import { fillGouraud, packHsl, RASTER_SIZE } from './minimapRaster'

interface FsLike {
  existsSync(path: string): boolean
}
const fs = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.('node:fs') as FsLike | undefined
const HAS_CACHE = !!fs?.existsSync(CACHE_PATH)

describe('minimap raster primitives', () => {
  it('packs HSL like the client (hue 6 bits, sat 3, light 7)', () => {
    expect(packHsl(0, 0, 0)).toBe(0)
    expect(packHsl(255, 128, 100)).toBe((63 << 10) | (4 << 7) | 50)
    // very light colours lose saturation
    expect(packHsl(255, 255, 255)).toBe((63 << 10) | 127)
  })

  it('fills a flat triangle inside its bounds only', () => {
    const buf = new Uint32Array(16 * 16)
    const hsl = packHsl(10, 128, 64)
    fillGouraud(buf, 16, 16, 0, 0, 8, 0, 8, 0, hsl, hsl, hsl)
    const filled = buf.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)
    expect(filled).toBeGreaterThan(20)
    expect(filled).toBeLessThan(64)
    for (let y = 9; y < 16; y++) for (let x = 0; x < 16; x++) expect(buf[y * 16 + x]).toBe(0)
  })
})

describe.skipIf(!HAS_CACHE)('Inferno minimap from the cache (map square 35,83)', () => {
  it('rasterises a 256x256 north-up image with real terrain colours', () => {
    const img = minimapImageFor(testCache(), 35, 83)
    expect(img).not.toBeNull()
    expect(img!.length).toBe(RASTER_SIZE * RASTER_SIZE)
    const colours = new Set<number>()
    let opaque = 0
    for (const v of img!) {
      if (v >>> 24 !== 0) opaque++
      colours.add(v)
    }
    // The arena floor (underlays) is drawn; hidden overlays (lava, 0xFF00FF) are skipped like scim.
    expect(opaque).toBeGreaterThan(RASTER_SIZE * RASTER_SIZE * 0.2)
    expect(colours.size).toBeGreaterThan(20)
    // memoised per cache + square
    expect(minimapImageFor(testCache(), 35, 83)).toBe(img)
  })
})
