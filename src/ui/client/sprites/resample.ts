/**
 * Pixel-art resampler for chrome sprites drawn at non-native sizes (UI scale x
 * devicePixelRatio). Re-implements scim.gg's
 *:
 *
 * - a separable premultiplied-alpha linear filter whose ramp between two
 *   source texels is squeezed to at most `maxRampDevicePx` device pixels (and
 *   45% of the scale), so large integer scales stay pure nearest-neighbour
 *   while fractional scales get a 1-device-pixel transition instead of blur;
 * - a light unsharp pass (strength 0.4) when the target is not an exact
 *   integer multiple of the source.
 */

/** Default ramp width in device pixels. */
export const MAX_RAMP_DEVICE_PX = 1
/** Ramp as a fraction of the scale factor. */
const RAMP_SCALE_FRACTION = 0.45
/** Unsharp strength for fractional scales. */
export const SHARPEN_STRENGTH = 0.4

export interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface AxisSamples {
  idx0: Int32Array
  idx1: Int32Array
  frac: Float32Array
}

/** Sample positions along one axis: `outputLength` outputs over source `[start, start + length)`. */
export function axisSamples(sourceLength: number, start: number, length: number, outputLength: number, maxRampDevicePx = MAX_RAMP_DEVICE_PX): AxisSamples {
  const scale = outputLength / length
  const sharpness = scale / Math.min(maxRampDevicePx, RAMP_SCALE_FRACTION * scale)
  const idx0 = new Int32Array(outputLength)
  const idx1 = new Int32Array(outputLength)
  const frac = new Float32Array(outputLength)
  const last = sourceLength - 1
  for (let i = 0; i < outputLength; i++) {
    const src = start + (i + 0.5) / scale
    const left = Math.floor(src - 0.5)
    const t = (src - 0.5 - left - 0.5) * sharpness + 0.5
    idx0[i] = Math.min(last, Math.max(0, left))
    idx1[i] = Math.min(last, Math.max(0, left + 1))
    frac[i] = t < 0 ? 0 : t > 1 ? 1 : t
  }
  return { idx0, idx1, frac }
}

export interface SourceRect {
  x: number
  y: number
  width: number
  height: number
}

/** Resample `sourceRect` of `source` to `targetWidth x targetHeight` (straight-alpha RGBA in and out). */
export function resampleRegion(source: PixelBuffer, sourceRect: SourceRect, targetWidth: number, targetHeight: number, maxRampDevicePx = MAX_RAMP_DEVICE_PX): Uint8ClampedArray {
  const outW = Math.max(1, Math.round(targetWidth))
  const outH = Math.max(1, Math.round(targetHeight))
  const out = new Uint8ClampedArray(outW * outH * 4)
  const { width: sw, height: sh, data } = source
  if (sw <= 0 || sh <= 0) return out
  const xs = axisSamples(sw, sourceRect.x, sourceRect.width, outW, maxRampDevicePx)
  const ys = axisSamples(sh, sourceRect.y, sourceRect.height, outH, maxRampDevicePx)
  // Premultiply the source.
  const pre = new Float32Array(sw * sh * 4)
  for (let i = 0; i < sw * sh; i++) {
    const o = i * 4
    const a = data[o + 3]!
    const k = a / 255
    pre[o] = data[o]! * k
    pre[o + 1] = data[o + 1]! * k
    pre[o + 2] = data[o + 2]! * k
    pre[o + 3] = a
  }
  // Horizontal pass: every source row to outW columns.
  const rows = new Float32Array(sh * outW * 4)
  for (let y = 0; y < sh; y++) {
    const srcRow = y * sw * 4
    const dstRow = y * outW * 4
    for (let x = 0; x < outW; x++) {
      const a = srcRow + xs.idx0[x]! * 4
      const b = srcRow + xs.idx1[x]! * 4
      const f = xs.frac[x]!
      const g = 1 - f
      const d = dstRow + x * 4
      rows[d] = pre[a]! * g + pre[b]! * f
      rows[d + 1] = pre[a + 1]! * g + pre[b + 1]! * f
      rows[d + 2] = pre[a + 2]! * g + pre[b + 2]! * f
      rows[d + 3] = pre[a + 3]! * g + pre[b + 3]! * f
    }
  }
  // Vertical pass, un-premultiplying into the output.
  for (let y = 0; y < outH; y++) {
    const a0 = ys.idx0[y]! * outW * 4
    const b0 = ys.idx1[y]! * outW * 4
    const f = ys.frac[y]!
    const g = 1 - f
    for (let x = 0; x < outW; x++) {
      const a = a0 + x * 4
      const b = b0 + x * 4
      const o = (y * outW + x) * 4
      const alpha = rows[a + 3]! * g + rows[b + 3]! * f
      out[o + 3] = alpha
      if (alpha <= 0) continue
      const k = 255 / alpha
      out[o] = (rows[a]! * g + rows[b]! * f) * k
      out[o + 1] = (rows[a + 1]! * g + rows[b + 1]! * f) * k
      out[o + 2] = (rows[a + 2]! * g + rows[b + 2]! * f) * k
    }
  }
  return out
}

/**
 * In-place unsharp mask with a [1 2 1] x [1 2 1] blur on premultiplied colour
 *: alpha is sharpened first, colour channels are clamped to it.
 */
