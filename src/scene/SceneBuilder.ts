/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Builds a Scene from decoded map regions: copies terrain into the scene
 * grid (filling missing neighbour regions the way the client does), places
 * locs with their terrain-resolved heights and wires their collision, then
 * generates the terrain tile models with blended underlay colours, overlay
 * colours/textures and height-based lighting.
 *
 * Model loading is left to the model layer through `LocModelHook`; the scene
 * records what to draw where, and the hook decides what "what" is.
 */
import { REGION_SIZE, TileFlag, UNITS_LEVEL_HEIGHT, type RegionTerrain } from '../cache/map/TerrainDecoder'
import type { RegionLoc } from '../cache/map/LocDecoder'
import type { CollisionMap } from './CollisionMap'
import { HSL_RGB_MAP, adjustOverlayLight, adjustUnderlayLight, packHsl } from './ColorUtil'
import { FloorColorCache, type FloorTypeProvider } from './FloorTypes'
import { LocModelType, locKind } from './LocModelType'
import { Scene, TILE_SIZE } from './Scene'
import type { LocModelHook, SceneLoc } from './SceneTile'
import { SceneTileModel } from './SceneTileModel'

/** Where regions come from (RegionLoader satisfies this). */
export interface RegionSource {
  getTerrain(regionX: number, regionY: number): RegionTerrain | undefined
  getLocs(regionX: number, regionY: number): readonly RegionLoc[]
}

/**
 * What the scene needs from a loc config. `src/cache/config` LocType has
 * exactly these fields, so a LocTypeLoader can be passed straight in.
 */
export interface SceneLocType {
  readonly sizeX: number
  readonly sizeY: number
  /** Client "interactType": 0 = no clipping, 1 = blocks movement only (opcode 27), 2 = blocks all (default). */
  readonly clipType: number
  readonly blocksProjectile: boolean
  /** False when opcode 22 cleared it: the loc casts no light occlusion. Default true. */
  readonly clipped?: boolean
  /** Wall decoration displacement (opcode 24 / 70), default 16. */
  readonly decorDisplacement?: number
}

export interface LocTypeSource {
  load(id: number): SceneLocType
}

export const DEFAULT_DECOR_DISPLACEMENT = 16

/** Loc config used when no LocTypeSource is given: a 1x1 blocking loc (the client's defaults). */
const DEFAULT_LOC_TYPE: SceneLocType = {
  sizeX: 1,
  sizeY: 1,
  clipType: 2,
  blocksProjectile: true,
  clipped: true,
  decorDisplacement: DEFAULT_DECOR_DISPLACEMENT,
}

export interface SceneBuilderOptions<M> {
  floorTypes: FloorTypeProvider
  /** Loc configs for footprints / collision. Missing: every loc is treated as a 1x1 blocker. */
  locTypes?: LocTypeSource
  /** Model provider; missing: every `model` is null. */
  modelHook?: LocModelHook<M>
  /** Horizontal radius of a model in world units, used for loc light occlusion (default 60 -> occlusion 15). */
  modelXzRadius?: (model: M) => number
  /**
   * Average packed HSL of a texture, used for the minimap colour of textured
   * overlays. When it returns undefined (or is missing) the overlay is drawn
   * untextured with its primary colour instead.
   */
  textureAverageHsl?: (textureId: number) => number | undefined
  /** Blend underlay colours across tile corners (the client does not; default false). */
  smoothUnderlays?: boolean
}

/** Default border around the region so blending/lighting/collision see the neighbours. */
export const DEFAULT_BORDER_SIZE = 8
export const BLEND_RADIUS = 5

const DISPLACEMENT_X = [1, 0, -1, 0] as const
const DISPLACEMENT_Y = [0, -1, 0, 1] as const
const DIAGONAL_DISPLACEMENT_X = [1, -1, -1, 1] as const
const DIAGONAL_DISPLACEMENT_Y = [-1, -1, 1, 1] as const

/** Light occlusion for a loc whose model size is unknown. */
const DEFAULT_LOC_OCCLUSION = 15

