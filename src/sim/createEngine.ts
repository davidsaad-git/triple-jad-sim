/**
 * Entry point: a headless triple-Jad engine on the real cache.
 */
import type { CacheSystem } from '../cache/CacheSystem'
import { ObjTypeLoader } from '../cache/config/ObjType'
import type { Loadout, MechanicsConfig, SkillName } from './api'
import { SimulationEngine } from './core/Engine'
import { PLAYER_START } from './encounters/tripleJad/constants'
import { TripleJadEncounter } from './encounters/tripleJad/TripleJadEncounter'
import type { ArenaConfig } from './map/Arena'
import { buildArenaConfig, INFERNO_EXCLUDED_LOC_IDS, INFERNO_MAP_SQUARE, INFERNO_MAP_SQUARE_OFFSETS } from './map/buildArena'

export interface CreateTripleJadEngineOptions {
  cache: CacheSystem
  loadout: Loadout
  baseLevels?: Record<SkillName, number>
  mechanics?: Partial<MechanicsConfig>
  combatSeed?: number
  encounterSeed?: number
}

const arenaCache = new WeakMap<CacheSystem, ArenaConfig>()

/** The cache-built arena for the triple-Jad wave (memoised per cache). */
export function tripleJadArenaConfig(cache: CacheSystem): ArenaConfig {
  const cached = arenaCache.get(cache)
  if (cached) return cached
  const cfg = buildArenaConfig(cache, {
    mapX: INFERNO_MAP_SQUARE.x,
    mapY: INFERNO_MAP_SQUARE.y,
    seedX: PLAYER_START[0],
    seedY: PLAYER_START[1],
    mapSquareOffsets: INFERNO_MAP_SQUARE_OFFSETS,
    excludedStaticLocIds: INFERNO_EXCLUDED_LOC_IDS,
  })
  arenaCache.set(cache, cfg)
  return cfg
}

const objLoaders = new WeakMap<CacheSystem, ObjTypeLoader>()

function objLoaderFor(cache: CacheSystem): ObjTypeLoader {
  let l = objLoaders.get(cache)
  if (!l) {
    l = new ObjTypeLoader(cache)
    objLoaders.set(cache, l)
  }
  return l
}

/**
 * Build the engine, apply the loadout and auto-prepot (scim does both when an
 * encounter is entered). `reset()` re-applies the same loadout.
 */
export function createTripleJadEngine(opts: CreateTripleJadEngineOptions): SimulationEngine {
  const encounter = new TripleJadEncounter(opts.encounterSeed)
  const engine = new SimulationEngine({
    encounter,
    objTypeLoader: objLoaderFor(opts.cache),
    arenaConfig: tripleJadArenaConfig(opts.cache),
    ...(opts.baseLevels ? { baseLevels: opts.baseLevels } : {}),
    ...(opts.mechanics ? { mechanics: opts.mechanics } : {}),
    ...(opts.combatSeed === undefined ? {} : { combatSeed: opts.combatSeed }),
  })
  engine.setLoadout(opts.loadout)
  engine.applyPrepotEffects()
  return engine
}

export type { SimulationEngine }
