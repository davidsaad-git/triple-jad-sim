/**
 * OSRS sound-effect synthesiser, ported from the game client (see SoundEnvelope.ts).
 *
 * One voice of a sound effect: up to five detuned oscillators driven by pitch
 * and volume envelopes, optional pitch / volume modulators, a gate
 * ("release" / "attack"), an echo and an IIR filter. Renders 16-bit samples
 * at 22050 Hz into a shared Int32 scratch buffer, exactly like the client.
 */
import type { ByteReader } from '../ByteReader'
import { AudioFilter } from './AudioFilter'
import { SoundEnvelope } from './SoundEnvelope'

export const SAMPLE_RATE = 22050

/** java.util.Random(seed).nextInt() sequence, needed to reproduce the client's noise table. */
export function* javaRandomInts(seed: bigint): Generator<number> {
  const multiplier = 0x5deece66dn
  const mask = (1n << 48n) - 1n
  let state = (seed ^ multiplier) & mask
  for (;;) {
    state = (state * multiplier + 0xbn) & mask
    yield Number(state >> 16n) | 0
  }
}

let noiseTable: Int32Array | null = null
let sineTable: Int32Array | null = null

function noise(): Int32Array {
  if (!noiseTable) {
    noiseTable = new Int32Array(32768)
    const rng = javaRandomInts(0n)
    for (let i = 0; i < 32768; i++) noiseTable[i] = ((rng.next().value as number) & 2) - 1
  }
  return noiseTable
}

function sine(): Int32Array {
  if (!sineTable) {
    sineTable = new Int32Array(32768)
    for (let i = 0; i < 32768; i++) sineTable[i] = Math.trunc(Math.sin(i / 5215.1903) * 16384)
  }
  return sineTable
}

/** Shared render buffer (the client allocates 10 s worth and never more). */
let samples = new Int32Array(220500)
const phases = new Int32Array(5)
const delays = new Int32Array(5)
const volumeSteps = new Int32Array(5)
const pitchSteps = new Int32Array(5)
const pitchBaseSteps = new Int32Array(5)

/** `(int)((long)a * (long)b >> 16)` */
function mulShift16(a: number, b: number): number {
  return Math.floor((a * b) / 65536) | 0
}

export class Instrument {
  pitch = new SoundEnvelope()
  volume = new SoundEnvelope()
  pitchModifier: SoundEnvelope | null = null
  pitchModifierAmplitude: SoundEnvelope | null = null
  volumeMultiplier: SoundEnvelope | null = null
  volumeMultiplierAmplitude: SoundEnvelope | null = null
  release: SoundEnvelope | null = null
  attack: SoundEnvelope | null = null
  readonly oscillatorVolume = [0, 0, 0, 0, 0]
  readonly oscillatorPitch = [0, 0, 0, 0, 0]
  readonly oscillatorDelays = [0, 0, 0, 0, 0]
  delayTime = 0
  delayDecay = 100
  filter = new AudioFilter()
  filterEnvelope = new SoundEnvelope()
  /** Length in ms. */
  duration = 500
  /** Start offset in ms within the sound effect. */
  offset = 0

  static decode(r: ByteReader): Instrument {
    const ins = new Instrument()
    ins.pitch = SoundEnvelope.decode(r)
    ins.volume = SoundEnvelope.decode(r)
    if (r.u8() !== 0) {
      r.offset--
      ins.pitchModifier = SoundEnvelope.decode(r)
      ins.pitchModifierAmplitude = SoundEnvelope.decode(r)
    }
    if (r.u8() !== 0) {
      r.offset--
      ins.volumeMultiplier = SoundEnvelope.decode(r)
      ins.volumeMultiplierAmplitude = SoundEnvelope.decode(r)
    }
    if (r.u8() !== 0) {
      r.offset--
      ins.release = SoundEnvelope.decode(r)
      ins.attack = SoundEnvelope.decode(r)
    }
    for (let i = 0; i < 10; i++) {
      const vol = r.uSmart()
      if (vol === 0) break
      ins.oscillatorVolume[i] = vol
      ins.oscillatorPitch[i] = r.iSmart()
      ins.oscillatorDelays[i] = r.uSmart()
    }
    ins.delayTime = r.uSmart()
    ins.delayDecay = r.uSmart()
    ins.duration = r.u16()
    ins.offset = r.u16()
    ins.filter = new AudioFilter()
    ins.filterEnvelope = new SoundEnvelope()
    ins.filter.decode(r, ins.filterEnvelope)
    return ins
  }