export class SceneBuilder<M = unknown> {
  private readonly source: RegionSource
  private readonly floorColors: FloorColorCache
  private readonly locTypes: LocTypeSource | undefined
  private readonly modelHook: LocModelHook<M> | undefined
  private readonly modelXzRadius: ((model: M) => number) | undefined
  private readonly textureAverageHsl: ((textureId: number) => number | undefined) | undefined
  private readonly smoothUnderlays: boolean

  constructor(source: RegionSource, options: SceneBuilderOptions<M>) {
    this.source = source
    this.floorColors = new FloorColorCache(options.floorTypes)
    this.locTypes = options.locTypes
    this.modelHook = options.modelHook
    this.modelXzRadius = options.modelXzRadius
    this.textureAverageHsl = options.textureAverageHsl
    this.smoothUnderlays = options.smoothUnderlays ?? false
  }

  /** One region with `borderSize` tiles of its neighbours on every side. */
  buildRegion(regionX: number, regionY: number, borderSize = DEFAULT_BORDER_SIZE): Scene<M> {
    const size = REGION_SIZE + borderSize * 2
    return this.build(regionX * REGION_SIZE - borderSize, regionY * REGION_SIZE - borderSize, size, size, borderSize)
  }

  /** Arbitrary world rectangle (absolute tile coordinates). */
  build(baseX: number, baseY: number, sizeX: number, sizeY: number, borderSize = 0): Scene<M> {
    const scene = new Scene<M>(sizeX, sizeY, baseX, baseY, borderSize)

    const regionStartX = Math.floor(baseX / REGION_SIZE)
    const regionStartY = Math.floor(baseY / REGION_SIZE)
    const regionEndX = Math.ceil((baseX + sizeX) / REGION_SIZE)
    const regionEndY = Math.ceil((baseY + sizeY) / REGION_SIZE)

    const missing: [number, number][] = []
    for (let rx = regionStartX; rx < regionEndX; rx++) {
      for (let ry = regionStartY; ry < regionEndY; ry++) {
        const terrain = this.source.getTerrain(rx, ry)
        if (terrain) {
          this.copyTerrain(scene, terrain, rx * REGION_SIZE - baseX, ry * REGION_SIZE - baseY)
        } else {
          missing.push([rx, ry])
        }
      }
    }

    for (const [rx, ry] of missing) {
      const offsetX = rx * REGION_SIZE - baseX
      const offsetY = ry * REGION_SIZE - baseY
      const tileX = Math.max(offsetX, 0)
      const tileY = Math.max(offsetY, 0)
      const emptySizeX = (rx + 1) * REGION_SIZE - baseX - tileX
      const emptySizeY = (ry + 1) * REGION_SIZE - baseY - tileY
      for (let level = 0; level < scene.levels; level++) {
        this.fillEmptyTerrain(scene, level, tileX, tileY, emptySizeX, emptySizeY)
      }
    }

    this.applyFloorCollision(scene)

    for (let rx = regionStartX; rx < regionEndX; rx++) {
      for (let ry = regionStartY; ry < regionEndY; ry++) {
        const locs = this.source.getLocs(rx, ry)
        if (locs.length === 0) continue
        this.placeLocs(scene, locs, rx * REGION_SIZE - baseX, ry * REGION_SIZE - baseY)
      }
    }

    this.addTileModels(scene)
    scene.setTileMinLevels()
    this.linkBridges(scene)

    return scene
  }

  private copyTerrain(scene: Scene<M>, terrain: RegionTerrain, offsetX: number, offsetY: number): void {
    for (let level = 0; level < scene.levels; level++) {
      const heights = terrain.heights[level]!
      const overlays = terrain.overlayIds[level]!
      const shapes = terrain.overlayShapes[level]!
      const rotations = terrain.overlayRotations[level]!
      const underlays = terrain.underlayIds[level]!
      const settings = terrain.settings[level]!
      for (let x = 0; x < REGION_SIZE; x++) {
        const sceneX = x + offsetX
        if (sceneX < 0 || sceneX >= scene.sizeX) continue
        for (let y = 0; y < REGION_SIZE; y++) {
          const sceneY = y + offsetY
          if (sceneY < 0 || sceneY >= scene.sizeY) continue
          const src = x * REGION_SIZE + y
          const dst = scene.tileIndex(sceneX, sceneY)
          scene.heights[level]![scene.heightIndex(sceneX, sceneY)] = heights[src]!
          scene.overlayIds[level]![dst] = overlays[src]!
          scene.shapes[level]![dst] = shapes[src]!
          scene.rotations[level]![dst] = rotations[src]!
          scene.underlayIds[level]![dst] = underlays[src]!
          scene.renderFlags[level]![dst] = settings[src]!
        }
      }
    }
  }

