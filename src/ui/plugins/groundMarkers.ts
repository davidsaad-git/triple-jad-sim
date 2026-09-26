/**
 * RuneLite Ground Markers import/export for Tile Markers: `[{regionId, regionX, regionY, z: 0,
 * color: "#AARRGGBB", label?}]` with regionId = (mapSquareX << 8) | mapSquareY.
 */
import type { TileMarker } from '../../app/plugins/stores'

/** The Inferno map square 35,83 (region 9043). */
export const INFERNO_REGION_ID = (35 << 8) | 83
const DEFAULT_COLOR = '#3BA9FF'

/** scim: "#AARRGGBB" or "#RRGGBB" -> colour + opacity (2 decimals). */
export function parseMarkerColor(c: string): { color: string; opacity: number } {
  const h = c.startsWith('#') ? c.slice(1) : c
  if (h.length === 8) {
    const a = Number.parseInt(h.slice(0, 2), 16)
    return { color: `#${h.slice(2).toUpperCase()}`, opacity: Math.round((a / 255) * 100) / 100 }
  }
  return h.length === 6 ? { color: `#${h.toUpperCase()}`, opacity: 1 } : { color: DEFAULT_COLOR, opacity: 1 }
}

/** scim: colour + opacity -> "#AARRGGBB". */
export function formatMarkerColor(color: string, opacity: number): string {
  const h = color.startsWith('#') ? color.slice(1) : color
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  return `#${a}${h.toUpperCase().padEnd(6, '0')}`
}

export function markerKey(x: number, y: number): string {
  return `${x},${y}`
}

/** Deduplicate by tile, later entries win. */
export function dedupeMarkers(list: readonly TileMarker[]): TileMarker[] {
  const m = new Map<string, TileMarker>()
  for (const t of list) m.set(markerKey(t.x, t.y), t)
  return [...m.values()]
}

export function exportGroundMarkers(markers: readonly TileMarker[], regionId = INFERNO_REGION_ID): string {
  return JSON.stringify(
    markers.map((m) => ({ regionId, regionX: m.x, regionY: m.y, z: 0, color: formatMarkerColor(m.color, m.opacity), ...(m.label ? { label: m.label } : {}) })),
  )
}

/** Null when the text is not a JSON array; markers of other regions are skipped. */
export function importGroundMarkers(text: string, regionId = INFERNO_REGION_ID): TileMarker[] | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(json)) return null
  const out: TileMarker[] = []
  for (const e of json as Record<string, unknown>[]) {
    if (typeof e !== 'object' || e === null) continue
    if (Math.round(Number(e.regionId)) !== regionId) continue
    const x = Math.round(Number(e.regionX))
    const y = Math.round(Number(e.regionY))
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 63 || y > 63) continue
    const { color, opacity } = typeof e.color === 'string' ? parseMarkerColor(e.color) : { color: DEFAULT_COLOR, opacity: 1 }
    out.push({ x, y, color, opacity, ...(typeof e.label === 'string' ? { label: e.label } : {}) })
  }
  return dedupeMarkers(out)
}

/** Imported markers replace existing ones on the same tiles. */
export function mergeMarkers(existing: readonly TileMarker[], imported: readonly TileMarker[]): TileMarker[] {
  const keys = new Set(imported.map((m) => markerKey(m.x, m.y)))
  return dedupeMarkers([...existing.filter((m) => !keys.has(markerKey(m.x, m.y))), ...imported])
}
