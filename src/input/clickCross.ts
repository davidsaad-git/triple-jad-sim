import type { ClickType } from './menu'

/**
 * Click crosses.
 *
 * The sprites are animated images fetched once and cached as data URLs. A
 * cross is a single 22x22 px pixelated <img> centred on the click; each new
 * cross replaces the previous one and restarts the animation by appending
 * `#<counter>` to the data URL; it hides 600 ms (real time) after the click.
 * Viewport clicks use an <img> inside the viewport overlay (absolute, z 8);
 * menu selections use a fixed <img> on document.body (z 200000).
 *
 * Sources: scim's and `/red_click.webp` (generated into
 * public/ by the CLIENT-UI asset script); when those are missing we fall back
 * to our own animated PNGs built from the cache cross sprites
 * (public/assets/input/*_click.png, scripts/build-input-assets.ts).
 */

export const CROSS_LIFETIME_MS = 600
export const CROSS_SIZE_PX = 22

function base(): string {
  const b = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  return b.endsWith('/') ? b : `${b}/`
}

export const CROSS_SOURCES: Record<ClickType, string[]> = {
  // Cross sprites exported from the game cache (scripts/build-input-assets.ts).
  yellow: [`${base()}assets/input/yellow_click.png`],
  red: [`${base()}assets/input/red_click.png`],
}

const dataUrls = new Map<ClickType, string>()
const inflight = new Map<ClickType, Promise<void>>()
let counter = 0

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

async function loadCross(type: ClickType): Promise<void> {
  for (const src of CROSS_SOURCES[type]) {
    try {
      const res = await fetch(src)
      if (!res.ok) continue
      const blob = await res.blob()
      // Dev servers answer missing files with index.html; only accept images.
      if (!blob.type.startsWith('image/')) continue
      dataUrls.set(type, await blobToDataUrl(blob))
      return
    } catch {
      // try the next source
    }
  }
}

/** Start loading a cross sprite (idempotent). */
export function preloadCross(type: ClickType): Promise<void> {
  if (dataUrls.has(type)) return Promise.resolve()
  let p = inflight.get(type)
  if (!p) {
    p = loadCross(type).finally(() => inflight.delete(type))
    inflight.set(type, p)
  }
  return p
}

export function preloadCrosses(): void {
  if (typeof fetch === 'undefined' || typeof FileReader === 'undefined') return
  void preloadCross('yellow')
  void preloadCross('red')
}

function styleCross(img: HTMLImageElement, position: 'absolute' | 'fixed', zIndex: string): void {
  img.style.position = position
  img.style.width = `${CROSS_SIZE_PX}px`
  img.style.height = `${CROSS_SIZE_PX}px`
  img.style.imageRendering = 'pixelated'
  img.style.pointerEvents = 'none'
  img.style.zIndex = zIndex
  img.alt = ''
  img.setAttribute('aria-hidden', 'true')
}

function nextSrc(type: ClickType): string | null {
  const url = dataUrls.get(type)
  return url ? `${url}#${counter++}` : null
}

// ---- menu-selection cross (fixed on the body) --------------------------------

let menuImg: HTMLImageElement | null = null
let menuTimer: ReturnType<typeof setTimeout> | null = null

/** Cross for a menu selection at client coordinates. */
export function showMenuCross(clientX: number, clientY: number, type: ClickType = 'yellow'): void {
  preloadCrosses()
  const src = nextSrc(type)
  if (!src || typeof document === 'undefined') return
  if (menuTimer !== null) {
    clearTimeout(menuTimer)
    menuTimer = null
  }
  if (!menuImg) {
    menuImg = document.createElement('img')
    styleCross(menuImg, 'fixed', '200000')
    document.body.appendChild(menuImg)
  }
  menuImg.style.left = `${clientX - CROSS_SIZE_PX / 2}px`
  menuImg.style.top = `${clientY - CROSS_SIZE_PX / 2}px`
  menuImg.style.display = 'block'
  menuImg.src = src
  menuTimer = setTimeout(() => {
    if (menuImg) menuImg.style.display = 'none'
    menuTimer = null
  }, CROSS_LIFETIME_MS)
}

// ---- viewport cross (inside the viewport overlay) -------------------------

/** One reusable cross inside a container. Coordinates are container-local CSS px. */
export class ViewportCross {
  private readonly container: HTMLElement
  private img: HTMLImageElement | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(container: HTMLElement) {
    this.container = container
    preloadCrosses()
  }

  show(x: number, y: number, type: ClickType = 'yellow'): void {
    const src = nextSrc(type)
    if (!src) return
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    let img = this.img
    if (!img) {
      img = document.createElement('img')
      styleCross(img, 'absolute', '8')
      this.container.appendChild(img)
      this.img = img
    }
    img.style.left = `${x - CROSS_SIZE_PX / 2}px`
    img.style.top = `${y - CROSS_SIZE_PX / 2}px`
    img.style.display = 'block'
    img.src = src
    this.timer = setTimeout(() => {
      if (this.img) this.img.style.display = 'none'
      this.timer = null
    }, CROSS_LIFETIME_MS)
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.img?.remove()
    this.img = null
  }
}
