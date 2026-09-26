import { type CSSProperties, forwardRef, type HTMLAttributes, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { getImage, loadImage, scaledImage, scaledRegion, subscribeImages } from './imageStore'
import { fitSize, type SourceRect } from './resample'
import { useDevicePixelRatio, usePanelScale } from './scale'

/** The decoded image for `url` (undefined while loading, null on failure); triggers the load. */
export function useImage(url: string): HTMLImageElement | null | undefined {
  const img = useSyncExternalStore(
    subscribeImages,
    () => getImage(url),
    () => undefined,
  )
  useEffect(() => {
    if (img === undefined) void loadImage(url)
  }, [img, url])
  return img
}

export interface PixelSpriteProps extends Omit<HTMLAttributes<HTMLCanvasElement>, 'style'> {
  src: string
  alt?: string
  style?: CSSProperties
  /** Overrides the panel scale for the backing store. */
  scale?: number
  width?: number
  height?: number
  sourceRect?: SourceRect
}

/**
 * One sprite painted into a canvas at `client size x scale x dpr` device
 * pixels. Size follows the aspect-fit rules
 * of `fitSize` using `width`/`height` (props or numeric style) and numeric
 * `maxWidth`/`maxHeight` from style.
 */
export const PixelSprite = forwardRef<HTMLCanvasElement | null, PixelSpriteProps>(function PixelSprite(
  { src, alt = '', style, scale, width, height, sourceRect, ...rest },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useImperativeHandle<HTMLCanvasElement | null, HTMLCanvasElement | null>(ref, () => canvasRef.current, [])
  const panelScale = usePanelScale()
  const dpr = useDevicePixelRatio()
  const k = (scale ?? panelScale) * dpr
  const img = useImage(src)
  const w = typeof style?.width === 'number' ? style.width : width
  const h = typeof style?.height === 'number' ? style.height : height
  const maxWidth = typeof style?.maxWidth === 'number' ? style.maxWidth : undefined
  const maxHeight = typeof style?.maxHeight === 'number' ? style.maxHeight : undefined
  const size = img ? fitSize(sourceRect?.width ?? img.naturalWidth, sourceRect?.height ?? img.naturalHeight, { width: w, height: h, maxWidth, maxHeight }) : null
  const dw = size ? Math.max(1, Math.round(size.width * k)) : 0
  const dh = size ? Math.max(1, Math.round(size.height * k)) : 0

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !img || dw <= 0 || dh <= 0) return
    if (canvas.width !== dw) canvas.width = dw
    if (canvas.height !== dh) canvas.height = dh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, dw, dh)
    ctx.imageSmoothingEnabled = false
    if (!sourceRect) {
      ctx.drawImage(scaledImage(src, img, dw, dh), 0, 0)
      return
    }
    const region = scaledRegion(src, img, sourceRect, dw, dh)
    if (region) ctx.drawImage(region, 0, 0)
    else ctx.drawImage(img, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, 0, 0, dw, dh)
  }, [img, src, dw, dh, sourceRect])

  useLayoutEffect(paint, [paint])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onRestore = (): void => paint()
    canvas.addEventListener('contextrestored', onRestore)
    return () => canvas.removeEventListener('contextrestored', onRestore)
  }, [paint])

  const failed = img === null
  const css: CSSProperties = {
    ...style,
    ...(size ? { width: size.width, height: size.height } : { width: w ?? 0, height: h ?? 0 }),
    ...(failed || !img ? { opacity: 0 } : null),
  }
  return <canvas ref={canvasRef} role="img" aria-label={alt || undefined} data-src={src} style={css} {...rest} />
})