  /** The client's fill for regions that do not exist: flat plane 0, stacked planes above, edges continued. */
  private fillEmptyTerrain(
    scene: Scene<M>,
    level: number,
    tileX: number,
    tileY: number,
    sizeX: number,
    sizeY: number,
  ): void {
    for (let ty = tileY; ty < tileY + sizeY; ty++) {
      for (let tx = tileX; tx < tileX + sizeX; tx++) {
        if (tx < 0 || tx >= scene.sizeX || ty < 0 || ty >= scene.sizeY) continue
        if (level === 0) {
          scene.setHeight(0, tx, ty, 0)
        } else {
          scene.setHeight(level, tx, ty, scene.getHeight(level - 1, tx, ty) - UNITS_LEVEL_HEIGHT)
        }
      }
    }
    if (tileX > 0 && scene.sizeX > tileX) {
      for (let ty = tileY + 1; ty < tileY + sizeY; ty++) {
        if (ty >= 0 && ty < scene.sizeY) {
          scene.setHeight(level, tileX, ty, scene.getHeight(level, tileX - 1, ty))
        }
      }
    }
    if (tileY > 0 && scene.sizeY > tileY) {
      for (let tx = tileX + 1; tx < tileX + sizeX; tx++) {
        if (tx >= 0 && tx < scene.sizeX) {
          scene.setHeight(level, tx, tileY, scene.getHeight(level, tx, tileY - 1))
        }
      }
    }
    if (tileX >= 0 && tileY >= 0 && tileX < scene.sizeX && tileY < scene.sizeY) {
      if (level !== 0) {
        if (tileX > 0 && scene.getHeight(level, tileX - 1, tileY) !== scene.getHeight(level - 1, tileX - 1, tileY)) {
          scene.setHeight(level, tileX, tileY, scene.getHeight(level, tileX - 1, tileY))
        } else if (
          tileY <= 0 ||
          scene.getHeight(level, tileX, tileY - 1) === scene.getHeight(level - 1, tileX, tileY - 1)
        ) {
          if (
            tileX > 0 &&
            tileY > 0 &&
            scene.getHeight(level, tileX - 1, tileY - 1) !== scene.getHeight(level - 1, tileX - 1, tileY - 1)
          ) {
            scene.setHeight(level, tileX, tileY, scene.getHeight(level, tileX - 1, tileY - 1))
          }
        } else {
          scene.setHeight(level, tileX, tileY, scene.getHeight(level, tileX, tileY - 1))
        }
      } else if (tileX > 0 && scene.getHeight(0, tileX - 1, tileY) !== 0) {
        scene.setHeight(0, tileX, tileY, scene.getHeight(0, tileX - 1, tileY))
      } else if (tileY > 0 && scene.getHeight(0, tileX, tileY - 1) !== 0) {
        scene.setHeight(0, tileX, tileY, scene.getHeight(0, tileX, tileY - 1))
      } else if (tileX > 0 && tileY > 0 && scene.getHeight(0, tileX - 1, tileY - 1) !== 0) {
        scene.setHeight(0, tileX, tileY, scene.getHeight(0, tileX - 1, tileY - 1))
      }
    }
  }

