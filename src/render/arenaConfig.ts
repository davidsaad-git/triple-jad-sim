/**
 * Render configuration of the triple-Jad arena: scim's Zuk render config
 * `CT` minus the wave-69-only bits.
 *
 * - Same map square (35, 83) + N/E/S/W neighbours, level 0.
 * - Loc 30338 (the static "Ancestral Glyph" in the lava at (30, 51)) is
 *   drawn: scim hides it only because wave 69 replaces it with the moving
 *   glyph NPC 7707; on waves 1-68 the cache's static loc is what the game
 *   shows (Zuk is still sealed in the northern wall). All locs with an
 *   origin inside [17..45]^2 are hidden, exactly like scim.
 * - The six replacements (Zuk's platform, wave 69) are NOT applied:
 *   nothing in the bundle shows them outside the Zuk fight (open question).
 */
import type { ArenaRenderConfig } from '../scene/arena/ArenaScene'

export const TRIPLE_JAD_ARENA: ArenaRenderConfig = {
  terrainMapSquare: { x: 35, y: 83 },
  mapSquareOffsets: [
    { dx: 0, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: -1, dy: 0 },
  ],
  locRender: {
    levels: [0],
    excludedLocIds: [],
    excludedRegions: [{ minX: 17, maxX: 45, minY: 17, maxY: 45 }],
    replacements: [],
  },
}

/** scim's table (wave 69 only), kept for reference / a future toggle. */
export const ZUK_PLATFORM_REPLACEMENTS = [
  { localX: 27, localY: 52, sourceLocId: 30333, targetLocId: 30340, targetRotation: 1 },
  { localX: 35, localY: 52, sourceLocId: 30332, targetLocId: 30339, targetRotation: 3 },
  { localX: 27, localY: 54, sourceLocId: 30324, targetLocId: 30342, targetRotation: 1 },
  { localX: 35, localY: 54, sourceLocId: 30334, targetLocId: 30341, targetRotation: 3 },
  { localX: 28, localY: 52, sourceLocId: 30337, targetLocId: 30346, targetRotation: 3 },
  { localX: 33, localY: 52, sourceLocId: 30336, targetLocId: 30345, targetRotation: 3 },
] as const

/** Map-square tile -> world tile offset of the arena (centre square SW). */
export const ARENA_BASE_X = 35 * 64
export const ARENA_BASE_Y = 83 * 64
