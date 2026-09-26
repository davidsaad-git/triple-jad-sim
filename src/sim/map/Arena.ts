import type { CollisionGrid } from './collisionFlags'

export interface Bounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly width: number
  readonly height: number
}

/** Packs a tile into one number (scim, valid for -8192 <= x, y < 57344). */
export function tileKey(x: number, y: number): number {
  return (x + 8192) * 65536 + (y + 8192)
}

export function unpackTileKey(key: number): [number, number] {
  const x = Math.floor(key / 65536) - 8192
  const y = (key % 65536) - 8192
  return [x, y]
}

/** scim's arena configuration: `{bounds, walkableTiles, collisionMap}`. */
export interface ArenaConfig {
  readonly bounds: Bounds | null
  readonly walkableTiles: ReadonlySet<number> | null
  readonly collisionMap: CollisionGrid | null
}

export const EMPTY_ARENA_CONFIG: ArenaConfig = { bounds: null, walkableTiles: null, collisionMap: null }

/**
 * The arena queries every movement/LOS routine uses (scim's module globals
 * `P` isWalkable, `F` inBounds, `I` collisionMap, `M` bounds with the default
 * flag `O`). scim keeps them global; we keep one instance per engine.
 */
export class Arena {
  readonly config: ArenaConfig
  /** scim: answer for isWalkable/inBounds when the matching field is null. */
  readonly defaultWalkable: boolean

  constructor(config: ArenaConfig, defaultWalkable: boolean) {
    this.config = config
    this.defaultWalkable = defaultWalkable
  }

  
  isWalkable(x: number, y: number): boolean {
    const set = this.config.walkableTiles
    return set ? set.has(tileKey(x, y)) : this.defaultWalkable
  }

  
  inBounds(x: number, y: number): boolean {
    const b = this.config.bounds
    return b ? x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY : this.defaultWalkable
  }

  
  get collision(): CollisionGrid | null {
    return this.config.collisionMap
  }

  
  get bounds(): Bounds | null {
    return this.config.bounds
  }

  
  get walkableTiles(): ReadonlySet<number> | null {
    return this.config.walkableTiles
  }

  /**
   * scim `applyEncounterArenaConfig`: a cache-built config is used
   * with default false; otherwise the encounter's fallback with default =
   * (all three fields null).
   */
  static fromEncounter(cacheBuilt: ArenaConfig | null, fallback: ArenaConfig): Arena {
    if (cacheBuilt && (cacheBuilt.bounds !== null || cacheBuilt.walkableTiles !== null || cacheBuilt.collisionMap !== null)) {
      return new Arena(cacheBuilt, false)
    }
    return new Arena(fallback, fallback.bounds === null && fallback.walkableTiles === null && fallback.collisionMap === null)
  }
}
