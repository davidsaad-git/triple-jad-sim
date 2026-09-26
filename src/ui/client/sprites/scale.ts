import { createContext, useContext, useEffect, useState } from 'react'

/**
 * The content scale of the draggable panel a sprite lives in (scim
 * contexts read by): canvases are backed at
 * `client size x panelScale x devicePixelRatio` device pixels.
 */
export const PanelScaleContext = createContext<number>(1)

export function usePanelScale(): number {
  return useContext(PanelScaleContext)
}

function currentDpr(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

/** devicePixelRatio, updated when it changes (scim: not clamped for chrome). */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(currentDpr)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = (): void => setDpr(currentDpr())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dpr])
  return dpr
}
