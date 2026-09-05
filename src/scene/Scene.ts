/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * The client's scene: a levels x sizeX x sizeY grid of tiles over flat
 * per-plane terrain arrays, plus one collision map per plane. A scene is
 * normally one 64x64 region with a border of `borderSize` tiles on every side
 * so blending, lighting and collision near the region edge see their
 * neighbours; `baseX`/`baseY` are the absolute world tile at scene (0, 0).
 *
 * Heights are the client's negative-up world units (128 per tile, 8 per
 * height step). The height arrays have one extra row and column so the
 * north/east corners of the last tiles can be read.
 */
import { CollisionMap } from './CollisionMap'
import { TileFlag } from '../cache/map/TerrainDecoder'
import type { SceneLoc } from './SceneTile'
import { SceneTile } from './SceneTile'
import type { SceneTileModel } from './SceneTileModel'

export const SCENE_LEVELS = 4
export const TILE_SIZE_SHIFT = 7
export const TILE_SIZE = 1 << TILE_SIZE_SHIFT

/** Client light direction and intensity constants for terrain shading. */
const LIGHT_DIR_X = -50
const LIGHT_DIR_Y = -10
const LIGHT_DIR_Z = -50
const LIGHT_INTENSITY_BASE = 96
const LIGHT_INTENSITY_FACTOR = 768
const HEIGHT_SCALE = 65536

/** The client never keeps more than five locs on one tile. */
const MAX_LOCS_PER_TILE = 5

export class Scene<M = unknown> {
  readonly levels = SCENE_LEVELS
  readonly sizeX: number
  readonly sizeY: number
  readonly borderSize: number
  /** Absolute world tile at scene tile (0, 0). */
  readonly baseX: number
  readonly baseY: number

  /** Per plane, flat `sizeX * sizeY` array indexed by `tileIndex(x, y)`. */
  readonly tiles: (SceneTile<M> | undefined)[][]
  readonly collisionMaps: CollisionMap[]

  /** Per plane, `(sizeX + 1) * (sizeY + 1)` heights indexed by `heightIndex(x, y)`. */
  readonly heights: Int32Array[]
  /** Per plane, `sizeX * sizeY` tile settings (see TileFlag). */
  readonly renderFlags: Uint8Array[]
  /** 0 = none, otherwise config id + 1. */
  readonly underlayIds: Uint16Array[]
  readonly overlayIds: Uint16Array[]
  readonly shapes: Uint8Array[]
  readonly rotations: Uint8Array[]
  /** Per plane, `(sizeX + 1) * (sizeY + 1)` light occlusion from walls and locs. */
  readonly lightOcclusions: Uint8Array[]

  /** Every loc placed in the scene, in map-file order. */
  readonly locs: SceneLoc<M>[] = []

  constructor(sizeX: number, sizeY: number, baseX: number, baseY: number, borderSize: number) {
    this.sizeX = sizeX
    this.sizeY = sizeY
    this.baseX = baseX
    this.baseY = baseY
    this.borderSize = borderSize

    const tileCount = sizeX * sizeY
    const cornerCount = (sizeX + 1) * (sizeY + 1)
    this.tiles = []
    this.collisionMaps = []
    this.heights = []
    this.renderFlags = []
    this.underlayIds = []
    this.overlayIds = []
    this.shapes = []
    this.rotations = []
    this.lightOcclusions = []
    for (let level = 0; level < this.levels; level++) {
      this.tiles.push(new Array<SceneTile<M> | undefined>(tileCount).fill(undefined))
      this.collisionMaps.push(new CollisionMap(sizeX, sizeY))
      this.heights.push(new Int32Array(cornerCount))
      this.renderFlags.push(new Uint8Array(tileCount))
      this.underlayIds.push(new Uint16Array(tileCount))
      this.overlayIds.push(new Uint16Array(tileCount))
      this.shapes.push(new Uint8Array(tileCount))
      this.rotations.push(new Uint8Array(tileCount))
      this.lightOcclusions.push(new Uint8Array(cornerCount))
    }
  }

