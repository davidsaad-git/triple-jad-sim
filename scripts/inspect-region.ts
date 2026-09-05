/**
 * Smoke test for the map / scene layer: decode the Inferno region (9043),
 * build the scene, print statistics, write PPM previews and run collision,
 * pathfinding and line-of-sight queries.
 *   npx tsx scripts/inspect-region.ts [public/osrs-cache/disk.zip] [--region 9043] [--out DIR]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CacheSystem } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { LocTypeLoader, OverlayFloorTypeLoader, UnderlayFloorTypeLoader } from '../src/cache/config'
import { REGION_SIZE, RegionLoader, regionCoords, tileIndex } from '../src/cache/map'
import { TextureLoader } from '../src/cache/texture/TextureLoader'
import {
  CollisionFlag,
  LocModelType,
  SceneBuilder,
  SceneCollision,
  buildTerrainMeshWithStats,
  type FloorTypeProvider,
} from '../src/scene'

const args = process.argv.slice(2)
function flag(name: string, fallback: string): string {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1]! : fallback
}
const path = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]!.startsWith('--'))) ?? 'public/osrs-cache/disk.zip'
const regionIdArg = Number(flag('--region', '9043'))
const outDir = flag(
  '--out',
  'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-Desktop-zuk/f215424a-b315-4fcf-b6ff-b28606f3c2ae/scratchpad',
)

const t0 = performance.now()
const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync(path))))
console.log(`opened ${path} in ${(performance.now() - t0).toFixed(0)} ms`)

const { regionX, regionY } = regionCoords(regionIdArg)
const regions = new RegionLoader(cache)
console.log(`region ${regionIdArg} = (${regionX}, ${regionY}); exists: ${regions.hasRegion(regionX, regionY)}`)
for (const [dx, dy] of [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const) {
  console.log(`  neighbour (${regionX + dx}, ${regionY + dy}) exists: ${regions.hasRegion(regionX + dx, regionY + dy)}`)
}

// ---- raw terrain / loc statistics -------------------------------------------------------------
const terrain = regions.getTerrain(regionX, regionY)
if (!terrain) throw new Error('no terrain')
for (let plane = 0; plane < 4; plane++) {
  let nonEmpty = 0
  let minH = Infinity
  let maxH = -Infinity
  const overlays = new Set<number>()
  const underlays = new Set<number>()
  let blocked = 0
  for (let x = 0; x < REGION_SIZE; x++) {
    for (let y = 0; y < REGION_SIZE; y++) {
      const i = tileIndex(x, y)
      const u = terrain.underlayIds[plane]![i]!
      const o = terrain.overlayIds[plane]![i]!
      if (u !== 0 || o !== 0) nonEmpty++
      if (u !== 0) underlays.add(u - 1)
      if (o !== 0) overlays.add(o - 1)
      const h = terrain.heights[plane]![i]!
      if (h < minH) minH = h
      if (h > maxH) maxH = h
      if (terrain.settings[plane]![i]! & 1) blocked++
    }
  }
  const fmt = (s: Set<number>): string => [...s].sort((a, b) => a - b).join(',')
  console.log(
    `plane ${plane}: non-empty ${nonEmpty}/4096, height ${minH}..${maxH}, blocked-by-floor ${blocked}, underlays [${fmt(underlays)}], overlays [${fmt(overlays)}]`,
  )
}

const locs = regions.getLocs(regionX, regionY)
const locTypes = new LocTypeLoader(cache)
const underlayTypes = new UnderlayFloorTypeLoader(cache)
const overlayTypes = new OverlayFloorTypeLoader(cache)
const typeNames = Object.fromEntries(Object.entries(LocModelType).map(([k, v]) => [v, k]))
const counts = new Map<number, { n: number; shapes: Set<number> }>()
for (const loc of locs) {
  const e = counts.get(loc.id) ?? { n: 0, shapes: new Set<number>() }
  e.n++
  e.shapes.add(loc.type)
  counts.set(loc.id, e)
}
console.log(`locs: ${locs.length} placements, ${counts.size} distinct ids`)
const byPlane = [0, 0, 0, 0]
for (const loc of locs) byPlane[loc.plane]!++
console.log(`  per plane: ${byPlane.join(', ')}`)
const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10)
for (const [id, e] of top) {
  const t = locTypes.load(id)
  const shapes = [...e.shapes].map((s) => `${s}:${typeNames[s]}`).join(' ')
  console.log(
    `  loc ${id} x${e.n} "${t.name}" size ${t.sizeX}x${t.sizeY} clip ${t.clipType} proj ${t.blocksProjectile} shapes [${shapes}]`,
  )
}

// ---- scene ------------------------------------------------------------------------------------
const floorTypes: FloorTypeProvider = {
  underlay: (id) => {
    const u = underlayTypes.load(id)
    return { id, rgb: u.rgbColor }
  },
  overlay: (id) => {
    const o = overlayTypes.load(id)
    return { id, rgb: o.primaryRgb, textureId: o.textureId, hideUnderlay: o.hideUnderlay, secondaryRgb: o.secondaryRgb }
  },
}
const textures = TextureLoader.load(cache)
const t1 = performance.now()
const builder = new SceneBuilder(regions, {
  floorTypes,
  locTypes,
  textureAverageHsl: (id) => (textures.has(id) ? textures.getAverageHsl(id) : undefined),
})
const scene = builder.buildRegion(regionX, regionY)
const border = scene.borderSize
console.log(
  `scene ${scene.sizeX}x${scene.sizeY} (border ${border}) base (${scene.baseX}, ${scene.baseY}) built in ${(performance.now() - t1).toFixed(0)} ms; ${scene.locs.length} locs placed`,
)
const kinds = new Map<string, number>()
for (const loc of scene.locs) kinds.set(loc.kind, (kinds.get(loc.kind) ?? 0) + 1)
console.log(`  by kind: ${[...kinds.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`)
const sample = scene.locs.find((l) => l.kind === 'loc' && l.sizeX > 1) ?? scene.locs[0]
if (sample) {
  console.log(
    `  sample loc ${sample.id} type ${sample.type} rot ${sample.rotation} at scene (${sample.x},${sample.y}) world (${sample.worldX},${sample.worldY}) size ${sample.sizeX}x${sample.sizeY} center (${sample.centerX}, ${sample.height}, ${sample.centerZ})`,
  )
}

for (let plane = 0; plane < 4; plane++) {
  let tiles = 0
  for (let x = 0; x < scene.sizeX; x++) for (let y = 0; y < scene.sizeY; y++) if (scene.getTile(plane, x, y)?.tileModel) tiles++
  const { mesh, stats } = buildTerrainMeshWithStats(scene, plane)
  console.log(
    `plane ${plane}: ${tiles} tile models; region mesh ${stats.triangles} triangles (${stats.texturedTriangles} textured), ${mesh.vertexCount} vertices, texcoords ${mesh.texcoords ? 'yes' : 'no'}`,
  )
  if (plane === 0 && mesh.vertexCount > 0) {
    let minY = Infinity
    let maxY = -Infinity
    let minX = Infinity
    let maxX = -Infinity
    for (let v = 0; v < mesh.vertexCount; v++) {
      const px = mesh.positions[v * 3]!
      const py = mesh.positions[v * 3 + 1]!
      if (py < minY) minY = py
      if (py > maxY) maxY = py
      if (px < minX) minX = px
      if (px > maxX) maxX = px
    }
    console.log(`  plane 0 mesh bounds x ${minX}..${maxX}, y ${minY}..${maxY}`)
  }
}

// ---- PPM previews -----------------------------------------------------------------------------
mkdirSync(outDir, { recursive: true })
const SIZE = 512
const SCALE = SIZE / REGION_SIZE

function writePpm(name: string, pixel: (rx: number, ry: number) => number): void {
  const buf = Buffer.alloc(SIZE * SIZE * 3)
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      // Image rows go top-down; region y grows northwards.
      const rx = Math.floor(px / SCALE)
      const ry = REGION_SIZE - 1 - Math.floor(py / SCALE)
      const rgb = pixel(rx, ry)
      const o = (py * SIZE + px) * 3
      buf[o] = (rgb >> 16) & 0xff
      buf[o + 1] = (rgb >> 8) & 0xff
      buf[o + 2] = rgb & 0xff
    }
  }
  const file = join(outDir, name)
  writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${SIZE} ${SIZE}\n255\n`), buf]))
  console.log(`wrote ${file}`)
}

writePpm('region-plane0-colors.ppm', (rx, ry) => {
  const tile = scene.getTile(0, rx + border, ry + border)
  const model = tile?.tileModel
  if (!model) return 0x000000
  // Prefer the overlay minimap colour where the tile has an overlay, else the underlay.
  if (model.shape !== 0 || model.overlayRgb !== 0) return model.overlayRgb !== 0 ? model.overlayRgb : model.underlayRgb
  return model.underlayRgb
})

const collision0 = scene.collisionMaps[0]!
writePpm('region-plane0-collision.ppm', (rx, ry) => {
  const f = collision0.getFlag(rx + border, ry + border)
  if (f & CollisionFlag.FLOOR) return 0x2040c0
  if (f & CollisionFlag.OBJECT) return f & CollisionFlag.OBJECT_PROJECTILE_BLOCKER ? 0xc02020 : 0xe08040
  if (f & CollisionFlag.FLOOR_DECORATION) return 0x80c040
  if (f & 0xff) return 0xe0d020
  return 0xf0f0f0
})

// ---- pathfinding / line of sight ---------------------------------------------------------------
const query = new SceneCollision(collision0, { offsetX: border, offsetY: border })
let walkable = 0
for (let x = 0; x < REGION_SIZE; x++) for (let y = 0; y < REGION_SIZE; y++) if (query.canStand(x, y, 1)) walkable++
console.log(`plane 0: ${walkable} walkable region tiles`)

function describeFlags(x: number, y: number): string {
  const f = query.getFlag(x, y)
  return `0x${(f >>> 0).toString(16)}`
}

const pathQueries: [number, number, number, number][] = [
  [34, 43, 25, 35],
  [25, 35, 34, 43],
  [34, 43, 45, 20],
]
for (const [sx, sy, dx, dy] of pathQueries) {
  for (const size of [1, 3]) {
    const t = performance.now()
    const path = query.findPath(sx, sy, size, dx, dy)
    const end = path[path.length - 1]
    console.log(
      `path size ${size} (${sx},${sy}) [${describeFlags(sx, sy)}] -> (${dx},${dy}) [${describeFlags(dx, dy)}]: ${path.length} steps, end ${end ? `(${end.x},${end.y})` : 'none'}, ${(performance.now() - t).toFixed(1)} ms; canStand src ${query.canStand(sx, sy, size)} dst ${query.canStand(dx, dy, size)}`,
    )
  }
}

const losQueries: [number, number, number, number][] = [
  [34, 43, 25, 35],
  [34, 43, 45, 20],
  [20, 20, 40, 40],
  [10, 32, 55, 32],
  [32, 5, 32, 60],
  [0, 0, 63, 63],
]
for (const [ax, ay, bx, by] of losQueries) {
  console.log(`LOS (${ax},${ay}) -> (${bx},${by}): ${query.hasLineOfSight(ax, ay, bx, by)} / reverse ${query.hasLineOfSight(bx, by, ax, ay)}`)
}
console.log(`LOS 5x5 actor at (30,30) -> tile (10,45): ${query.hasLineOfSightActors(30, 30, 5, 10, 45, 1)}`)

console.log(`done in ${(performance.now() - t0).toFixed(0)} ms`)
