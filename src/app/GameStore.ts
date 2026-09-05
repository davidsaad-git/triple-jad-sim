import { useSyncExternalStore } from 'react'

/**
 * Minimal external store bridging the engine and React. The engine bumps the
 * version after each tick (or any state change the UI must show); components
 * subscribe with `useGameStore(selector)`. Snapshots are plain objects so React
 * can compare them by reference.
 */
export class Store<T extends object> {
  private snapshot: T
  private readonly listeners = new Set<() => void>()

  constructor(initial: T) {
    this.snapshot = initial
  }

  get(): T {
    return this.snapshot
  }

  set(next: T): void {
    this.snapshot = next
    for (const l of this.listeners) l()
  }

  update(patch: Partial<T>): void {
    this.set({ ...this.snapshot, ...patch })
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()))
}
