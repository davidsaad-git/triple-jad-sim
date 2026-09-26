/**
 * Generates the renderer's fallback overlay images from cache sprites into
 * public/assets/render/ (used when the CLIENT-UI assets at scim's paths
 * /assets/ui/... are missing):
 *   hitsplat-{damage,block,poison,heal}.png, healthbar/default_{back,front}_{W}px.png,
 *   overhead_{melee,missiles,magic,redemption}.png
 *   npx tsx scripts/render-build-assets.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { CacheSystem } from '../src/cache/CacheSystem'
import { HealthBarTypeLoader } from '../src/cache/config/HealthBarType'
import { HitsplatTypeLoader } from '../src/cache/config/HitsplatType'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { SpriteLoader } from '../src/cache/sprite/SpriteLoader'
import { encodePng } from '../src/render/sprites/png'

const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync('public/osrs-cache/disk.zip'))))
const sprites = new SpriteLoader(cache)
const out = 'public/assets/render'
mkdirSync(`${out}/healthbar`, { recursive: true })

function save(path: string, id: number, frame = 0): string {
  const s = sprites.loadSprite(id, frame)
  if (!s) throw new Error(`sprite ${id}:${frame} missing`)
  s.normalize()
  writeFileSync(`${out}/${path}`, encodePng(s.getPixelsRgba(), s.width, s.height))
  return `${path} ${s.width}x${s.height}`
}

const hitsplats = new HitsplatTypeLoader(cache)
// hitsplat config -> kind (cache ids: 28 red damage, 26 blue block, 3 poison, 6 heal)
const splatSprites: Record<string, number> = {
  damage: hitsplats.load(28).backgroundSpriteId,
  block: hitsplats.load(26).backgroundSpriteId,
  poison: hitsplats.load(3).backgroundSpriteId,
  heal: hitsplats.load(6).backgroundSpriteId,
}
for (const [kind, id] of Object.entries(splatSprites)) console.log(save(`hitsplat-${kind}.png`, id))

// health bar configs of the default (green/red) family by width
const bars = new HealthBarTypeLoader(cache)
const byWidth: Record<number, number> = { 40: 2, 60: 6, 80: 9, 100: 10, 120: 11 }
for (const [w, cfg] of Object.entries(byWidth)) {
  const t = bars.load(cfg)
  console.log(save(`healthbar/default_front_${w}px.png`, t.frontSpriteId), save(`healthbar/default_back_${w}px.png`, t.backSpriteId))
}

// prayer head icons (sprite 440 frames: melee, missiles, magic, retribution, smite, redemption)
const icons: Record<string, number> = { melee: 0, missiles: 1, magic: 2, redemption: 5 }
for (const [name, frame] of Object.entries(icons)) console.log(save(`overhead_${name}.png`, 440, frame))
