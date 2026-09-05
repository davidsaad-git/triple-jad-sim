import type { CacheSystem } from '../cache/CacheSystem'
import { LocTypeLoader, OverlayFloorTypeLoader, UnderlayFloorTypeLoader } from '../cache/config'
import { RegionLoader, regionCoords } from '../cache/map'
import type { Model } from '../cache/model/Model'
import { ModelLoader } from '../cache/model/ModelLoader'
import { TextureLoader } from '../cache/texture/TextureLoader'
import { TILE_SIZE } from '../render/Camera'
import type { MeshData } from '../render/Mesh'
import type { HeightSampler } from '../render/pick'
import {
  LocModelLoader,
  SceneBuilder,
  SceneCollision,
  buildLocMesh,
  buildTerrainMesh,
  type FloorTypeProvider,
  type LocBounds,
  type Scene,
} from '../scene'

export const INFERNO_REGION_ID = 9043

/** Objects removed when the north wall collapses for TzKal-Zuk: wall pieces 30332/30333/30336/30337 and the static Ancestral Glyph 30338. */
export const ZUK_COLLAPSED_LOCS: ReadonlySet<number> = new Set([30332, 30333, 30336, 30337, 30338])

/**
 * Everything derived from one map region: the built scene, its terrain and
 * loc meshes in render units (region tile 0,0 at the origin, y up), the
 * collision / pathfinding adapter in region-local tile coordinates and a
 * height sampler.
 */
export class Arena {
  readonly regionId: number
  readonly scene: Scene<Model>
  readonly terrain: MeshData
  /** Static locs on plane 0: opaque faces first, then translucent ones (see `locsAlphaStart`). */
  readonly locs: MeshData
  readonly locsAlphaStart: number
  /** Loc mesh for wave 69: the collapsing wall pieces and the static glyph are gone. */
  readonly locsZuk: MeshData
  /** Render-space bounding box per drawn loc placement, for picking. */
  readonly locBounds: LocBounds[]
  readonly locModels: LocModelLoader
  readonly collision: SceneCollision
  readonly heights: HeightSampler
  readonly textures: TextureLoader

  constructor(cache: CacheSystem, regionId = INFERNO_REGION_ID) {
    this.regionId = regionId
    const { regionX, regionY } = regionCoords(regionId)
    const regions = new RegionLoader(cache)
    const underlays = new UnderlayFloorTypeLoader(cache)
    const overlays = new OverlayFloorTypeLoader(cache)
    const locTypes = new LocTypeLoader(cache)
    const floorTypes: FloorTypeProvider = {
      underlay: (id) => {
        const u = underlays.load(id)
        return { id, rgb: u.rgbColor }
      },
      overlay: (id) => {
        const o = overlays.load(id)
        return { id, rgb: o.primaryRgb, textureId: o.textureId, hideUnderlay: o.hideUnderlay, secondaryRgb: o.secondaryRgb }
      },
    }
    this.textures = TextureLoader.load(cache)
    this.locModels = new LocModelLoader(locTypes, new ModelLoader(cache))
    const builder = new SceneBuilder<Model>(regions, {
      floorTypes,
      locTypes,
      modelHook: this.locModels.hook(),
      modelXzRadius: (model) => this.locModels.xzRadius(model),
      textureAverageHsl: (id) => (this.textures.has(id) ? this.textures.getAverageHsl(id) : undefined),
    })
    const scene = builder.buildRegion(regionX, regionY)
    this.scene = scene
    const border = scene.borderSize
    this.terrain = buildTerrainMesh(scene, 0)
    const locMesh = buildLocMesh(scene, 0, { isTextureTransparent: (id) => this.textures.isTransparent(id) }, this.locModels)
    this.locs = locMesh.mesh
    this.locsAlphaStart = locMesh.alphaStart
    this.locBounds = locMesh.bounds
    this.locsZuk = buildLocMesh(
      scene,
      0,
      { isTextureTransparent: (id) => this.textures.isTransparent(id), exclude: (loc) => ZUK_COLLAPSED_LOCS.has(loc.id) },
      this.locModels,
    ).mesh
    this.collision = new SceneCollision(scene.collisionMaps[0]!, { offsetX: border, offsetY: border })
    this.heights = {
      heightAt: (x, z) => {
        const sx = x + border * TILE_SIZE
        const sz = z + border * TILE_SIZE
        if (sx < 0 || sz < 0 || sx >= scene.sizeX * TILE_SIZE || sz >= scene.sizeY * TILE_SIZE) return null
        return -scene.getHeightInterpolated(0, Math.floor(sx), Math.floor(sz))
      },
    }
  }
}
