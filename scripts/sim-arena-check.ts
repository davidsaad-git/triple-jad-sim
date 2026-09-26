/**
 * Builds the triple-Jad arena from the cache and prints its bounds and a map
 * of the walkable set (dev aid for the SIM module).
 * Run: npx tsx scripts/sim-arena-check.ts
 */
import { readFileSync } from 'node:fs'
import { CacheSystem } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { tileKey } from '../src/sim/map/Arena'
import {
  buildArenaConfig,
  INFERNO_EXCLUDED_LOC_IDS,
  INFERNO_MAP_SQUARE,
  INFERNO_MAP_SQUARE_OFFSETS,
} from '../src/sim/map/buildArena'

const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync('public/osrs-cache/disk.zip'))))
for (const seed of [
  [31, 44],
  [31, 33],
] as const) {
  const t0 = performance.now()
  const cfg = buildArenaConfig(cache, {
    mapX: INFERNO_MAP_SQUARE.x,
    mapY: INFERNO_MAP_SQUARE.y,
    seedX: seed[0],
    seedY: seed[1],
    mapSquareOffsets: INFERNO_MAP_SQUARE_OFFSETS,
    excludedStaticLocIds: INFERNO_EXCLUDED_LOC_IDS,
  })
  console.log('seed', seed, 'bounds', cfg.bounds, 'tiles', cfg.walkableTiles?.size, 'ms', (performance.now() - t0).toFixed(0))
  if (seed[1] === 33 && cfg.bounds && cfg.walkableTiles) {
    const b = cfg.bounds
    for (let y = b.maxY + 1; y >= b.minY - 1; y--) {
      let row = String(y).padStart(3) + ' '
      for (let x = b.minX - 1; x <= b.maxX + 1; x++) {
        const w = cfg.walkableTiles.has(tileKey(x, y))
        const f = cfg.collisionMap?.getFlag(x, y) ?? 0
        row += w ? (f !== 0 ? '+' : '.') : '#'
      }
      console.log(row)
    }
  }
}
