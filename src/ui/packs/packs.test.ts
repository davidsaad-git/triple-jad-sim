import { describe, expect, it } from 'vitest'
import { CHROME_PACK_PATHS, DEFAULT_PACK, packAsset, packHasFile, resolvePackFolder, resolvePackId, RESOURCE_PACKS, VANILLA_PACK } from './index'
import { PACK_FILES } from './packFiles.generated'
import { SCIM_PACK_WHITELISTS } from './build/scimWhitelist'
import { decodePng, encodePng } from './build/png'
import { paletteFor, PACK_PALETTES, THEME_CSS_VARIABLES } from '../theme/palettes'

interface FsLike {
  existsSync(path: string): boolean
  readFileSync(path: string): Uint8Array
}
const fs = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.('node:fs') as FsLike | undefined
const PUBLIC_BUILT = !!fs?.existsSync('public/assets/ui/packs/pack-vanilla/panel/side_panel_background.png')

describe('resource pack resolution', () => {
  it('defaults to Brown Theme and maps unknown ids to Vanilla', () => {
    expect(DEFAULT_PACK).toBe('pack-browntown')
    expect(RESOURCE_PACKS.map((p) => p.id)).toEqual(['pack-vanilla', 'pack-browntown', 'pack-toblite', 'pack-duckscape'])
    expect(resolvePackId('pack-nope')).toBe(VANILLA_PACK)
    expect(resolvePackId(undefined)).toBe(VANILLA_PACK)
  })

  it('uses the pack copy only for whitelisted, built files', () => {
    expect(resolvePackFolder('panel/side_panel_background.png', 'pack-browntown')).toBe('pack-browntown')
    // tab icons are not in the Brown whitelist -> Vanilla
    expect(resolvePackFolder('tabs/combat.png', 'pack-browntown')).toBe(VANILLA_PACK)
    // whitelisted but no RuneLite source -> Vanilla
    expect(packHasFile('pack-browntown', 'other/reset_killcount_button.png')).toBe(false)
    expect(packAsset('tabs/prayer.png', 'pack-browntown')).toBe('/assets/ui/packs/pack-vanilla/tabs/prayer.png')
    expect(packAsset('panel/tabs_top_row.png', 'pack-browntown')).toBe('/assets/ui/packs/pack-browntown/panel/tabs_top_row.png')
    expect(packAsset('anything.png', 'pack-unknown')).toBe('/assets/ui/packs/pack-vanilla/anything.png')
  })

  it('generated pack lists are subsets of scim whitelists', () => {
    for (const [pack, files] of Object.entries(PACK_FILES)) {
      const allowed = new Set(SCIM_PACK_WHITELISTS[pack as keyof typeof SCIM_PACK_WHITELISTS])
      for (const f of files) expect(allowed.has(f), `${pack}/${f}`).toBe(true)
    }
  })

  it.skipIf(!PUBLIC_BUILT)('pack-vanilla contains every chrome path and every pack file exists', () => {
    for (const p of CHROME_PACK_PATHS) expect(fs!.existsSync(`public/assets/ui/packs/pack-vanilla/${p}`), p).toBe(true)
    for (const [pack, files] of Object.entries(PACK_FILES)) {
      for (const f of files) expect(fs!.existsSync(`public/assets/ui/packs/${pack}/${f}`), `${pack}/${f}`).toBe(true)
    }
  })
})

describe('theme palettes (08 §9.2)', () => {
  it('defines every CSS variable for every pack', () => {
    for (const pack of RESOURCE_PACKS) {
      const pal = paletteFor(pack.id)
      for (const v of THEME_CSS_VARIABLES) expect(pal[v], `${pack.id} ${v}`).toBeTruthy()
    }
    expect(PACK_PALETTES['pack-browntown']['color-primary']).toBe('#d4a54a')
    expect(PACK_PALETTES['pack-vanilla']['color-primary']).toBe('#ff981f')
    expect(paletteFor('pack-nope')['color-primary']).toBe('#d4a54a')
  })
})

describe('png codec', () => {
  it('round-trips RGBA', () => {
    const rgba = new Uint8ClampedArray(3 * 2 * 4)
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) & 255
    const img = decodePng(encodePng({ width: 3, height: 2, rgba }))
    expect(img.width).toBe(3)
    expect(img.height).toBe(2)
    expect(Array.from(img.rgba)).toEqual(Array.from(rgba))
  })
})