  /** Tiles whose settings say "blocked" get the FLOOR flag (on the plane below when on a bridge). */
  private applyFloorCollision(scene: Scene<M>): void {
    for (let level = 0; level < scene.levels; level++) {
      for (let x = 0; x < scene.sizeX; x++) {
        for (let y = 0; y < scene.sizeY; y++) {
          if ((scene.getRenderFlags(level, x, y) & TileFlag.Blocked) === 0) continue
          let realLevel = level
          if ((scene.getRenderFlags(1, x, y) & TileFlag.Bridge) !== 0) realLevel = level - 1
          if (realLevel >= 0) scene.collisionMaps[realLevel]!.setBlockedByFloor(x, y)
        }
      }
    }
  }

  private placeLocs(scene: Scene<M>, locs: readonly RegionLoc[], offsetX: number, offsetY: number): void {
    for (const loc of locs) {
      const sceneX = loc.x + offsetX
      const sceneY = loc.y + offsetY
      // Like the client, the outermost ring of the scene never receives locs.
      if (sceneX <= 0 || sceneY <= 0 || sceneX >= scene.sizeX - 1 || sceneY >= scene.sizeY - 1) continue

      let collisionLevel = loc.plane
      if ((scene.getRenderFlags(1, sceneX, sceneY) & TileFlag.Bridge) !== 0) collisionLevel = loc.plane - 1
      const collision = collisionLevel >= 0 ? scene.collisionMaps[collisionLevel] : undefined

      this.addLoc(scene, loc.plane, sceneX, sceneY, loc.id, loc.type, loc.rotation, collision)
    }
  }

