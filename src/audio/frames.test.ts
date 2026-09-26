import { describe, expect, it } from 'vitest'
import type { SequenceFrameState } from '../render/api'
import type { EnginePlayOptions } from './EventAudioPlayer'
import { type FrameSoundEntry, type FrameSoundSeq, FrameSoundTracker } from './FrameSoundTracker'

interface Played {
  id: number
  options: EnginePlayOptions
  trigger: string | undefined
}

const sfx = (id: number): FrameSoundEntry => ({ id, loops: 1, location: 0, retain: 0 })

function seq(frames: Record<number, FrameSoundEntry[]>, frameCount: number, looping: boolean): FrameSoundSeq {
  return { frameSounds: new Map(Object.entries(frames).map(([f, e]) => [Number(f), e])), looping, frameCount }
}

const SEQS: Record<number, FrameSoundSeq> = {
  // 6 frames, a sound on frames 1..5.
  100: seq({ 1: [sfx(11)], 2: [sfx(12)], 3: [sfx(13)], 4: [sfx(14)], 5: [sfx(15)] }, 6, false),
  // Looping copy.
  101: seq({ 0: [sfx(20)], 1: [sfx(21)], 4: [sfx(24)], 5: [sfx(25)] }, 6, true),
  // Tumeken's shadow cast graphic: seq 9543 frame 1 -> 6412, location 15, retain 0.
  9543: seq({ 1: [{ id: 6412, loops: 1, location: 15, retain: 0 }] }, 10, false),
  // Two entries on one frame both play (no weighted pick).
  200: seq({ 0: [sfx(31), { id: 32, loops: 3, location: 0, retain: 0 }] }, 2, false),
}

function setup() {
  const played: Played[] = []
  const tracker = new FrameSoundTracker({ play: (id, options, trigger) => played.push({ id, options, trigger }) }, (id) => SEQS[id] ?? null)
  const ids = () => played.splice(0).map((p) => p.id)
  return { tracker, played, ids }
}

const at = (key: string, seqId: number, frame: number, position: { x: number; y: number } | null = null): SequenceFrameState => ({ key, seqId, frame, position })
const LISTENER = { x: 31.5, y: 33.5 }

describe('FrameSoundTracker', () => {
  it('a new animation plays only its current frame', () => {
    const { tracker, ids } = setup()
    tracker.update([at('npc:1', 100, 3)], LISTENER)
    expect(ids()).toEqual([13])
    tracker.update([at('npc:1', 100, 3)], LISTENER)
    expect(ids()).toEqual([])
  })

  it('catches up every skipped frame', () => {
    const { tracker, ids } = setup()
    tracker.update([at('npc:1', 100, 0)], LISTENER)
    tracker.update([at('npc:1', 100, 1)], LISTENER)
    expect(ids()).toEqual([11])
    tracker.update([at('npc:1', 100, 4)], LISTENER)
    expect(ids()).toEqual([12, 13, 14])
  })

  it('wraps around looping sequences, restarts non-looping ones from frame 0', () => {
    const { tracker, ids } = setup()
    tracker.update([at('a', 101, 3)], LISTENER)
    tracker.update([at('a', 101, 1)], LISTENER)
    expect(ids()).toEqual([24, 25, 20, 21])
    tracker.update([at('b', 100, 4)], LISTENER)
    ids()
    tracker.update([at('b', 100, 2)], LISTENER)
    expect(ids()).toEqual([11, 12])
  })

  it('a sequence change or a forgotten key starts over at the current frame', () => {
    const { tracker, ids } = setup()
    tracker.update([at('p', 100, 2)], LISTENER)
    tracker.update([at('p', 101, 4)], LISTENER)
    expect(ids()).toEqual([12, 24])
    tracker.update([], LISTENER) // not seen: forgotten
    tracker.update([at('p', 101, 5)], LISTENER)
    expect(ids()).toEqual([25])
  })

  it('silentSync records frames without playing (paused / discontinuity)', () => {
    const { tracker, ids } = setup()
    tracker.silentSync([at('x', 100, 1)])
    tracker.silentSync([at('x', 100, 3)])
    tracker.update([at('x', 100, 4)], LISTENER)
    expect(ids()).toEqual([14])
  })

  it('plays every entry of a frame; location 0 -> full sfx', () => {
    const { tracker, played } = setup()
    tracker.update([at('npc:2', 200, 0, { x: 90, y: 90 })], LISTENER)
    expect(played.map((p) => [p.id, p.options])).toEqual([
      [31, { channel: 'sfx' }],
      [32, { channel: 'sfx' }],
    ])
    expect(played[0]!.trigger).toBe('frame:seq=200,f=0')
  })

  it("location > 0 -> area channel attenuated from the actor's render centre (Tumeken's shadow 6412)", () => {
    const { tracker, played } = setup()
    // Spotanim on the player: distance 0 -> volume 1, but on the area channel.
    tracker.update([at('spotanim:7', 9543, 0, LISTENER)], LISTENER)
    tracker.update([at('spotanim:7', 9543, 1, LISTENER)], LISTENER)
    expect(played.map((p) => [p.id, p.options])).toEqual([[6412, { channel: 'area', volume: 1 }]])
    played.length = 0
    // 5.5 + 2 - 1 = 6.5 tiles away -> (15 - 6.5) / 15.
    tracker.update([at('spotanim:8', 9543, 1, { x: 37, y: 35.5 })], LISTENER)
    expect(played[0]!.options.volume).toBeCloseTo(8.5 / 15)
    played.length = 0
    tracker.update([at('spotanim:9', 9543, 1, { x: 60, y: 60 })], LISTENER)
    expect(played).toEqual([])
    // Without a position the entry plays as full-volume sfx.
    tracker.update([at('spotanim:10', 9543, 1, null)], LISTENER)
    expect(played.map((p) => p.options)).toEqual([{ channel: 'sfx' }])
  })

  it('sequences without frame sounds are tracked but silent', () => {
    const { tracker, ids } = setup()
    tracker.update([at('jad', 7592, 0)], LISTENER)
    tracker.update([at('jad', 7592, 9)], LISTENER)
    expect(ids()).toEqual([])
  })
})
