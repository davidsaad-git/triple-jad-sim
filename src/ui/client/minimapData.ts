/**
 * Loads a map square's terrain and floor configs from the cache and
 * rasterises its minimap (plane 0), memoised per cache + square.
 */
import type { CacheSystem } from '../../cache/CacheSystem'
import { OverlayFloorTypeLoader } from '../../cache/config/OverlayFloorType'
import { UnderlayFloorTypeLoader } from '../../cache/config/UnderlayFloorType'
import { RegionLoader } from '../../cache/map/RegionLoader'
import { TextureLoader } from '../../cache/texture/TextureLoader'
import { packHsl, rasterizeMinimap, type UnderlayColor } from './minimapRaster'

const cache = new WeakMap<CacheSystem, Map<string, Uint32Array | null>>()

/** Packed HSL of an overlay for the minimap: texture average, hidden 0xFF00FF, else colour (or secondary). */
export function overlayMinimapHsl(
  o: { textureId: number; primaryRgb: number; hue: number; saturation: number; lightness: number; secondaryRgb: number; secondaryHue: number; secondarySaturation: number; secondaryLightness: number },
  textureAverage: ((id: number) => number | null) | null,
): number {
  let hsl: number
  if (o.textureId !== -1 && textureAverage) {
    const avg = textureAverage(o.textureId)
    if (avg !== null) hsl = avg
    else if (o.primaryRgb === 0xff00ff) return -1
    else hsl = packHsl(o.hue, o.saturation, o.lightness)
  } else if (o.textureId !== -1 && !textureAverage) return -1
  else if (o.primaryRgb === 0xff00ff) return -1
  else hsl = packHsl(o.hue, o.saturation, o.lightness)
  if (o.secondaryRgb !== -1) hsl = packHsl(o.secondaryHue, o.secondarySaturation, o.secondaryLightness)
  return hsl
}

/** ABGR raster (256x256, north up) of map square (mapX, mapY), or null when it is missing. */
export function minimapImageFor(system: CacheSystem, mapX: number, mapY: number): Uint32Array | null {
  let perCache = cache.get(system)
  if (!perCache) {
    perCache = new Map()
    cache.set(system, perCache)
  }
  const key = `${mapX},${mapY}`
  const hit = perCache.get(key)
  if (hit !== undefined) return hit
  let result: Uint32Array | null = null
  try {
    const terrain = new RegionLoader(system).getTerrain(mapX, mapY)
    if (terrain) {
      const underlays = new UnderlayFloorTypeLoader(system)
      const overlays = new OverlayFloorTypeLoader(system)
      let textures: TextureLoader | null = null
      try {
        textures = TextureLoader.load(system)
      } catch {
        textures = null
      }
      const uCache = new Map<number, UnderlayColor | null>()
      const oCache = new Map<number, number>()
      const underlay = (id: number): UnderlayColor | null => {
        let u = uCache.get(id)
        if (u === undefined) {
          try {
            const t = underlays.load(id)
            u = { hue: t.hue, saturation: t.saturation, lightness: t.lightness, hueMultiplier: t.hueMultiplier }
          } catch {
            u = null
          }
          uCache.set(id, u)
        }
        return u
      }
      const texAvg = textures ? (id: number): number | null => (textures!.has(id) ? textures!.getAverageHsl(id) : null) : null
      const overlay = (idPlusOne: number): number => {
        let v = oCache.get(idPlusOne)
        if (v === undefined) {
          try {
            v = overlayMinimapHsl(overlays.load(idPlusOne - 1), texAvg)
          } catch {
            v = -1
          }
          oCache.set(idPlusOne, v)
        }
        return v
      }
      result = rasterizeMinimap(
        {
          heights: terrain.heights[0]!,
          underlayIds: terrain.underlayIds[0]!,
          overlayIds: terrain.overlayIds[0]!,
          overlayShapes: terrain.overlayShapes[0]!,
          overlayRotations: terrain.overlayRotations[0]!,
        },
        underlay,
        overlay,
      )
    }
  } catch {
    result = null
  }
  perCache.set(key, result)
  return result
}
