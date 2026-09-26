import { useLayoutEffect, useReducer, useRef } from 'react'
import { packAsset } from '../../packs'
import { composedBitmap, getImage, loadImage, subscribeImages } from './imageStore'
import { useDevicePixelRatio, usePanelScale } from './scale'

const CORNER = 6

/** Stone button pieces, normal or `_selected`. */
export function stoneButtonPaths(selected: boolean): string[] {
  const s = selected ? '_selected' : ''
  return [
    `buttons/corner_top_left${s}.png`,
    `buttons/corner_top_right${s}.png`,
    `buttons/corner_bottom_left${s}.png`,
    `buttons/corner_bottom_right${s}.png`,
    `buttons/edge_top${s}.png`,
    `buttons/edge_bottom${s}.png`,
    `buttons/edge_left${s}.png`,
    `buttons/edge_right${s}.png`,
    `buttons/middle${s}.png`,
  ]
}

function fillPattern(ctx: CanvasRenderingContext2D, img: HTMLImageElement | undefined, x: number, y: number, w: number, h: number): void {
  if (!img || w <= 0 || h <= 0) return
  const p = ctx.createPattern(img, 'repeat')
  if (!p) return
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = p
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

/**
 * The OSRS stone button: 6 px corners, tiled 6 px edges
 * and a tiled middle, filling its positioned parent. Red `_selected` stones
 * when selected.
 */
export function NineSlice({ selected = false }: { selected?: boolean }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const panelScale = usePanelScale()
  const dpr = useDevicePixelRatio()
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const urls = stoneButtonPaths(selected).map((p) => packAsset(p))

  useLayoutEffect(() => {
    const box = boxRef.current
    const canvas = canvasRef.current
    if (!box || !canvas) return
    const paint = (): boolean => {
      const w = box.offsetWidth
      const h = box.offsetHeight
      if (w <= 0 || h <= 0) return true
      const imgs = urls.map((u) => getImage(u))
      if (imgs.some((i) => i === undefined)) return false
      const [tl, tr, bl, br, et, eb, el, er, mid] = imgs.map((i) => i ?? undefined)
      const k = panelScale * dpr
      const dw = Math.max(1, Math.round(w * k))
      const dh = Math.max(1, Math.round(h * k))
      if (canvas.width !== dw) canvas.width = dw
      if (canvas.height !== dh) canvas.height = dh
      const ctx = canvas.getContext('2d')
      if (!ctx) return true
      ctx.clearRect(0, 0, dw, dh)
      ctx.imageSmoothingEnabled = false
      const bmp = composedBitmap(`nineslice|${urls.join(',')}|${w}x${h}`, w, h, dw, dh, (c) => {
        const iw = Math.max(0, w - CORNER * 2)
        const ih = Math.max(0, h - CORNER * 2)
        fillPattern(c, mid, CORNER, CORNER, iw, ih)
        fillPattern(c, et, CORNER, 0, iw, CORNER)
        fillPattern(c, eb, CORNER, h - CORNER, iw, CORNER)
        fillPattern(c, el, 0, CORNER, CORNER, ih)
        fillPattern(c, er, w - CORNER, CORNER, CORNER, ih)
        if (tl) c.drawImage(tl, 0, 0, CORNER, CORNER)
        if (tr) c.drawImage(tr, w - CORNER, 0, CORNER, CORNER)
        if (bl) c.drawImage(bl, 0, h - CORNER, CORNER, CORNER)
        if (br) c.drawImage(br, w - CORNER, h - CORNER, CORNER, CORNER)
      })
      if (bmp) ctx.drawImage(bmp, 0, 0)
      return true
    }
    if (paint()) return
    for (const u of urls) if (getImage(u) === undefined) void loadImage(u)
    const unsubscribe = subscribeImages(() => {
      if (paint()) {
        unsubscribe()
        bump()
      }
    })
    return unsubscribe
  })

  return (
    <div ref={boxRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  )
}
