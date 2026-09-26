/**
 * Builds a TrueType font from one of the client's bitmap fonts, the way the
 * RuneStar / RuneLite "RuneScape" TTFs are made: every opaque glyph pixel
 * becomes a 1x1 unit square (unitsPerEm 16, so at font-size 16px one font
 * pixel is one CSS pixel), traced into outline contours.
 *
 * Used for "RuneScape Small" (/fonts/RuneScape-Small.ttf), which scim.gg loads
 * but which is not part of the RuneStar set.
 */
import type { BitmapFont } from './bitmapFont'

export interface TtfOptions {
  familyName: string
  /** hhea/OS2 ascender and descender in font pixels (CSS ascent-override wins anyway). */
  ascender: number
  descender: number
  version?: string
}

/** CP-1252 code points for glyph indices 128-159 (0 = unmapped). */
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
]

type Pt = readonly [number, number]

/**
 * Trace the boundary of a pixel mask into closed contours with the filled area
 * on the right-hand side (TrueType outer contours are clockwise in y-up
 * space). `mask[y][x]`, y down; output points in y-up pixel units with the
 * mask's top row at `topY`.
 */
export function traceContours(width: number, height: number, filled: (x: number, y: number) => boolean, left: number, topY: number): Pt[][] {
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && filled(x, y)
  // Directed boundary edges in a y-down grid of corner points (from -> to).
  const edges = new Map<string, [number, number][]>()
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    const key = `${x0},${y0}`
    let list = edges.get(key)
    if (!list) edges.set(key, (list = []))
    list.push([x1, y1])
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!on(x, y)) continue
      // Visually clockwise around filled pixels (flipping y keeps the visual
      // orientation): top edge left->right, right edge down, bottom edge
      // right->left, left edge up.
      if (!on(x, y - 1)) add(x, y, x + 1, y)
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!on(x - 1, y)) add(x, y + 1, x, y)
    }
  }
  const contours: Pt[][] = []
  const takeEdge = (key: string): [number, number] | undefined => {
    const list = edges.get(key)
    if (!list || list.length === 0) return undefined
    const e = list.shift()!
    if (list.length === 0) edges.delete(key)
    return e
  }
  while (edges.size > 0) {
    const startKey = edges.keys().next().value as string
    const [sx, sy] = startKey.split(',').map(Number) as [number, number]
    const loop: [number, number][] = [[sx, sy]]
    let cur = takeEdge(startKey)
    let prevDir: [number, number] = [0, 0]
    while (cur) {
      const [cx, cy] = cur
      if (cx === sx && cy === sy) break
      loop.push([cx, cy])
      const key = `${cx},${cy}`
      const list = edges.get(key)
      if (list && list.length > 1) {
        // Two outgoing edges at a pinch point: prefer turning right (keeps loops simple).
        const last = loop[loop.length - 2]!
        prevDir = [cx - last[0], cy - last[1]]
        list.sort((a, b) => turnScore(prevDir, [a[0] - cx, a[1] - cy]) - turnScore(prevDir, [b[0] - cx, b[1] - cy]))
      }
      cur = takeEdge(key)
    }
    // Drop collinear points.
    const simplified: [number, number][] = []
    for (let i = 0; i < loop.length; i++) {
      const p = loop[(i - 1 + loop.length) % loop.length]!
      const c = loop[i]!
      const n = loop[(i + 1) % loop.length]!
      const cross = (c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0])
      if (cross !== 0) simplified.push(c)
    }
    contours.push(simplified.map(([x, y]) => [left + x, topY - y] as const))
  }
  return contours
}

/** Lower is preferred: right turn (in y-down, that's a clockwise turn) first. */
function turnScore(d: [number, number], e: [number, number]): number {
  const cross = d[0] * e[1] - d[1] * e[0]
  const dot = d[0] * e[0] + d[1] * e[1]
  if (cross > 0) return 0
  if (dot > 0) return 1
  return 2
}

