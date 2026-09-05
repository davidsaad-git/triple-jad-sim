/**
 * Smoke test for the cache layer against the local OpenRS2 mirror.
 *   npx tsx scripts/inspect-cache.ts [public/osrs-cache/disk.zip]
 */
import { readFileSync } from 'node:fs'
import { CacheSystem, ConfigArchive, IndexId } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'

const path = process.argv[2] ?? 'public/osrs-cache/disk.zip'
const t0 = performance.now()
const zip = new Uint8Array(readFileSync(path))
const store = openDiskZip(zip)
console.log(`opened ${path} in ${(performance.now() - t0).toFixed(0)} ms; indexes: ${store.indexIds.join(',')}`)

const cache = new CacheSystem(store)
for (const indexId of store.indexIds) {
  try {
    const index = cache.getIndex(indexId)
    const t = index.table
    const files = [...t.archives.values()].reduce((n, a) => n + a.fileIds.length, 0)
    console.log(
      `index ${indexId}: format ${t.format} version ${t.version} flags ${t.flags} archives ${t.archives.size} files ${files}`,
    )
  } catch (e) {
    console.log(`index ${indexId}: FAILED ${(e as Error).message}`)
  }
}

// Decode a few real archives across compression types.
const configs = cache.getIndex(IndexId.Configs)
const npcs = configs.getArchive(ConfigArchive.Npc)
console.log(`npc configs: ${npcs?.fileCount} files, last id ${npcs?.entry.fileCapacity}`)
const zuk = npcs?.getFile(7706)
console.log(`npc 7706 (TzKal-Zuk) raw bytes: ${zuk?.length}`)

const models = cache.getIndex(IndexId.Models)
const modelIds = models.archiveIds
console.log(`models: ${modelIds.length} archives, e.g. ${modelIds.slice(0, 5).join(',')}`)
const firstModel = models.getArchive(modelIds[0]!)
console.log(`model ${modelIds[0]}: ${firstModel?.getFile(0)?.length} bytes`)

// Since build 237 map groups are numeric ((x << 8) | y); file 0 = terrain, file 1 = locs, no XTEA.
const maps = cache.getIndex(IndexId.Maps)
const inferno = maps.getArchive((35 << 8) | 83)
console.log(
  `inferno region 9043: files ${inferno?.fileIds.join(',')}; terrain ${inferno?.getFile(0)?.length} bytes, locs ${inferno?.getFile(1)?.length} bytes`,
)

const sprites = cache.getIndex(IndexId.Sprites)
console.log(`sprites: ${sprites.archiveIds.length} archives`)
const textures = cache.getIndex(IndexId.Textures)
console.log(`textures archive 0 files: ${textures.getArchive(0)?.fileCount}`)
console.log(`done in ${(performance.now() - t0).toFixed(0)} ms`)