  private addLoc(
    scene: Scene<M>,
    level: number,
    tileX: number,
    tileY: number,
    id: number,
    type: number,
    rotation: number,
    collision: CollisionMap | undefined,
  ): void {
    const locType = this.locTypes?.load(id) ?? DEFAULT_LOC_TYPE
    const clipped = locType.clipped ?? true
    const decorDisplacement = locType.decorDisplacement ?? DEFAULT_DECOR_DISPLACEMENT
    const breakRouteFinding = locType.clipType === 1

    let sizeX = locType.sizeX
    let sizeY = locType.sizeY
    if (rotation === 1 || rotation === 3) {
      sizeX = locType.sizeY
      sizeY = locType.sizeX
    }

    // OSRS centres the loc height on the footprint.
    let startX: number
    let endX: number
    if (tileX + sizeX <= scene.sizeX) {
      startX = (sizeX >> 1) + tileX
      endX = ((sizeX + 1) >> 1) + tileX
    } else {
      startX = tileX
      endX = tileX + 1
    }
    let startY: number
    let endY: number
    if (tileY + sizeY <= scene.sizeY) {
      startY = (sizeY >> 1) + tileY
      endY = tileY + ((sizeY + 1) >> 1)
    } else {
      startY = tileY
      endY = tileY + 1
    }

    const centerHeight =
      (scene.getHeight(level, endX, endY) +
        scene.getHeight(level, startX, endY) +
        scene.getHeight(level, startX, startY) +
        scene.getHeight(level, endX, startY)) >>
      2

    const make = (
      modelType: number,
      modelRotation: number,
      secondaryModelRotation: number,
      footX: number,
      footY: number,
      centerX: number,
      centerZ: number,
      offsetX = 0,
      offsetZ = 0,
    ): SceneLoc<M> => ({
      id,
      type,
      kind: locKind(type),
      rotation,
      modelRotation,
      secondaryModelRotation,
      storedLevel: level,
      level,
      x: tileX,
      y: tileY,
      worldX: scene.toWorldX(tileX),
      worldY: scene.toWorldY(tileY),
      sizeX: footX,
      sizeY: footY,
      centerX,
      centerZ,
      height: centerHeight,
      offsetX,
      offsetZ,
      model: this.modelHook?.(id, modelType, modelRotation) ?? null,
      secondaryModel:
        secondaryModelRotation === -1 ? null : (this.modelHook?.(id, modelType, secondaryModelRotation) ?? null),
    })

    const tileCenterX = tileX * TILE_SIZE + TILE_SIZE / 2
    const tileCenterZ = tileY * TILE_SIZE + TILE_SIZE / 2

    if (type === LocModelType.FloorDecoration) {
      scene.setFloorDecoration(make(type, rotation, -1, 1, 1, tileCenterX, tileCenterZ))
      if (locType.clipType === 1 && collision) collision.setBlockedByFloorDec(tileX, tileY)
    } else if (type === LocModelType.Normal || type === LocModelType.NormalDiagonal) {
      const locRotation = type === LocModelType.Normal ? rotation : rotation + 4
      const loc = make(
        LocModelType.Normal,
        locRotation,
        -1,
        sizeX,
        sizeY,
        tileX * TILE_SIZE + (sizeX * TILE_SIZE) / 2,
        tileY * TILE_SIZE + (sizeY * TILE_SIZE) / 2,
      )
      const added = scene.addLoc(loc)
      if (added && clipped) {
        let occlusion = DEFAULT_LOC_OCCLUSION
        if (loc.model !== null && this.modelXzRadius) {
          occlusion = Math.min(30, (this.modelXzRadius(loc.model) / 4) | 0)
        }
        for (let sx = tileX; sx <= tileX + sizeX; sx++) {
          for (let sy = tileY; sy <= tileY + sizeY; sy++) {
            scene.raiseLightOcclusion(level, sx, sy, occlusion)
          }
        }
      }
      if (locType.clipType !== 0 && collision) {
        collision.addLoc(tileX, tileY, sizeX, sizeY, locType.blocksProjectile, breakRouteFinding)
      }
    } else if (type >= LocModelType.RoofSloped) {
      scene.addLoc(make(type, rotation, -1, 1, 1, tileCenterX, tileCenterZ))
    } else if (type === LocModelType.Wall) {
      scene.setWall(make(type, rotation, -1, 1, 1, tileCenterX, tileCenterZ))
      if (locType.clipType !== 0 && collision) {
        collision.addWall(tileX, tileY, type, rotation, locType.blocksProjectile, breakRouteFinding)
      }
      if (decorDisplacement !== DEFAULT_DECOR_DISPLACEMENT) {
        scene.updateWallDecorationDisplacement(level, tileX, tileY, decorDisplacement)
      }
      if (clipped) {
        if (rotation === 0) {
          scene.setLightOcclusion(level, tileX, tileY, 50)
          scene.setLightOcclusion(level, tileX, tileY + 1, 50)
        } else if (rotation === 1) {
          scene.setLightOcclusion(level, tileX, tileY + 1, 50)
          scene.setLightOcclusion(level, tileX + 1, tileY + 1, 50)
        } else if (rotation === 2) {
          scene.setLightOcclusion(level, tileX + 1, tileY, 50)
          scene.setLightOcclusion(level, tileX + 1, tileY + 1, 50)
        } else if (rotation === 3) {
          scene.setLightOcclusion(level, tileX, tileY, 50)
          scene.setLightOcclusion(level, tileX + 1, tileY, 50)
        }
      }
    } else if (type === LocModelType.WallTriCorner || type === LocModelType.WallRectCorner) {
      scene.setWall(make(type, rotation, -1, 1, 1, tileCenterX, tileCenterZ))
      if (locType.clipType !== 0 && collision) {
        collision.addWall(tileX, tileY, type, rotation, locType.blocksProjectile, breakRouteFinding)
      }
      if (clipped) {
        if (rotation === 0) scene.setLightOcclusion(level, tileX, tileY + 1, 50)
        else if (rotation === 1) scene.setLightOcclusion(level, tileX + 1, tileY + 1, 50)
        else if (rotation === 2) scene.setLightOcclusion(level, tileX + 1, tileY, 50)
        else if (rotation === 3) scene.setLightOcclusion(level, tileX, tileY, 50)
      }
    } else if (type === LocModelType.WallCorner) {
      scene.setWall(make(type, rotation + 4, (rotation + 1) & 3, 1, 1, tileCenterX, tileCenterZ))
      if (locType.clipType !== 0 && collision) {
        collision.addWall(tileX, tileY, type, rotation, locType.blocksProjectile, breakRouteFinding)
      }
      if (decorDisplacement !== DEFAULT_DECOR_DISPLACEMENT) {
        scene.updateWallDecorationDisplacement(level, tileX, tileY, decorDisplacement)
      }
    } else if (type === LocModelType.WallDiagonal) {
      scene.addLoc(make(type, rotation, -1, 1, 1, tileCenterX, tileCenterZ))
      if (locType.clipType !== 0 && collision) {
        collision.addLoc(tileX, tileY, sizeX, sizeY, locType.blocksProjectile, breakRouteFinding)
      }
      if (decorDisplacement !== DEFAULT_DECOR_DISPLACEMENT) {
        scene.updateWallDecorationDisplacement(level, tileX, tileY, decorDisplacement)
      }
    } else if (type === LocModelType.WallDecorationInside) {
      scene.setWallDecoration(make(LocModelType.WallDecorationInside, rotation, -1, 1, 1, tileCenterX, tileCenterZ))
      if (decorDisplacement !== DEFAULT_DECOR_DISPLACEMENT) {
        scene.updateWallDecorationDisplacement(level, tileX, tileY, decorDisplacement)
      }
    } else if (type === LocModelType.WallDecorationOutside) {
      const displacement = this.wallDisplacement(scene, level, tileX, tileY, DEFAULT_DECOR_DISPLACEMENT)
      scene.setWallDecoration(
        make(
          LocModelType.WallDecorationInside,
          rotation,
          -1,
          1,
          1,
          tileCenterX,
          tileCenterZ,
          displacement * DISPLACEMENT_X[rotation & 3]!,
          displacement * DISPLACEMENT_Y[rotation & 3]!,
        ),
      )
    } else if (type === LocModelType.WallDecorationDiagonalOutside) {
      const displacement = this.wallDisplacement(scene, level, tileX, tileY, DEFAULT_DECOR_DISPLACEMENT / 2, true)
      scene.setWallDecoration(
        make(
          LocModelType.WallDecorationInside,
          rotation + 4,
          -1,
          1,
          1,
          tileCenterX,
          tileCenterZ,
          displacement * DIAGONAL_DISPLACEMENT_X[rotation & 3]!,
          displacement * DIAGONAL_DISPLACEMENT_Y[rotation & 3]!,
        ),
      )
    } else if (type === LocModelType.WallDecorationDiagonalInside) {
      const insideRotation = (rotation + 2) & 3
      scene.setWallDecoration(
        make(LocModelType.WallDecorationInside, insideRotation + 4, -1, 1, 1, tileCenterX, tileCenterZ),
      )
    } else if (type === LocModelType.WallDecorationDiagonalDouble) {
      const displacement = this.wallDisplacement(scene, level, tileX, tileY, DEFAULT_DECOR_DISPLACEMENT / 2, true)
      const insideRotation = (rotation + 2) & 3
      scene.setWallDecoration(
        make(
          LocModelType.WallDecorationInside,
          rotation + 4,
          insideRotation + 4,
          1,
          1,
          tileCenterX,
          tileCenterZ,
          displacement * DIAGONAL_DISPLACEMENT_X[rotation & 3]!,
          displacement * DIAGONAL_DISPLACEMENT_Y[rotation & 3]!,
        ),
      )
    }
  }

