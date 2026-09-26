import { createAudioSystem, type AudioSystem } from '../audio'
import type { CacheSystem } from '../cache/CacheSystem'
import { createTripleJadEngine } from '../sim/createEngine'
import type { SimEngine } from '../sim/api'
import { loadStartConfig, type EncounterStartConfig } from '../ui/menu/encounter'
import { createRuntime, type RuntimeHandle } from './runtime/Runtime'

/**
 * One live triple-Jad session: the engine, the real-time runtime around it and
 * the audio system listening to it. Created once the cache has loaded.
 */
export interface Session {
  readonly cache: CacheSystem
  readonly engine: SimEngine
  readonly runtime: RuntimeHandle
  readonly audio: AudioSystem
  /** Apply a new loadout / stats / mechanics (Configure dialog "Start Encounter") and restart. */
  startRun(config: EncounterStartConfig): void
  dispose(): void
}

export function createSession(cache: CacheSystem, config: EncounterStartConfig = loadStartConfig()): Session {
  let current = config
  const engine = createTripleJadEngine({
    cache,
    loadout: current.loadout,
    baseLevels: current.baseLevels,
    mechanics: current.mechanics,
  })
  const runtime = createRuntime({ engine, cache })
  const audio = createAudioSystem(cache)
  const detachAudio = audio.attach(runtime)
  runtime.start()

  return {
    cache,
    engine,
    runtime,
    audio,
    startRun(next) {
      current = next
      engine.setPlayerStats(current.baseLevels)
      engine.setMechanicsConfig(current.mechanics)
      engine.setLoadout(current.loadout)
      runtime.restart()
    },
    dispose() {
      detachAudio()
      runtime.stop()
    },
  }
}
