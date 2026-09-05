/**
 * Minimal bzip2 decompressor (decode only), written for the OSRS cache where
 * payloads are "BZh1" streams stored without the 4-byte stream header.
 * Handles multi-block streams; randomised blocks (an obsolete feature) are
 * rejected. CRCs are not verified.
 */

const BLOCK_MAGIC_HI = 0x314159
const BLOCK_MAGIC_LO = 0x265359
const EOS_MAGIC_HI = 0x177245
const EOS_MAGIC_LO = 0x385090
const MAX_CODE_LEN = 20
const MAX_GROUPS = 6
const GROUP_SIZE = 50
const RUNA = 0
const RUNB = 1

class BitReader {
  private readonly data: Uint8Array
  private pos = 0
  private bitBuf = 0
  private bitCount = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  bits(n: number): number {
    while (this.bitCount < n) {
      if (this.pos >= this.data.length) {
        throw new Error('bzip2: unexpected end of input')
      }
      this.bitBuf = ((this.bitBuf << 8) | this.data[this.pos++]!) >>> 0
      this.bitCount += 8
    }
    this.bitCount -= n
    const v = (this.bitBuf >>> this.bitCount) & ((1 << n) - 1)
    this.bitBuf &= (1 << this.bitCount) - 1
    return v
  }

  bit(): number {
    return this.bits(1)
  }
}

interface HuffmanTable {
  minLen: number
  limit: Int32Array
  base: Int32Array
  perm: Int32Array
}

function buildTable(lengths: Uint8Array, alphaSize: number): HuffmanTable {
  let minLen = 32
  let maxLen = 0
  for (let i = 0; i < alphaSize; i++) {
    const l = lengths[i]!
    if (l > maxLen) maxLen = l
    if (l < minLen) minLen = l
  }
  const perm = new Int32Array(alphaSize)
  let pp = 0
  for (let i = minLen; i <= maxLen; i++) {
    for (let j = 0; j < alphaSize; j++) {
      if (lengths[j] === i) perm[pp++] = j
    }
  }
  const base = new Int32Array(MAX_CODE_LEN + 2)
  for (let i = 0; i < alphaSize; i++) base[lengths[i]! + 1]!++
  for (let i = 1; i < base.length; i++) base[i]! += base[i - 1]!
  const limit = new Int32Array(MAX_CODE_LEN + 2)
  let vec = 0
  for (let i = minLen; i <= maxLen; i++) {
    vec += base[i + 1]! - base[i]!
    limit[i] = vec - 1
    vec <<= 1
  }
  for (let i = minLen + 1; i <= maxLen; i++) {
    base[i] = ((limit[i - 1]! + 1) << 1) - base[i]!
  }
  for (let i = maxLen + 1; i < limit.length; i++) limit[i] = 0x7fffffff
  return { minLen, limit, base, perm }
}

function decodeSymbol(br: BitReader, t: HuffmanTable): number {
  let n = t.minLen
  let code = br.bits(n)
  while (code > t.limit[n]!) {
    if (++n > MAX_CODE_LEN) throw new Error('bzip2: bad huffman code')
    code = (code << 1) | br.bit()
  }
  const idx = code - t.base[n]!
  if (idx < 0 || idx >= t.perm.length) throw new Error('bzip2: huffman index out of range')
  return t.perm[idx]!
}

/**
 * @param payload  bzip2 stream bytes, with the "BZh<level>" header present.
 * @param expectedLength  size hint for the output buffer; the result is exact.
 */
