import type { SimEvent, SimEventBody } from '../api'

/**
 * Per-tick event buffer with global event ids.
 *
 * `emit` stamps the current tick and the next id (ids start at 1 and are
 * never reset, not even by an engine reset). `flush` hands out and clears the
 * buffer. Events emitted between ticks keep the previous stamp and come out
 * with the next flush.
 */
export class EventBus {
  private buffer: SimEvent[] = []
  private nextEventId = 1
  private currentTick = 0

  setTick(tick: number): void {
    this.currentTick = tick
  }

  get tick(): number {
    return this.currentTick
  }

  emit(event: SimEventBody): void {
    const stamped = { ...event, tick: this.currentTick, eventId: this.nextEventId } as SimEvent
    this.buffer.push(stamped)
    this.nextEventId += 1
  }

  /** Replay take-over: make the next id `max(next, id + 1)`. */
  continueAfter(eventId: number): void {
    this.nextEventId = Math.max(this.nextEventId, eventId + 1)
  }

  flush(): SimEvent[] {
    const out = this.buffer
    this.buffer = []
    return out
  }

  get pending(): readonly SimEvent[] {
    return this.buffer
  }
}
