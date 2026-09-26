import { createContext, useContext, useEffect, useState } from 'react'
import type { SimRuntime, TickSnapshot } from './types'

export const RuntimeContext = createContext<SimRuntime | null>(null)

export function useRuntime(): SimRuntime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('useRuntime() outside <RuntimeContext.Provider>')
  return runtime
}

/** Re-renders on every tick with the latest snapshot. Use a selector-style hook for hot paths. */
export function useTickSnapshot(): TickSnapshot {
  const runtime = useRuntime()
  const [snap, setSnap] = useState(() => runtime.getSnapshot())
  useEffect(() => runtime.onTick(setSnap), [runtime])
  return snap
}
