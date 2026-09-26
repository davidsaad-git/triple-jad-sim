import { describe, expect, it } from 'vitest'
import { CacheSystem } from '../../cache/CacheSystem'
import { openDiskZip } from '../../cache/loadDiskZip'
import { TRIPLE_JAD_ARENA } from '../../render/arenaConfig'
import { ArenaSceneBuilder, expandedOffsets } from './ArenaScene'
import { filterLoc } from './locPlacement'

const CACHE = 'public/osrs-cache/disk.zip'

interface FsLike {
  existsSync(path: string): boolean
  readFileSync(path: string): Uint8Array
}

/** node:fs without Node typings (the app tsconfig has none). */
const fs = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.('node:fs') as FsLike | undefined
const existsSync = (p: string): boolean => fs?.existsSync(p) ?? false
const readFileSync = (p: string): Uint8Array => fs!.readFileSync(p)

describe('arena render filter', () => {
  it('keeps the static glyph loc (wave 68) but drops everything with an origin inside [17..45]^2', () => {
    const cfg = TRIPLE_JAD_ARENA.locRender
    expect(filterLoc({ id: 30338, localX: 30, localY: 51, level: 0, rotation: 3 }, cfg)).toEqual({ id: 30338, rotation: 3 })
    expect(filterLoc({ id: 14390, localX: 17, localY: 45, level: 0, rotation: 0 }, cfg)).toBeNull()
    expect(filterLoc({ id: 30333, localX: 27, localY: 52, level: 0, rotation: 3 }, cfg)).toEqual({ id: 30333, rotation: 3 })
    expect(filterLoc({ id: 1, localX: 5, localY: 5, level: 1, rotation: 0 }, cfg)).toBeNull()
    expect(expandedOffsets(TRIPLE_JAD_ARENA.mapSquareOffsets)).toHaveLength(21)
  })
})

describe.skipIf(!existsSync(CACHE))('arena scene from the cache', () => {
  it('builds level-0 terrain and batched locs for map square (35, 83)', () => {
    const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync(CACHE))))
    const scene = new ArenaSceneBuilder(cache, TRIPLE_JAD_ARENA).build({ smoothTerrain: false, textureLayer: () => -1 })
    // Only the centre square exists around the Inferno in this cache.
    expect(scene.terrainCommands).toHaveLength(1)
    expect(scene.stats.terrainTriangles).toBe(1740)
    expect(scene.stats.mapLocs).toBe(2850)
    expect(scene.stats.renderedLocs).toBe(2133)
    expect(scene.stats.staticLocTriangles).toBe(140818) // includes the static glyph loc (1652 triangles)
    expect(scene.staticLocCommands.map((c) => c.meshId)).toEqual(['merged-static-locs-opaque', 'merged-static-locs-transparent'])
    expect(scene.animatedLocs).toHaveLength(1)
    expect(scene.terrainHeights).toHaveLength(65)
    expect(scene.terrainHeights[31]![33]).toBe(-240)
  }, 60000)
})
