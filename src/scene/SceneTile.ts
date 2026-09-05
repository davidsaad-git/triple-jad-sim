/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * One cell of the scene grid: the terrain model plus the loc slots the client
 * keeps per tile (one wall, one wall decoration, one floor decoration and up
 * to five "normal" locs whose footprint covers the tile).
 */
import type { LocKind } from './LocModelType'
import type { SceneTileModel } from './SceneTileModel'

/**
 * Hook the model layer plugs in: return the model for a loc config drawn with
 * the given placement type and (possibly +4 for diagonal variants) rotation,
 * or null when the loc has nothing to draw. `M` is whatever the model layer
 * produces; the scene only stores it.
 */
export type LocModelHook<M> = (locId: number, type: number, rotation: number) => M | null

/** A placed loc with its world position resolved against the terrain. */
export interface SceneLoc<M = unknown> {
  /** Loc config id. */
  readonly id: number
  /** Placement type 0..22 exactly as stored in the map file (see LocModelType). */
  readonly type: number
  readonly kind: LocKind
  /** Rotation 0..3 as stored. */
  readonly rotation: number
  /** Rotation handed to the model hook (the client adds 4 for diagonal variants). */
  readonly modelRotation: number
  /** Second model rotation for two-model shapes (wall corner, double diagonal decoration), else -1. */
  readonly secondaryModelRotation: number
  /** Plane as stored in the map file. */
  readonly storedLevel: number
  /** Plane the loc is drawn on; decremented for tiles linked below a bridge. */
  level: number
  /** Scene tile of the footprint's south-west corner. */
  readonly x: number
  readonly y: number
  /** Absolute world tile of the footprint's south-west corner. */
  readonly worldX: number
  readonly worldY: number
  /** Footprint in tiles after applying the rotation. */
  readonly sizeX: number
  readonly sizeY: number
  /** Model origin in world units from the scene origin (128 per tile); `height` is the client's negative-up value. */
  readonly centerX: number
  readonly centerZ: number
  readonly height: number
  /** Wall-decoration displacement along x / z in world units (0 for other kinds). */
  offsetX: number
  offsetZ: number
  readonly model: M | null
  readonly secondaryModel: M | null
}

export class SceneTile<M = unknown> {
  /** Plane the tile was created on. */
  readonly initLevel: number
  /** Plane the tile is drawn on (initLevel - 1 when linked below a bridge). */
  level: number
  readonly x: number
  readonly y: number
  /** Lowest plane from which this tile is visible (bridges / force-lowest-plane tiles). */
  minLevel = 0

  tileModel: SceneTileModel | undefined = undefined
  floorDecoration: SceneLoc<M> | undefined = undefined
  wall: SceneLoc<M> | undefined = undefined
  wallDecoration: SceneLoc<M> | undefined = undefined
  readonly locs: SceneLoc<M>[] = []

  /** For bridge tiles: the original plane-0 tile now drawn underneath this one. */
  linkedBelowTile: SceneTile<M> | undefined = undefined

  constructor(level: number, x: number, y: number) {
    this.initLevel = level
    this.level = level
    this.x = x
    this.y = y
  }
}