  /** Displacement of the wall already on the tile (for "outside" wall decorations). */
  private wallDisplacement(
    scene: Scene<M>,
    level: number,
    x: number,
    y: number,
    fallback: number,
    halve = false,
  ): number {
    const wall = scene.getWall(level, x, y)
    if (!wall) return fallback
    const d = this.locTypes?.load(wall.id).decorDisplacement ?? DEFAULT_DECOR_DISPLACEMENT
    return halve ? (d / 2) | 0 : d
  }

  /**
   * The client's underlay blur: a (2r+1)^2 box filter over hue (weighted by
   * each floor's hue multiplier), saturation and lightness, run as a sliding
   * window in x then y. Returns packed HSL per tile, -1 where there is no underlay.
   */
  blendUnderlays(scene: Scene<M>, level: number): Int32Array {
    const sizeX = scene.sizeX
    const sizeY = scene.sizeY
    const colors = new Int32Array(sizeX * sizeY).fill(-1)
    const underlayIds = scene.underlayIds[level]!

    const hues = new Int32Array(sizeY)
    const sats = new Int32Array(sizeY)
    const lights = new Int32Array(sizeY)
    const muls = new Int32Array(sizeY)
    const nums = new Int32Array(sizeY)

    for (let xi = -BLEND_RADIUS; xi < sizeX + BLEND_RADIUS; xi++) {
      for (let yi = 0; yi < sizeY; yi++) {
        const xEast = xi + BLEND_RADIUS
        if (xEast >= 0 && xEast < sizeX) {
          const underlayId = underlayIds[scene.tileIndex(xEast, yi)]!
          if (underlayId > 0) {
            const u = this.floorColors.underlayHsl(underlayId - 1)
            if (u) {
              hues[yi] = hues[yi]! + u.hueBlend
              sats[yi] = sats[yi]! + u.saturation
              lights[yi] = lights[yi]! + u.lightness
              muls[yi] = muls[yi]! + u.hueMultiplier
              nums[yi] = nums[yi]! + 1
            }
          }
        }
        const xWest = xi - BLEND_RADIUS
        if (xWest >= 0 && xWest < sizeX) {
          const underlayId = underlayIds[scene.tileIndex(xWest, yi)]!
          if (underlayId > 0) {
            const u = this.floorColors.underlayHsl(underlayId - 1)
            if (u) {
              hues[yi] = hues[yi]! - u.hueBlend
              sats[yi] = sats[yi]! - u.saturation
              lights[yi] = lights[yi]! - u.lightness
              muls[yi] = muls[yi]! - u.hueMultiplier
              nums[yi] = nums[yi]! - 1
            }
          }
        }
      }

      if (xi < 0 || xi >= sizeX) continue

      let runningHue = 0
      let runningSat = 0
      let runningLight = 0
      let runningMul = 0
      let runningNum = 0
      for (let yi = -BLEND_RADIUS; yi < sizeY + BLEND_RADIUS; yi++) {
        const yNorth = yi + BLEND_RADIUS
        if (yNorth >= 0 && yNorth < sizeY) {
          runningHue += hues[yNorth]!
          runningSat += sats[yNorth]!
          runningLight += lights[yNorth]!
          runningMul += muls[yNorth]!
          runningNum += nums[yNorth]!
        }
        const ySouth = yi - BLEND_RADIUS
        if (ySouth >= 0 && ySouth < sizeY) {
          runningHue -= hues[ySouth]!
          runningSat -= sats[ySouth]!
          runningLight -= lights[ySouth]!
          runningMul -= muls[ySouth]!
          runningNum -= nums[ySouth]!
        }
        if (yi < 0 || yi >= sizeY) continue

        const underlayId = underlayIds[scene.tileIndex(xi, yi)]!
        if (underlayId > 0 && runningNum > 0 && runningMul > 0) {
          const avgHue = ((runningHue * 256) / runningMul) | 0
          const avgSat = (runningSat / runningNum) | 0
          const avgLight = (runningLight / runningNum) | 0
          colors[scene.tileIndex(xi, yi)] = packHsl(avgHue, avgSat, avgLight)
        }
      }
    }
    return colors
  }