  tileIndex(x: number, y: number): number {
    return x * this.sizeY + y
  }

  heightIndex(x: number, y: number): number {
    return x * (this.sizeY + 1) + y
  }

  isWithinBounds(level: number, x: number, y: number): boolean {
    return level >= 0 && level < this.levels && x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY
  }

  /** Scene tile -> absolute world tile. */
  toWorldX(x: number): number {
    return x + this.baseX
  }

  toWorldY(y: number): number {
    return y + this.baseY
  }

  /** Absolute world tile -> scene tile (may be outside the scene). */
  toSceneX(worldX: number): number {
    return worldX - this.baseX
  }

  toSceneY(worldY: number): number {
    return worldY - this.baseY
  }

  getHeight(level: number, x: number, y: number): number {
    return this.heights[level]![this.heightIndex(x, y)]!
  }

  setHeight(level: number, x: number, y: number, height: number): void {
    this.heights[level]![this.heightIndex(x, y)] = height
  }

  getRenderFlags(level: number, x: number, y: number): number {
    return this.renderFlags[level]![this.tileIndex(x, y)]!
  }

  getUnderlayId(level: number, x: number, y: number): number {
    return this.underlayIds[level]![this.tileIndex(x, y)]!
  }

  getOverlayId(level: number, x: number, y: number): number {
    return this.overlayIds[level]![this.tileIndex(x, y)]!
  }

  getLightOcclusion(level: number, x: number, y: number): number {
    return this.lightOcclusions[level]![this.heightIndex(x, y)]!
  }

  /** Raise (never lower) the light occlusion at a tile corner. */
  raiseLightOcclusion(level: number, x: number, y: number, occlusion: number): void {
    if (x < 0 || y < 0 || x > this.sizeX || y > this.sizeY) return
    const arr = this.lightOcclusions[level]!
    const i = this.heightIndex(x, y)
    if (occlusion > arr[i]!) arr[i] = occlusion
  }

  setLightOcclusion(level: number, x: number, y: number, occlusion: number): void {
    if (x < 0 || y < 0 || x > this.sizeX || y > this.sizeY) return
    this.lightOcclusions[level]![this.heightIndex(x, y)] = occlusion
  }

  getTile(level: number, x: number, y: number): SceneTile<M> | undefined {
    if (!this.isWithinBounds(level, x, y)) return undefined
    return this.tiles[level]![this.tileIndex(x, y)]
  }

  /** Get or create the tile at (level, x, y), also creating the tiles below it like the client. */
  ensureTile(level: number, x: number, y: number): SceneTile<M> {
    const i = this.tileIndex(x, y)
    for (let l = 0; l <= level; l++) {
      const plane = this.tiles[l]!
      if (!plane[i]) plane[i] = new SceneTile<M>(l, x, y)
    }
    return this.tiles[level]![i]!
  }

  newTileModel(level: number, x: number, y: number, tileModel: SceneTileModel): void {
    const i = this.tileIndex(x, y)
    const plane = this.tiles[level]!
    let tile = plane[i]
    if (!tile) {
      tile = new SceneTile<M>(level, x, y)
      plane[i] = tile
    }
    tile.tileModel = tileModel
  }

  /**
   * Add a normal loc covering its footprint. Returns false (and adds nothing)
   * when the footprint leaves the scene or a tile already holds five locs.
   */
  addLoc(loc: SceneLoc<M>): boolean {
    const endX = loc.x + loc.sizeX - 1
    const endY = loc.y + loc.sizeY - 1
    for (let sx = loc.x; sx <= endX; sx++) {
      for (let sy = loc.y; sy <= endY; sy++) {
        if (sx < 0 || sy < 0 || sx >= this.sizeX || sy >= this.sizeY) return false
        const tile = this.tiles[loc.level]![this.tileIndex(sx, sy)]
        if (tile && tile.locs.length >= MAX_LOCS_PER_TILE) return false
      }
    }
    for (let sx = loc.x; sx <= endX; sx++) {
      for (let sy = loc.y; sy <= endY; sy++) {
        this.ensureTile(loc.level, sx, sy).locs.push(loc)
      }
    }
    this.locs.push(loc)
    return true
  }

