/**
 * Sprite image loading and scaled-bitmap caches for the chrome (scim
 * loader lookup batched listeners and the LRU caches).
 *
 * - `getImage(url)`: HTMLImageElement when decoded, `null` when it failed,
 *   `undefined` while unknown / loading. Painters skip unloaded sprites and
 *   repaint when `subscribeImages` fires (batched to one call per frame).
 * - `scaledImage(url, img, w, h)`: the image at an exact device size through
 *   the pixel-art resampler (cached, 512 entries).
 * - `composedBitmap(key, w, h, dw, dh, draw)`: a callback drawn at native
 *   client resolution, then resampled to the device size.
 */
import { type PixelBuffer, scalePixelArt, scaleRegion, type SourceRect } from './resample'

const MAX_CONCURRENT = 32
const SOURCE_CACHE = 128
const SCALED_CACHE = 512

type ImageState = HTMLImageElement | null
const images = new Map<string, ImageState>()
const inflight = new Map<string, Promise<ImageState>>()
const queue: (() => void)[] = []
let active = 0

const listeners = new Set<() => void>()
let flushScheduled = false

function scheduleNotify(): void {
  if (flushScheduled) return
  flushScheduled = true
  const run = (): void => {
    if (!flushScheduled) return
    flushScheduled = false
    for (const l of [...listeners]) l()
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run)
    // Dev-only: a hidden preview pane never fires rAF; don't leave loaded images undrawn there.
    if (import.meta.env.DEV) setTimeout(run, 100)
  } else queueMicrotask(run)
}

/** Called (at most once per frame) after any image finished loading. */
export function subscribeImages(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!
    active++
    job()
  }
}

/** Start loading (no-op when known). Resolves with the image or null on error. */
export function loadImage(url: string): Promise<ImageState> {
  const known = images.get(url)
  if (known !== undefined) return Promise.resolve(known)
  const pending = inflight.get(url)
  if (pending) return pending
  if (typeof Image === 'undefined') {
    images.set(url, null)
    return Promise.resolve(null)
  }
  const promise = new Promise<ImageState>((resolve) => {
    queue.push(() => {
      const img = new Image()
      img.decoding = 'async'
      img.crossOrigin = 'anonymous'
      const done = (state: ImageState): void => {
        active--
        images.set(url, state)
        inflight.delete(url)
        resolve(state)
        scheduleNotify()
        pump()
      }
      img.onload = () => done(img)
      img.onerror = () => done(null)
      img.src = url
    })
    pump()
  })
  inflight.set(url, promise)
  return promise
}

/** Decoded image, null on failure, undefined while unknown/loading. */
export function getImage(url: string): ImageState | undefined {
  return images.get(url)
}

/** Kick off loads for every url (scim's preloader warms the whole registry). */
export function preloadImages(urls: Iterable<string>): void {
  for (const u of urls) void loadImage(u)
}

// ---------------------------------------------------------------------------
// LRU caches of pixel data and scaled canvases
// ---------------------------------------------------------------------------

function lruGet<V>(map: Map<string, V>, key: string): V | undefined {
  const v = map.get(key)
  if (v !== undefined) {
    map.delete(key)
    map.set(key, v)
  }
  return v
}

function lruSet<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  if (map.size >= max) {
    const first = map.keys().next()
    if (!first.done) map.delete(first.value)
  }
  map.set(key, value)
}

const sourcePixels = new Map<string, PixelBuffer>()
const scaled = new Map<string, HTMLCanvasElement>()

function canvasFrom(data: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  c.getContext('2d')?.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
  return c
}

function pixelsOf(key: string, img: HTMLImageElement): PixelBuffer | null {
  const cached = lruGet(sourcePixels, key)
  if (cached) return cached
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w <= 0 || h <= 0) return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0)
  const buf = { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h }
  lruSet(sourcePixels, key, buf, SOURCE_CACHE)
  return buf
}

/** The image resampled to exactly `w x h` device pixels (the image itself at natural size). */
export function scaledImage(url: string, img: HTMLImageElement, w: number, h: number): CanvasImageSource {
  const tw = Math.max(1, Math.round(w))
  const th = Math.max(1, Math.round(h))
  if (tw === img.naturalWidth && th === img.naturalHeight) return img
  const key = `${url}|${tw}x${th}`
  const hit = lruGet(scaled, key)
  if (hit) return hit
  const src = pixelsOf(url, img)
  if (!src) return img
  const canvas = canvasFrom(scalePixelArt(src, tw, th), tw, th)
  lruSet(scaled, key, canvas, SCALED_CACHE)
  return canvas
}

/** A source sub-rectangle resampled to `w x h` device pixels. */
export function scaledRegion(url: string, img: HTMLImageElement, rect: SourceRect, w: number, h: number): CanvasImageSource | null {
  const tw = Math.max(1, Math.round(w))
  const th = Math.max(1, Math.round(h))
  const key = `region|${url}|${rect.x},${rect.y},${rect.width}x${rect.height}|${tw}x${th}`
  const hit = lruGet(scaled, key)
  if (hit) return hit
  const src = pixelsOf(url, img)
  if (!src) return null
  const canvas = canvasFrom(scaleRegion(src, rect, tw, th), tw, th)
  lruSet(scaled, key, canvas, SCALED_CACHE)
  return canvas
}

/**
 * Draw `draw` into a `width x height` client-resolution bitmap (cached by
 * `key`), then resample it to `deviceW x deviceH`.
 */
export function composedBitmap(key: string, width: number, height: number, deviceW: number, deviceH: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasImageSource | null {
  const tw = Math.max(1, Math.round(deviceW))
  const th = Math.max(1, Math.round(deviceH))
  if (width <= 0 || height <= 0) return null
  const baseKey = `${key}|${width}x${height}`
  const scaledKey = `${baseKey}|${tw}x${th}`
  const hit = lruGet(scaled, scaledKey)
  if (hit) return hit
  let src = lruGet(sourcePixels, baseKey)
  if (!src) {
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    draw(ctx)
    src = { data: ctx.getImageData(0, 0, width, height).data, width, height }
    lruSet(sourcePixels, baseKey, src, SOURCE_CACHE)
  }
  const canvas = canvasFrom(scalePixelArt(src, tw, th), tw, th)
  lruSet(scaled, scaledKey, canvas, SCALED_CACHE)
  return canvas
}

/** Fill `(x, y, w, h)` with `img` repeated from the rect origin plus an offset. */
export function tileImage(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number, offsetX = 0, offsetY = 0): void {
  if (w <= 0 || h <= 0) return
  const pattern = ctx.createPattern(img, 'repeat')
  if (!pattern) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.translate(x + offsetX, y + offsetY)
  ctx.fillStyle = pattern
  ctx.fillRect(-offsetX, -offsetY, w, h)
  ctx.restore()
}
