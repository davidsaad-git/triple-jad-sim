import { describe, expect, it } from 'vitest'
import { areaAttenuation } from './attenuation'
import { AudioEngine, MAX_VOICES } from './AudioEngine'
import { FakeAudioContext, fakeSource } from './testing'

function setup(opts: { length?: number; missing?: number[] } = {}) {
  const ctx = new FakeAudioContext()
  let created = 0
  const engine = new AudioEngine(fakeSource(opts.length ?? 22050, opts.missing ?? []), () => {
    created++
    return ctx.asContext()
  })
  return { ctx, engine, created: () => created }
}

describe('area attenuation', () => {
  it('Manhattan distance minus one, linear to silence at the range', () => {
    expect(areaAttenuation([10, 10], [10, 10], 15)).toBe(1)
    expect(areaAttenuation([10, 10], [11, 10], 15)).toBe(1) // orthogonal neighbour
    expect(areaAttenuation([10, 10], [11, 11], 15)).toBeCloseTo(14 / 15) // diagonal: d = 1
    expect(areaAttenuation([10, 10], [15, 10], 10)).toBeCloseTo(6 / 10) // d = 4
    expect(areaAttenuation([0, 0], [10, 1], 10)).toBe(0) // d = 10 = range
    expect(areaAttenuation([0, 0], [30, 30], 15)).toBe(0)
  })

  it('retain gives a full-volume inner radius of (retain & 31) - 1', () => {
    // inner = 4: full volume up to d = 4, then (15 - d) / 11.
    expect(areaAttenuation([0, 0], [5, 0], 15, 5)).toBe(1)
    expect(areaAttenuation([0, 0], [10, 0], 15, 5)).toBeCloseTo(6 / 11)
    expect(areaAttenuation([0, 0], [10, 0], 15, 32 + 5)).toBeCloseTo(6 / 11) // only the low 5 bits count
    // inner >= range: full volume inside the range, silent beyond it.
    expect(areaAttenuation([0, 0], [8, 0], 8, 20)).toBe(1)
    expect(areaAttenuation([0, 0], [9, 0], 8, 20)).toBe(0)
  })

  it('works with fractional render positions (frame sounds)', () => {
    expect(areaAttenuation([12.5, 10.5], [10.5, 10.5], 15)).toBeCloseTo(14 / 15)
  })
})

