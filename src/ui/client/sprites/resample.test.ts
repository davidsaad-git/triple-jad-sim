import { describe, expect, it } from 'vitest'
import { fitSize, isIntegerMultiple, type PixelBuffer, scalePixelArt, scaleRegion } from './resample'

/** 2x2 checker: red, green / blue, white (opaque). */
function checker(): PixelBuffer {
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
  return { data, width: 2, height: 2 }
}

const px = (out: Uint8ClampedArray, w: number, x: number, y: number): number[] => Array.from(out.subarray((y * w + x) * 4, (y * w + x) * 4 + 4))

describe('pixel-art resampler', () => {
  it('is pure nearest-neighbour at integer multiples', () => {
    const src = checker()
    const out = scalePixelArt(src, 6, 6)
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const sx = Math.floor(x / 3)
        const sy = Math.floor(y / 3)
        expect(px(out, 6, x, y)).toEqual(Array.from(src.data.subarray((sy * 2 + sx) * 4, (sy * 2 + sx) * 4 + 4)))
      }
    }
  })

  it('keeps texel centres crisp at fractional scales with a narrow ramp', () => {
    const src = checker()
    const out = scalePixelArt(src, 5, 5)
    // corners stay the source colours
    expect(px(out, 5, 0, 0)).toEqual([255, 0, 0, 255])
    expect(px(out, 5, 4, 4)).toEqual([255, 255, 255, 255])
    // alpha stays opaque everywhere
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255)
  })

  it('does not bleed colour from transparent texels (premultiplied)', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0])
    const out = scalePixelArt({ data, width: 2, height: 1 }, 5, 1)
    for (let x = 0; x < 5; x++) {
      const [r, g, , a] = px(out, 5, x, 0)
      if (a! > 0) {
        expect(r).toBeGreaterThan(200)
        expect(g).toBeLessThan(10)
      }
    }
  })

  it('scales integer-aligned regions without a margin', () => {
    const out = scaleRegion(checker(), { x: 1, y: 0, width: 1, height: 1 }, 2, 2)
    expect(px(out, 2, 1, 1)).toEqual([0, 255, 0, 255])
  })

  it('detects integer multiples and fits sizes', () => {
    expect(isIntegerMultiple(10, 10, 30, 20)).toBe(true)
    expect(isIntegerMultiple(10, 10, 25, 20)).toBe(false)
    expect(fitSize(20, 10, { width: 40 })).toEqual({ width: 40, height: 20 })
    expect(fitSize(20, 10, { maxWidth: 10 })).toEqual({ width: 10, height: 5 })
    expect(fitSize(20, 10, { width: 5, height: 5 })).toEqual({ width: 5, height: 5 })
    expect(fitSize(20, 10, { maxWidth: 100 })).toEqual({ width: 20, height: 10 })
  })
})
