/**
 * Builds every static file the client chrome needs, at scim.gg's URL layout:
 *
 *   public/fonts/RuneScape-{Plain-12,Bold-12,Plain-11,Quill-8}.ttf   RuneStar fonts (CC0), copied
 *   public/fonts/RuneScape-Small.ttf                                  built from the cache font p11_full (494)
 *   public/assets/ui/packs/pack-vanilla/<category>/<name>.png         cache sprites (src/ui/packs/build/vanillaSprites.ts)
 *   public/assets/ui/packs/pack-{browntown,toblite,duckscape}/...     RuneLite resource packs (BSD-2) mapped to scim's names
 *   public/assets/ui/<misc>.png                                       health bars, hitsplats, overheads, skill icons, combat styles...
 *   public/assets/items/<id>.png                                      inventory icons rendered from the cache like the client
 *   src/ui/packs/packFiles.generated.ts                               which pack files exist (runtime fallback table)
 *
 * Usage: npx tsx scripts/build-ui-assets.ts [--all-wearables]
 *   --all-wearables also renders every equipable / ammo item in the cache (for the loadout editor's pickers).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CacheSystem } from '../src/cache/CacheSystem'
import { ObjTypeLoader } from '../src/cache/config/ObjType'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { SpriteLoader } from '../src/cache/sprite/SpriteLoader'
import { BitmapFont, FontIds } from '../src/ui/packs/build/bitmapFont'
import { ItemIconRenderer } from '../src/ui/packs/build/itemIcon'
import { encodePng, type RgbaImage } from '../src/ui/packs/build/png'
import { blit, flip, newImage, spriteImage } from '../src/ui/packs/build/raster'
import { SCIM_PACK_WHITELISTS } from '../src/ui/packs/build/scimWhitelist'
import { buildTtf } from '../src/ui/packs/build/ttf'
import { SKILL_ICON_SPRITES, type SpriteSource, UI_ASSET_SPRITES, VANILLA_SPRITES } from '../src/ui/packs/build/vanillaSprites'

const ROOT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const PUBLIC = join(ROOT, 'public')
const REF = join(ROOT, '.reference', 'assets')
const allWearables = process.argv.includes('--all-wearables')

const t0 = performance.now()
const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync(join(PUBLIC, 'osrs-cache', 'disk.zip')))))
const sprites = new SpriteLoader(cache)
const report: string[] = []

function writeFile(path: string, data: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}

function render(src: SpriteSource): RgbaImage | null {
  if (src.kind === 'sprite') return spriteImage(sprites, src.id, src.frame ?? 0)
  const layers = src.layers.map((l) => ({ l, img: spriteImage(sprites, l.id, l.frame ?? 0) }))
  if (layers.some((x) => !x.img)) return null
  const w = src.w || layers[0]!.img!.width
  const h = src.h || layers[0]!.img!.height
  const out = newImage(w, h)
  for (const { l, img } of layers) blit(out, l.flipH || l.flipV ? flip(img!, !!l.flipH, !!l.flipV) : img!, l.x, l.y)
  return out
}

/** Box-filter downscale (RuneLite ImageUtil.resizeImage-like smooth scaling). */
function downscale(src: RgbaImage, w: number, h: number): RgbaImage {
  const out = newImage(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = (x * src.width) / w
      const x1 = ((x + 1) * src.width) / w
      const y0 = (y * src.height) / h
      const y1 = ((y + 1) * src.height) / h
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const cov = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy))
          const i = (sy * src.width + sx) * 4
          const al = src.rgba[i + 3]! / 255
          r += src.rgba[i]! * al * cov
          g += src.rgba[i + 1]! * al * cov
          b += src.rgba[i + 2]! * al * cov
          a += al * cov
          wsum += cov
        }
      }
      const o = (y * w + x) * 4
      if (a > 0) {
        out.rgba[o] = r / a
        out.rgba[o + 1] = g / a
        out.rgba[o + 2] = b / a
      }
      out.rgba[o + 3] = (a / wsum) * 255
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------
{
  const dir = join(REF, 'runestar-fonts', 'ttf')
  for (const name of ['RuneScape-Plain-12', 'RuneScape-Bold-12', 'RuneScape-Plain-11', 'RuneScape-Quill-8']) {
    const from = join(dir, `${name}.ttf`)
    if (existsSync(from)) {
      mkdirSync(join(PUBLIC, 'fonts'), { recursive: true })
      copyFileSync(from, join(PUBLIC, 'fonts', `${name}.ttf`))
    } else report.push(`MISSING font source ${from}`)
  }
  const p11 = BitmapFont.load(cache, FontIds.p11)
  if (p11) {
    // scim's @font-face uses ascent-override 87.5% / descent 12.5% for this family.
    writeFile(join(PUBLIC, 'fonts', 'RuneScape-Small.ttf'), buildTtf(p11, { familyName: 'RuneScape Small', ascender: 14, descender: 2 }))
  } else report.push('MISSING cache font 494 (p11_full) for RuneScape-Small')
}