describe('AudioEngine', () => {
  it('builds source -> voice gain -> sfx/area bus -> master -> destination, lazily', () => {
    const { ctx, engine, created } = setup()
    engine.setMasterVolume(0.1)
    engine.setSfxVolume(0.2)
    engine.setAreaVolume(0.3)
    expect(created()).toBe(0)
    engine.play(1, { channel: 'area', volume: 0.5 })
    engine.play(2)
    expect(created()).toBe(1)
    const { master, sfx, area } = ctx.buses
    expect(master.connections).toEqual([ctx.destination])
    expect(sfx.connections).toEqual([master])
    expect(area.connections).toEqual([master])
    expect([master.gain.value, sfx.gain.value, area.gain.value]).toEqual([0.1, 0.2, 0.3])
    const [a, s] = ctx.sources
    expect(a!.voiceGain!.gain.value).toBe(0.5)
    expect(a!.voiceGain!.connections).toEqual([area])
    expect(s!.voiceGain!.gain.value).toBe(1)
    expect(s!.voiceGain!.connections).toEqual([sfx])
    // Mono 22050 Hz buffers.
    expect(a!.buffer!.numberOfChannels).toBe(1)
    expect(a!.buffer!.sampleRate).toBe(22050)
  })

  it('schedules delayMs from now and clamps the voice volume', () => {
    const { ctx, engine } = setup()
    ctx.currentTime = 5
    engine.play(1, { delayMs: 680, volume: 3 })
    engine.play(2, { delayMs: -50 })
    expect(ctx.sources[0]!.startedAt).toEqual({ when: 5.68, offset: 0 })
    expect(ctx.sources[0]!.voiceGain!.gain.value).toBe(1)
    expect(ctx.sources[1]!.startedAt).toEqual({ when: 5, offset: 0 })
  })

  it('32 voices, oldest (scheduled) voice stolen first, no de-duplication', () => {
    const { ctx, engine } = setup()
    for (let i = 0; i < MAX_VOICES; i++) engine.play(162, { delayMs: i === 0 ? 5000 : 0 })
    expect(engine.activeVoiceCount).toBe(32)
    expect(ctx.sources.every((s) => !s.stopped)).toBe(true)
    engine.play(163)
    expect(engine.activeVoiceCount).toBe(32)
    // The first voice had not even started (5 s delay) and is still the one evicted.
    expect(ctx.sources[0]!.stopped).toBe(true)
    expect(ctx.sources.slice(1).every((s) => !s.stopped)).toBe(true)
    engine.play(163)
    expect(ctx.sources[1]!.stopped).toBe(true)
    // A voice that ended frees its slot.
    ctx.sources[5]!.end()
    expect(engine.activeVoiceCount).toBe(31)
  })

  it('drops plays when muted, paused, focus-suspended or the id is missing', () => {
    const { ctx, engine } = setup({ missing: [99] })
    engine.play(99)
    expect(ctx.sources.length).toBe(0)
    engine.setSfxVolume(0)
    engine.play(1)
    engine.play(2, { channel: 'area' })
    expect(ctx.sources.length).toBe(1)
    engine.setAreaVolume(0)
    engine.play(2, { channel: 'area' })
    expect(ctx.sources.length).toBe(1)
    engine.setSfxVolume(1)
    engine.setAreaVolume(1)
    engine.setFocusSuspended(true)
    engine.play(1)
    expect(ctx.sources.length).toBe(1)
    engine.setFocusSuspended(false)
    engine.pausePlayback()
    engine.play(1)
    expect(ctx.sources.length).toBe(1)
    engine.resumePlayback()
    engine.setMasterVolume(0)
    engine.play(1)
    expect(ctx.sources.length).toBe(1)
  })

  it('master volume 0 stops every voice', () => {
    const { ctx, engine } = setup()
    engine.play(1)
    engine.play(2)
    engine.setMasterVolume(0)
    expect(ctx.sources.every((s) => s.stopped)).toBe(true)
    expect(engine.activeVoiceCount).toBe(0)
  })

  it('pause freezes voices (offset + remaining delay) and resume restarts them', () => {
    const { ctx, engine } = setup({ length: 22050 }) // 1 s buffers
    ctx.currentTime = 0
    engine.play(1) // started at 0
    engine.play(2, { delayMs: 1000 }) // starts at 1.0
    ctx.currentTime = 0.4
    engine.pausePlayback()
    expect(ctx.sources.slice(0, 2).every((s) => s.stopped)).toBe(true)
    expect(engine.activeVoiceCount).toBe(0)
    ctx.currentTime = 2
    engine.resumePlayback()
    const [a, b] = ctx.sources.slice(2)
    expect(a!.startedAt!.when).toBeCloseTo(2)
    expect(a!.startedAt!.offset).toBeCloseTo(0.4)
    expect(b!.startedAt!.when).toBeCloseTo(2.6)
    expect(b!.startedAt!.offset).toBe(0)
    // A voice that had already finished is not resumed.
    ctx.currentTime = 10
    engine.pausePlayback()
    engine.resumePlayback()
    expect(ctx.sources.length).toBe(4)
  })

  it('mute when unfocused: master gain 0 and everything stopped for good', () => {
    const { ctx, engine } = setup()
    engine.setMasterVolume(0.1)
    engine.play(1)
    engine.pausePlayback()
    engine.setFocusSuspended(true)
    expect(ctx.buses.master.gain.value).toBe(0)
    engine.setFocusSuspended(false)
    expect(ctx.buses.master.gain.value).toBe(0.1)
    engine.resumePlayback() // nothing saved any more
    expect(ctx.sources.length).toBe(1)
    engine.play(2)
    expect(ctx.sources.length).toBe(2)
  })

  it('resume() creates the context and resumes it when suspended', async () => {
    const { ctx, engine } = setup()
    ctx.state = 'suspended'
    await engine.resume()
    expect(ctx.resumeCalls).toBe(1)
    await engine.resume()
    expect(ctx.resumeCalls).toBe(1)
  })

  it('records the play history for the Sound Debug overlay', () => {
    const { engine } = setup()
    const seen: number[] = []
    engine.onSoundPlayed((r) => seen.push(r.soundId))
    engine.play(159, {}, 'event:zuk_jad_cue')
    engine.play(162)
    expect(seen).toEqual([159])
    expect(engine.getRecentSoundEvents(10).map((r) => [r.soundId, r.trigger])).toEqual([[159, 'event:zuk_jad_cue']])
  })
})