  setWall(loc: SceneLoc<M>): void {
    this.ensureTile(loc.level, loc.x, loc.y).wall = loc
    this.locs.push(loc)
  }

  setWallDecoration(loc: SceneLoc<M>): void {
    this.ensureTile(loc.level, loc.x, loc.y).wallDecoration = loc
    this.locs.push(loc)
  }

  setFloorDecoration(loc: SceneLoc<M>): void {
    this.ensureTile(loc.level, loc.x, loc.y).floorDecoration = loc
    this.locs.push(loc)
  }

  /** Wall decorations inherit the displacement of the wall they hang on. */
  updateWallDecorationDisplacement(level: number, x: number, y: number, displacement: number): void {
    const decor = this.getTile(level, x, y)?.wallDecoration
    if (decor) {
      decor.offsetX = ((displacement * decor.offsetX) / 16) | 0
      decor.offsetZ = ((displacement * decor.offsetZ) / 16) | 0
    }
  }

  getWall(level: number, x: number, y: number): SceneLoc<M> | undefined {
    return this.getTile(level, x, y)?.wall
  }

  /** Lowest plane the tile is drawn from: 0 for force-lowest tiles, level - 1 on bridges. */
  getTileMinLevel(level: number, x: number, y: number): number {
    const flags = this.getRenderFlags(level, x, y)
    if ((flags & TileFlag.ForceLowestPlane) !== 0) return 0
    if (level > 0 && (flags & TileFlag.Bridge) !== 0) return level - 1
    return level
  }

  setTileMinLevels(): void {
    for (let level = 0; level < this.levels; level++) {
      for (let x = 0; x < this.sizeX; x++) {
        for (let y = 0; y < this.sizeY; y++) {
          const tile = this.tiles[level]![this.tileIndex(x, y)]
          if (tile) tile.minLevel = this.getTileMinLevel(level, x, y)
        }
      }
    }
  }

  /** Tile is under a roof. */
  isInside(level: number, x: number, y: number): boolean {
    return (this.getRenderFlags(level, x, y) & TileFlag.Roof) !== 0
  }

  /** Whether a tile on `level` is visible to a player standing on `playerLevel`. */
  isPlayerLevel(level: number, x: number, y: number, playerLevel: number): boolean {
    if ((this.getRenderFlags(0, x, y) & TileFlag.Bridge) !== 0) return true
    if ((this.getRenderFlags(level, x, y) & TileFlag.HideAbove) !== 0) return false
    return playerLevel === this.getTileMinLevel(level, x, y)
  }

  /** Bilinear terrain height at a world-unit position (scene-relative), 0 outside the scene. */
  getHeightInterpolated(level: number, x: number, z: number): number {
    const tileX = x >> TILE_SIZE_SHIFT
    const tileY = z >> TILE_SIZE_SHIFT
    if (tileX < 0 || tileY < 0 || tileX > this.sizeX - 1 || tileY > this.sizeY - 1) return 0
    const rx = x & (TILE_SIZE - 1)
    const rz = z & (TILE_SIZE - 1)
    const south =
      ((TILE_SIZE - rx) * this.getHeight(level, tileX, tileY) + this.getHeight(level, tileX + 1, tileY) * rx) >>
      TILE_SIZE_SHIFT
    const north =
      (this.getHeight(level, tileX, tileY + 1) * (TILE_SIZE - rx) + this.getHeight(level, tileX + 1, tileY + 1) * rx) >>
      TILE_SIZE_SHIFT
    return (rz * north + (TILE_SIZE - rz) * south) >> TILE_SIZE_SHIFT
  }

