/**
 * DOM writers for the 2D overlays drawn over the 3D canvas, mirroring the
 * viewport's element structure and styles:
 * health bars (z 1), hitsplats (z 3), overhead icons (z 8) and marker labels.
 * Images use scim's asset paths; a render-owned fallback under
 * /assets/render/ is used when an image fails to load.
 */
import type { HealthBarDraw, HitsplatDraw, IconDraw } from './UiOverlays'
import { publicUrl } from '../../app/publicUrl'

export interface LabelDraw {
  key: string
  screenX: number
  screenY: number
  text: string
  color: string
}

const HITSPLAT_SPRITES: Record<string, string> = {
  damage: '/assets/ui/hitsplat-damage.png',
  block: '/assets/ui/hitsplat-block.png',
  poison: '/assets/ui/hitsplat-poison.png',
  venom: '/assets/ui/hitsplat-poison.png',
  heal: '/assets/ui/hitsplat-heal.png',
  doom: '/assets/ui/hitsplat-doom-skull.png',
  burn: '/assets/ui/hitsplat-burn.png',
}

function fallbackFor(src: string): string | null {
  if (src.startsWith('/assets/render/')) return null
  if (src.startsWith('/assets/ui/')) return `/assets/render/${src.slice('/assets/ui/'.length)}`
  return null
}

/** `src` is a logical public path (`/assets/...`); the base path is applied here. */
function setSrc(img: HTMLImageElement, src: string): void {
  if (img.getAttribute('data-src') === src) return
  img.setAttribute('data-src', src)
  img.onerror = () => {
    const fb = fallbackFor(src)
    if (fb && img.getAttribute('data-src') === src) {
      img.onerror = null
      img.src = publicUrl(fb)
    }
  }
  img.src = publicUrl(src)
}

function layer(parent: HTMLElement, attr: string, z: number): HTMLDivElement {
  let el = parent.querySelector<HTMLDivElement>(`[${attr}]`)
  if (!el) {
    el = document.createElement('div')
    el.setAttribute(attr, 'true')
    el.style.position = 'absolute'
    el.style.top = '0'
    el.style.left = '0'
    el.style.pointerEvents = 'none'
    el.style.zIndex = String(z)
    parent.appendChild(el)
  }
  return el
}

function trim(el: HTMLElement, n: number): void {
  while (el.children.length > n) el.removeChild(el.lastChild!)
}

export class DomOverlays {
  /** Icons / overhead layer container. */
  readonly iconsRoot: HTMLDivElement
  /** Tile-marker label container. */
  readonly labelsRoot: HTMLDivElement
  /** Hitsplat / health bar container. */
  readonly barsRoot: HTMLDivElement

  constructor(iconsRoot: HTMLDivElement, labelsRoot: HTMLDivElement, barsRoot: HTMLDivElement) {
    this.iconsRoot = iconsRoot
    this.labelsRoot = labelsRoot
    this.barsRoot = barsRoot
  }

  icons(list: readonly IconDraw[]): void {
    if (list.length === 0) {
      this.iconsRoot.querySelector('[data-overhead-icons]')?.remove()
      return
    }
    const root = layer(this.iconsRoot, 'data-overhead-icons', 8)
    trim(root, list.length)
    list.forEach((d, i) => {
      let img = root.children[i] as HTMLImageElement | undefined
      if (!img) {
        img = document.createElement('img')
        img.style.position = 'absolute'
        img.style.imageRendering = 'pixelated'
        img.style.pointerEvents = 'none'
        img.style.filter = 'drop-shadow(0 0 3px rgba(0, 0, 0, 0.8))'
        root.appendChild(img)
      }
      setSrc(img, d.iconPath)
      img.style.width = `${d.width}px`
      img.style.height = `${d.height}px`
      img.style.left = `${d.screenX - d.width / 2}px`
      img.style.top = `${d.screenY - d.height / 2}px`
    })
  }