export function sharpen(data: Uint8ClampedArray, width: number, height: number, strength: number): void {
  if (strength <= 0 || width < 3 || height < 3) return
  const n = width * height
  const pre = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const a = data[o + 3]!
    const k = a / 255
    pre[o] = data[o]! * k
    pre[o + 1] = data[o + 1]! * k
    pre[o + 2] = data[o + 2]! * k
    pre[o + 3] = a
  }
  const blurX = new Float32Array(n * 4)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const c = (row + x) * 4
      const l = (row + (x > 0 ? x - 1 : 0)) * 4
      const r = (row + (x < width - 1 ? x + 1 : width - 1)) * 4
      for (let k = 0; k < 4; k++) blurX[c + k] = (pre[l + k]! + 2 * pre[c + k]! + pre[r + k]!) * 0.25
    }
  }
  const f32 = Math.fround
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : 0) * width * 4
    const mid = y * width * 4
    const down = (y < height - 1 ? y + 1 : height - 1) * width * 4
    for (let x = 0; x < width; x++) {
      const t = x * 4
      const c = mid + t
      const alpha = pre[c + 3]!
      const blurA = f32((blurX[up + t + 3]! + 2 * blurX[mid + t + 3]! + blurX[down + t + 3]!) * 0.25)
      const outA = Math.min(255, Math.max(0, alpha + strength * (alpha - blurA)))
      if (outA <= 0) {
        data[c] = 0
        data[c + 1] = 0
        data[c + 2] = 0
        data[c + 3] = 0
        continue
      }
      for (let k = 0; k < 3; k++) {
        const blur = f32((blurX[up + t + k]! + 2 * blurX[mid + t + k]! + blurX[down + t + k]!) * 0.25)
        const v = pre[c + k]!
        const sharp = Math.min(outA, Math.max(0, v + strength * (v - blur)))
        data[c + k] = (sharp * 255) / outA
      }
      data[c + 3] = outA
    }
  }
}

/** True when `target` is an exact integer multiple of `source` on both axes. */
export function isIntegerMultiple(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): boolean {
  return sourceWidth > 0 && sourceHeight > 0 && targetWidth % sourceWidth === 0 && targetHeight % sourceHeight === 0
}

/** Scale a whole bitmap: resample, then sharpen unless the scale is an integer multiple. */
export function scalePixelArt(source: PixelBuffer, targetWidth: number, targetHeight: number): Uint8ClampedArray {
  const w = Math.max(1, Math.round(targetWidth))
  const h = Math.max(1, Math.round(targetHeight))
  const out = resampleRegion(source, { x: 0, y: 0, width: source.width, height: source.height }, w, h)
  if (!isIntegerMultiple(source.width, source.height, w, h)) sharpen(out, w, h, SHARPEN_STRENGTH)
  return out
}

/**
 * Scale a sub-rectangle: integer-aligned rects at integer
 * multiples are resampled directly; otherwise a one-pixel margin is resampled
 * and sharpened, then cropped so the edges sharpen against real neighbours.
 */
export function scaleRegion(source: PixelBuffer, rect: SourceRect, targetWidth: number, targetHeight: number): Uint8ClampedArray {
  const w = Math.max(1, Math.round(targetWidth))
  const h = Math.max(1, Math.round(targetHeight))
  if (Number.isInteger(rect.x) && Number.isInteger(rect.y) && Number.isInteger(rect.width) && Number.isInteger(rect.height) && w % rect.width === 0 && h % rect.height === 0) {
    return resampleRegion(source, rect, w, h)
  }
  const px = rect.width / w
  const py = rect.height / h
  const ew = w + 2
  const eh = h + 2
  const extended = resampleRegion(source, { x: rect.x - px, y: rect.y - py, width: rect.width + px * 2, height: rect.height + py * 2 }, ew, eh)
  sharpen(extended, ew, eh, SHARPEN_STRENGTH)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const from = ((y + 1) * ew + 1) * 4
    out.set(extended.subarray(from, from + w * 4), y * w * 4)
  }
  return out
}

/**
 * Aspect fit: width+height given -> exactly that; one given ->
 * keep aspect; none -> natural size; then shrink (never grow) to the max box.
 */
export function fitSize(
  naturalWidth: number,
  naturalHeight: number,
  opts: { width?: number | undefined; height?: number | undefined; maxWidth?: number | undefined; maxHeight?: number | undefined } = {},
): { width: number; height: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0) return { width: 0, height: 0 }
  const ratio = naturalHeight / naturalWidth
  let w: number
  let h: number
  if (opts.width !== undefined && opts.height !== undefined) {
    w = opts.width
    h = opts.height
  } else if (opts.width !== undefined) {
    w = opts.width
    h = opts.width * ratio
  } else if (opts.height !== undefined) {
    w = opts.height / ratio
    h = opts.height
  } else {
    w = naturalWidth
    h = naturalHeight
  }
  const shrink = Math.min(opts.maxWidth !== undefined && w > 0 ? opts.maxWidth / w : 1, opts.maxHeight !== undefined && h > 0 ? opts.maxHeight / h : 1, 1)
  return { width: w * shrink, height: h * shrink }
}
