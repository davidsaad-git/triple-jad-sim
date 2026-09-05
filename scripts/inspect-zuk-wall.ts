import { readFileSync } from 'node:fs'
import { CacheSystem } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { Arena } from '../src/app/Arena'
import { LocTypeLoader } from '../src/cache/config'
const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync('public/osrs-cache/disk.zip'))))
const arena = new Arena(cache)
const locTypes = new LocTypeLoader(cache)
const border = arena.scene.borderSize
const rows = new Map<string, number>()
for (const loc of arena.scene.locs) {
  const rx = loc.x - border
  const ry = loc.y - border
  if (loc.level !== 0 || rx < 24 || rx > 38 || ry < 47 || ry > 53) continue
  const t = locTypes.load(loc.id)
  const key = `${loc.id} "${t.name}" type ${loc.type} size ${t.sizeX}x${t.sizeY} at ${rx},${ry}`
  rows.set(key, (rows.get(key) ?? 0) + 1)
}
for (const [k, n] of [...rows.entries()].sort()) console.log(`${n}x ${k}`)
