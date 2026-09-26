/**
 * Builds the triple-Jad arena scene from the cache (Node) and prints the
 * triangle / loc counts, texture usage and a few sample heights.
 *   npx tsx scripts/render-arena-stats.ts
 */
import { readFileSync } from 'node:fs'
import { CacheSystem } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { TextureLoader } from '../src/cache/texture/TextureLoader'
import { TRIPLE_JAD_ARENA } from '../src/render/arenaConfig'
import { ArenaSceneBuilder } from '../src/scene/arena/ArenaScene'

const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync('public/osrs-cache/disk.zip'))))
const textures = TextureLoader.load(cache)
const layerOf = new Map<number, number>()
textures.textureIds.forEach((id, i) => layerOf.set(id, i + 1))

for (const smooth of [false, true]) {
  const t0 = performance.now()
  const builder = new ArenaSceneBuilder(cache, TRIPLE_JAD_ARENA)
  const scene = builder.build({ smoothTerrain: smooth, textureLayer: (id) => layerOf.get(id) ?? -1 })
  const ms = performance.now() - t0
  console.log(`smoothTerrain=${smooth}: built in ${ms.toFixed(0)} ms`)
  console.log('  stats', scene.stats)
  for (const c of scene.terrainCommands) {
    const tex = new Set<number>()
    for (const t of c.textureIds ?? []) if (t > 0) tex.add(t)
    console.log(`  ${c.meshId}: ${c.positions.length / 9} tris, texture layers ${[...tex].join(',')}`)
  }
  for (const c of scene.staticLocCommands) console.log(`  ${c.meshId}: ${c.positions.length / 9} tris`)
  for (const a of scene.animatedLocs) console.log(`  animated ${a.key}: seq ${a.seq.id}, ${a.frames.length} frames`)
  if (!smooth) {
    const h = scene.terrainHeights
    console.log('  heights (31,33)', h[31]?.[33], '(24,36)', h[24]?.[36], '(0,0)', h[0]?.[0], '(63,63)', h[63]?.[63])
    const anim = new Map<number, [number, number]>()
    for (const id of textures.textureIds) {
      const uv = textures.getAnimationUv(id)
      if (uv[0] !== 0 || uv[1] !== 0) anim.set(id, uv)
    }
    const used = new Set<number>()
    for (const c of scene.terrainCommands) for (const t of c.textureIds ?? []) if (t > 0) used.add(textures.textureIds[t - 1]!)
    for (const c of scene.staticLocCommands) for (const t of c.textureIds ?? []) if (t > 0) used.add(textures.textureIds[t - 1]!)
    console.log('  textures used:', [...used].sort((a, b) => a - b).map((id) => `${id}${anim.has(id) ? ` anim${JSON.stringify(anim.get(id))}` : ''}`).join(' '))
    const filtered = scene.mapLocs.filter((l) => l.localX >= 17 && l.localX <= 45 && l.localY >= 17 && l.localY <= 45).length
    console.log(`  map locs inside the excluded region: ${filtered}; glyph 30338 present: ${scene.mapLocs.some((l) => l.id === 30338)}`)
  }
}
