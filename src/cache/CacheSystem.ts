import { Archive } from './Archive'
import { decodeContainer } from './container'
import { DiskStore, REFERENCE_INDEX } from './DiskStore'
import { ReferenceTable } from './ReferenceTable'

/** OSRS cache index ids. */
export const IndexId = {
  Frames: 0,
  FrameMaps: 1,
  Configs: 2,
  Interfaces: 3,
  SoundEffects: 4,
  Maps: 5,
  Music: 6,
  Models: 7,
  Sprites: 8,
  Textures: 9,
  Binary: 10,
  Jingles: 11,
  ClientScripts: 12,
  FontMetrics: 13,
  Vorbis: 14,
  Instruments: 15,
  WorldMapAreas: 18,
  WorldMapLabels: 19,
  DbTableIndex: 21,
  /** Skeletal ("animaya") keyframes, OSRS 229+. */
  Animations: 22,
  GameVals: 24,
} as const
export type IndexId = (typeof IndexId)[keyof typeof IndexId]

/** Archives inside the configs index (2). */
export const ConfigArchive = {
  Underlay: 1,
  Identkit: 3,
  Overlay: 4,
  Inventory: 5,
  Object: 6,
  Enum: 8,
  Npc: 9,
  Item: 10,
  Param: 11,
  Sequence: 12,
  SpotAnim: 13,
  Varbit: 14,
  VarClientString: 15,
  VarPlayer: 16,
  VarClient: 19,
  Hitsplat: 32,
  HealthBar: 33,
  Struct: 34,
  Area: 35,
  DbRow: 38,
  DbTable: 39,
  Gamelogevent: 70,
} as const
export type ConfigArchive = (typeof ConfigArchive)[keyof typeof ConfigArchive]

export type XteaKeyProvider = (indexId: number, archiveId: number) => readonly number[] | null

export class CacheIndex {
  readonly id: number
  readonly table: ReferenceTable
  private readonly system: CacheSystem
  private readonly archives = new Map<number, Archive>()

  constructor(system: CacheSystem, id: number, table: ReferenceTable) {
    this.system = system
    this.id = id
    this.table = table
  }

  get archiveIds(): number[] {
    return this.table.archiveIds
  }

  hasArchive(archiveId: number): boolean {
    return this.table.archives.has(archiveId)
  }

  getArchive(archiveId: number, keys?: readonly number[] | null): Archive | undefined {
    const cached = this.archives.get(archiveId)
    if (cached) return cached
    const entry = this.table.getArchive(archiveId)
    if (!entry) return undefined
    const raw = this.system.store.read(this.id, archiveId)
    if (!raw) return undefined
    const container = decodeContainer(raw, keys ?? this.system.keys(this.id, archiveId))
    const archive = Archive.split(archiveId, entry, container.data)
    this.archives.set(archiveId, archive)
    return archive
  }

  getArchiveByName(name: string, keys?: readonly number[] | null): Archive | undefined {
    const entry = this.table.findByName(name)
    return entry ? this.getArchive(entry.id, keys) : undefined
  }

  getFile(archiveId: number, fileId: number): Uint8Array | undefined {
    return this.getArchive(archiveId)?.getFile(fileId)
  }
}

/**
 * Top-level cache API: indexes -> archives -> files, decoded lazily with
 * memoised archives.
 */
export class CacheSystem {
  readonly store: DiskStore
  readonly keys: XteaKeyProvider
  private readonly indexes = new Map<number, CacheIndex>()

  constructor(store: DiskStore, keys: XteaKeyProvider = () => null) {
    this.store = store
    this.keys = keys
  }

  get indexIds(): number[] {
    return this.store.indexIds
  }

  getIndex(indexId: number): CacheIndex {
    const cached = this.indexes.get(indexId)
    if (cached) return cached
    const raw = this.store.read(REFERENCE_INDEX, indexId)
    if (!raw) {
      throw new Error(`Index ${indexId} has no reference table`)
    }
    const table = ReferenceTable.decode(decodeContainer(raw).data)
    const index = new CacheIndex(this, indexId, table)
    this.indexes.set(indexId, index)
    return index
  }

  /** Convenience for the very common configs-index lookup. */
  getConfigArchive(archive: ConfigArchive): Archive | undefined {
    return this.getIndex(IndexId.Configs).getArchive(archive)
  }
}
