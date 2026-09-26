import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { SimRuntime, TickSnapshot } from '../../app/runtime/types'
import type { SimState } from '../../sim/api'
import { ClientPresentation } from './presentation'

export interface ClientCtx {
  runtime: SimRuntime
  presentation: ClientPresentation
}

const ClientContext = createContext<ClientCtx | null>(null)
const SnapshotContext = createContext<TickSnapshot | null>(null)

const presentations = new WeakMap<SimRuntime, ClientPresentation>()

/** One presentation-override set per runtime (shared by every chrome component). */
export function presentationFor(runtime: SimRuntime): ClientPresentation {
  let p = presentations.get(runtime)
  if (!p) {
    p = new ClientPresentation()
    presentations.set(runtime, p)
  }
  return p
}

/**
 * Provides the runtime, its latest tick snapshot and the click-time
 * presentation overrides to the chrome.
 */
export function ClientProvider({ runtime, children }: { runtime: SimRuntime; children: ReactNode }) {
  const presentation = presentationFor(runtime)
  const [snap, setSnap] = useState(() => runtime.getSnapshot())
  useEffect(() => {
    setSnap(runtime.getSnapshot())
    const offTick = runtime.onTick((s) => {
      presentation.onTick(s.state)
      setSnap(s)
    })
    const offRestart = runtime.onRestart?.(() => presentation.reset())
    return () => {
      offTick()
      offRestart?.()
    }
  }, [runtime, presentation])
  const ctx = useMemo(() => ({ runtime, presentation }), [runtime, presentation])
  return (
    <ClientContext.Provider value={ctx}>
      <SnapshotContext.Provider value={snap}>{children}</SnapshotContext.Provider>
    </ClientContext.Provider>
  )
}

export function useClient(): ClientCtx {
  const c = useContext(ClientContext)
  if (!c) throw new Error('useClient() outside <ClientProvider>')
  return c
}

export function useTick(): TickSnapshot {
  const s = useContext(SnapshotContext)
  if (!s) throw new Error('useTick() outside <ClientProvider>')
  return s
}

export function useSimState(): SimState {
  return useTick().state
}

/** Re-render when click-time overrides change. */
export function usePresentation(): ClientPresentation {
  const { presentation } = useClient()
  useSyncExternalStore(
    (l) => presentation.subscribe(l),
    () => presentation.getVersion(),
    () => 0,
  )
  return presentation
}