export function bzip2DecompressStream(payload: Uint8Array, expectedLength?: number): Uint8Array {
  if (payload[0] !== 0x42 || payload[1] !== 0x5a || payload[2] !== 0x68) {
    throw new Error('bzip2: missing BZh header')
  }
  const level = payload[3]! - 0x30
  if (level < 1 || level > 9) throw new Error(`bzip2: bad block size level ${level}`)
  const blockMax = level * 100000

  const br = new BitReader(payload.subarray(4))
  let out = new Uint8Array(expectedLength ?? blockMax * 2)
  let outPos = 0
  const ensure = (extra: number) => {
    if (outPos + extra > out.length) {
      const grown = new Uint8Array(Math.max(out.length * 2, outPos + extra))
      grown.set(out.subarray(0, outPos))
      out = grown
    }
  }

  const tt = new Uint32Array(blockMax)
  const lengths = new Uint8Array(258)
  const tables: HuffmanTable[] = []

  for (;;) {
    const magicHi = br.bits(24)
    const magicLo = br.bits(24)
    if (magicHi === EOS_MAGIC_HI && magicLo === EOS_MAGIC_LO) {
      br.bits(32) // combined CRC
      break
    }
    if (magicHi !== BLOCK_MAGIC_HI || magicLo !== BLOCK_MAGIC_LO) {
      throw new Error('bzip2: bad block magic')
    }
    br.bits(32) // block CRC
    if (br.bit() !== 0) throw new Error('bzip2: randomised blocks are not supported')
    const origPtr = br.bits(24)

    // Symbol map.
    const seqToUnseq = new Uint8Array(256)
    let nInUse = 0
    const inUse16 = br.bits(16)
    for (let i = 0; i < 16; i++) {
      if ((inUse16 & (0x8000 >>> i)) !== 0) {
        const bitsGroup = br.bits(16)
        for (let j = 0; j < 16; j++) {
          if ((bitsGroup & (0x8000 >>> j)) !== 0) {
            seqToUnseq[nInUse++] = i * 16 + j
          }
        }
      }
    }
    if (nInUse === 0) throw new Error('bzip2: empty symbol map')
    const alphaSize = nInUse + 2

    const nGroups = br.bits(3)
    if (nGroups < 2 || nGroups > MAX_GROUPS) throw new Error('bzip2: bad group count')
    const nSelectors = br.bits(15)
    if (nSelectors < 1) throw new Error('bzip2: bad selector count')

    // Selectors, MTF-coded.
    const selectors = new Uint8Array(nSelectors)
    const mtfPos = new Uint8Array(MAX_GROUPS)
    for (let i = 0; i < nGroups; i++) mtfPos[i] = i
    for (let i = 0; i < nSelectors; i++) {
      let j = 0
      while (br.bit() === 1) {
        if (++j >= nGroups) throw new Error('bzip2: bad selector')
      }
      const v = mtfPos[j]!
      for (let k = j; k > 0; k--) mtfPos[k] = mtfPos[k - 1]!
      mtfPos[0] = v
      selectors[i] = v
    }

    // Code lengths per group and decoding tables.
    tables.length = 0
    for (let t = 0; t < nGroups; t++) {
      let curr = br.bits(5)
      for (let i = 0; i < alphaSize; i++) {
        for (;;) {
          if (curr < 1 || curr > MAX_CODE_LEN) throw new Error('bzip2: bad code length')
          if (br.bit() === 0) break
          curr += br.bit() === 0 ? 1 : -1
        }
        lengths[i] = curr
      }
      tables.push(buildTable(lengths, alphaSize))
    }

    // MTF/RLE2 decode into tt.
    const eob = nInUse + 1
    const unzftab = new Int32Array(256)
    const yy = new Uint8Array(256)
    for (let i = 0; i < nInUse; i++) yy[i] = i
    let groupNo = -1
    let groupPos = 0
    let table = tables[0]!
    let nblock = 0
    const next = (): number => {
      if (groupPos === 0) {
        groupNo++
        if (groupNo >= nSelectors) throw new Error('bzip2: selector overflow')
        groupPos = GROUP_SIZE
        table = tables[selectors[groupNo]!]!
      }
      groupPos--
      return decodeSymbol(br, table)
    }

    let sym = next()
    for (;;) {
      if (sym === eob) break
      if (sym === RUNA || sym === RUNB) {
        let es = -1
        let n = 1
        do {
          es += sym === RUNA ? n : 2 * n
          n <<= 1
          if (n >= 2 * 1024 * 1024) throw new Error('bzip2: run too long')
          sym = next()
        } while (sym === RUNA || sym === RUNB)
        es++
        const uc = seqToUnseq[yy[0]!]!
        unzftab[uc]! += es
        if (nblock + es > blockMax) throw new Error('bzip2: block overflow')
        while (es-- > 0) tt[nblock++] = uc
        continue
      }
      const nn = sym - 1
      const ucIdx = yy[nn]!
      for (let k = nn; k > 0; k--) yy[k] = yy[k - 1]!
      yy[0] = ucIdx
      const uc = seqToUnseq[ucIdx]!
      unzftab[uc]!++
      if (nblock >= blockMax) throw new Error('bzip2: block overflow')
      tt[nblock++] = uc
      sym = next()
    }
    if (origPtr < 0 || origPtr >= nblock) throw new Error('bzip2: bad origPtr')

    // Inverse BWT.
    const cftab = new Int32Array(257)
    for (let i = 0; i < 256; i++) cftab[i + 1] = cftab[i]! + unzftab[i]!
    for (let i = 0; i < nblock; i++) {
      const uc = tt[i]! & 0xff
      tt[cftab[uc]!]! |= i << 8
      cftab[uc]!++
    }

    // Walk the BWT chain and undo RLE1.
    let tPos = tt[origPtr]! >>> 8
    let count = 0
    let prev = -1
    ensure(nblock)
    for (let i = 0; i < nblock; i++) {
      const entry = tt[tPos]!
      const b = entry & 0xff
      tPos = entry >>> 8
      if (count === 4) {
        ensure(b)
        for (let k = 0; k < b; k++) out[outPos++] = prev
        count = 0
        continue
      }
      if (b === prev) {
        count++
      } else {
        prev = b
        count = 1
      }
      ensure(1)
      out[outPos++] = b
    }
  }

  return outPos === out.length ? out : out.subarray(0, outPos)
}

const HEADER = new Uint8Array([0x42, 0x5a, 0x68, 0x31]) // "BZh1"

/** Decompress a header-less cache bzip2 payload. */
export function bzip2Decompress(payload: Uint8Array, uncompressedLength: number): Uint8Array {
  const withHeader = new Uint8Array(payload.length + 4)
  withHeader.set(HEADER, 0)
  withHeader.set(payload, 4)
  return bzip2DecompressStream(withHeader, uncompressedLength)
}
