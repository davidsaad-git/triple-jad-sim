import { type CSSProperties, useLayoutEffect, useRef } from 'react'
import { getImage, loadImage, scaledImage, subscribeImages } from './imageStore'
import { fitSize } from './resample'
import { useDevicePixelRatio, usePanelScale } from './scale'

export interface LayerSprite {
  src: string
  /** Box the sprite is fitted and centred in (client units). */
  x: number
  y: number
  w: number
  h: number
  /** Exact size (stretch) or one side (keep aspect); omitted = natural size shrunk to the box. */
  width?: number
  height?: number
  opacity?: number
  offsetX?: number
  offsetY?: number
}

function sameSprites(a: readonly LayerSprite[] | null, b: readonly LayerSprite[]): boolean {
  if (a === b) return true
  if (!a || a.length !== b.length) return false
  return a.every((s, i) => {
    const t = b[i]!
    return s.src === t.src && s.x === t.x && s.y === t.y && s.w === t.w && s.h === t.h && s.width === t.width && s.height === t.height && s.opacity === t.opacity && s.offsetX === t.offsetX && s.offsetY === t.offsetY
  })
}

/**
 * Pixel rectangle of a fitted sprite in device pixels, edge-snapped so
 * neighbouring sprites never overlap or gap.
 */
export function layerSpriteRect(s: LayerSprite, naturalWidth: number, naturalHeight: number, k: number): { x: number; y: number; w: number; h: number } {
  const fit = fitSize(naturalWidth, naturalHeight, { width: s.width, height: s.height, maxWidth: s.w, maxHeight: s.h })
  const left = s.x + (s.w - fit.width) / 2 + (s.offsetX ?? 0)
  const top = s.y + (s.h - fit.height) / 2 + (s.offsetY ?? 0)
  const x = Math.round(left * k)
  const y = Math.round(top * k)
  return { x, y, w: Math.round((left + fit.width) * k) - x, h: Math.round((top + fit.height) * k) - y }
}

/** Many sprites painted into one canvas. */
export function SpriteLayer({ width, height, sprites, style }: { width: number; height: number; sprites: readonly LayerSprite[]; style?: CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const panelScale = usePanelScale()
  const dpr = useDevicePixelRatio()
  const lastSprites = useRef<readonly LayerSprite[] | null>(null)
  const lastSize = useRef('')

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const k = panelScale * dpr
    const dw = Math.max(1, Math.round(width * k))
    const dh = Math.max(1, Math.round(height * k))
    const paint = (force: boolean): void => {
      const sizeKey = `${dw}x${dh}`
      if (!force && sizeKey === lastSize.current && sameSprites(lastSprites.current, sprites)) return
      lastSprites.current = sprites
      lastSize.current = sizeKey
      if (canvas.width !== dw) canvas.width = dw
      if (canvas.height !== dh) canvas.height = dh
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, dw, dh)
      ctx.imageSmoothingEnabled = false
      for (const s of sprites) {
        const img = getImage(s.src)
        if (!img) continue
        const r = layerSpriteRect(s, img.naturalWidth, img.naturalHeight, k)
        if (r.w <= 0 || r.h <= 0) continue
        ctx.globalAlpha = s.opacity ?? 1
        ctx.drawImage(scaledImage(s.src, img, r.w, r.h), r.x, r.y)
      }
      ctx.globalAlpha = 1
    }
    paint(false)
    const pending = new Set<string>()
    for (const s of sprites) {
      if (getImage(s.src) === undefined) {
        pending.add(s.src)
        void loadImage(s.src)
      }
    }
    if (pending.size === 0) return
    const unsubscribe = subscribeImages(() => {
      for (const src of [...pending]) if (getImage(src) !== undefined) pending.delete(src)
      paint(true)
      if (pending.size === 0) unsubscribe()
    })
    return unsubscribe
  }, [sprites, width, height, panelScale, dpr])

  return <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none', ...style }} />
}
