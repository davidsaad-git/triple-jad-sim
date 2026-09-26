/**
 * DOM geometry helpers shared by the viewport layer, the context menu and the
 * tooltip.
 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Client coordinates -> element-local CSS px, undoing CSS transform scaling. */
export function toElementLocal(el: Element, clientX: number, clientY: number): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  const html = el as HTMLElement
  const sx = html.offsetWidth > 0 ? r.width / html.offsetWidth : 1
  const sy = html.offsetHeight > 0 ? r.height / html.offsetHeight : 1
  return { x: sx === 0 ? 0 : (clientX - r.left) / sx, y: sy === 0 ? 0 : (clientY - r.top) / sy }
}

/** Element-local CSS px -> client coordinates. */
export function fromElementLocal(el: Element, x: number, y: number): { clientX: number; clientY: number } {
  const r = el.getBoundingClientRect()
  const html = el as HTMLElement
  const sx = html.offsetWidth > 0 ? r.width / html.offsetWidth : 1
  const sy = html.offsetHeight > 0 ? r.height / html.offsetHeight : 1
  return { clientX: r.left + x * sx, clientY: r.top + y * sy }
}

export function windowRect(): Rect {
  return {
    left: 0,
    top: 0,
    right: typeof window !== 'undefined' ? window.innerWidth : 0,
    bottom: typeof window !== 'undefined' ? window.innerHeight : 0,
  }
}

/** The `.game-viewport-frame` rect intersected with the window, else the window. */
export function viewportFrameRect(): Rect {
  const win = windowRect()
  if (typeof document === 'undefined') return win
  const frame = document.querySelector('.game-viewport-frame')
  if (!frame) return win
  const r = frame.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return win
  const left = Math.max(r.left, 0)
  const top = Math.max(r.top, 0)
  const right = Math.min(r.right, win.right)
  const bottom = Math.min(r.bottom, win.bottom)
  return right <= left || bottom <= top ? win : { left, top, right, bottom }
}

/** `.workspace-presentation-surface` rect, else the viewport frame rect. */
export function presentationRect(): Rect {
  if (typeof document === 'undefined') return windowRect()
  const r = document.querySelector('.workspace-presentation-surface')?.getBoundingClientRect()
  if (!r || r.width <= 0 || r.height <= 0) return viewportFrameRect()
  return { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(window.innerWidth, r.right), bottom: Math.min(window.innerHeight, r.bottom) }
}

/**
 * Clamp a box of size w x h placed at (x, y) into `bounds` with `margin`;
 * when it would overflow the bottom, `flipY` gives the alternative top.
 */
export function clampBox(
  x: number,
  y: number,
  w: number,
  h: number,
  bounds: Rect,
  margin: number,
  flipY?: number,
): { x: number; y: number } {
  let left = x
  let top = y
  if (left + w + margin > bounds.right) left = bounds.right - w - margin
  if (left < bounds.left + margin) left = bounds.left + margin
  if (top + h + margin > bounds.bottom) top = flipY ?? bounds.bottom - h - margin
  if (top < bounds.top + margin) top = bounds.top + margin
  return { x: left, y: top }
}
