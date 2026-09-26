import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SimRuntime, TickSnapshot } from '../../app/runtime/types'
import { getModifiers, type ModifierState, onModifiersChange } from '../../input/modifiers'

let modsSnapshot: ModifierState | null = null
function modsSubscribe(listener: () => void): () => void {
  return onModifiersChange((m) => {
    modsSnapshot = m
    listener()
  })
}
function modsGet(): ModifierState {
  if (modsSnapshot === null) modsSnapshot = getModifiers()
  return modsSnapshot
}
const NO_MODS: ModifierState = { shift: false, ctrl: false, alt: false, meta: false }

/** Currently held modifiers. */
export function useModifiers(): ModifierState {
  return useSyncExternalStore(modsSubscribe, modsGet, () => NO_MODS)
}

/** True while Alt is held (panel editing affordances, scim). */
export function useAltHeld(): boolean {
  return useModifiers().alt
}

/** The latest runtime snapshot, re-rendering every tick. */
export function useSnapshot(runtime: SimRuntime): TickSnapshot {
  const [snap, setSnap] = useState(() => runtime.getSnapshot())
  useEffect(() => {
    setSnap(runtime.getSnapshot())
    return runtime.onTick(setSnap)
  }, [runtime])
  return snap
}

/** Window inner size, updated on resize. */
export function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: typeof window === 'undefined' ? 1280 : window.innerWidth, height: typeof window === 'undefined' ? 720 : window.innerHeight }))
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** Content-box size of an element (ResizeObserver). */
export function useElementSize(el: HTMLElement | null): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    if (!el) return
    const update = (): void => {
      const w = el.clientWidth
      const h = el.clientHeight
      setSize((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }))
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return size
}

/** Latest value in a ref (for callbacks registered once). */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  ref.current = value
  return ref
}
