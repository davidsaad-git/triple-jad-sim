/**
 * Frame advance of an animated loc: a
 * random start frame (when the sequence loops), catch-up capped at 100
 * cycles for looping sequences, loop back by `frameStep`; a sequence that
 * runs off its end stops on frame 0. Driven by performance.now() / (20 / speed).
 */
import type { SeqType } from '../../cache/config/SeqType'

export class LocAnimator {
  private seq: SeqType | undefined
  frame = 0
  private cycleStart: number

  constructor(seq: SeqType, nowCycles: number, random: () => number = Math.random) {
    this.seq = seq
    this.cycleStart = nowCycles - 1
    if (seq.frameStep !== -1 && seq.frameIds.length > 0) {
      this.frame = Math.floor(random() * seq.frameIds.length)
      this.cycleStart -= Math.floor(random() * (seq.frameLengths[this.frame] ?? 1))
    }
  }

  update(nowCycles: number): number {
    const seq = this.seq
    if (!seq) return 0
    let n = nowCycles - this.cycleStart
    if (n > 100 && seq.frameStep > 0) n = 100
    const count = seq.frameLengths.length
    while (n > (seq.frameLengths[this.frame] ?? 1)) {
      n -= seq.frameLengths[this.frame] ?? 1
      this.frame++
      if (this.frame >= count) {
        this.frame -= seq.frameStep
        if (this.frame < 0 || this.frame >= count) {
          this.frame = 0
          this.cycleStart = nowCycles - 1
          this.seq = undefined
          return 0
        }
      }
    }
    this.cycleStart = nowCycles - n
    return this.frame
  }
}
