/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS sequence (animation) config (index 2, archive 12), revision 233+ layout:
 * opcode 13 is the skeletal ("animaya") animation id, 14 the sparse frame
 * sound table, 15 the skeletal frame range and 17 the skeletal bone masks.
 */
import type { ByteReader } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { ConfigTypeLoader, decodeOpcodes, unknownOpcode } from './Type'

const TYPE_NAME = 'SeqType'

export interface SeqSoundEffect {
  id: number
  /** Opcode-14 weight byte (rev 226+). -1 for the dense opcode-13 form. */
  weight: number
  loops: number
  location: number
  retain: number
}

function decodeSoundEffect(r: ByteReader, hasWeight: boolean): SeqSoundEffect {
  const id = r.u16()
  const weight = hasWeight ? r.u8() : -1
  const loops = r.u8()
  const location = r.u8()
  const retain = r.u8()
  return { id, weight, loops, location, retain }
}

export class SeqType {
  readonly id: number

  /** Frame ids: (frame archive id << 16) | frame file id. */
  frameIds: number[] = []
  frameLengths: number[] = []
  chatFrameIds: number[] = []
  frameSounds: Map<number, SeqSoundEffect[]> = new Map()

  /** Frame index to loop back to; -1 when the animation does not loop that way. */
  frameStep = -1

  /** "interleaveLeave" bone-group masks (opcode 3), terminated with 9999999. */
  masks: number[] | null = null

  stretches = false

  forcedPriority = 5

  leftHandItem = -1
  rightHandItem = -1

  maxLoops = 99
  looping = false

  precedenceAnimating = -1
  priority = -1
  replyMode = 2

  /** Skeletal ("animaya") animation id in index 22, or -1. */
  skeletalId = -1
  skeletalStart = 0
  skeletalEnd = 0
  /** 256-entry bone mask, or null. */
  skeletalMasks: boolean[] | null = null

  /** Opcode 16 (rev 233+): signed vertical offset. */
  heightOffset = 0
  /** Opcode 18 (rev 230+). */
  debugName: string | null = null
  /** Opcode 19 (rev 239+): frame sounds are audible across the whole world view. */
  soundsCrossWorldView = false

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): SeqType {
    const type = new SeqType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      const count = r.u16()
      this.frameIds = new Array<number>(count)
      this.frameLengths = new Array<number>(count)
      for (let i = 0; i < count; i++) {
        this.frameLengths[i] = r.u16()
      }
      for (let i = 0; i < count; i++) {
        this.frameIds[i] = r.u16()
      }
      for (let i = 0; i < count; i++) {
        this.frameIds[i] = this.frameIds[i]! + (r.u16() << 16)
      }
    } else if (opcode === 2) {
      this.frameStep = r.u16()
    } else if (opcode === 3) {
      const count = r.u8()
      const masks: number[] = new Array<number>(count + 1)
      for (let i = 0; i < count; i++) {
        masks[i] = r.u8()
      }
      masks[count] = 9999999
      this.masks = masks
    } else if (opcode === 4) {
      this.stretches = true
    } else if (opcode === 5) {
      this.forcedPriority = r.u8()
    } else if (opcode === 6) {
      this.leftHandItem = r.u16()
    } else if (opcode === 7) {
      this.rightHandItem = r.u16()
    } else if (opcode === 8) {
      this.maxLoops = r.u8()
      this.looping = true
    } else if (opcode === 9) {
      this.precedenceAnimating = r.u8()
    } else if (opcode === 10) {
      this.priority = r.u8()
    } else if (opcode === 11) {
      this.replyMode = r.u8()
    } else if (opcode === 12) {
      const count = r.u8()
      this.chatFrameIds = new Array<number>(count)
      for (let i = 0; i < count; i++) {
        this.chatFrameIds[i] = r.u16()
      }
      for (let i = 0; i < count; i++) {
        this.chatFrameIds[i] = this.chatFrameIds[i]! + (r.u16() << 16)
      }
    } else if (opcode === 13) {
      this.skeletalId = r.i32()
    } else if (opcode === 14) {
      const count = r.u16()
      for (let i = 0; i < count; i++) {
        const frame = r.u16()
        const effect = decodeSoundEffect(r, true)
        const effects = this.frameSounds.get(frame)
        if (effects) {
          effects.push(effect)
        } else {
          this.frameSounds.set(frame, [effect])
        }
      }
    } else if (opcode === 15) {
      this.skeletalStart = r.u16()
      this.skeletalEnd = r.u16()
    } else if (opcode === 16) {
      this.heightOffset = r.i8()
    } else if (opcode === 17) {
      const count = r.u8()
      const masks: boolean[] = new Array<boolean>(256).fill(false)
      for (let i = 0; i < count; i++) {
        masks[r.u8()] = true
      }
      this.skeletalMasks = masks
    } else if (opcode === 18) {
      this.debugName = r.string()
    } else if (opcode === 19) {
      this.soundsCrossWorldView = true
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  /** Alias of `skeletalStart`. */
  get skeletalRangeBegin(): number {
    return this.skeletalStart
  }

  /** Alias of `skeletalEnd`. */
  get skeletalRangeEnd(): number {
    return this.skeletalEnd
  }

  isSkeletalSeq(): boolean {
    return this.skeletalId >= 0
  }

  getSkeletalDuration(): number {
    return this.skeletalEnd - this.skeletalStart
  }

  get frameCount(): number {
    return this.frameIds.length
  }

  /** Total length in client ticks of one pass of the frame table. */
  getTotalFrameLength(): number {
    let total = 0
    for (const length of this.frameLengths) {
      total += length
    }
    return total
  }
}

export class SeqTypeLoader extends ConfigTypeLoader<SeqType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.Sequence), SeqType.decode, (id) => new SeqType(id))
  }
}