  hitsplats(list: readonly HitsplatDraw[]): void {
    if (list.length === 0) {
      this.barsRoot.querySelector('[data-hitsplats]')?.remove()
      return
    }
    const root = layer(this.barsRoot, 'data-hitsplats', 3)
    trim(root, list.length)
    list.forEach((d, i) => {
      let box = root.children[i] as HTMLDivElement | undefined
      if (!box) {
        box = document.createElement('div')
        const s = box.style
        s.position = 'absolute'
        s.left = '0'
        s.top = '0'
        s.pointerEvents = 'none'
        s.display = 'flex'
        s.alignItems = 'center'
        s.justifyContent = 'center'
        s.imageRendering = 'pixelated'
        s.willChange = 'transform, opacity'
        const img = document.createElement('img')
        img.style.position = 'absolute'
        img.style.top = '0'
        img.style.left = '0'
        img.style.width = '100%'
        img.style.height = '100%'
        img.style.imageRendering = 'pixelated'
        img.style.pointerEvents = 'none'
        box.appendChild(img)
        const text = document.createElement('span')
        const t = text.style
        t.position = 'relative'
        t.fontFamily = "'RuneScape Small', monospace"
        t.fontWeight = 'normal'
        t.setProperty('-webkit-font-smoothing', 'none')
        t.setProperty('font-smooth', 'never')
        t.fontSize = '11px'
        t.lineHeight = '1'
        t.color = '#FFFFFF'
        t.textShadow = '1px 1px 0 #000'
        t.pointerEvents = 'none'
        box.appendChild(text)
        root.appendChild(box)
      }
      const img = box.children[0] as HTMLImageElement
      const text = box.children[1] as HTMLSpanElement
      setSrc(img, HITSPLAT_SPRITES[d.type] ?? HITSPLAT_SPRITES['damage']!)
      const filter = d.type === 'venom' ? 'brightness(0.55) saturate(1.15)' : 'none'
      if (img.style.filter !== filter) img.style.filter = filter
      box.style.width = `${d.width}px`
      box.style.height = `${d.height}px`
      box.style.opacity = '1'
      const amount = String(d.amount)
      if (text.textContent !== amount) text.textContent = amount
      text.style.fontSize = `${d.fontSize}px`
      box.style.transform = `translate3d(${d.screenX - d.width / 2}px, ${d.screenY - d.height / 2}px, 0px)`
    })
  }

  healthBars(list: readonly HealthBarDraw[]): void {
    if (list.length === 0) {
      this.barsRoot.querySelector('[data-healthbars]')?.remove()
      return
    }
    const root = layer(this.barsRoot, 'data-healthbars', 1)
    trim(root, list.length)
    list.forEach((d, i) => {
      let box = root.children[i] as HTMLDivElement | undefined
      if (!box) {
        box = document.createElement('div')
        const s = box.style
        s.position = 'absolute'
        s.left = '0'
        s.top = '0'
        s.pointerEvents = 'none'
        s.imageRendering = 'pixelated'
        s.willChange = 'transform, opacity'
        const bg = document.createElement('img')
        bg.style.position = 'absolute'
        bg.style.top = '0'
        bg.style.left = '0'
        bg.style.width = '100%'
        bg.style.height = '100%'
        bg.style.display = 'block'
        bg.style.imageRendering = 'pixelated'
        bg.style.pointerEvents = 'none'
        box.appendChild(bg)
        const clip = document.createElement('div')
        clip.style.position = 'absolute'
        clip.style.top = '0'
        clip.style.left = '0'
        clip.style.height = '100%'
        clip.style.overflow = 'hidden'
        const fg = document.createElement('img')
        fg.style.display = 'block'
        fg.style.width = '0'
        fg.style.height = '100%'
        fg.style.imageRendering = 'pixelated'
        fg.style.pointerEvents = 'none'
        clip.appendChild(fg)
        box.appendChild(clip)
        root.appendChild(box)
      }
      box.style.width = `${d.width}px`
      box.style.height = `${d.height}px`
      box.style.transform = `translate3d(${d.screenX - d.width / 2}px, ${d.screenY - d.height / 2}px, 0px)`
      const bg = box.children[0] as HTMLImageElement
      setSrc(bg, `/assets/ui/healthbar/default_back_${d.width}px.png`)
      const clip = box.children[1] as HTMLDivElement
      const fg = clip.children[0] as HTMLImageElement
      setSrc(fg, `/assets/ui/healthbar/default_front_${d.width}px.png`)
      const fill = d.ratio <= 0 ? 0 : Math.max(2, d.ratio * d.width)
      clip.style.width = `${fill}px`
      fg.style.width = `${d.width}px`
      box.style.opacity = '1'
    })
  }

  labels(list: readonly LabelDraw[]): void {
    const root = this.labelsRoot
    trim(root, list.length)
    list.forEach((d, i) => {
      let el = root.children[i] as HTMLSpanElement | undefined
      if (!el) {
        el = document.createElement('span')
        const s = el.style
        s.position = 'absolute'
        s.left = '0'
        s.top = '0'
        s.pointerEvents = 'none'
        s.fontFamily = "'RuneScape Small', sans-serif"
        s.fontSize = '16px'
        s.lineHeight = '1'
        s.whiteSpace = 'nowrap'
        s.textShadow = '1px 1px 0 #000'
        s.setProperty('-webkit-font-smoothing', 'none')
        s.setProperty('font-smooth', 'never')
        root.appendChild(el)
      }
      if (el.textContent !== d.text) el.textContent = d.text
      const t = `translate3d(${d.screenX}px, ${d.screenY}px, 0px) translate(-50%, -50%)`
      if (el.style.transform !== t) el.style.transform = t
      if (el.style.color !== d.color) el.style.color = d.color
    })
  }
}
