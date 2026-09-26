import { memo, useCallback, useLayoutEffect, useRef } from 'react'
import type { ClientLayoutMode } from '../../app/settings/settings'
import { packAsset, uiAsset, useActivePack } from '../packs'
import { type Rect, statusBarFill, statusBarsGeometry } from './layout'
import { PixelSprite } from './sprites/PixelSprite'
import { useDevicePixelRatio, usePanelScale } from './sprites/scale'

/**
 * Status Bars plugin (scim,
 * 09): HP bar left, prayer bar right of / beside the side panel.
 */

const rgba = (r: number, g: number, b: number, a: number): string => `rgba(${r}, ${g}, ${b}, ${a / 255})`
export const STATUS_BAR_COLORS = {
  background: rgba(0, 0, 0, 150),
  hitpoints: rgba(225, 35, 0, 125),
  prayer: rgba(50, 200, 200, 175),
  prayerActive: rgba(57, 255, 186, 225),
} as const

const FRAME = 1

function drawBar(ctx: CanvasRenderingContext2D, bar: Rect, bounds: Rect, k: number, max: number, current: number, color: string): void {
  const fill = (r: Rect, style: string): void => {
    const x = Math.round((r.x - bounds.x) * k)
    const y = Math.round((r.y - bounds.y) * k)
    const w = Math.round((r.x - bounds.x + r.width) * k) - x
    const h = Math.round((r.y - bounds.y + r.height) * k) - y
    ctx.fillStyle = style
    ctx.fillRect(x, y, w, h)
  }
  fill(bar, STATUS_BAR_COLORS.background)
  fill({ ...bar, height: FRAME }, STATUS_BAR_COLORS.background)
  fill({ ...bar, y: bar.y + bar.height - FRAME, height: FRAME }, STATUS_BAR_COLORS.background)
  const innerY = bar.y + FRAME
  const innerH = bar.height - 2
  fill({ x: bar.x, y: innerY, width: FRAME, height: innerH }, STATUS_BAR_COLORS.background)
  fill({ x: bar.x + bar.width - FRAME, y: innerY, width: FRAME, height: innerH }, STATUS_BAR_COLORS.background)
  const f = statusBarFill(bar, max, current)
  if (f) fill(f, color)
}

function drawValue(ctx: CanvasRenderingContext2D, bar: Rect, bounds: Rect, k: number, value: number): void {
  const x = Math.round((bar.x + bar.width / 2 - bounds.x) * k)
  const y = Math.round((bar.y + 20 - bounds.y) * k)
  const shadow = Math.round(k)
  ctx.font = `${Math.round(16 * k)}px "RuneScape Small", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#000000'
  ctx.fillText(String(value), x + shadow, y + shadow)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(String(value), x, y)
}

export const StatusBars = memo(function StatusBars({ mode, hp, maxHp, prayer, maxPrayer, anyPrayerActive, showValues }: { mode: ClientLayoutMode; hp: number; maxHp: number; prayer: number; maxPrayer: number; anyPrayerActive: boolean; showValues: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scale = usePanelScale()
  const dpr = useDevicePixelRatio()
  const pack = useActivePack()
  const { left, right, bounds } = statusBarsGeometry(mode)
  const prayerColor = anyPrayerActive ? STATUS_BAR_COLORS.prayerActive : STATUS_BAR_COLORS.prayer

  const paint = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const k = scale * dpr
    const w = Math.max(1, Math.round(bounds.width * k))
    const h = Math.max(1, Math.round(bounds.height * k))
    if (c.width !== w) c.width = w
    if (c.height !== h) c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    drawBar(ctx, left, bounds, k, maxHp, hp, STATUS_BAR_COLORS.hitpoints)
    drawBar(ctx, right, bounds, k, maxPrayer, prayer, prayerColor)
    if (showValues) {
      drawValue(ctx, left, bounds, k, hp)
      drawValue(ctx, right, bounds, k, prayer)
    }
  }, [scale, dpr, bounds.x, bounds.y, bounds.width, bounds.height, left, right, hp, maxHp, prayer, maxPrayer, prayerColor, showValues]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    paint()
    const c = canvasRef.current
    if (!c) return
    c.addEventListener('contextrestored', paint)
    // Repaint once the bitmap font is available (canvas text does not wait for it).
    let alive = true
    void document.fonts?.load?.('16px "RuneScape Small"').then(() => {
      if (alive) paint()
    })
    return () => {
      alive = false
      c.removeEventListener('contextrestored', paint)
    }
  }, [paint])

  const iconPos = (bar: Rect) => ({ position: 'absolute' as const, left: bar.x + Math.floor(bar.width / 2) - 8 - bounds.x, top: bar.y + 4 - bounds.y })
  return (
    <div aria-hidden data-status-bars={mode} style={{ position: 'absolute', left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height, pointerEvents: 'none' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, width: bounds.width, height: bounds.height, imageRendering: 'pixelated' }} />
      <PixelSprite src={packAsset('other/minimap_orb_hitpoints_icon.png', pack)} sourceRect={{ x: 5, y: 6, width: 16, height: 16 }} style={iconPos(left)} />
      <PixelSprite src={uiAsset('status-bars/prayer.png')} style={iconPos(right)} />
    </div>
  )
})
