/**
 * Big-endian byte reader over a Uint8Array, mirroring the primitives the
 * OSRS cache formats are written with (Jagex "Packet"/"Buffer" semantics).
 */
export class ByteReader {
  readonly data: Uint8Array
  private readonly view: DataView
  offset: number

  constructor(data: Uint8Array, offset = 0) {
    this.data = data
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    this.offset = offset
  }

  get length(): number {
    return this.data.length
  }

  get remaining(): number {
    return this.data.length - this.offset
  }

  seek(offset: number): void {
    this.offset = offset
  }

  skip(n: number): void {
    this.offset += n
  }

  u8(): number {
    return this.data[this.offset++]!
  }

  i8(): number {
    return this.view.getInt8(this.offset++)
  }

  u16(): number {
    const v = this.view.getUint16(this.offset)
    this.offset += 2
    return v
  }

  i16(): number {
    const v = this.view.getInt16(this.offset)
    this.offset += 2
    return v
  }

  u24(): number {
    const v = (this.data[this.offset]! << 16) | (this.data[this.offset + 1]! << 8) | this.data[this.offset + 2]!
    this.offset += 3
    return v
  }

  i32(): number {
    const v = this.view.getInt32(this.offset)
    this.offset += 4
    return v
  }

  u32(): number {
    const v = this.view.getUint32(this.offset)
    this.offset += 4
    return v
  }

  i64(): bigint {
    const v = this.view.getBigInt64(this.offset)
    this.offset += 8
    return v
  }

  /** Jagex "smart": 1 byte if < 128, else 2 bytes minus 32768. Unsigned. */
  uSmart(): number {
    const peek = this.data[this.offset]!
    return peek < 128 ? this.u8() : this.u16() - 32768
  }

  /** Jagex signed smart: 1 byte - 64, or 2 bytes - 49152. */
  iSmart(): number {
    const peek = this.data[this.offset]!
    return peek < 128 ? this.u8() - 64 : this.u16() - 49152
  }

  /** "Big smart": 2 bytes if the sign bit is clear, else 4 bytes masked to 31 bits. */
  bigSmart(): number {
    const peek = this.view.getInt8(this.offset)
    if (peek < 0) {
      return this.i32() & 0x7fffffff
    }
    const v = this.u16()
    return v === 32767 ? -1 : v
  }

  /** Unsigned smart that can extend beyond 32767 by chaining. */
  uSmartExtended(): number {
    let total = 0
    let v = this.uSmart()
    while (v === 32767) {
      total += 32767
      v = this.uSmart()
    }
    return total + v
  }

  /** Null-terminated CP-1252 string. */
  string(): string {
    const start = this.offset
    while (this.data[this.offset] !== 0) {
      this.offset++
    }
    const bytes = this.data.subarray(start, this.offset)
    this.offset++ // terminator
    return decodeCp1252(bytes)
  }

  /** String prefixed by a 0 version byte (used in newer configs). */
  versionedString(): string {
    const version = this.u8()
    if (version !== 0) {
      throw new Error(`Unexpected string version ${version}`)
    }
    return this.string()
  }

  bytes(n: number): Uint8Array {
    const out = this.data.subarray(this.offset, this.offset + n)
    this.offset += n
    return out
  }

  /** Copy of the remaining bytes. */
  rest(): Uint8Array {
    return this.data.subarray(this.offset)
  }
}

const CP1252_HIGH = [
  0x20ac, 0x0000, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x0000,
  0x017d, 0x0000, 0x0000, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x0000, 0x017e, 0x0178,
]

export function decodeCp1252(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    if (b >= 0x80 && b < 0xa0) {
      const mapped = CP1252_HIGH[b - 0x80]!
      s += String.fromCharCode(mapped === 0 ? 0x3f : mapped)
    } else {
      s += String.fromCharCode(b)
    }
  }
  return s
}
