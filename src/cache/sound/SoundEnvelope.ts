/**
 * OSRS sound-effect synthesiser, ported from the game client (class names
 * follow the RuneLite deobfuscation: SoundEffect, Instrument, SoundEnvelope,
 * AudioFilter; the byte layout matches RuneLite's
 * net.runelite.cache.definitions.loaders.sound.* loaders).
 *
 * A piecewise-linear envelope: `segments` (duration, value) pairs in 16-bit
 * fixed point, stepped once per output sample.
 */
import type { ByteReader } from '../ByteReader'

export class SoundEnvelope {
  /** Wave form for the pitch / modulator envelopes: 1 square, 2 sine, 3 saw, 4 noise. */
  form = 0
  start = 0
  end = 0
  segments = 2
  durations: number[] = [0, 65535]
  phases: number[] = [0, 65535]

  private ticks = 0
  private phaseIndex = 0
  private max = 0
  private step = 0
  private amplitude = 0

  static decode(r: ByteReader): SoundEnvelope {
    const e = new SoundEnvelope()
    e.form = r.u8()
    e.start = r.i32()
    e.end = r.i32()
    e.decodeSegments(r)
    return e
  }

  decodeSegments(r: ByteReader): void {
    this.segments = r.u8()
    this.durations = new Array<number>(this.segments)
    this.phases = new Array<number>(this.segments)
    for (let i = 0; i < this.segments; i++) {
      this.durations[i] = r.u16()
      this.phases[i] = r.u16()
    }
  }

  reset(): void {
    this.ticks = 0
    this.phaseIndex = 0
    this.step = 0
    this.amplitude = 0
    this.max = 0
  }

  /** Advance one sample of a `total`-sample render; returns the 0..65535 envelope value. */
  doStep(total: number): number {
    if (this.max >= this.ticks) {
      this.amplitude = this.phases[this.phaseIndex++]! << 15
      if (this.phaseIndex >= this.segments) this.phaseIndex = this.segments - 1
      this.ticks = Math.trunc((this.durations[this.phaseIndex]! / 65536) * total)
      if (this.ticks > this.max) {
        this.step = Math.trunc(((this.phases[this.phaseIndex]! << 15) - this.amplitude) / (this.ticks - this.max))
      }
    }
    this.amplitude = (this.amplitude + this.step) | 0
    this.max++
    return (this.amplitude - this.step) >> 15
  }
}
