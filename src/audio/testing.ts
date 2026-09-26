/**
 * Test doubles for the audio module: a minimal fake Web Audio context that
 * records the graph and every scheduled voice, and event builders.
 * Not imported by production code.
 */
import type { SimEvent, SimEventBody } from '../sim/api'

export class FakeParam {
  value = 1
}

export class FakeNode {
  readonly kind: string
  connections: FakeNode[] = []
  constructor(kind: string) {
    this.kind = kind
  }
  connect(node: FakeNode): FakeNode {
    this.connections.push(node)
    return node
  }
  disconnect(): void {
    this.connections = []
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam()
  constructor() {
    super('gain')
  }
}

export class FakeBuffer {
  readonly numberOfChannels: number
  readonly length: number
  readonly sampleRate: number
  private readonly data: Float32Array
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.data = new Float32Array(length)
  }
  get duration(): number {
    return this.length / this.sampleRate
  }
  getChannelData(): Float32Array {
    return this.data
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null
  onended: (() => void) | null = null
  startedAt: { when: number; offset: number } | null = null
  stopped = false
  constructor() {
    super('source')
  }
  start(when = 0, offset = 0): void {
    this.startedAt = { when, offset }
  }
  stop(): void {
    this.stopped = true
  }
  /** Simulate the natural end of playback. */
  end(): void {
    this.onended?.()
  }
  /** The bus (sfx/area gain) this voice feeds, via its per-voice gain. */
  get voiceGain(): FakeGain | undefined {
    return this.connections[0] as FakeGain | undefined
  }
}

export class FakeAudioContext {
  currentTime = 0
  state: 'suspended' | 'running' | 'closed' = 'running'
  readonly destination = new FakeNode('destination')
  readonly gains: FakeGain[] = []
  readonly sources: FakeSource[] = []
  resumeCalls = 0

  createGain(): FakeGain {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate)
  }
  resume(): Promise<void> {
    this.resumeCalls++
    this.state = 'running'
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }
  /** [master, sfx, area] in creation order (see AudioEngine.ensureContext). */
  get buses(): { master: FakeGain; sfx: FakeGain; area: FakeGain } {
    const [master, sfx, area] = this.gains
    if (!master || !sfx || !area) throw new Error('context graph not built')
    return { master, sfx, area }
  }
  asContext(): AudioContext {
    return this as unknown as AudioContext
  }
}

/** A sound source where every id is `length` samples of silence (except ids in `missing`). */
export function fakeSource(length = 22050, missing: readonly number[] = []): { sampleRate: number; getPcm(id: number): Float32Array | null } {
  return { sampleRate: 22050, getPcm: (id) => (missing.includes(id) ? null : new Float32Array(length)) }
}

let nextEventId = 1
/** Stamp an event body with tick + a fresh eventId. */
export function ev(body: SimEventBody, tick = 10, eventId = nextEventId++): SimEvent {
  return { ...body, tick, eventId } as SimEvent
}