  /** Average of the four corner heights of a tile. */
  getCenterHeight(level: number, x: number, y: number): number {
    return (
      (this.getHeight(level, x, y) +
        this.getHeight(level, x, y + 1) +
        this.getHeight(level, x + 1, y) +
        this.getHeight(level, x + 1, y + 1)) >>
      2
    )
  }

  /**
   * Per-corner terrain light for a plane: a Lambert term from the height
   * slope against the client's fixed sun direction, minus the occlusion
   * accumulated from nearby walls and locs. Indexed by `heightIndex(x, y)`;
   * only 1..size-2 are computed (the border is never drawn).
   */
  calculateTileLights(level: number, ignoreOcclusion = false): Int32Array {
    const lights = new Int32Array((this.sizeX + 1) * (this.sizeY + 1))
    const heights = this.heights[level]!
    const occlusions = this.lightOcclusions[level]!

    const lightMagnitude =
      Math.sqrt(LIGHT_DIR_X * LIGHT_DIR_X + LIGHT_DIR_Y * LIGHT_DIR_Y + LIGHT_DIR_Z * LIGHT_DIR_Z) | 0
    const lightIntensity = (lightMagnitude * LIGHT_INTENSITY_FACTOR) >> 8

    for (let x = 1; x < this.sizeX - 1; x++) {
      for (let y = 1; y < this.sizeY - 1; y++) {
        const heightDeltaX = heights[this.heightIndex(x + 1, y)]! - heights[this.heightIndex(x - 1, y)]!
        const heightDeltaY = heights[this.heightIndex(x, y + 1)]! - heights[this.heightIndex(x, y - 1)]!
        const normalLength =
          Math.sqrt(heightDeltaY * heightDeltaY + heightDeltaX * heightDeltaX + HEIGHT_SCALE) | 0
        const normalX = ((heightDeltaX << 8) / normalLength) | 0
        const normalY = (HEIGHT_SCALE / normalLength) | 0
        const normalZ = ((heightDeltaY << 8) / normalLength) | 0

        const dot = normalX * LIGHT_DIR_X + normalY * LIGHT_DIR_Y + normalZ * LIGHT_DIR_Z
        const sunLight = (dot / lightIntensity + LIGHT_INTENSITY_BASE) | 0

        const occlusion = ignoreOcclusion
          ? 0
          : (occlusions[this.heightIndex(x - 1, y)]! >> 2) +
            (occlusions[this.heightIndex(x, y - 1)]! >> 2) +
            (occlusions[this.heightIndex(x + 1, y)]! >> 3) +
            (occlusions[this.heightIndex(x, y + 1)]! >> 3) +
            (occlusions[this.heightIndex(x, y)]! >> 1)

        lights[this.heightIndex(x, y)] = sunLight - occlusion
      }
    }
    return lights
  }

  /**
   * Bridge handling: shift every tile at (x, y) down one plane, keeping the
   * original plane-0 tile reachable as `linkedBelowTile` of the new plane-0 tile.
   */
  setLinkBelow(x: number, y: number): void {
    const i = this.tileIndex(x, y)
    const below = this.tiles[0]![i]

    for (let level = 0; level < this.levels - 1; level++) {
      const tile = this.tiles[level + 1]![i]
      this.tiles[level]![i] = tile
      if (tile) {
        tile.level--
        for (const loc of tile.locs) {
          if (loc.x === x && loc.y === y) loc.level--
        }
      }
    }

    let ground = this.tiles[0]![i]
    if (!ground) {
      ground = new SceneTile<M>(0, x, y)
      this.tiles[0]![i] = ground
    }
    ground.linkedBelowTile = below
    this.tiles[this.levels - 1]![i] = undefined
  }
}
