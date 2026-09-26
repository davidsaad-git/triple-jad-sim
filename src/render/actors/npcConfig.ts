/**
 * Per-NPC-type render configuration: scim's entries
 * for JalTok-Jad and Yt-HurKot, keyed by our wave-68 ids 7700/7701 and scim's Zuk-fight ids
 * 7704/7705 (identical presentation data).
 */
export interface NpcRenderConfig {
  idleSeqId: number
  /** Undefined: use the NPC type's walk sequence. */
  walkSeqId?: number
  /** Clip id -> sequence id; only these clips are triggered by cues. */
  attackClips: Record<string, number>
  deathSeqId: number
  /** Death presentation length override (ms). */
  deathDurationMs?: number
  /** NDC depth bias for every mesh of the type (`jm` = 5e-4 for Inferno NPCs). */
  depthBias: number
}

export const INFERNO_DEPTH_BIAS = 5e-4

const JAD: NpcRenderConfig = {
  idleSeqId: 7589,
  walkSeqId: 7588,
  attackClips: { magic: 7592, range: 7593, melee: 7590, defend: 7591 },
  deathSeqId: 7594,
  depthBias: INFERNO_DEPTH_BIAS,
}

const YT_HURKOT: NpcRenderConfig = {
  idleSeqId: 2636,
  walkSeqId: 2634,
  attackClips: { heal: 2639, melee: 2637, attack: 2637, defend: 2635 },
  deathSeqId: 2638,
  deathDurationMs: 1800,
  depthBias: INFERNO_DEPTH_BIAS,
}

export const NPC_RENDER_CONFIGS: Readonly<Record<number, NpcRenderConfig>> = {
  7700: JAD,
  7704: JAD,
  7701: YT_HURKOT,
  7705: YT_HURKOT,
}

/** NPC types loaded up front (scim preloads every encounter type before the fight). */
export const PRELOAD_NPC_TYPES: readonly number[] = [7700, 7701]
