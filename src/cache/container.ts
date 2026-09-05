import { ByteReader } from './ByteReader'
import { bzip2Decompress } from './bzip2'
import { gzipDecompress } from './gzip'
import { xteaDecrypt } from './xtea'

export const Compression = {
  None: 0,
  Bzip2: 1,
  Gzip: 2,
  Lzma: 3,
} as const
export type Compression = (typeof Compression)[keyof typeof Compression]

export interface Container {
  compression: Compression
  data: Uint8Array
  /** Trailing 2-byte version, if the container carried one. */
  version: number | null
}

/**
 * Decode a JS5 container: [compression u8][compressedLength i32]
 * [uncompressedLength i32 if compressed][payload][version u16?].
 * XTEA, when used, covers everything after the 5-byte header except the
 * version trailer.
 */
export function decodeContainer(raw: Uint8Array, keys?: readonly number[] | null): Container {
  const r = new ByteReader(raw)
  const compression = r.u8() as Compression
  const compressedLength = r.i32()
  if (compressedLength < 0 || compressedLength > raw.length - 5) {
    throw new Error(`Bad container length ${compressedLength} (buffer ${raw.length})`)
  }

  let body: Uint8Array
  const encryptedLength = compression === Compression.None ? compressedLength : compressedLength + 4
  if (keys && keys.length === 4 && keys.some((k) => k !== 0)) {
    body = xteaDecrypt(raw.subarray(5, 5 + encryptedLength), keys)
  } else {
    body = raw.subarray(5, 5 + encryptedLength)
  }

  const trailer = raw.length - (5 + encryptedLength)
  const version = trailer >= 2 ? ((raw[5 + encryptedLength]! << 8) | raw[5 + encryptedLength + 1]!) : null

  let data: Uint8Array
  if (compression === Compression.None) {
    data = body
  } else {
    const br = new ByteReader(body)
    const uncompressedLength = br.i32()
    const payload = body.subarray(4, 4 + compressedLength)
    switch (compression) {
      case Compression.Bzip2:
        data = bzip2Decompress(payload, uncompressedLength)
        break
      case Compression.Gzip:
        data = gzipDecompress(payload)
        break
      case Compression.Lzma:
        throw new Error('LZMA containers are not supported')
      default:
        throw new Error(`Unknown compression ${compression}`)
    }
    if (data.length !== uncompressedLength) {
      throw new Error(`Decompressed ${data.length} bytes, expected ${uncompressedLength}`)
    }
  }

  return { compression, data, version }
}
