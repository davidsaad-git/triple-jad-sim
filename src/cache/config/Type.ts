/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Shared plumbing for the OSRS config decoders: the opcode loop, the params
 * map (opcode 249), a few extra ByteReader primitives, and a generic cached
 * loader over one archive of the configs index (index 2).
 */
import type { Archive } from '../Archive'
import { ByteReader } from '../ByteReader'

export type ParamValue = number | string | bigint
export type ParamsMap = Map<number, ParamValue>

/** Decodes an opcode-249 params block, merging into `params` if given. */
export function readParamsMap(r: ByteReader, params: ParamsMap | null): ParamsMap {
  const count = r.u8()
  const out = params ?? new Map<number, ParamValue>()
  for (let i = 0; i < count; i++) {
    const typeId = r.u8()
    const key = r.u24()
    switch (typeId) {
      case 0:
        out.set(key, r.i32())
        break
      case 1:
        out.set(key, r.string())
        break
      case 2:
        out.set(key, r.i64())
        break
      default:
        throw new Error(`Unknown param type ${typeId}`)
    }
  }
  return out
}

/** Unsigned smart minus one (used for sprite frame indices). */
export function readUSmartMin1(r: ByteReader): number {
  const peek = r.data[r.offset]!
  return peek < 128 ? r.u8() - 1 : r.u16() - 0x8001
}

/** A null-terminated string where a leading 0 byte means "no string". */
export function readNullString(r: ByteReader): string | null {
  if (r.data[r.offset] === 0) {
    r.offset++
    return null
  }
  return r.string()
}

/** Reads a u16 where 65535 means "none" (-1). */
export function readU16OrNone(r: ByteReader): number {
  const v = r.u16()
  return v === 65535 ? -1 : v
}

/** Reads `count` u16 values. */
export function readU16Array(r: ByteReader, count: number): number[] {
  const out: number[] = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    out[i] = r.u16()
  }
  return out
}

/** Reads a pair of parallel u16 arrays (recolour / retexture tables). */
export function readU16Pairs(r: ByteReader): [number[], number[]] {
  const count = r.u8()
  const from: number[] = new Array<number>(count)
  const to: number[] = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    from[i] = r.u16()
    to[i] = r.u16()
  }
  return [from, to]
}

/**
 * The multi-variable "transforms" table shared by npc/loc/hitsplat configs:
 * varbit, varp, optional default id, then count+1 ids. `transforms` has
 * `count + 2` entries; the last one is the default (or -1).
 */
export interface TransformTable {
  varbit: number
  varp: number
  transforms: number[]
}

export function readTransforms(r: ByteReader, withDefault: boolean): TransformTable {
  const varbit = readU16OrNone(r)
  const varp = readU16OrNone(r)
  let defaultId = -1
  if (withDefault) {
    defaultId = readU16OrNone(r)
  }
  const count = r.u8()
  const transforms: number[] = new Array<number>(count + 2)
  for (let i = 0; i <= count; i++) {
    transforms[i] = readU16OrNone(r)
  }
  transforms[count + 1] = defaultId
  return { varbit, varp, transforms }
}

/** Minimal view of player variable state, enough to resolve config transforms. */
export interface VarProvider {
  getVarbit(id: number): number
  getVarp(id: number): number
}

/**
 * Resolves a transforms table against the current var state. Returns -1 when
 * the config transforms into nothing.
 */
export function resolveTransform(table: TransformTable | null, vars: VarProvider): number {
  if (!table) return -1
  let index = -1
  if (table.varbit !== -1) {
    index = vars.getVarbit(table.varbit)
  } else if (table.varp !== -1) {
    index = vars.getVarp(table.varp)
  }
  const t = table.transforms
  const last = t[t.length - 1] ?? -1
  if (index >= 0 && index < t.length - 1) {
    const v = t[index] ?? -1
    return v === -1 ? last : v
  }
  return last
}

/** A right-click op that only shows while a varp/varbit is within [min, max]. */
export interface ConditionalOp {
  text: string
  varp: number
  varbit: number
  min: number
  max: number
}

/**
 * The extended right-click menu data shared by npc/loc/obj configs (rev 220+):
 * sub-menus per op slot (opcodes 251/100/200 and obj 43) and var-gated ops
 * (252/101/201 and 253/102/202). Follows RuneLite's EntityOpsLoader.
 */
export class EntityOps {
  /** `subOps[opIndex][subIndex]`, 5 x 20 slots, null when unset. */
  subOps: (string | null)[][] | null = null
  /** Per op slot, or null. */
  conditionalOps: (ConditionalOp | null)[] | null = null
  /** `conditionalSubOps[opIndex][subIndex]`. */
  conditionalSubOps: (ConditionalOp | null)[][] | null = null

  setSubOp(opIndex: number, subIndex: number, text: string): void {
    if (opIndex < 0 || opIndex >= 5 || subIndex < 0 || subIndex >= 20) return
    this.subOps ??= [[], [], [], [], []]
    const row = this.subOps[opIndex]!
    while (row.length < 20) row.push(null)
    row[subIndex] = text
  }

