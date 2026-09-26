/**
 * OSRS sound-effect synthesiser, ported from the game client (see SoundEnvelope.ts).
 *
 * A sound effect (cache index 4) is up to ten instruments plus a loop range in
 * milliseconds. `mix()` renders them to signed 8-bit 22050 Hz mono, the
 * client's `RawSound` format.
 */
import { ByteReader } from '../ByteReader'
import { Instrument, SAMPLE_RATE } from './Instrument'

export class SoundEffect {
  readonly instruments: (Instrument | null)[] = new Array<Instrument | null>(10).fill(null)
  /** Loop range in ms (start == end: no loop section). */
  start = 0
  end = 0

  static decode(data: Uint8Array): SoundEffect {
    const r = new ByteReader(data)
    const effect = new SoundEffect()
    for (let i = 0; i < 10; i++) {
      if (r.u8() !== 0) {
        r.offset--
        effect.instruments[i] = Instrument.decode(r)
      }
    }
    effect.start = r.u16()
    effect.end = r.u16()
    return effect
  }

  get instrumentCount(): number {
    let n = 0
    for (const ins of this.instruments) if (ins) n++
    return n
  }

  /** Total length in ms (longest instrument offset + duration). */
  get durationMs(): number {
    let ms = 0
    for (const ins of this.instruments) {
      if (ins && ins.duration + ins.offset > ms) ms = ins.duration + ins.offset
    }
    return ms
  }

  get loopStartSample(): number {
    return Math.trunc((this.start * SAMPLE_RATE) / 1000)
  }

  get loopEndSample(): number {
    return Math.trunc((this.end * SAMPLE_RATE) / 1000)
  }

  /**
   * Client `calculateDelay`: trims leading silence shared by all instruments
   * (in 20 ms client cycles) and returns the trimmed amount in cycles, so the
   * caller can delay playback by the same amount.
   */
  calculateDelay(): number {
    let cycles = 9999999
    for (const ins of this.instruments) {
      if (ins && Math.trunc(ins.offset / 20) < cycles) cycles = Math.trunc(ins.offset / 20)
    }
    if (this.start < this.end && Math.trunc(this.start / 20) < cycles) cycles = Math.trunc(this.start / 20)
    if (cycles === 9999999 || cycles === 0) return 0
    for (const ins of this.instruments) if (ins) ins.offset -= cycles * 20
    if (this.start < this.end) {
      this.start -= cycles * 20
      this.end -= cycles * 20
    }
    return cycles
  }

  /** Render to signed 8-bit PCM at 22050 Hz. */
  mix(): Int8Array {
    const ms = this.durationMs
    if (ms === 0) return new Int8Array(0)
    const n = Math.trunc((ms * SAMPLE_RATE) / 1000)
    const out = new Int8Array(n)
    for (const ins of this.instruments) {
      if (!ins) continue
      const len = Math.trunc((ins.duration * SAMPLE_RATE) / 1000)
      const off = Math.trunc((ins.offset * SAMPLE_RATE) / 1000)
      const buf = ins.synthesize(len, ins.duration)
      for (let s = 0; s < len; s++) {
        let v = (buf[s]! >> 8) + out[s + off]!
        if (((v + 128) & -256) !== 0) v = (v >> 31) ^ 127
        out[s + off] = v
      }
    }
    return out
  }

  /** Render to float PCM in -1..1 at 22050 Hz. */
  toPcm(): Float32Array {
    const bytes = this.mix()
    const out = new Float32Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! / 128
    return out
  }
}