// ---------------------------------------------------------------------------
// Resource packs
// ---------------------------------------------------------------------------
let vanillaCount = 0
for (const [path, src] of Object.entries(VANILLA_SPRITES)) {
  const img = render(src)
  if (!img) {
    report.push(`MISSING vanilla sprite for ${path}`)
    continue
  }
  writeFile(join(PUBLIC, 'assets', 'ui', 'packs', 'pack-vanilla', path), encodePng(img))
  vanillaCount++
}

/** scim pack path -> RuneLite resource-pack path (same art, RuneLite's folder names). */
export function scimToRuneLite(path: string): string {
  const slash = path.indexOf('/')
  const cat = path.slice(0, slash)
  const name = path.slice(slash + 1)
  if (cat === 'buttons') return `button/${name}`
  if (cat === 'chatbox') return name === 'chat_background.png' ? 'chatbox/background.png' : `chatbox/${name.replace(/^chatbox_/, '')}`
  if (cat === 'equipment-slots') return `equipment/${name}`
  if (cat === 'panel') return name.startsWith('fixed_mode_') ? `fixed_mode/${name.slice('fixed_mode_'.length)}` : `resizeable_mode/${name}`
  if (cat === 'tabs') return `tab/${name}`
  return path
}

const packFiles: Record<string, string[]> = {}
for (const [pack, list] of Object.entries(SCIM_PACK_WHITELISTS)) {
  const dir = join(REF, 'packs', `resource-packs-${pack}`)
  const present: string[] = []
  const missing: string[] = []
  for (const path of list) {
    const from = join(dir, scimToRuneLite(path))
    if (!existsSync(from)) {
      missing.push(path)
      continue
    }
    const to = join(PUBLIC, 'assets', 'ui', 'packs', pack, path)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    present.push(path)
  }
  packFiles[pack] = present.sort()
  if (missing.length) report.push(`${pack}: ${missing.length} whitelisted files have no RuneLite source (fall back to vanilla): ${missing.join(', ')}`)
}
{
  let out =
    '// Generated by scripts/build-ui-assets.ts - do not edit.\n' +
    '// Pack-relative files present in each non-vanilla resource pack (scim `Ace` whitelist ∩ files built).\n' +
    'export const PACK_FILES: Readonly<Record<string, readonly string[]>> = {\n'
  for (const [pack, list] of Object.entries(packFiles)) {
    out += `  '${pack}': [\n`
    for (const f of list) out += `    '${f}',\n`
    out += '  ],\n'
  }
  out += '}\n'
  writeFileSync(join(ROOT, 'src', 'ui', 'packs', 'packFiles.generated.ts'), out)
}

// ---------------------------------------------------------------------------
// Misc UI assets under /assets/ui/
// ---------------------------------------------------------------------------
let uiCount = 0
for (const [path, src] of Object.entries(UI_ASSET_SPRITES)) {
  const img = render(src)
  if (!img) {
    report.push(`MISSING ui sprite for ${path}`)
    continue
  }
  writeFile(join(PUBLIC, 'assets', 'ui', path), encodePng(img))
  uiCount++
}
{
  // Status Bars prayer icon: the prayer skill icon scaled to 16x16 (RuneLite StatusBarsOverlay).
  const prayer = spriteImage(sprites, SKILL_ICON_SPRITES.prayer!)
  if (prayer) writeFile(join(PUBLIC, 'assets', 'ui', 'status-bars', 'prayer.png'), encodePng(downscale(prayer, 16, 16)))
  // Minimap NPC dot: frame 0 of sprite group 511 (scim converts it at runtime; we pre-bake it too).
  const dot = spriteImage(sprites, 511, 0)
  if (dot) writeFile(join(PUBLIC, 'assets', 'ui', 'minimap', 'npc-dot.png'), encodePng(dot))
  // Click crosses as horizontal PNG sheets (frames of sprite 299): 0-3 yellow, 4-7 red.
  const frames = [0, 1, 2, 3, 4, 5, 6, 7].map((f) => spriteImage(sprites, 299, f))
  if (frames.every((f) => f)) {
    for (const [name, start] of [
      ['yellow_click_sheet.png', 0],
      ['red_click_sheet.png', 4],
    ] as const) {
      const w = frames[0]!.width
      const h = frames[0]!.height
      const sheet = newImage(w * 4, h)
      for (let i = 0; i < 4; i++) blit(sheet, frames[start + i]!, i * w, 0)
      writeFile(join(PUBLIC, 'assets', 'ui', 'click-cross', name), encodePng(sheet))
    }
  }
}

