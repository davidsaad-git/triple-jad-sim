// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// Cached loaders for the three animation indexes:
//   index 1 (frame maps): one archive per base id, file 0;
//   index 0 (frames): one archive per base id holding that base's frames,
//     addressed as (archiveId << 16) | fileId (the SeqType frame id);
//   index 22 (animaya): archives of skeletal sequences, same id packing.

import { IndexId, type CacheSystem } from '../CacheSystem'
import { SeqBase } from './SeqBase'
import { SeqFrame } from './SeqFrame'
import { SkeletalSeq } from './skeletal/SkeletalSeq'

export class SeqBaseLoader {
  private readonly cache: CacheSystem
  private readonly bases = new Map<number, SeqBase | null>()

  constructor(cache: CacheSystem) {
    this.cache = cache
  }

  load(id: number): SeqBase | undefined {
    const cached = this.bases.get(id)
    if (cached !== undefined) return cached ?? undefined
    const file = this.cache.getIndex(IndexId.FrameMaps).getFile(id, 0)
    if (!file) {
      this.bases.set(id, null)
      return undefined
    }
    const base = SeqBase.decode(id, file)
    this.bases.set(id, base)
    return base
  }

  clear(): void {
    this.bases.clear()
  }
}

export class SeqFrameLoader {
  private readonly cache: CacheSystem
  readonly baseLoader: SeqBaseLoader
  /** Decoded frames per frame archive; a null entry means that file failed to decode. */
  private readonly archives = new Map<number, Map<number, SeqFrame | null>>()
  /** Decode failures seen so far, as "archive:file -> message". */
  readonly failures = new Map<string, string>()

  constructor(cache: CacheSystem, baseLoader: SeqBaseLoader = new SeqBaseLoader(cache)) {
    this.cache = cache
    this.baseLoader = baseLoader
  }

  /** `id` is a SeqType frame id: (archive << 16) | file. */
  load(id: number): SeqFrame | undefined {
    const archiveId = id >>> 16
    const fileId = id & 0xffff
    let frames = this.archives.get(archiveId)
    if (!frames) {
      frames = this.decodeArchive(archiveId)
      this.archives.set(archiveId, frames)
    }
    return frames.get(fileId) ?? undefined
  }

  private decodeArchive(archiveId: number): Map<number, SeqFrame | null> {
    const frames = new Map<number, SeqFrame | null>()
    const archive = this.cache.getIndex(IndexId.Frames).getArchive(archiveId)
    if (!archive) return frames
    const loadBase = (baseId: number): SeqBase | undefined => this.baseLoader.load(baseId)
    for (const [fileId, data] of archive) {
      try {
        frames.set(fileId, SeqFrame.decode(data, loadBase))
      } catch (e) {
        this.failures.set(`${archiveId}:${fileId}`, (e as Error).message)
        frames.set(fileId, null)
      }
    }
    return frames
  }

  clear(): void {
    this.archives.clear()
  }
}

export class SkeletalSeqLoader {
  private readonly cache: CacheSystem
  readonly baseLoader: SeqBaseLoader
  private readonly seqs = new Map<number, SkeletalSeq | null>()

  constructor(cache: CacheSystem, baseLoader: SeqBaseLoader = new SeqBaseLoader(cache)) {
    this.cache = cache
    this.baseLoader = baseLoader
  }

  /** `id` is a SeqType skeletal id: (archive << 16) | file. */
  load(id: number): SkeletalSeq | undefined {
    const cached = this.seqs.get(id)
    if (cached !== undefined) return cached ?? undefined
    const archiveId = id >>> 16
    const fileId = id & 0xffff
    const file = this.cache.getIndex(IndexId.Animations).getFile(archiveId, fileId)
    if (!file) {
      this.seqs.set(id, null)
      return undefined
    }
    const seq = SkeletalSeq.decode(id, file, (baseId) => this.baseLoader.load(baseId))
    this.seqs.set(id, seq)
    return seq
  }

  clear(): void {
    this.seqs.clear()
  }
}

/** The frame and skeletal loaders, sharing one base cache. */
export interface AnimLoaders {
  frames: SeqFrameLoader
  skeletal: SkeletalSeqLoader
}

export function createAnimLoaders(cache: CacheSystem): AnimLoaders {
  const bases = new SeqBaseLoader(cache)
  return {
    frames: new SeqFrameLoader(cache, bases),
    skeletal: new SkeletalSeqLoader(cache, bases),
  }
}
