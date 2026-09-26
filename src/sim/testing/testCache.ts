/**
 * Test helper: load the real cache (public/osrs-cache/disk.zip) once per
 * test file and build engines on it. Node only.
 */
import { CacheSystem } from '../../cache/CacheSystem'
import { openDiskZip } from '../../cache/loadDiskZip'
import type { Loadout, MechanicsConfig, SimEvent, SkillName, Tile } from '../api'
import { createTripleJadEngine } from '../createEngine'
import type { SimulationEngine } from '../core/Engine'
import { presetLoadout } from '../loadouts/presets'

let cache: CacheSystem | null = null

interface FsLike {
  readFileSync(path: string): Uint8Array
}

/** node:fs without depending on Node typings (the app tsconfig has none). */
function nodeFs(): FsLike {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
  const mod = proc?.getBuiltinModule?.('node:fs') as FsLike | undefined
  if (!mod) throw new Error('testCache needs Node >= 22.3 (process.getBuiltinModule)')
  return mod
}

export const CACHE_PATH = 'public/osrs-cache/disk.zip'

export function testCache(): CacheSystem {
  cache ??= new CacheSystem(openDiskZip(new Uint8Array(nodeFs().readFileSync(CACHE_PATH))))
  return cache
}

export function makeEngine(
  opts: {
    preset?: string
    loadout?: Loadout
    combatSeed?: number
    encounterSeed?: number
    mechanics?: Partial<MechanicsConfig>
    baseLevels?: Record<SkillName, number>
  } = {},
): SimulationEngine {
  return createTripleJadEngine({
    cache: testCache(),
    loadout: opts.loadout ?? presetLoadout(opts.preset ?? 'max_tbow'),
    combatSeed: opts.combatSeed ?? 1,
    encounterSeed: opts.encounterSeed ?? 1,
    ...(opts.mechanics ? { mechanics: opts.mechanics } : {}),
    ...(opts.baseLevels ? { baseLevels: opts.baseLevels } : {}),
  })
}

/** Advance `n` ticks with a fixed click target (default: stand still); returns all events. */
export function runTicks(engine: SimulationEngine, n: number, target?: Tile): SimEvent[] {
  const out: SimEvent[] = []
  for (let i = 0; i < n; i++) {
    engine.advanceTick(target ?? engine.getState().playerPosition)
    out.push(...engine.lastTickEvents)
  }
  return out
}

export function eventsOf<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)
}
