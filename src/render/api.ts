import type { Tile } from '../sim/api'

/**
 * Contracts the renderer offers to the input layer and the audio layer.
 * Implemented in src/render; consumed by src/input and src/audio.
 */

/** Result of hit-testing the 3D viewport at a CSS pixel. */
export interface ViewportPick {
  /** Ground tile under the cursor (map-square-local), or null when off the terrain. */
  tile: Tile | null
  /** NPC ids under the cursor that have menu actions, nearest first (scim: model triangle hit-test). */
  npcIds: string[]
  /** Ground item ids under the cursor, nearest first. */
  groundItemIds: string[]
}

export interface ViewportPicker {
  /** CSS px relative to the viewport element's top-left, unscaled. */
  pick(cssX: number, cssY: number): ViewportPick
  /** Edge of the hovered tile nearest the cursor in screen space, for line markers. */
  pickTileEdge?(cssX: number, cssY: number): { x: number; y: number; edge: 'north' | 'east' | 'south' | 'west' } | null
}

/**
 * One animated thing's current sequence frame, collected once per rendered
 * frame for the audio FrameSoundTracker. Keys must be stable per actor / per spot-anim instance.
 */
export interface SequenceFrameState {
  key: string
  seqId: number
  frame: number
  /** Render centre in map-square-local tile units (floats), or null if unknown. */
  position: { x: number; y: number } | null
}

/**
 * Screen anchors of actors for DOM overlays drawn outside the renderer
 * (tick counter above head, attack-timer bar/number, marker labels).
 * CSS pixels relative to the viewport element's top-left.
 */
export interface ActorScreenAnchor {
  actorId: string
  /** Head anchor: actor centre at the overhead height (player: 2.2 tiles above the terrain). */
  x: number
  y: number
  /** Y of the health-bar centre (model top + 15 px). */
  healthBarY: number
  /** Health bar width in px (40..120 by size). */
  healthBarWidth: number
  /** True when an overhead prayer icon is drawn for this actor. */
  hasPrayerIcon: boolean
}

export interface OverlayProjection {
  /** Latest anchors, updated every rendered frame. */
  getAnchors(): ReadonlyMap<string, ActorScreenAnchor>
  /** Subscribe to per-frame updates (after the 3D frame is drawn). */
  onFrame(listener: (anchors: ReadonlyMap<string, ActorScreenAnchor>) => void): () => void
  /** Project a map-square-local tile point (x, y in tiles; heightUnits in OSRS units above terrain) to viewport CSS px. */
  projectTile(x: number, y: number, heightUnits: number): { x: number; y: number } | null
}

export interface FrameSoundFeed {
  /** Called by the renderer after each rendered frame. `paused` = timeline paused or discontinuity (silent sync). */
  onFrame(states: readonly SequenceFrameState[], listener: { x: number; y: number } | null, paused: boolean): void
}
