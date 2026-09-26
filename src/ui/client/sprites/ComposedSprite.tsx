import { type CSSProperties, useLayoutEffect, useRef } from 'react'
import { composedBitmap, getImage, loadImage, subscribeImages } from './imageStore'
import { useDevicePixelRatio, usePanelScale } from './scale'

export interface ComposedSpriteProps {
  /** Identity of the drawing (sources + geometry + state) for the bitmap cache. */
  cacheKey: string
  /** Native (client) size the callback draws at. */
  width: number
  height: number
  /** CSS size when it differs from width/height (fixed-mode strips, chatbox); then only DPR applies. */
  cssSize?: { width: number; height: number }
  sources: readonly string[]
  draw: (ctx: CanvasRenderingContext2D, images: ReadonlyMap<string, HTMLImageElement>) => void
  style?: CSSProperties
}

/**
 * A custom drawing at native client resolution, resampled to device pixels
 *. Draws once every source is known.
 */
export function ComposedSprite({ cacheKey, width, height, cssSize, sources, draw, style }: ComposedSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  const panelScale = usePanelScale()
  const dpr = useDevicePixelRatio()
  const sourcesKey = sources.join('\0')
  const cssW = cssSize?.width
  const cssH = cssSize?.height

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return
    const list = sourcesKey.length > 0 ? sourcesKey.split('\0') : []
    const tryPaint = (): boolean => {
      const map = new Map<string, HTMLImageElement>()
      for (const src of list) {
        const img = getImage(src)
        if (img === undefined) return false
        if (img) map.set(src, img)
      }
      const explicit = cssW !== undefined && cssH !== undefined
      const bw = explicit ? cssW : width
      const bh = explicit ? cssH : height
      const k = explicit ? dpr : panelScale * dpr
      const dw = Math.max(1, Math.round(bw * k))
      const dh = Math.max(1, Math.round(bh * k))
      if (canvas.width !== dw) canvas.width = dw
      if (canvas.height !== dh) canvas.height = dh
      const ctx = canvas.getContext('2d')
      if (!ctx) return true
      ctx.clearRect(0, 0, dw, dh)
      ctx.imageSmoothingEnabled = false
      const bmp = composedBitmap(cacheKey, Math.round(width), Math.round(height), dw, dh, (c) => drawRef.current(c, map))
      if (bmp) ctx.drawImage(bmp, 0, 0)
      return true
    }
    if (tryPaint()) return
    for (const src of list) if (getImage(src) === undefined) void loadImage(src)
    const unsubscribe = subscribeImages(() => {
      if (tryPaint()) unsubscribe()
    })
    return unsubscribe
  }, [cacheKey, width, height, cssW, cssH, sourcesKey, panelScale, dpr])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-composed=""
      style={{ position: 'absolute', left: 0, top: 0, width: cssW ?? width, height: cssH ?? height, pointerEvents: 'none', ...style }}
    />
  )
}