  setConditionalOp(opIndex: number, op: ConditionalOp): void {
    if (opIndex < 0 || opIndex >= 5) return
    this.conditionalOps ??= [null, null, null, null, null]
    this.conditionalOps[opIndex] = op
  }

  setConditionalSubOp(opIndex: number, subIndex: number, op: ConditionalOp): void {
    if (opIndex < 0 || opIndex >= 5 || subIndex < 0 || subIndex >= 20) return
    this.conditionalSubOps ??= [[], [], [], [], []]
    const row = this.conditionalSubOps[opIndex]!
    while (row.length < 20) row.push(null)
    row[subIndex] = op
  }
}

/** Opcode 251 (npc) / 100 (loc) / 200 (obj): op index, sub index, text. */
export function readSubOp(r: ByteReader, ops: EntityOps): void {
  const opIndex = r.u8()
  const subIndex = r.u8()
  ops.setSubOp(opIndex, subIndex, r.string())
}

/** Opcode 252 / 101 / 201: op index, varp, varbit, min, max, text. */
export function readConditionalOp(r: ByteReader, ops: EntityOps): void {
  const opIndex = r.u8()
  const varp = r.u16()
  const varbit = r.u16()
  const min = r.i32()
  const max = r.i32()
  ops.setConditionalOp(opIndex, { text: r.string(), varp, varbit, min, max })
}

/** Opcode 253 / 102 / 202: op index, sub index (u16), varp, varbit, min, max, text. */
export function readConditionalSubOp(r: ByteReader, ops: EntityOps): void {
  const opIndex = r.u8()
  const subIndex = r.u16()
  const varp = r.u16()
  const varbit = r.u16()
  const min = r.i32()
  const max = r.i32()
  ops.setConditionalSubOp(opIndex, subIndex, { text: r.string(), varp, varbit, min, max })
}

/**
 * Obj opcode 43: an op index followed by (subIndex + 1, text) pairs until a 0
 * byte. Same data as repeated sub-op entries.
 */
export function readSubOpList(r: ByteReader, ops: EntityOps): void {
  const opIndex = r.u8()
  for (;;) {
    const subIndex = r.u8() - 1
    if (subIndex === -1) break
    ops.setSubOp(opIndex, subIndex, r.string())
  }
}

/** Runs the standard "opcode until 0" loop over a config file. */
export function decodeOpcodes(
  typeName: string,
  id: number,
  data: Uint8Array,
  handler: (opcode: number, r: ByteReader) => void,
): void {
  const r = new ByteReader(data)
  for (;;) {
    if (r.offset >= r.length) {
      throw new Error(`${typeName} ${id}: buffer overflow`)
    }
    const opcode = r.u8()
    if (opcode === 0) {
      break
    }
    handler(opcode, r)
  }
}

export function unknownOpcode(typeName: string, id: number, opcode: number): never {
  throw new Error(`${typeName} ${id}: opcode ${opcode} not implemented`)
}

export type ConfigDecoder<T> = (id: number, data: Uint8Array) => T

/**
 * Cached loader over one config archive. Missing files decode to a default
 * instance; decode failures are logged once and also yield the default so a
 * single bad entry cannot take down a scene load. Use `tryLoad` for strict
 * behaviour.
 */
export class ConfigTypeLoader<T> {
  readonly archive: Archive | undefined
  readonly typeName: string
  private readonly decoder: ConfigDecoder<T>
  private readonly createDefault: (id: number) => T
  private readonly cache = new Map<number, T>()

  constructor(
    typeName: string,
    archive: Archive | undefined,
    decoder: ConfigDecoder<T>,
    createDefault: (id: number) => T,
  ) {
    this.typeName = typeName
    this.archive = archive
    this.decoder = decoder
    this.createDefault = createDefault
  }

  /** Highest id + 1. */
  get count(): number {
    return this.archive?.entry.fileCapacity ?? 0
  }

  get ids(): number[] {
    return this.archive?.fileIds ?? []
  }

  has(id: number): boolean {
    return this.archive?.getFile(id) !== undefined
  }

  load(id: number): T {
    const cached = this.cache.get(id)
    if (cached !== undefined) {
      return cached
    }
    let type: T
    const data = this.archive?.getFile(id)
    if (data) {
      try {
        type = this.decoder(id, data)
      } catch (e) {
        console.warn(`Failed decoding ${this.typeName} ${id}: ${(e as Error).message}`)
        type = this.createDefault(id)
      }
    } else {
      type = this.createDefault(id)
    }
    this.cache.set(id, type)
    return type
  }

  /** Strict variant: throws on decode failure, returns undefined when the file is absent. */
  tryLoad(id: number): T | undefined {
    const data = this.archive?.getFile(id)
    if (!data) return undefined
    const cached = this.cache.get(id)
    if (cached !== undefined) return cached
    const type = this.decoder(id, data)
    this.cache.set(id, type)
    return type
  }

  clearCache(): void {
    this.cache.clear()
  }
}
