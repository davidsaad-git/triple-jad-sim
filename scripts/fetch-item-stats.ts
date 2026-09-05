/**
 * Fetch equipment bonuses from the OSRS wiki (Infobox Bonuses template) for
 * the items in scripts/item-list.json and write src/data/items/equipment.json.
 *   npx tsx scripts/fetch-item-stats.ts
 * Wiki text is CC BY-NC-SA 3.0; this project is non-commercial and credits the wiki.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

interface ItemSpec {
  name: string
  /** Cache item id (for models/icons). */
  id: number
  slot: string
}

interface EquipmentStats {
  name: string
  id: number
  slot: string
  astab: number
  aslash: number
  acrush: number
  amagic: number
  arange: number
  dstab: number
  dslash: number
  dcrush: number
  dmagic: number
  drange: number
  str: number
  rstr: number
  mdmg: number
  prayer: number
  speed?: number
  attackrange?: number
  combatstyle?: string
}

const UA = 'zuk-sim/0.1 (local development; contact via project README)'
const items = JSON.parse(readFileSync('scripts/item-list.json', 'utf8')) as ItemSpec[]

async function fetchWikitext(page: string): Promise<string> {
  const url = `https://oldschool.runescape.wiki/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&redirects=1&format=json&formatversion=2`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${page}: HTTP ${res.status}`)
  const json = (await res.json()) as { parse?: { wikitext?: string }; error?: { info: string } }
  if (!json.parse?.wikitext) throw new Error(`${page}: ${json.error?.info ?? 'no wikitext'}`)
  return json.parse.wikitext
}

function parseInfoboxBonuses(wikitext: string): Record<string, string> {
  const start = wikitext.indexOf('{{Infobox Bonuses')
  if (start < 0) throw new Error('no Infobox Bonuses')
  let depth = 0
  let end = start
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') depth++, i++
    else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--
      i++
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  const body = wikitext.slice(start + 2, end - 2)
  const fields: Record<string, string> = {}
  for (const part of body.split(/\n\s*\|/)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    fields[key] = value
  }
  return fields
}

function num(v: string | undefined): number {
  if (v === undefined) return 0
  const m = /-?\d+(\.\d+)?/.exec(v.replace(/%/g, ''))
  return m ? Number(m[0]) : 0
}

async function main() {
  const out: EquipmentStats[] = []
  for (const item of items) {
    try {
      const wt = await fetchWikitext(item.name)
      const f = parseInfoboxBonuses(wt)
      const stats: EquipmentStats = {
        name: item.name,
        id: item.id,
        slot: item.slot,
        astab: num(f.astab),
        aslash: num(f.aslash),
        acrush: num(f.acrush),
        amagic: num(f.amagic),
        arange: num(f.arange),
        dstab: num(f.dstab),
        dslash: num(f.dslash),
        dcrush: num(f.dcrush),
        dmagic: num(f.dmagic),
        drange: num(f.drange),
        str: num(f.str),
        rstr: num(f.rstr),
        mdmg: num(f.mdmg),
        prayer: num(f.prayer),
      }
      if (f.speed) stats.speed = num(f.speed)
      if (f.attackrange) stats.attackrange = num(f.attackrange)
      if (f.combatstyle) stats.combatstyle = f.combatstyle
      out.push(stats)
      console.log(`${item.name}: str ${stats.str} rstr ${stats.rstr} arange ${stats.arange} amagic ${stats.amagic} prayer ${stats.prayer}${stats.speed ? ` speed ${stats.speed}` : ''}`)
    } catch (e) {
      console.error(`FAILED ${item.name}: ${(e as Error).message}`)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  mkdirSync('src/data/items', { recursive: true })
  writeFileSync('src/data/items/equipment.json', JSON.stringify(out, null, 2))
  console.log(`wrote ${out.length} items`)
}

void main()