class Writer {
  private bytes: number[] = []
  u8(v: number): this {
    this.bytes.push(v & 0xff)
    return this
  }
  u16(v: number): this {
    return this.u8(v >> 8).u8(v)
  }
  i16(v: number): this {
    return this.u16(v < 0 ? v + 0x10000 : v)
  }
  u32(v: number): this {
    return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff)
  }
  tag(s: string): this {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i))
    return this
  }
  raw(b: Uint8Array | number[]): this {
    for (const v of b) this.bytes.push(v & 0xff)
    return this
  }
  pad4(): this {
    while (this.bytes.length % 4) this.bytes.push(0)
    return this
  }
  get length(): number {
    return this.bytes.length
  }
  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

function checksum(b: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < b.length; i += 4) {
    const v = ((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)
    sum = (sum + (v >>> 0)) >>> 0
  }
  return sum
}

interface GlyphData {
  advance: number
  contours: Pt[][]
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

function encodeGlyph(g: GlyphData): Uint8Array {
  if (g.contours.length === 0) return new Uint8Array(0)
  const w = new Writer()
  w.i16(g.contours.length).i16(g.xMin).i16(g.yMin).i16(g.xMax).i16(g.yMax)
  let end = -1
  for (const c of g.contours) {
    end += c.length
    w.u16(end)
  }
  w.u16(0) // instructionLength
  const pts = g.contours.flat()
  // Flags: on-curve, x/y as 16-bit deltas (no short vectors, keeps it simple and valid).
  for (let i = 0; i < pts.length; i++) w.u8(0x01)
  let px = 0
  for (const [x] of pts) {
    w.i16(x - px)
    px = x
  }
  let py = 0
  for (const [, y] of pts) {
    w.i16(y - py)
    py = y
  }
  return w.pad4().toBytes()
}

function utf16be(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out.push(c >> 8, c & 0xff)
  }
  return out
}

