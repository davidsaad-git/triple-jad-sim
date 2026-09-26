import { describe, expect, it } from 'vitest'
import { Instrument, SAMPLE_RATE } from './Instrument'
import { SoundEffect } from './SoundEffect'
import { encodeWav } from './wav'

/** Envelope bytes: form, start, end, then (duration, phase) pairs. */
function envelope(form: number, start: number, end: number, segments: [number, number][]): number[] {
  const out = [form, ...i32(start), ...i32(end), segments.length]
  for (const [d, p] of segments) out.push(...u16(d), ...u16(p))
  return out
}
function i32(v: number): number[] {
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
}
function u16(v: number): number[] {
  return [(v >> 8) & 255, v & 255]
}

/** A 500 ms 440 Hz sine at full volume, hand-assembled in the cache format. */
function sineEffectBytes(): Uint8Array {
  const instrument = [
    ...envelope(2, 440, 440, [
      [0, 0],
      [65535, 65535],
    ]),
    ...envelope(0, 0, 100, [
      [0, 65535],
      [65535, 65535],
    ]),
    0, // no pitch modifier
    0, // no volume multiplier
    0, // no gate
    100, // oscillator 0 volume (uSmart)
    64, // oscillator 0 pitch offset 0 (iSmart)
    0, // oscillator 0 delay
    0, // oscillator terminator
    0, // delay time
    0, // delay decay
    ...u16(500), // duration ms
    ...u16(0), // offset ms
    0, // no filter
  ]
  return new Uint8Array([...instrument, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u16(0), ...u16(0)])
}

describe('sound effect synthesiser', () => {
  it('decodes and renders a hand-built sine at the expected length and level', () => {
    const effect = SoundEffect.decode(sineEffectBytes())
    expect(effect.instrumentCount).toBe(1)
    expect(effect.durationMs).toBe(500)
    const ins = effect.instruments[0]!
    expect(ins.pitch.form).toBe(2)
    expect(ins.pitch.start).toBe(440)
    expect(ins.oscillatorVolume[0]).toBe(100)
    const pcm = effect.toPcm()
    expect(pcm.length).toBe(Math.trunc((500 * SAMPLE_RATE) / 1000))
    let peak = 0
    let sum = 0
    let crossings = 0
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i]!
      peak = Math.max(peak, Math.abs(v))
      sum += v * v
      if (i > 0 && (v >= 0) !== (pcm[i - 1]! >= 0)) crossings++
    }
    expect(peak).toBeGreaterThan(0.9)
    expect(peak).toBeLessThanOrEqual(1)
    // Full-scale sine: RMS ~ 0.707.
    expect(Math.sqrt(sum / pcm.length)).toBeGreaterThan(0.6)
    // 440 Hz over 0.5 s crosses zero ~440 times.
    expect(crossings).toBeGreaterThan(420)
    expect(crossings).toBeLessThan(460)
  })

  it('renders a square wave from a programmatic instrument', () => {
    const ins = new Instrument()
    ins.pitch.form = 1
    ins.pitch.start = 200
    ins.pitch.end = 200
    ins.volume.phases = [65535, 65535]
    ins.oscillatorVolume[0] = 50
    ins.duration = 100
    const n = Math.trunc((100 * SAMPLE_RATE) / 1000)
    const out = ins.synthesize(n, 100)
    let nonZero = 0
    for (let i = 0; i < n; i++) if (out[i] !== 0) nonZero++
    expect(nonZero).toBeGreaterThan(n * 0.9)
    // 50 % volume: amplitude 16383 (65535 * 8192 >> 15).
    expect(Math.abs(out[10]!)).toBe(16383)
  })

  it('writes a valid WAV header', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), SAMPLE_RATE)
    expect(wav.length).toBe(44 + 6)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
    const view = new DataView(wav.buffer)
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE)
    expect(view.getInt16(46, true)).toBe(16384)
  })

  it('trims shared leading silence into a play delay', () => {
    const effect = SoundEffect.decode(sineEffectBytes())
    effect.instruments[0]!.offset = 400
    expect(effect.calculateDelay()).toBe(20)
    expect(effect.instruments[0]!.offset).toBe(0)
    expect(effect.calculateDelay()).toBe(0)
    expect(effect.toPcm().length).toBe(Math.trunc((500 * SAMPLE_RATE) / 1000))
  })
})
