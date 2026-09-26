/**
 * Audio: scim.gg's sound engine, event rules and cache frame sounds.
 * Entry point: `createAudioSystem(cache)`.
 */
export { createAudioSystem, FRAME_PRELOAD_SOUND_IDS, PRIORITY_SOUND_IDS } from './AudioSystem'
export type { AudioSystem, AudioSystemOptions, PlayOptions } from './AudioSystem'
export { AudioEngine, MAX_VOICES } from './AudioEngine'
export type { AudioContextFactory, SoundPlayRecord, SoundSource } from './AudioEngine'
export { CYCLE_MS, EventAudioPlayer } from './EventAudioPlayer'
export type { EnginePlayOptions, EventSoundSink, ResolvedPlay } from './EventAudioPlayer'
export { FrameSoundTracker } from './FrameSoundTracker'
export type { FrameSoundEntry, FrameSoundSeq, FrameSoundSeqLookup, FrameSoundSink } from './FrameSoundTracker'
export { areaAttenuation, DEFAULT_AREA_RANGE } from './attenuation'
export { CacheSoundBank } from './SoundBank'
export { SOUND_NAMES, soundName } from './soundNames'
export { INFERNO_LAYER, INFERNO_SOUNDS } from './rules/inferno'
export { createCoreLayer, equipSoundKind, resolvePlayerAttackSound } from './rules/core'
export type { RuleLayer, SoundChannel, SoundEntry, SoundSpec } from './rules/types'

import { createCoreLayer } from './rules/core'
import { INFERNO_LAYER } from './rules/inferno'
import { collectLayerSoundIds } from './rules/types'
import { FRAME_PRELOAD_SOUND_IDS } from './AudioSystem'

/** Every sound id the rule layers (plus preloaded frame sounds) can play, sorted (e.g. for cache trimming). */
export function allAudioSoundIds(): number[] {
  return [...new Set([...collectLayerSoundIds([INFERNO_LAYER, createCoreLayer()]), ...FRAME_PRELOAD_SOUND_IDS])].sort((a, b) => a - b)
}
