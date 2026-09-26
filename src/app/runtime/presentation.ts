/**
 * Immediate-feedback overrides for lagged inputs.
 *
 * The game state changes only at the tick, but the UI shows some effects at
 * click time (destination tile, run orb, attack style, selected spell; see
 *). `show(value)` sets the override and returns a `retire`
 * function; call `retire()` inside the dispatched apply so the override
 * disappears exactly when the real state takes over. A newer `show` wins: an
 * older retire is then a no-op.
 *
 * `undefined` means "no override"; `null` is a valid override value (e.g. the
 * destination tile hidden by an NPC click).
 */
export class PresentationOverride<T> {
  private value: T | undefined = undefined
  private seq = 0
  private readonly listeners = new Set<(value: T | undefined) => void>()

  get(): T | undefined {
    return this.value
  }

  show(value: T): () => void {
    const seq = ++this.seq
    this.set(value)
    return () => {
      if (this.seq === seq) this.set(undefined)
    }
  }

  reset(): void {
    this.seq += 1
    this.set(undefined)
  }

  subscribe(listener: (value: T | undefined) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(value: T | undefined): void {
    this.value = value
    for (const listener of [...this.listeners]) listener(value)
  }
}
