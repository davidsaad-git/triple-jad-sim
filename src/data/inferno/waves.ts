/**
 * Inferno wave composition, waves 1..66. Columns: nibbler, bat (Jal-MejRah),
 * blob (Jal-Ak), meleer (Jal-ImKot), ranger (Jal-Xil), mager (Jal-Zek).
 * Waves 67..69 are scripted (Jad, triple Jad, Zuk). See docs/INFERNO_DATA.md.
 */
export type WaveCounts = readonly [nibbler: number, bat: number, blob: number, meleer: number, ranger: number, mager: number]

export const WAVES: readonly WaveCounts[] = [
  [3, 1, 0, 0, 0, 0], // 1
  [3, 2, 0, 0, 0, 0], // 2
  [6, 0, 0, 0, 0, 0], // 3
  [3, 0, 1, 0, 0, 0], // 4
  [3, 1, 1, 0, 0, 0], // 5
  [3, 2, 1, 0, 0, 0], // 6
  [3, 0, 2, 0, 0, 0], // 7
  [6, 0, 0, 0, 0, 0], // 8
  [3, 0, 0, 1, 0, 0], // 9
  [3, 1, 0, 1, 0, 0], // 10
  [3, 2, 0, 1, 0, 0], // 11
  [3, 0, 1, 1, 0, 0], // 12
  [3, 1, 1, 1, 0, 0], // 13
  [3, 2, 1, 1, 0, 0], // 14
  [3, 0, 2, 1, 0, 0], // 15
  [3, 0, 0, 2, 0, 0], // 16
  [6, 0, 0, 0, 0, 0], // 17
  [3, 0, 0, 0, 1, 0], // 18
  [3, 1, 0, 0, 1, 0], // 19
  [3, 2, 0, 0, 1, 0], // 20
  [3, 0, 1, 0, 1, 0], // 21
  [3, 1, 1, 0, 1, 0], // 22
  [3, 2, 1, 0, 1, 0], // 23
  [3, 0, 2, 0, 1, 0], // 24
  [3, 0, 0, 1, 1, 0], // 25
  [3, 1, 0, 1, 1, 0], // 26
  [3, 2, 0, 1, 1, 0], // 27
  [3, 0, 1, 1, 1, 0], // 28
  [3, 1, 1, 1, 1, 0], // 29
  [3, 2, 1, 1, 1, 0], // 30
  [3, 0, 2, 1, 1, 0], // 31
  [3, 0, 0, 2, 1, 0], // 32
  [3, 0, 0, 0, 2, 0], // 33
  [6, 0, 0, 0, 0, 0], // 34
  [3, 0, 0, 0, 0, 1], // 35
  [3, 1, 0, 0, 0, 1], // 36
  [3, 2, 0, 0, 0, 1], // 37
  [3, 0, 1, 0, 0, 1], // 38
  [3, 1, 1, 0, 0, 1], // 39
  [3, 2, 1, 0, 0, 1], // 40
  [3, 0, 2, 0, 0, 1], // 41
  [3, 0, 0, 1, 0, 1], // 42
  [3, 1, 0, 1, 0, 1], // 43
  [3, 2, 0, 1, 0, 1], // 44
  [3, 0, 1, 1, 0, 1], // 45
  [3, 1, 1, 1, 0, 1], // 46
  [3, 2, 1, 1, 0, 1], // 47
  [3, 0, 2, 1, 0, 1], // 48
  [3, 0, 0, 2, 0, 1], // 49
  [3, 0, 0, 0, 1, 1], // 50
  [3, 1, 0, 0, 1, 1], // 51
  [3, 2, 0, 0, 1, 1], // 52
  [3, 0, 1, 0, 1, 1], // 53
  [3, 1, 1, 0, 1, 1], // 54
  [3, 2, 1, 0, 1, 1], // 55
  [3, 0, 2, 0, 1, 1], // 56
  [3, 0, 0, 1, 1, 1], // 57
  [3, 1, 0, 1, 1, 1], // 58
  [3, 2, 0, 1, 1, 1], // 59
  [3, 0, 1, 1, 1, 1], // 60
  [3, 1, 1, 1, 1, 1], // 61
  [3, 2, 1, 1, 1, 1], // 62
  [3, 0, 2, 1, 1, 1], // 63
  [3, 0, 0, 2, 1, 1], // 64
  [3, 0, 0, 0, 2, 1], // 65
  [3, 0, 0, 0, 0, 2], // 66
]

export const FIRST_JAD_WAVE = 67
export const TRIPLE_JAD_WAVE = 68
export const ZUK_WAVE = 69
export const LAST_WAVE = 69

/** Waves 1..66 composition; throws outside that range. */
export function waveCounts(wave: number): WaveCounts {
  const counts = WAVES[wave - 1]
  if (!counts || wave > WAVES.length) {
    throw new Error(`Wave ${wave} has no standard composition`)
  }
  return counts
}

/** Region-local tile (0..63, y north) of an NPC's south-west corner. */
export interface RegionTile {
  x: number
  y: number
}

/** The 9 possible spawn tiles, in scouter "reading order". */
export const SPAWN_TILES: readonly RegionTile[] = [
  { x: 18, y: 41 }, // 1 NW
  { x: 39, y: 41 }, // 2 NE
  { x: 20, y: 35 }, // 3 W
  { x: 40, y: 34 }, // 4 E
  { x: 33, y: 29 }, // 5 centre
  { x: 22, y: 23 }, // 6 SW
  { x: 40, y: 21 }, // 7 SE
  { x: 18, y: 18 }, // 8 far SW
  { x: 32, y: 18 }, // 9 S
]

/** Nibblers spawn inside this 3x3 block in the centre of the arena. */
export const NIBBLER_SPAWN_BLOCK: readonly RegionTile[] = [25, 26, 27].flatMap((x) => [33, 34, 35].map((y) => ({ x, y })))

export interface PillarInfo {
  name: 'SOUTH' | 'WEST' | 'NORTH'
  /** Centre tile of the 3x3 pillar. */
  centre: RegionTile
}

export const PILLARS: readonly PillarInfo[] = [
  { name: 'SOUTH', centre: { x: 28, y: 24 } },
  { name: 'WEST', centre: { x: 18, y: 38 } },
  { name: 'NORTH', centre: { x: 35, y: 40 } },
]

export const PILLAR_HITPOINTS = 255

/** Region tiles the player starts on (IT coordinates converted: x = it.x + 6, y = 60 - it.y). */
export const PLAYER_START: Record<'standard' | 'jad' | 'tripleJad' | 'zuk', RegionTile> = {
  standard: { x: 34, y: 43 },
  jad: { x: 24, y: 35 },
  tripleJad: { x: 31, y: 33 },
  zuk: { x: 31, y: 45 },
}

/** Monsters appear on this tick of each wave. */
export const WAVE_SPAWN_TICK = 15
/** Ticks between the last monster dying and the next wave starting. */
export const WAVE_END_DELAY_TICKS = 9
