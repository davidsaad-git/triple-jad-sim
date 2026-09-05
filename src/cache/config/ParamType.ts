/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * OSRS param config (index 2, archive 11): the type and default of a param key.
 */
import type { ByteReader } from '../ByteReader'
import { decodeCp1252 } from '../ByteReader'
import { type CacheSystem, ConfigArchive } from '../CacheSystem'
import { ConfigTypeLoader, decodeOpcodes, unknownOpcode } from './Type'

const TYPE_NAME = 'ParamType'

/**
 * ScriptVarType id -> char key (RuneLite's ScriptVarType). Opcode 8 stores
 * the numeric id, opcode 1 the char.
 */
const SCRIPT_VAR_TYPE_CHARS: ReadonlyMap<number, string> = new Map<number, string>([
  [0, 'i'], // integer
  [1, '1'], // boolean
  [6, 'A'], // seq
  [7, 'C'], // colour
  [8, 'H'], // locshape
  [9, 'I'], // component
  [10, 'K'], // idkit
  [11, 'M'], // midi
  [13, 'O'], // namedobj
  [14, 'P'], // synth
  [17, 'S'], // stat
  [22, 'c'], // coordgrid
  [23, 'd'], // graphic
  [25, 'f'], // fontmetrics
  [26, 'g'], // enum
  [28, 'j'], // jingle
  [30, 'l'], // loc
  [31, 'm'], // model
  [32, 'n'], // npc
  [33, 'o'], // obj
  [36, 's'], // string
  [37, 't'], // spotanim
  [39, 'v'], // inv
  [40, 'x'], // texture
  [41, 'y'], // category
  [42, 'z'], // char
  [55, '£'], // mapsceneicon
  [59, 'µ'], // mapelement
  [62, '×'], // hitmark
  [73, 'J'], // struct
  [74, 'Ð'], // dbrow
  [118, 'Ø'], // dbtable
  [209, '7'], // varp
])

export class ParamType {
  readonly id: number

  /** ScriptVarType character (e.g. 'i' int, 's' string, 'o' obj). */
  type: string | null = null
  /** ScriptVarType numeric id (opcode 8), or -1 when only the char form (opcode 1) was given. */
  typeId = -1

  defaultInt = 0
  defaultString: string | null = null
  /** Opcode 7 (rev 239+). */
  defaultLong = 0n

  autoDisable = true

  constructor(id: number) {
    this.id = id
  }

  static decode(id: number, data: Uint8Array): ParamType {
    const type = new ParamType(id)
    decodeOpcodes(TYPE_NAME, id, data, (opcode, r) => type.decodeOpcode(opcode, r))
    return type
  }

  private decodeOpcode(opcode: number, r: ByteReader): void {
    if (opcode === 1) {
      const c = r.u8()
      if (c === 0) {
        throw new Error(`ParamType ${this.id}: invalid type char`)
      }
      this.type = decodeCp1252(new Uint8Array([c]))
    } else if (opcode === 2) {
      this.defaultInt = r.i32()
    } else if (opcode === 4) {
      this.autoDisable = false
    } else if (opcode === 5) {
      this.defaultString = r.string()
    } else if (opcode === 7) {
      this.defaultLong = r.i64()
    } else if (opcode === 8) {
      this.typeId = r.u8()
      this.type = SCRIPT_VAR_TYPE_CHARS.get(this.typeId) ?? null
    } else {
      unknownOpcode(TYPE_NAME, this.id, opcode)
    }
  }

  isString(): boolean {
    return this.type === 's'
  }
}

export class ParamTypeLoader extends ConfigTypeLoader<ParamType> {
  constructor(cache: CacheSystem) {
    super(TYPE_NAME, cache.getConfigArchive(ConfigArchive.Param), ParamType.decode, (id) => new ParamType(id))
  }
}