/** Build the .ttf bytes for a bitmap font. Glyph 0 is .notdef, glyph i+1 is font glyph i (0..255). */
export function buildTtf(font: BitmapFont, options: TtfOptions): Uint8Array {
  const glyphs: GlyphData[] = [{ advance: 0, contours: [], xMin: 0, yMin: 0, xMax: 0, yMax: 0 }]
  for (let c = 0; c < 256; c++) {
    const g = font.glyphs[c]!
    const topY = font.ascent - g.top
    const contours =
      g.width > 0 ? traceContours(g.width, g.height, (x, y) => g.alpha[y * g.width + x]! > 0, g.left, topY) : []
    let xMin = 0
    let yMin = 0
    let xMax = 0
    let yMax = 0
    if (contours.length) {
      const pts = contours.flat()
      xMin = Math.min(...pts.map((p) => p[0]))
      xMax = Math.max(...pts.map((p) => p[0]))
      yMin = Math.min(...pts.map((p) => p[1]))
      yMax = Math.max(...pts.map((p) => p[1]))
    }
    glyphs.push({ advance: font.advances[c]!, contours, xMin, yMin, xMax, yMax })
  }
  const numGlyphs = glyphs.length
  const glyfParts = glyphs.map(encodeGlyph)
  const glyf = new Writer()
  const offsets: number[] = []
  for (const p of glyfParts) {
    offsets.push(glyf.length)
    glyf.raw(p)
  }
  offsets.push(glyf.length)
  const loca = new Writer()
  for (const o of offsets) loca.u32(o)

  const all = glyphs.filter((g) => g.contours.length)
  const bxMin = Math.min(...all.map((g) => g.xMin))
  const byMin = Math.min(...all.map((g) => g.yMin))
  const bxMax = Math.max(...all.map((g) => g.xMax))
  const byMax = Math.max(...all.map((g) => g.yMax))
  const maxPoints = Math.max(...glyphs.map((g) => g.contours.reduce((n, c) => n + c.length, 0)))
  const maxContours = Math.max(...glyphs.map((g) => g.contours.length))
  const maxAdvance = Math.max(...glyphs.map((g) => g.advance))

  const head = new Writer()
    .u32(0x00010000)
    .u32(0x00010000) // fontRevision 1.0
    .u32(0) // checkSumAdjustment (patched later)
    .u32(0x5f0f3cf5)
    .u16(0x000b) // flags: baseline at y=0, lsb at x=0, integer ppem
    .u16(16) // unitsPerEm
    .u32(0)
    .u32(0) // created
    .u32(0)
    .u32(0) // modified
    .i16(bxMin)
    .i16(byMin)
    .i16(bxMax)
    .i16(byMax)
    .u16(0) // macStyle
    .u16(8) // lowestRecPPEM
    .i16(2) // fontDirectionHint
    .i16(1) // indexToLocFormat: long
    .i16(0)

  const hhea = new Writer()
    .u32(0x00010000)
    .i16(options.ascender)
    .i16(-options.descender)
    .i16(0) // lineGap
    .u16(maxAdvance)
    .i16(Math.min(0, bxMin)) // minLeftSideBearing
    .i16(0) // minRightSideBearing
    .i16(bxMax) // xMaxExtent
    .i16(1)
    .i16(0)
    .i16(0) // caret slope/offset
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0) // metricDataFormat
    .u16(numGlyphs)

  const maxp = new Writer()
    .u32(0x00010000)
    .u16(numGlyphs)
    .u16(maxPoints)
    .u16(maxContours)
    .u16(0)
    .u16(0)
    .u16(2) // maxZones
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)

  const hmtx = new Writer()
  for (const g of glyphs) hmtx.u16(g.advance).i16(g.contours.length ? g.xMin : 0)

  // cmap format 4: Unicode -> glyph (font glyph index + 1).
  const map = new Map<number, number>()
  for (let c = 32; c < 256; c++) {
    if (c === 127) continue
    const cp = c >= 128 && c < 160 ? CP1252_HIGH[c - 128]! : c
    if (cp === 0) continue
    map.set(cp, c + 1)
  }
  const codes = [...map.keys()].sort((a, b) => a - b)
  const segments: { start: number; end: number; glyphs: number[] }[] = []
  for (const cp of codes) {
    const last = segments[segments.length - 1]
    if (last && cp === last.end + 1) {
      last.end = cp
      last.glyphs.push(map.get(cp)!)
    } else segments.push({ start: cp, end: cp, glyphs: [map.get(cp)!] })
  }
  segments.push({ start: 0xffff, end: 0xffff, glyphs: [0] })
  const segX2 = segments.length * 2
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segments.length))
  const sub = new Writer()
  const glyphIdArray: number[] = []
  const idRangeOffsets: number[] = []
  const idDeltas: number[] = []
  segments.forEach((seg, i) => {
    const delta = seg.glyphs[0]! - seg.start
    const constantDelta = seg.glyphs.every((g, k) => g - (seg.start + k) === delta)
    if (constantDelta || seg.start === 0xffff) {
      idDeltas.push(seg.start === 0xffff ? 1 : (delta + 0x10000) & 0xffff)
      idRangeOffsets.push(0)
    } else {
      idDeltas.push(0)
      idRangeOffsets.push((segments.length - i + glyphIdArray.length) * 2)
      glyphIdArray.push(...seg.glyphs)
    }
  })
  const cmapLen = 16 + segX2 * 4 + glyphIdArray.length * 2
  sub
    .u16(4)
    .u16(cmapLen)
    .u16(0)
    .u16(segX2)
    .u16(searchRange)
    .u16(Math.floor(Math.log2(segments.length)))
    .u16(segX2 - searchRange)
  for (const seg of segments) sub.u16(seg.end)
  sub.u16(0)
  for (const seg of segments) sub.u16(seg.start)
  for (const d of idDeltas) sub.u16(d)
  for (const r of idRangeOffsets) sub.u16(r)
  for (const g of glyphIdArray) sub.u16(g)
  const cmap = new Writer().u16(0).u16(2).u16(0).u16(3).u32(20).u16(3).u16(1).u32(20).raw(sub.toBytes())

  const os2 = new Writer()
    .u16(4) // version
    .i16(Math.round(glyphs.reduce((n, g) => n + g.advance, 0) / numGlyphs)) // xAvgCharWidth
    .u16(400)
    .u16(5)
    .u16(0) // fsType: installable
    .i16(3)
    .i16(3)
    .i16(0)
    .i16(0) // subscript
    .i16(3)
    .i16(3)
    .i16(0)
    .i16(4) // superscript
    .i16(1)
    .i16(4) // strikeout
    .i16(0) // family class
    .raw(new Array(10).fill(0)) // panose
    .u32(1)
    .u32(0)
    .u32(0)
    .u32(0) // unicode ranges (Basic Latin)
    .tag('RSCP')
    .u16(0x0040) // fsSelection REGULAR
    .u16(codes[0]!)
    .u16(codes[codes.length - 1]!)
    .i16(options.ascender)
    .i16(-options.descender)
    .i16(0)
    .u16(Math.max(options.ascender, byMax))
    .u16(Math.max(options.descender, -byMin))
    .u32(1)
    .u32(0) // code page ranges (Latin 1)
    .i16(0) // sxHeight
    .i16(0) // sCapHeight
    .u16(0)
    .u16(32)
    .u16(0)

  const version = options.version ?? 'Version 1.0'
  const names: [number, string][] = [
    [1, options.familyName],
    [2, 'Regular'],
    [3, `${options.familyName}; built from the OSRS cache bitmap font`],
    [4, options.familyName],
    [5, version],
    [6, options.familyName.replace(/\s+/g, '')],
  ]
  const strings: number[][] = names.map(([, v]) => utf16be(v))
  const name = new Writer().u16(0).u16(names.length).u16(6 + names.length * 12)
  let strOff = 0
  names.forEach(([id], i) => {
    name.u16(3).u16(1).u16(0x0409).u16(id).u16(strings[i]!.length).u16(strOff)
    strOff += strings[i]!.length
  })
  for (const s of strings) name.raw(s)

  const post = new Writer().u32(0x00030000).u32(0).i16(-1).i16(1).u32(0).u32(0).u32(0).u32(0).u32(0)

  const tables: [string, Uint8Array][] = [
    ['OS/2', os2.toBytes()],
    ['cmap', cmap.toBytes()],
    ['glyf', glyf.toBytes()],
    ['head', head.toBytes()],
    ['hhea', hhea.toBytes()],
    ['hmtx', hmtx.toBytes()],
    ['loca', loca.toBytes()],
    ['maxp', maxp.toBytes()],
    ['name', name.toBytes()],
    ['post', post.toBytes()],
  ]
  const numTables = tables.length
  const entrySelector = Math.floor(Math.log2(numTables))
  const out = new Writer()
    .u32(0x00010000)
    .u16(numTables)
    .u16(16 * 2 ** entrySelector)
    .u16(entrySelector)
    .u16(numTables * 16 - 16 * 2 ** entrySelector)
  let offset = 12 + numTables * 16
  const layout: { tag: string; data: Uint8Array; offset: number }[] = []
  for (const [tag, data] of tables) {
    layout.push({ tag, data, offset })
    offset += Math.ceil(data.length / 4) * 4
  }
  for (const t of layout) out.tag(t.tag).u32(checksum(t.data)).u32(t.offset).u32(t.data.length)
  for (const t of layout) out.raw(t.data).pad4()
  const bytes = out.toBytes()
  // head.checkSumAdjustment = 0xB1B0AFBA - checksum(whole font)
  const headEntry = layout.find((t) => t.tag === 'head')!
  const adj = (0xb1b0afba - checksum(bytes)) >>> 0
  bytes[headEntry.offset + 8] = (adj >>> 24) & 0xff
  bytes[headEntry.offset + 9] = (adj >>> 16) & 0xff
  bytes[headEntry.offset + 10] = (adj >>> 8) & 0xff
  bytes[headEntry.offset + 11] = adj & 0xff
  return bytes
}