  /** Terrain geometry for every drawable tile on every plane (the border ring is skipped like the client). */
  addTileModels(scene: Scene<M>): void {
    for (let level = 0; level < scene.levels; level++) {
      const blended = this.blendUnderlays(scene, level)
      const lights = scene.calculateTileLights(level)

      for (let x = 1; x < scene.sizeX - 1; x++) {
        for (let y = 1; y < scene.sizeY - 1; y++) {
          const i = scene.tileIndex(x, y)
          const underlayId = scene.underlayIds[level]![i]! - 1
          const overlayId = scene.overlayIds[level]![i]! - 1
          // Tiles with neither underlay nor overlay are the client's "black" tiles: nothing is drawn.
          if (underlayId === -1 && overlayId === -1) continue

          const heightSw = scene.getHeight(level, x, y)
          const heightSe = scene.getHeight(level, x + 1, y)
          const heightNe = scene.getHeight(level, x + 1, y + 1)
          const heightNw = scene.getHeight(level, x, y + 1)

          const lightSw = lights[scene.heightIndex(x, y)]!
          const lightSe = lights[scene.heightIndex(x + 1, y)]!
          const lightNe = lights[scene.heightIndex(x + 1, y + 1)]!
          const lightNw = lights[scene.heightIndex(x, y + 1)]!

          let underlayHslSw = -1
          let underlayHslSe = -1
          let underlayHslNe = -1
          let underlayHslNw = -1
          if (underlayId !== -1) {
            underlayHslSw = blended[i]!
            underlayHslSe = blended[scene.tileIndex(x + 1, y)]!
            underlayHslNe = blended[scene.tileIndex(x + 1, y + 1)]!
            underlayHslNw = blended[scene.tileIndex(x, y + 1)]!
            if (underlayHslSe === -1 || !this.smoothUnderlays) underlayHslSe = underlayHslSw
            if (underlayHslNe === -1 || !this.smoothUnderlays) underlayHslNe = underlayHslSw
            if (underlayHslNw === -1 || !this.smoothUnderlays) underlayHslNw = underlayHslSw
          }

          let underlayRgb = 0
          if (underlayHslSw !== -1) {
            underlayRgb = HSL_RGB_MAP[adjustUnderlayLight(underlayHslSw, 96)]!
          }

          const base = {
            x,
            y,
            heightSw,
            heightSe,
            heightNe,
            heightNw,
            lightSw,
            lightSe,
            lightNe,
            lightNw,
            underlayHslSw,
            underlayHslSe,
            underlayHslNe,
            underlayHslNw,
            underlayRgb,
          }

          let tileModel: SceneTileModel
          if (overlayId === -1) {
            tileModel = new SceneTileModel({
              ...base,
              shape: 0,
              rotation: 0,
              textureId: -1,
              overlayHsl: 0,
              overlayMinimapHsl: 0,
              overlayRgb: 0,
            })
          } else {
            const shape = scene.shapes[level]![i]! + 1
            const rotation = scene.rotations[level]![i]!
            const overlay = this.floorColors.overlay(overlayId)
            const overlayHslBase = this.floorColors.overlayHsl(overlayId)

            let textureId = -1
            let overlayHsl: number
            let overlayMinimapHsl: number
            const textureAverage =
              overlay && overlay.textureId !== -1 ? this.textureAverageHsl?.(overlay.textureId) : undefined
            if (overlay && textureAverage !== undefined) {
              textureId = overlay.textureId
              overlayHsl = -1
              overlayMinimapHsl = textureAverage
            } else if (!overlay || overlay.rgb === 0xff00ff || !overlayHslBase) {
              overlayHsl = overlayMinimapHsl = -2
            } else {
              overlayHsl = overlayMinimapHsl = packHsl(
                overlayHslBase.hue,
                overlayHslBase.saturation,
                overlayHslBase.lightness,
              )
            }

            const secondary = this.floorColors.overlaySecondaryHsl(overlayId)
            if (secondary) {
              overlayMinimapHsl = packHsl(secondary.hue, secondary.saturation, secondary.lightness)
            }

            let overlayRgb = 0
            if (overlayMinimapHsl !== -2) {
              overlayRgb = HSL_RGB_MAP[adjustOverlayLight(overlayMinimapHsl, 96)]!
            }

            tileModel = new SceneTileModel({
              ...base,
              shape,
              rotation,
              textureId,
              overlayHsl,
              overlayMinimapHsl,
              overlayRgb,
            })
          }

          scene.newTileModel(level, x, y, tileModel)
        }
      }
    }
  }

  /** Tiles flagged as a bridge on plane 1 are shifted down so the bridge deck draws on plane 0. */
  private linkBridges(scene: Scene<M>): void {
    for (let x = 0; x < scene.sizeX; x++) {
      for (let y = 0; y < scene.sizeY; y++) {
        if ((scene.getRenderFlags(1, x, y) & TileFlag.Bridge) !== 0) scene.setLinkBelow(x, y)
      }
    }
  }
}
