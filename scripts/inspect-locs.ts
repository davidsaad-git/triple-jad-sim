/**
 * Smoke test for the loc model layer: build the Inferno region (9043) with
 * loc models, flatten plane 0 into a mesh and print statistics.
 *   npx tsx scripts/inspect-locs.ts [public/osrs-cache/disk.zip] [--region 9043] [--level 0]
 */
import { readFileSync } from 'node:fs'
import { CacheSystem } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { LocTypeLoader, OverlayFloorTypeLoader, UnderlayFloorTypeLoader } from '../src/cache/config'
import { RegionLoader, regionCoords } from '../src/cache/map'
import type { Model } from '../src/cache/model/Model'
import { ModelLoader } from '../src/cache/model/ModelLoader'
import { TextureLoader } from '../src/cache/texture/TextureLoader'
import { LocModelLoader, LocModelType, SceneBuilder, buildLocMesh, type FloorTypeProvider } from '../src/scene'

const args = process.argv.slice(2)
function flag(name: string, fallback: string): string {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1]! : fallback
}
const path = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]!.startsWith('--'))) ?? 'public/osrs-cache/disk.zip'
const regionIdArg = Number(flag('--region', '9043'))
const level = Number(flag('--level', '0'))

const t0 = performance.now()
const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync(path))))
console.log(`opened ${path} in ${(performance.now() - t0).toFixed(0)} ms`)

const { regionX, regionY } = regionCoords(regionIdArg)
const regions = new RegionLoader(cache)
const locTypes = new LocTypeLoader(cache)
const underlayTypes = new UnderlayFloorTypeLoader(cache)
const overlayTypes = new OverlayFloorTypeLoader(cache)
const textures = TextureLoader.load(cache)
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

const locModels = new LocModelLoader(locTypes, new ModelLoader(cache))
const t1 = performance.now()
const builder = new SceneBuilder<Model>(regions, {
  floorTypes,
  locTypes,
  modelHook: locModels.hook(),
  modelXzRadius: (m) => locModels.xzRadius(m),
  textureAverageHsl: (id) => (textures.has(id) ? textures.getAverageHsl(id) : undefined),
})
const scene = builder.buildRegion(regionX, regionY)
console.log(
  `region ${regionIdArg} (${regionX}, ${regionY}): scene ${scene.sizeX}x${scene.sizeY} built in ${(performance.now() - t1).toFixed(0)} ms; ${scene.locs.length} loc placements, ${locModels.cachedModelCount} distinct (id, type, rotation) models resolved`,
)

// ---- placements by type -----------------------------------------------------------------------
const typeNames = Object.fromEntries(Object.entries(LocModelType).map(([k, v]) => [v, k]))
const byType = new Map<number, { placements: number; withModel: number }>()
const perLevel = [0, 0, 0, 0]
for (const loc of scene.locs) {
  perLevel[loc.level]!++
  if (loc.level !== level) continue
  const e = byType.get(loc.type) ?? { placements: 0, withModel: 0 }
  e.placements++
  if (loc.model || loc.secondaryModel) e.withModel++
  byType.set(loc.type, e)
}
console.log(`placements per level: ${perLevel.join(', ')}`)
console.log(`plane ${level} placements by type:`)
for (const [type, e] of [...byType.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${String(type).padStart(2)} ${typeNames[type]!.padEnd(34)} ${String(e.placements).padStart(5)}  with model ${e.withModel}`)
}
const noModel = scene.locs.filter((l) => l.level === level && !l.model && !l.secondaryModel)
if (noModel.length > 0) {
  const ids = [...new Set(noModel.map((l) => l.id))].slice(0, 10)
  console.log(
    `  ${noModel.length} placements without a model, e.g. ${ids.map((id) => `${id} "${locTypes.load(id).name}"`).join(', ')}`,
  )
}

// ---- mesh -------------------------------------------------------------------------------------
const t2 = performance.now()
const result = buildLocMesh(scene, level, { isTextureTransparent: (id) => textures.isTransparent(id) }, locModels)
const { mesh, stats, bounds } = result
console.log(
  `plane ${level} loc mesh built in ${(performance.now() - t2).toFixed(0)} ms: ${stats.drawn}/${stats.placements} placements drawn, ${stats.models} distinct models, ${stats.triangles} triangles (${stats.alphaTriangles} translucent, ${stats.texturedTriangles} textured), ${mesh.vertexCount} vertices, alpha starts at vertex ${result.alphaStart}, texcoords ${mesh.texcoords ? 'yes' : 'no'}`,
)
const texturedPlacements = bounds.filter((b) => b.textured).length
const contoured = bounds.filter((b) => b.contoured).length
console.log(`  placements with textured faces: ${texturedPlacements}; contoured to ground: ${contoured}`)

if (mesh.vertexCount > 0) {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const b of bounds) {
    if (b.minX < minX) minX = b.minX
    if (b.minY < minY) minY = b.minY
    if (b.minZ < minZ) minZ = b.minZ
    if (b.maxX > maxX) maxX = b.maxX
    if (b.maxY > maxY) maxY = b.maxY
    if (b.maxZ > maxZ) maxZ = b.maxZ
  }
  console.log(`  mesh bounds (render space, y up): x ${minX}..${maxX}, y ${minY}..${maxY}, z ${minZ}..${maxZ}`)
  // Sanity check against the terrain: every placement's base should sit at (or near) its tile height.
  let maxBaseGap = 0
  for (const b of bounds) {
    const gap = Math.abs(b.minY - -b.loc.height)
    if (gap > maxBaseGap) maxBaseGap = gap
  }
  console.log(`  largest gap between a placement's lowest vertex and its tile height: ${maxBaseGap.toFixed(0)} units`)

  const textureIds = new Set<number>()
  if (mesh.texcoords) {
    for (let v = 0; v < mesh.vertexCount; v++) {
      const id = mesh.texcoords[v * 3 + 2]!
      if (id !== -1) textureIds.add(id)
    }
  }
  console.log(`  texture ids used: [${[...textureIds].sort((a, b) => a - b).join(', ')}]`)
}

// ---- largest models ---------------------------------------------------------------------------
const largest = new Map<string, { id: number; type: number; rotation: number; triangles: number; count: number }>()
for (const b of bounds) {
  const key = `${b.loc.id}:${b.loc.type}:${b.loc.modelRotation}`
  const e = largest.get(key)
  if (e) {
    e.count++
  } else {
    largest.set(key, { id: b.loc.id, type: b.loc.type, rotation: b.loc.modelRotation, triangles: b.triangles, count: 1 })
  }
}
console.log('5 largest loc models by triangle count:')
for (const e of [...largest.values()].sort((a, b) => b.triangles - a.triangles).slice(0, 5)) {
  const t = locTypes.load(e.id)
  console.log(
    `  loc ${e.id} "${t.name}" type ${e.type} (${typeNames[e.type]}) rot ${e.rotation}: ${e.triangles} triangles, ${e.count} placement(s), size ${t.sizeX}x${t.sizeY}, models [${t.models.map((m) => m.join('+')).join(', ')}], contour ${t.contourGroundType}/${t.contourGroundParam}`,
  )
}

console.log(`done in ${(performance.now() - t0).toFixed(0)} ms`)
