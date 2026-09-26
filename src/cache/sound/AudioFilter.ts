/**
 * OSRS sound-effect synthesiser, ported from the game client (see SoundEnvelope.ts).
 *
 * A pair of IIR filters (feed-forward and feedback pole pairs) whose
 * coefficients are interpolated between two end states by an envelope.
 * Float32 arithmetic mirrors the client's `float` fields.
 */
import type { ByteReader } from '../ByteReader'
import type { SoundEnvelope } from './SoundEnvelope'

const f = Math.fround

export class AudioFilter {
  /** Number of pole pairs per direction (0 = feed-forward, 1 = feedback). */
  readonly pairs = [0, 0]
  /** [direction][end state][pair] frequencies (field406). */
  private readonly frequencies: number[][][] = [
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  ]
  /** [direction][end state][pair] magnitudes (field407). */
  private readonly magnitudes: number[][][] = [
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  ]
  /** Unity gain at the two end states (field408). */
  private readonly unity = [0, 0]

  /** Shared scratch state, like the client's statics. */
  static readonly coefficients: [Int32Array, Int32Array] = [new Int32Array(8), new Int32Array(8)]
  static forwardMultiplier = 0
  private static readonly work: [Float32Array, Float32Array] = [new Float32Array(8), new Float32Array(8)]
  private static gain = 0

  /** Client `method1022`: gain of one pole pair at interpolation `t`. */
  private magnitude(dir: number, pair: number, t: number): number {
    const m = this.magnitudes[dir]!
    let v = f(m[0]![pair]! + t * (m[1]![pair]! - m[0]![pair]!))
    v = f(v * 0.0015258789)
    return f(1 - Math.pow(10, -v / 20))
  }

  /** Client `method1023`: angular frequency of one pole pair at `t`. */
  private frequency(dir: number, pair: number, t: number): number {
    const q = this.frequencies[dir]!
    let v = f(q[0]![pair]! + t * (q[1]![pair]! - q[0]![pair]!))
    v = f(v * 1.2207031e-4)
    return AudioFilter.normalize(v)
  }

  /**
   * Recompute the integer coefficients for `dir` at envelope position `t`
   * (0..1); returns the number of coefficients (pairs * 2).
   */
  compute(dir: number, t: number): number {
    const work = AudioFilter.work[dir]!
    let v: number
    if (dir === 0) {
      v = f(this.unity[0]! + (this.unity[1]! - this.unity[0]!) * t)
      v = f(v * 0.0030517578)
      AudioFilter.gain = f(Math.pow(0.1, v / 20))
      AudioFilter.forwardMultiplier = Math.trunc(AudioFilter.gain * 65536)
    }
    const pairs = this.pairs[dir]!
    if (pairs === 0) return 0
    v = this.magnitude(dir, 0, t)
    work[0] = f(-2 * v * Math.cos(this.frequency(dir, 0, t)))
    work[1] = f(v * v)
    for (let i = 1; i < pairs; i++) {
      v = this.magnitude(dir, i, t)
      const a = f(-2 * v * Math.cos(this.frequency(dir, i, t)))
      const b = f(v * v)
      work[i * 2 + 1] = f(work[i * 2 - 1]! * b)
      work[i * 2] = f(work[i * 2 - 1]! * a + work[i * 2 - 2]! * b)
      for (let j = i * 2 - 1; j >= 2; j--) {
        work[j] = f(work[j]! + work[j - 1]! * a + work[j - 2]! * b)
      }
      work[1] = f(work[1]! + work[0]! * a + b)
      work[0] = f(work[0]! + a)
    }
    if (dir === 0) {
      for (let i = 0; i < pairs * 2; i++) work[i] = f(work[i]! * AudioFilter.gain)
    }
    const coefficients = AudioFilter.coefficients[dir]!
    for (let i = 0; i < pairs * 2; i++) coefficients[i] = Math.trunc(work[i]! * 65536)
    return pairs * 2
  }

  /** Client `method1025`: reads the filter and, when it varies, its envelope segments. */
  decode(r: ByteReader, envelope: SoundEnvelope): void {
    const header = r.u8()
    this.pairs[0] = header >> 4
    this.pairs[1] = header & 15
    if (header !== 0) {
      this.unity[0] = r.u16()
      this.unity[1] = r.u16()
      const varying = r.u8()
      for (let dir = 0; dir < 2; dir++) {
        for (let pair = 0; pair < this.pairs[dir]!; pair++) {
          this.frequencies[dir]![0]![pair] = r.u16()
          this.magnitudes[dir]![0]![pair] = r.u16()
        }
      }
      for (let dir = 0; dir < 2; dir++) {
        for (let pair = 0; pair < this.pairs[dir]!; pair++) {
          if ((varying & (1 << (dir * 4) << pair)) !== 0) {
            this.frequencies[dir]![1]![pair] = r.u16()
            this.magnitudes[dir]![1]![pair] = r.u16()
          } else {
            this.frequencies[dir]![1]![pair] = this.frequencies[dir]![0]![pair]!
            this.magnitudes[dir]![1]![pair] = this.magnitudes[dir]![0]![pair]!
          }
        }
      }
      if (varying !== 0 || this.unity[1] !== this.unity[0]) envelope.decodeSegments(r)
    } else {
      this.unity[0] = 0
      this.unity[1] = 0
    }
  }

  /** Octaves above C0 (32.703 Hz) to radians per sample at 22050 Hz. */
  static normalize(octaves: number): number {
    const hz = f(32.703197 * Math.pow(2, octaves))
    return f((hz * 3.1415927) / 11025)
  }
}