  /**
   * Render `n` samples spanning `durationMs`. Returns the shared scratch
   * buffer (valid until the next call), 16-bit range.
   */
  synthesize(n: number, durationMs: number): Int32Array {
    if (n > samples.length) samples = new Int32Array(n)
    samples.fill(0, 0, n)
    if (durationMs < 10) return samples
    const samplesPerMs = n / (durationMs + 0.0)
    this.pitch.reset()
    this.volume.reset()
    let pmStep = 0
    let pmBase = 0
    let pmPhase = 0
    if (this.pitchModifier && this.pitchModifierAmplitude) {
      this.pitchModifier.reset()
      this.pitchModifierAmplitude.reset()
      pmStep = Math.trunc(((this.pitchModifier.end - this.pitchModifier.start) * 32.768) / samplesPerMs)
      pmBase = Math.trunc((this.pitchModifier.start * 32.768) / samplesPerMs)
    }
    let vmStep = 0
    let vmBase = 0
    let vmPhase = 0
    if (this.volumeMultiplier && this.volumeMultiplierAmplitude) {
      this.volumeMultiplier.reset()
      this.volumeMultiplierAmplitude.reset()
      vmStep = Math.trunc(((this.volumeMultiplier.end - this.volumeMultiplier.start) * 32.768) / samplesPerMs)
      vmBase = Math.trunc((this.volumeMultiplier.start * 32.768) / samplesPerMs)
    }
    for (let o = 0; o < 5; o++) {
      if (this.oscillatorVolume[o] !== 0) {
        phases[o] = 0
        delays[o] = Math.trunc(this.oscillatorDelays[o]! * samplesPerMs)
        volumeSteps[o] = Math.trunc((this.oscillatorVolume[o]! << 14) / 100)
        pitchSteps[o] = Math.trunc(((this.pitch.end - this.pitch.start) * 32.768 * Math.pow(1.0057929410678534, this.oscillatorPitch[o]!)) / samplesPerMs)
        pitchBaseSteps[o] = Math.trunc((this.pitch.start * 32.768) / samplesPerMs)
      }
    }

    for (let s = 0; s < n; s++) {
      let p = this.pitch.doStep(n)
      let v = this.volume.doStep(n)
      if (this.pitchModifier && this.pitchModifierAmplitude) {
        const pm = this.pitchModifier.doStep(n)
        const pma = this.pitchModifierAmplitude.doStep(n)
        p += this.evaluateWave(pmPhase, pma, this.pitchModifier.form) >> 1
        pmPhase = (pmPhase + pmBase + (Math.imul(pm, pmStep) >> 16)) | 0
      }
      if (this.volumeMultiplier && this.volumeMultiplierAmplitude) {
        const vm = this.volumeMultiplier.doStep(n)
        const vma = this.volumeMultiplierAmplitude.doStep(n)
        v = Math.imul(v, (this.evaluateWave(vmPhase, vma, this.volumeMultiplier.form) >> 1) + 32768) >> 15
        vmPhase = (vmPhase + vmBase + (Math.imul(vm, vmStep) >> 16)) | 0
      }
      for (let o = 0; o < 5; o++) {
        if (this.oscillatorVolume[o] !== 0) {
          const idx = delays[o]! + s
          if (idx < n) {
            samples[idx] = (samples[idx]! + this.evaluateWave(phases[o]!, Math.imul(v, volumeSteps[o]!) >> 15, this.pitch.form)) | 0
            phases[o] = (phases[o]! + (Math.imul(p, pitchSteps[o]!) >> 16) + pitchBaseSteps[o]!) | 0
          }
        }
      }
    }

    if (this.release && this.attack) {
      this.release.reset()
      this.attack.reset()
      let counter = 0
      let muted = true
      const span = this.release.end - this.release.start
      for (let s = 0; s < n; s++) {
        const rel = this.release.doStep(n)
        const att = this.attack.doStep(n)
        const threshold = muted ? (Math.imul(rel, span) >> 8) + this.release.start : (Math.imul(att, span) >> 8) + this.release.start
        counter += 256
        if (counter >= threshold) {
          counter = 0
          muted = !muted
        }
        if (muted) samples[s] = 0
      }
    }

    if (this.delayTime > 0 && this.delayDecay > 0) {
      const d = Math.trunc(this.delayTime * samplesPerMs)
      for (let s = d; s < n; s++) {
        samples[s] = (samples[s]! + Math.trunc(Math.imul(samples[s - d]!, this.delayDecay) / 100)) | 0
      }
    }

    if (this.filter.pairs[0]! > 0 || this.filter.pairs[1]! > 0) {
      this.filterEnvelope.reset()
      let e = this.filterEnvelope.doStep(n + 1)
      let fwd = this.filter.compute(0, e / 65536)
      let fb = this.filter.compute(1, e / 65536)
      if (n >= fwd + fb) {
        const c0 = AudioFilter.coefficients[0]
        const c1 = AudioFilter.coefficients[1]
        let i = 0
        let lim = fb
        if (fb > n - fwd) lim = n - fwd
        while (i < lim) {
          let acc = mulShift16(samples[i + fwd]!, AudioFilter.forwardMultiplier)
          for (let j = 0; j < fwd; j++) acc += mulShift16(samples[i + fwd - 1 - j]!, c0[j]!)
          for (let j = 0; j < i; j++) acc -= mulShift16(samples[i - 1 - j]!, c1[j]!)
          samples[i] = acc | 0
          e = this.filterEnvelope.doStep(n + 1)
          i++
        }
        lim = 128
        for (;;) {
          if (lim > n - fwd) lim = n - fwd
          while (i < lim) {
            let acc = mulShift16(samples[i + fwd]!, AudioFilter.forwardMultiplier)
            for (let j = 0; j < fwd; j++) acc += mulShift16(samples[i + fwd - 1 - j]!, c0[j]!)
            for (let j = 0; j < fb; j++) acc -= mulShift16(samples[i - 1 - j]!, c1[j]!)
            samples[i] = acc | 0
            e = this.filterEnvelope.doStep(n + 1)
            i++
          }
          if (i >= n - fwd) {
            while (i < n) {
              let acc = 0
              for (let j = i + fwd - n; j < fwd; j++) acc += mulShift16(samples[i + fwd - 1 - j]!, c0[j]!)
              for (let j = 0; j < fb; j++) acc -= mulShift16(samples[i - 1 - j]!, c1[j]!)
              samples[i] = acc | 0
              this.filterEnvelope.doStep(n + 1)
              i++
            }
            break
          }
          fwd = this.filter.compute(0, e / 65536)
          fb = this.filter.compute(1, e / 65536)
          lim += 128
        }
      }
    }

    for (let s = 0; s < n; s++) {
      if (samples[s]! < -32768) samples[s] = -32768
      if (samples[s]! > 32767) samples[s] = 32767
    }
    return samples
  }

  /** One oscillator sample: 1 square, 2 sine, 3 saw, 4 noise. */
  evaluateWave(phase: number, amplitude: number, form: number): number {
    if (form === 1) return (phase & 32767) < 16384 ? amplitude : -amplitude
    if (form === 2) return Math.imul(sine()[phase & 32767]!, amplitude) >> 14
    if (form === 3) return (Math.imul(amplitude, phase & 32767) >> 14) - amplitude
    if (form === 4) return Math.imul(amplitude, noise()[Math.trunc(phase / 2607) & 32767]!)
    return 0
  }
}