// ---------------------------------------------------------------------------
// Item icons
// ---------------------------------------------------------------------------
/** scim's Zuk presets with the stack sizes they carry. */
const PRESET_ITEMS: [number, number][] = [
  // max_tbow
  [25912, 1], [28951, 1], [33639, 1], [20997, 1], [27238, 1], [27241, 1], [26235, 1], [31097, 1], [28310, 1],
  [21006, 1], [12817, 1], [26243, 1], [26245, 1], [31106, 1], [12926, 1], [27281, 1], [22947, 1], [33595, 1], [11230, 1],
  // shared supplies block XA
  [6685, 1], [3024, 1], [22461, 1], [30125, 1], [12625, 1],
  // bowfa
  [23971, 1], [22109, 1], [19547, 1], [25865, 1], [23975, 1], [23979, 1], [7462, 1], [22954, 1], [26764, 1],
  [27624, 1], [23991, 1], [4712, 1], [4714, 1], [12002, 1], [25849, 1],
  // atlatl_eclipse
  [29035, 1], [6585, 1], [9185, 1], [29031, 1], [29033, 1], [29806, 1], [29000, 1], [28991, 4000], [6914, 1], [12695, 1], [12791, 1], [9242, 1],
  // budget_rcb
  [4753, 1], [12492, 1], [12494, 1], [19921, 1], [25404, 1], [25416, 1], [9243, 1000],
  // mage_tank
  [21018, 1], [21791, 1], [27275, 1], [21021, 1], [21024, 1], [28313, 1], [31113, 1], [22326, 1], [27251, 1], [4759, 1], [11832, 1], [31638, 1], [27641, 1],
]
/** Consumable dose chains and misc. */
const CONSUMABLES: number[] = [
  22461, 22464, 22467, 22470, 12625, 12627, 12629, 12631, 30125, 30128, 30131, 30134, 31650, 31653, 31656, 31659, 13441, 29143, 3144, 27641, 10925, 10927, 10929, 10931,
  3024, 3026, 3028, 3030, 6685, 6687, 6689, 6691, 12695, 12697, 12699, 12701, 23685, 23688, 23691, 23694, 27629, 27632, 27635, 27638, 4417, 4419, 4421, 4423, 1980, 5952, 5954,
  5956, 5958, 31638, 31641, 31644, 31647, 31614, 31617, 31620, 31623, 30875, 30878, 30881, 30884, 2434, 139, 141, 143, 29183, 29201, 229, 22081, 7510,
  // infobox icons: saturated heart, antipoison, surge potion
  2446,
]
/** Runes and rune pouches. */
const RUNES = [556, 555, 557, 554, 4695, 4696, 4698, 4697, 4694, 4699, 558, 559, 564, 562, 561, 563, 560, 565, 566, 21880, 30843, 12791, 27281, 24416, 27086]
const ITEM_LIST: number[] = (JSON.parse(readFileSync(join(ROOT, 'scripts', 'item-list.json'), 'utf8')) as { id: number }[]).map((x) => x.id)

const objs = new ObjTypeLoader(cache)
const wanted = new Map<number, number>()
const want = (id: number, qty = 1): void => {
  if (!wanted.has(id) || qty > 1) wanted.set(id, qty)
}
for (const [id, q] of PRESET_ITEMS) want(id, q)
for (const id of [...CONSUMABLES, ...RUNES, ...ITEM_LIST]) want(id)
if (allWearables) {
  for (const id of objs.ids) {
    const o = objs.load(id)
    if (o.isNoted || o.isPlaceholder || o.name === 'null' || !o.name) continue
    if (o.wearPos1 < 0 || ![0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 13].includes(o.wearPos1)) continue
    want(id)
  }
}
const renderer = new ItemIconRenderer(cache)
let itemCount = 0
const itemFails: number[] = []
for (const [id, qty] of wanted) {
  if (!objs.has(id)) {
    itemFails.push(id)
    continue
  }
  // Stackables show their stack-size model; with no preset count, use a generic stack of 1000.
  const o = objs.load(id)
  const count = qty > 1 ? qty : o.countObj.length > 0 ? 1000 : 1
  let img = null
  try {
    img = renderer.render(id, count)
  } catch (e) {
    report.push(`item ${id} render error: ${(e as Error).message}`)
  }
  if (!img) {
    itemFails.push(id)
    continue
  }
  writeFile(join(PUBLIC, 'assets', 'items', `${id}.png`), encodePng(img))
  itemCount++
}
if (itemFails.length) report.push(`items without an icon: ${itemFails.join(', ')}`)

console.log(
  `fonts ok; vanilla ${vanillaCount}/${Object.keys(VANILLA_SPRITES).length}; packs ${Object.entries(packFiles)
    .map(([k, v]) => `${k} ${v.length}`)
    .join(', ')}; ui ${uiCount}; items ${itemCount}; ${((performance.now() - t0) / 1000).toFixed(1)} s`,
)
for (const line of report) console.log(`  - ${line}`)
