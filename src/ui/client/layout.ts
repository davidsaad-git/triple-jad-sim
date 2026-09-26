/**
 * Client chrome geometry (-), all in client units before UI
 * scaling. Values are scim.gg's;
 * the minified names are noted where a number comes from.
 */
import type { ClientLayoutMode, GameResolution, PanelPosition } from '../../app/settings/settings'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height })

// ---------------------------------------------------------------------------
// Fixed layout: the 765x503 client (scim...)
// ---------------------------------------------------------------------------

export const FIXED_CLIENT = { width: 765, height: 503 } as const

export const FIXED = {
  viewport: r(4, 4, 512, 334),
  viewportCollapsed: r(4, 4, 512, 476),
  topEdge: r(0, 0, 717, 4),
  topRightCorner: r(717, 0, 48, 4),
  leftEdge: r(0, 4, 4, 334),
  minimapBlock: r(516, 0, 249, 167),
  minimapArea: r(516, 4, 249, 163),
  sidePanelBlock: r(516, 167, 249, 336),
  topTabRow: r(516, 167, 249, 38),
  sidePanelBackground: r(547, 205, 190, 261),
  bottomTabRow: r(519, 466, 246, 37),
  chatbox: r(0, 338, 519, 165),
  chatButtons: r(0, 480, 519, 23),
  chatText: r(0, 338, 519, 142),
  chatInner: r(7, 344, 505, 130),
  chatScrollbar: r(496, 344, 16, 114),
  chatInput: r(7, 458, 505, 16),
  sideEdgeLeftUpper: r(516, 205, 31, 133),
  sideEdgeLeftLower: r(519, 338, 28, 128),
  sideEdgeRight: r(737, 205, 28, 261),
  sideFarLeftStrip: r(516, 338, 3, 165),
} as const

/** Chat channel buttons (scim, `IB`, `LB`, `RB`). */
export const CHAT_BUTTON_X = [5, 67, 129, 191, 253, 315, 377] as const
export const CHAT_BUTTON_SIZE = { width: 56, height: 22 } as const
export const CHAT_REPORT_SIZE = { width: 79, height: 22 } as const
export const CHAT_REPORT_X = FIXED.chatButtons.width - 3 - CHAT_REPORT_SIZE.width
export const CHAT_TABS = ['All', 'Game', 'Public', 'Private', 'Channel', 'Clan', 'Trade'] as const

/** Edge-snapped rounding of a client rect to physical pixels. */
export function snapRect(rect: Rect, scale: number): Rect {
  const x = Math.round(rect.x * scale)
  const y = Math.round(rect.y * scale)
  return { x, y, width: Math.round((rect.x + rect.width) * scale) - x, height: Math.round((rect.y + rect.height) * scale) - y }
}

export const FIXED_SCALE_MIN = 0.5
export const FIXED_SCALE_MAX = 6
/** Fixed-layout viewport choices. */
export const FIXED_SCALE_PRESETS = [1, 1.5, 2, 2.5, 3] as const

/** Fixed client size for a window and a `fixedLayoutScale` choice. */
export function fixedClientSize(windowWidth: number, windowHeight: number, choice: 'fit' | number): { scale: number; width: number; height: number } {
  const fit = windowWidth > 0 && windowHeight > 0 ? Math.min(windowWidth / FIXED_CLIENT.width, windowHeight / FIXED_CLIENT.height) : 1
  const s = typeof choice === 'number' && Number.isFinite(choice) ? Math.max(FIXED_SCALE_MIN, Math.min(FIXED_SCALE_MAX, choice)) : Math.max(FIXED_SCALE_MIN, Math.min(FIXED_SCALE_MAX, fit))
  const width = Math.round(FIXED_CLIENT.width * s)
  const height = Math.round(FIXED_CLIENT.height * (width / FIXED_CLIENT.width))
  return { scale: width / FIXED_CLIENT.width, width, height }
}

export interface FrameBox {
  kind: 'fit' | 'fixed-resolution' | 'fixed-layout'
  left: number
  top: number
  width: number
  height: number
  /** Fixed layout only: the client scale (frame width / 765). */
  fixedScale: number
}

/**
 * The `.game-viewport-frame` box inside a stage of `stageWidth x stageHeight`
 *: Fit fills the stage; a fixed resolution or the fixed
 * layout is centred.
 */
export function computeFrameBox(
  layout: ClientLayoutMode,
  resolution: GameResolution,
  fixedLayoutScale: 'fit' | number,
  stageWidth: number,
  stageHeight: number,
): FrameBox {
  if (layout === 'fixed') {
    const f = fixedClientSize(stageWidth, stageHeight, fixedLayoutScale)
    return {
      kind: 'fixed-layout',
      left: Math.max(0, Math.round((stageWidth - f.width) / 2)),
      top: Math.max(0, Math.round((stageHeight - f.height) / 2)),
      width: f.width,
      height: f.height,
      fixedScale: f.scale,
    }
  }
  if (resolution.mode !== 'fit') {
    return {
      kind: 'fixed-resolution',
      left: Math.max(0, Math.round((stageWidth - resolution.width) / 2)),
      top: Math.max(0, Math.round((stageHeight - resolution.height) / 2)),
      width: resolution.width,
      height: resolution.height,
      fixedScale: 1,
    }
  }
  return { kind: 'fit', left: 0, top: 0, width: stageWidth, height: stageHeight, fixedScale: 1 }
}

// ---------------------------------------------------------------------------
// Side panel geometry per mode
// ---------------------------------------------------------------------------

/** Every tab's content box. */
export const CONTENT_BOX = { width: 204, height: 275 } as const
export const TAB_STONE = { width: 33, height: 36 } as const
/** Modern tab bar (7 stones 33 wide, 1 px gaps). */
export const MODERN_TAB_BAR = { width: 237, height: 36, pitch: 34 } as const

export type EdgeSprite = 'classicLeft' | 'classicRight' | 'fixedLeftUpper' | 'fixedLeftLower' | 'fixedRight'

export interface TabRowGeometry {
  rect: Rect
  slotX: readonly number[]
  stoneY: number
}

export interface ShellGeometry {
  spriteSet: 'classic' | 'fixed'
  size: { width: number; height: number }
  background: Rect
  backgroundTiled: boolean
  edges: { sprite: EdgeSprite; rect: Rect; tiledFrom?: { width: number; height: number } }[]
  tabRowTop: TabRowGeometry
  tabRowBottom: TabRowGeometry
  /** Where the 204x275 content box sits (7 px outside the 190x261 interior). */
  panelShell: Point
}

const CLASSIC_SLOT_X = [4, 38, 71, 104, 137, 170, 204] as const
const FIXED_TOP_SLOT_X = [10, 44, 77, 110, 143, 176, 210] as const
const FIXED_BOTTOM_SLOT_X = [7, 41, 74, 107, 140, 173, 207] as const

/** Resizable - Classic side panel. */
export const CLASSIC_SHELL: ShellGeometry = {
  spriteSet: 'classic',
  size: { width: 241, height: 335 },
  background: r(21, 27, 200, 281),
  backgroundTiled: true,
  edges: [
    { sprite: 'classicLeft', rect: r(3, 37, 26, 261) },
    { sprite: 'classicRight', rect: r(213, 37, 26, 261) },
  ],
  tabRowTop: { rect: r(0, 0, 241, 37), slotX: CLASSIC_SLOT_X, stoneY: 0 },
  tabRowBottom: { rect: r(0, 298, 241, 37), slotX: CLASSIC_SLOT_X, stoneY: 0 },
  panelShell: { x: 26 - 7, y: 37 - 7 },
}

/** Rect relative to the fixed side-panel block. */
function fixedLocal(rect: Rect): Rect {
  return { x: rect.x - FIXED.sidePanelBlock.x, y: rect.y - FIXED.topTabRow.y, width: rect.width, height: rect.height }
}

/** Fixed side panel block. */
export const FIXED_SHELL: ShellGeometry = {
  spriteSet: 'fixed',
  size: { width: FIXED.sidePanelBlock.width, height: FIXED_CLIENT.height - FIXED.topTabRow.y },
  background: fixedLocal(FIXED.sidePanelBackground),
  backgroundTiled: false,
  edges: [
    { sprite: 'fixedLeftUpper', rect: fixedLocal(FIXED.sideEdgeLeftUpper) },
    { sprite: 'fixedLeftUpper', rect: fixedLocal(FIXED.sideFarLeftStrip), tiledFrom: { width: 31, height: 133 } },
    { sprite: 'fixedLeftLower', rect: fixedLocal(FIXED.sideEdgeLeftLower) },
    { sprite: 'fixedRight', rect: fixedLocal(FIXED.sideEdgeRight) },
  ],
  tabRowTop: { rect: fixedLocal(FIXED.topTabRow), slotX: FIXED_TOP_SLOT_X, stoneY: 1 },
  tabRowBottom: { rect: fixedLocal(FIXED.bottomTabRow), slotX: FIXED_BOTTOM_SLOT_X, stoneY: 0 },
  panelShell: { x: FIXED.sidePanelBackground.x - 7 - FIXED.sidePanelBlock.x, y: FIXED.sidePanelBackground.y - 7 - FIXED.topTabRow.y },
}

/** Outer size of the game panel per layout. */
export function panelMetrics(layout: ClientLayoutMode): { width: number; height: number } {
  return layout === 'modern' ? CONTENT_BOX : layout === 'fixed' ? FIXED_SHELL.size : CLASSIC_SHELL.size
}

export type StoneKind = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'middle'

/** Selected-stone sprite and offset for a classic/fixed tab slot. */
export function selectedStone(row: 'top' | 'bottom', slot: number, slotCount = 7): { stone: StoneKind; dx: number; width: number } {
  if (slot === 0) return { stone: row === 'top' ? 'topLeft' : 'bottomLeft', dx: -4, width: 38 }
  if (slot === slotCount - 1) return { stone: row === 'top' ? 'topRight' : 'bottomRight', dx: -1, width: 38 }
  return { stone: 'middle', dx: 0, width: 38 }
}

export type GamePanelTabId = 'combat' | 'skills' | 'inventory' | 'equipment' | 'prayer' | 'spellbook' | 'settings'

export interface TabDef {
  tab: GamePanelTabId
  label: string
  icon: string
  row: 'top' | 'bottom'
  slot: number
}

/** The seven tabs in scim's order: modern bar order and classic/fixed slots. */
export const GAME_PANEL_TABS: readonly TabDef[] = [
  { tab: 'combat', label: 'Combat', icon: 'tabs/combat.png', row: 'top', slot: 0 },
  { tab: 'skills', label: 'Skills', icon: 'tabs/stats.png', row: 'top', slot: 1 },
  { tab: 'inventory', label: 'Inventory', icon: 'tabs/inventory.png', row: 'top', slot: 3 },
  { tab: 'equipment', label: 'Equipment', icon: 'tabs/equipment.png', row: 'top', slot: 4 },
  { tab: 'prayer', label: 'Prayer', icon: 'tabs/prayer.png', row: 'top', slot: 5 },
  { tab: 'spellbook', label: 'Spellbook', icon: 'tabs/magic.png', row: 'top', slot: 6 },
  { tab: 'settings', label: 'Keybinds', icon: 'tabs/options.png', row: 'bottom', slot: 4 },
]

// ---------------------------------------------------------------------------
// Default panel positions (scim; modern clamp)
// ---------------------------------------------------------------------------

export const DEFAULT_GAME_PANEL_POSITION: PanelPosition = { x: 0, y: 0, anchorX: 'right', anchorY: 'bottom' }
export const DEFAULT_MINIMAP_POSITION: PanelPosition = { x: 0, y: 0, anchorX: 'right', anchorY: 'top' }
export const DEFAULT_COMPACT_ORBS_POSITION: PanelPosition = { x: 0, y: 60, anchorX: 'right', anchorY: 'top' }
export const DEFAULT_TAB_BAR_POSITION: PanelPosition = { x: 0, y: 0, anchorX: 'right', anchorY: 'bottom' }

/** Modern layout: the panel's default sits 2 px above the tab bar (`K10`). */
export function modernPanelDefault(uiScale: number): PanelPosition {
  return { x: 0, y: Math.round(36 * uiScale) + 2, anchorX: 'right', anchorY: 'bottom' }
}

/** Modern layout: stored positions are pushed above the tab bar. */
export function clampModernPanelPosition(pos: PanelPosition, uiScale: number): PanelPosition {
  const minY = Math.round(36 * uiScale) + 2
  return pos.y >= minY ? pos : { ...pos, y: minY }
}

// ---------------------------------------------------------------------------
// UI scale
// ---------------------------------------------------------------------------

export const UI_SCALE_STEPS = [1, 7 / 6, 4 / 3, 3 / 2, 5 / 3, 11 / 6, 2, 13 / 6, 7 / 3, 5 / 2, 8 / 3, 17 / 6, 3] as const

/** Move `steps` notches through `stops` from `current` (snapping when between stops). */
export function stepScale(current: number, steps: number, stops: readonly number[] = UI_SCALE_STEPS): number {
  if (steps === 0 || stops.length === 0) return current
  const exact = stops.findIndex((s) => Math.abs(s - current) < 1e-3)
  let index: number
  if (exact !== -1) index = exact + steps
  else if (steps > 0) {
    const above = stops.findIndex((s) => s > current + 1e-3)
    index = (above === -1 ? stops.length - 1 : above) + (steps - 1)
  } else {
    let below = -1
    for (let i = stops.length - 1; i >= 0; i--) {
      if (stops[i]! < current - 1e-3) {
        below = i
        break
      }
    }
    index = (below === -1 ? 0 : below) + (steps + 1)
  }
  return stops[Math.max(0, Math.min(stops.length - 1, index))]!
}

/** Tooltip / context-menu / infobox content scales derived from the UI scale (08). */
export function tooltipScaleFor(uiScale: number): number {
  return 1 + (uiScale - 1) * 0.4
}
export function infoboxContentScale(uiScale: number): number {
  return uiScale <= 0 ? 1 : Math.min(1, (1 + (uiScale - 1) * 0.35) / uiScale)
}

// ---------------------------------------------------------------------------
// Anchored positions (scim, `F1`, `I1`)
// ---------------------------------------------------------------------------

/** Anchored position -> left/top in the frame. */
export function anchoredToLeftTop(pos: PanelPosition, width: number, height: number, frameWidth: number, frameHeight: number): Point {
  return { x: pos.anchorX === 'left' ? pos.x : frameWidth - width - pos.x, y: pos.anchorY === 'top' ? pos.y : frameHeight - height - pos.y }
}

/** Left/top in the frame -> anchored position (non-negative offsets). */
export function leftTopToAnchored(left: number, top: number, width: number, height: number, frameWidth: number, frameHeight: number, anchorX: 'left' | 'right', anchorY: 'top' | 'bottom'): PanelPosition {
  return {
    x: Math.max(0, anchorX === 'left' ? left : frameWidth - width - left),
    y: Math.max(0, anchorY === 'top' ? top : frameHeight - height - top),
    anchorX,
    anchorY,
  }
}

/** Keep a box inside the frame with an inset. */
export function clampToFrame(left: number, top: number, width: number, height: number, frameWidth: number, frameHeight: number, inset = 0): Point {
  return { x: Math.max(inset, Math.min(left, frameWidth - width - inset)), y: Math.max(inset, Math.min(top, frameHeight - height - inset)) }
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Push a box out of exclusion rects, nearest free side first, up to 3 passes. */
export function avoidExclusions(left: number, top: number, width: number, height: number, bounds: Box, exclusions: readonly Box[] | undefined): Point {
  if (!exclusions || exclusions.length === 0) return { x: left, y: top }
  let x = left
  let y = top
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (const ex of exclusions) {
      if (x < ex.right && x + width > ex.left && y < ex.bottom && y + height > ex.top) {
        const options: { x: number; y: number; dist: number }[] = []
        const leftX = ex.left - width
        if (leftX >= bounds.left) options.push({ x: leftX, y, dist: Math.abs(x - leftX) })
        if (ex.right + width <= bounds.right) options.push({ x: ex.right, y, dist: Math.abs(x - ex.right) })
        const upY = ex.top - height
        if (upY >= bounds.top) options.push({ x, y: upY, dist: Math.abs(y - upY) })
        if (ex.bottom + height <= bounds.bottom) options.push({ x, y: ex.bottom, dist: Math.abs(y - ex.bottom) })
        if (options.length > 0) {
          options.sort((a, b) => a.dist - b.dist)
          x = options[0]!.x
          y = options[0]!.y
          moved = true
        }
      }
    }
    if (!moved) break
  }
  return { x, y }
}

/**
 * Window-resize rule (08): right/bottom offsets stay; left/top offsets
 * scale with the free space `(frame - panel)`.
 */
export function rescaleOnResize(pos: PanelPosition, width: number, height: number, oldW: number, oldH: number, newW: number, newH: number): PanelPosition {
  const freeOldX = Math.max(0, oldW - width)
  const freeNewX = Math.max(0, newW - width)
  const freeOldY = Math.max(0, oldH - height)
  const freeNewY = Math.max(0, newH - height)
  return {
    x: pos.anchorX === 'right' ? pos.x : (freeOldX > 0 ? pos.x / freeOldX : 0) * freeNewX,
    y: pos.anchorY === 'bottom' ? pos.y : (freeOldY > 0 ? pos.y / freeOldY : 0) * freeNewY,
    anchorX: pos.anchorX,
    anchorY: pos.anchorY,
  }
}

// ---------------------------------------------------------------------------
// Snapping to sibling panels
// ---------------------------------------------------------------------------

export type SnapContact = 'right-to-left' | 'left-to-right' | 'bottom-to-top' | 'top-to-bottom'
export const SNAP_GAP = 5
export const SNAP_ENGAGE = 14
export const SNAP_STICKY = 24
export const SNAP_PREVIEW = 28
export const SNAP_ALIGN = 10

export interface SnapTarget extends Box {
  id: string
}

export interface SnapEngagement {
  targetId: string
  contact: SnapContact
  state: 'engaged' | 'preview'
  marker: Rect
}

export interface SnapResult {
  dx: number
  dy: number
  engagement: SnapEngagement | null
}

export function snapToSiblings(args: {
  left: number
  top: number
  width: number
  height: number
  siblings: readonly SnapTarget[]
  previous: { targetId: string; contact: SnapContact } | null
  isDestinationValid?: (box: Box) => boolean
}): SnapResult {
  const { left, top, width, height, siblings, previous, isDestinationValid } = args
  const right = left + width
  const bottom = top + height
  interface Candidate {
    target: SnapTarget
    contact: SnapContact
    distance: number
    dx: number
    dy: number
  }
  let nearest: Candidate | null = null
  let sticky: Candidate | null = null
  const consider = (target: SnapTarget, contact: SnapContact, delta: number): void => {
    let dx = 0
    let dy = 0
    if (contact === 'right-to-left' || contact === 'left-to-right') dx = delta
    else dy = delta
    if (contact === 'bottom-to-top' || contact === 'top-to-bottom') {
      const dl = target.left - left
      const dr = target.right - right
      const a = Math.abs(dl) <= Math.abs(dr) ? dl : dr
      if (Math.abs(a) <= SNAP_ALIGN) dx = a
    } else {
      const dt = target.top - top
      const db = target.bottom - bottom
      const a = Math.abs(dt) <= Math.abs(db) ? dt : db
      if (Math.abs(a) <= SNAP_ALIGN) dy = a
    }
    if (isDestinationValid) {
      const l = left + dx
      const t = top + dy
      if (!isDestinationValid({ left: l, top: t, right: l + width, bottom: t + height })) return
    }
    const c: Candidate = { target, contact, distance: Math.abs(delta), dx, dy }
    if (!nearest || c.distance < nearest.distance) nearest = c
    if (previous && target.id === previous.targetId && contact === previous.contact) sticky = c
  }
  for (const t of siblings) {
    const overlapY = Math.min(bottom, t.bottom) > Math.max(top, t.top)
    const overlapX = Math.min(right, t.right) > Math.max(left, t.left)
    if (overlapY) consider(t, 'right-to-left', t.left - SNAP_GAP - right)
    if (overlapY) consider(t, 'left-to-right', t.right + SNAP_GAP - left)
    if (overlapX) consider(t, 'bottom-to-top', t.top - SNAP_GAP - bottom)
    if (overlapX) consider(t, 'top-to-bottom', t.bottom + SNAP_GAP - top)
  }
  let chosen: Candidate
  let engaged: boolean
  const st = sticky as Candidate | null
  const nr = nearest as Candidate | null
  if (st && st.distance <= SNAP_STICKY) {
    chosen = st
    engaged = true
  } else if (nr) {
    chosen = nr
    engaged = nr.distance <= SNAP_ENGAGE
    if (!engaged && nr.distance > SNAP_PREVIEW) return { dx: 0, dy: 0, engagement: null }
  } else return { dx: 0, dy: 0, engagement: null }
  const cl = left + chosen.dx
  const ct = top + chosen.dy
  const cr = cl + width
  const cb = ct + height
  const t = chosen.target
  let marker: Rect
  if (chosen.contact === 'right-to-left' || chosen.contact === 'left-to-right') {
    let a = Math.max(ct, t.top)
    let b = Math.min(cb, t.bottom)
    if (b <= a) {
      a = Math.min(ct, t.top)
      b = Math.max(cb, t.bottom)
    }
    marker = { x: chosen.contact === 'right-to-left' ? cr : t.right, y: a, width: SNAP_GAP, height: b - a }
  } else {
    let a = Math.max(cl, t.left)
    let b = Math.min(cr, t.right)
    if (b <= a) {
      a = Math.min(cl, t.left)
      b = Math.max(cr, t.right)
    }
    marker = { x: a, y: chosen.contact === 'bottom-to-top' ? cb : t.bottom, width: b - a, height: SNAP_GAP }
  }
  return {
    dx: engaged ? chosen.dx : 0,
    dy: engaged ? chosen.dy : 0,
    engagement: { targetId: t.id, contact: chosen.contact, state: engaged ? 'engaged' : 'preview', marker },
  }
}

// ---------------------------------------------------------------------------
// Orbs
// ---------------------------------------------------------------------------

export type OrbId = 'hitpoints' | 'prayer' | 'run' | 'special'
export const ORB_IDS: readonly OrbId[] = ['hitpoints', 'prayer', 'run', 'special']
export const ORB_BOX = { width: 57, height: 34 } as const
/** Arc angles in degrees for HP, Prayer, Run, Special. */
export const ORB_ARC_ANGLES = [283, 261, 239, 217] as const
export const ORB_ARC_CENTRE = { x: 162, y: 84 } as const
export const ORB_ARC_RADIUS = 73

/** Orb centres on the modern/classic minimap arc (radius + 17 - 8). */
export function arcOrbCentres(cx = ORB_ARC_CENTRE.x, cy = ORB_ARC_CENTRE.y, radius = ORB_ARC_RADIUS): Point[] {
  const rr = radius + 17 - 8
  return ORB_ARC_ANGLES.map((deg) => {
    const a = (deg * Math.PI) / 180
    return { x: cx + rr * Math.sin(a), y: cy - rr * Math.cos(a) }
  })
}

/** Fixed-mode orb boxes inside the (0,4) orb container. */
export const FIXED_ORB_BOXES: Readonly<Record<OrbId, Point>> = {
  hitpoints: { x: 0, y: 37 },
  prayer: { x: 0, y: 71 },
  run: { x: 10, y: 103 },
  special: { x: 32, y: 128 },
}
export const FIXED_ORB_CONTAINER: Point = { x: 0, y: 4 }
export const FIXED_XP_ORB: Rect = r(0, 17, 27, 27)

export function fixedOrbCentres(): Point[] {
  return ORB_IDS.map((id) => ({ x: FIXED_ORB_BOXES[id].x + 40, y: FIXED_ORB_BOXES[id].y + 17 }))
}

export type CompactOrbsLayout = 'vertical' | 'horizontal' | 'horizontal-wide'

/** Compact orb grid: `cols x rows` cells of 57x34, filled column by column. */
export function compactOrbGrid(cols: number, rows: number): { width: number; height: number; centres: Point[] } {
  const centres: Point[] = []
  for (let c = 0; c < cols; c++) for (let rw = 0; rw < rows; rw++) centres.push({ x: c * 57 + 40, y: rw * 34 + 17 })
  return { width: cols * 57, height: rows * 34, centres }
}

export const COMPACT_ORB_LAYOUTS: Readonly<Record<CompactOrbsLayout, { width: number; height: number; centres: Point[] }>> = {
  vertical: compactOrbGrid(1, 4),
  horizontal: compactOrbGrid(2, 2),
  'horizontal-wide': compactOrbGrid(4, 1),
}

export function normalizeCompactLayout(value: unknown): CompactOrbsLayout {
  return value === 'horizontal' || value === 'horizontal-wide' || value === 'vertical' ? value : 'vertical'
}

/** A valid orb order (all four ids once) or the default. */
export function normalizeOrbOrder(value: unknown): OrbId[] {
  if (Array.isArray(value) && value.length === 4 && ORB_IDS.every((id) => value.includes(id))) return value as OrbId[]
  return [...ORB_IDS]
}

/** Orb value colour: red -> yellow -> green by value / max. */
export function orbValueColor(value: number, max: number): string {
  if (max <= 0) return 'rgb(255, 0, 0)'
  const v = Math.max(0, Math.min(max, value))
  const half = max / 2
  const clamp = (n: number): number => Math.max(0, Math.min(255, n))
  return v > half ? `rgb(${clamp(Math.round(255 - (255 * (v - half)) / half))}, 255, 0)` : `rgb(255, ${clamp(Math.round((v * 255) / half))}, 0)`
}

/** Height (from the top) of the empty-orb cover. */
export function orbEmptyHeight(current: number, max: number): number {
  if (max <= 0) return 26
  const c = Math.max(0, Math.min(max, current))
  return Math.floor((26 * Math.max(0, max - c)) / max)
}

/** Prayer-flick sweep line for tick fraction f. */
export function flickSweep(fraction: number, size = 26): { x: number; y: number; height: number } {
  const a = fraction * Math.PI
  const height = Math.trunc(Math.sin(a) * size)
  return { x: Math.trunc((-Math.cos(a) * size) / 2) + Math.trunc(size / 2), y: Math.trunc(size / 2) - Math.trunc(height / 2), height }
}

// ---------------------------------------------------------------------------
// Minimap (scim...)
// ---------------------------------------------------------------------------

export const MINIMAP = {
  panel: { width: 244, height: 166 },
  frame: r(62, 0, 182, 166),
  circle: { x: 62 + 22, y: 7, diameter: 154 },
  compass: { x: 62 + 4, y: 4, diameter: 37 },
  compassSprite: 51,
} as const

export const FIXED_MINIMAP = {
  panel: { width: 249, height: 167 },
  frame: r(29, 4, 172, 156),
  leftEdge: r(0, 4, 29, 156),
  rightEdge: r(201, 4, 48, 156),
  bottom: r(0, 160, 249, 8),
  circle: { x: 29 + Math.round(25 + 145 / 2 - 148 / 2), y: 4 + Math.round(5 + 151 / 2 - 148 / 2), diameter: 148 },
  compass: { x: 29, y: 4, diameter: 33 },
} as const

export const MINIMAP_TILE_PX = 4
export const MINIMAP_CANVAS = 256
export const MINIMAP_ZOOM_DEFAULT = 4
export const MINIMAP_ZOOM_MIN = 2
export const MINIMAP_ZOOM_MAX = 8

/** Canvas transform for the rotating map. */
export function minimapTransform(px: number, py: number, yawDeg: number, zoom: number, diameter: number): { transform: string; origin: string } {
  const s = (zoom * MINIMAP_CANVAS) / (MINIMAP_TILE_PX * diameter)
  return {
    transform: `translate(${diameter / 2 - (px / MINIMAP_CANVAS) * diameter}px, ${diameter / 2 - (py / MINIMAP_CANVAS) * diameter}px) scale(${s}) rotate(${yawDeg}deg)`,
    origin: `${(px / MINIMAP_CANVAS) * 100}% ${(py / MINIMAP_CANVAS) * 100}%`,
  }
}

/** Screen offset of an NPC dot from the circle centre, or null when outside it. */
export function minimapDotOffset(npcX: number, npcY: number, playerX: number, playerY: number, yawDeg: number, zoom: number, diameter: number): Point | null {
  const dx = (npcX - playerX - 0.5) * zoom
  const dy = -(npcY - playerY - 0.5) * zoom
  const a = (yawDeg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const x = dx * c - dy * s
  const y = dx * s + dy * c
  const rad = diameter / 2
  return x * x + y * y <= rad * rad ? { x: rad + x, y: rad + y } : null
}

// ---------------------------------------------------------------------------
// Status bars
// ---------------------------------------------------------------------------

export interface StatusBarsGeometry {
  left: Rect
  right: Rect
  bounds: Rect
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

function barsAround(interior: Rect): StatusBarsGeometry {
  const y = interior.y + 4
  const left = r(interior.x - 20, y, 20, 252)
  const right = r(interior.x + interior.width, y, 20, 252)
  return { left, right, bounds: union(left, right) }
}

export function statusBarsGeometry(layout: ClientLayoutMode): StatusBarsGeometry {
  if (layout === 'fixed') return barsAround(fixedLocal(FIXED.sidePanelBackground))
  if (layout === 'classic') return barsAround(r(26, 37, 190, 261))
  const left = r(-51, 0, 20, 272)
  const right = r(-25, 0, 20, 272)
  return { left, right, bounds: union(left, right) }
}

/** Filled part of a bar (inset 1 px, grows from the bottom), or null when empty. */
export function statusBarFill(bar: Rect, max: number, current: number): Rect | null {
  const ratio = max <= 0 || current <= 0 ? 0 : current / max
  const h = ratio >= 1 ? bar.height : Math.round(ratio * bar.height)
  const inner = h - 2
  if (inner <= 0) return null
  return { x: bar.x + 1, y: bar.y + 1 + (bar.height - h), width: bar.width - 2, height: inner }
}

// ---------------------------------------------------------------------------
// Infobox strip
// ---------------------------------------------------------------------------

export const INFOBOX_SIZE = 32
export const INFOBOX_GAP = 2
export const INFOBOX_PER_ROW = 6

/** Strip size for `count` boxes, max 6 per row (Free / Inventory pins). */
export function infoboxStripSize(count: number, contentScale: number): { width: number; height: number } {
  const n = Math.max(1, count)
  const box = INFOBOX_SIZE * contentScale
  const gap = INFOBOX_GAP * contentScale
  const cols = Math.min(n, INFOBOX_PER_ROW)
  const rows = Math.ceil(n / INFOBOX_PER_ROW)
  return { width: cols * box + Math.max(0, cols - 1) * gap, height: rows * box + Math.max(0, rows - 1) * gap }
}

/** Strip size when docked to the HUD (as many per row as fit the HUD width). */
export function infoboxDockSize(hudWidth: number, uiScale: number, contentScale: number, count: number): { width: number; height: number } {
  const box = INFOBOX_SIZE * contentScale
  const gap = INFOBOX_GAP * contentScale
  const width = uiScale > 0 ? hudWidth / uiScale : hudWidth
  const perRow = Math.max(1, Math.floor((width + gap) / (box + gap)))
  const rows = Math.ceil(Math.max(1, count) / perRow)
  return { width, height: rows * box + Math.max(0, rows - 1) * gap }
}

/** Default (and Free-pin default) strip position: left edge with the game panel, 5 px above it. */
export function defaultInfoboxPosition(stripWidth: number, stripHeight: number, uiScale: number, gamePanel: PanelPosition | null, panelSize: { width: number; height: number } = CONTENT_BOX): PanelPosition {
  if (!gamePanel) {
    return { x: Math.max(0, (panelSize.width - stripWidth) * uiScale), y: Math.round(36 * uiScale) + 2 + panelSize.height * uiScale + 5, anchorX: 'right', anchorY: 'bottom' }
  }
  const dx = Math.max(0, (panelSize.width - stripWidth) * uiScale)
  const x = gamePanel.x + (gamePanel.anchorX === 'right' ? dx : 0)
  if (gamePanel.anchorY === 'bottom') return { x, y: gamePanel.y + panelSize.height * uiScale + 5, anchorX: gamePanel.anchorX, anchorY: 'bottom' }
  return { x, y: Math.max(0, gamePanel.y - 5 - stripHeight * uiScale), anchorX: gamePanel.anchorX, anchorY: 'top' }
}

/** Strip left/top when pinned to the game panel's live position. */
export function infoboxAbovePanel(panelLeft: number, panelTop: number, stripScaledHeight: number): Point {
  return { x: panelLeft, y: Math.max(0, panelTop - 5 - stripScaledHeight) }
}

// ---------------------------------------------------------------------------
// Inventory / prayer / equipment grids
// ---------------------------------------------------------------------------

/** Inventory slot box (36x32) origin. */
export function inventorySlotOrigin(index: number): Point {
  return { x: 23 + (index % 4) * 42, y: 15 + Math.floor(index / 4) * 36 }
}

/** Inventory drop target under a panel-local point, 42x36 cells from (20,13). */
export function inventorySlotAt(localX: number, localY: number): number | null {
  const col = Math.floor((localX - 20) / 42)
  const row = Math.floor((localY - 13) / 36)
  if (col < 0 || col >= 4 || row < 0 || row >= 7) return null
  const i = row * 4 + col
  return i < 28 ? i : null
}

/** Prayer icon cell origin: 5 columns, pitch 37, from (11,16). */
export function prayerCellOrigin(index: number): Point {
  return { x: 11 + (index % 5) * 37, y: 16 + Math.floor(index / 5) * 37 }
}

/** Skills grid cell origin: 3 columns x 63, rows x 30, from (8,8). */
export function skillCellOrigin(index: number): Point {
  return { x: 8 + (index % 3) * 63, y: 8 + Math.floor(index / 3) * 30 }
}

/** Quantity text + colour for an inventory stack. */
export function formatStackQuantity(q: number): { text: string; color: string } {
  if (q >= 1e7) return { text: `${Math.floor(q / 1e6)}M`, color: '#00ff00' }
  if (q >= 1e5) return { text: `${Math.floor(q / 1e3)}K`, color: '#ffffff' }
  return { text: q.toString(), color: '#ffff00' }
}

/** Spellbook grid. */
export const SPELLBOOK_GRID: Readonly<Record<'standard' | 'ancient' | 'lunar' | 'arceuus', { cols: number; gapX: number; gapY: number; offsetX: number; offsetY: number }>> = {
  standard: { cols: 7, gapX: 0, gapY: 0, offsetX: 1, offsetY: 15 },
  ancient: { cols: 4, gapX: 20, gapY: 4, offsetX: 2, offsetY: 8 },
  lunar: { cols: 6, gapX: 6, gapY: 5, offsetX: 0, offsetY: 8 },
  arceuus: { cols: 6, gapX: 9, gapY: 7, offsetX: 0, offsetY: 0 },
}

export interface SpellGridLayout {
  slotSize: number
  startX: number
  startY: number
  gapX: number
  gapY: number
  cols: number
}

export function spellGridLayout(filtering: boolean, count: number, book: keyof typeof SPELLBOOK_GRID, iconResizing = true): SpellGridLayout {
  const trunc = Math.trunc
  if (!filtering) {
    const g = SPELLBOOK_GRID[book]
    return { slotSize: 24, startX: 7 + trunc((190 - (g.cols * 24 + (g.cols - 1) * g.gapX)) / 2) + g.offsetX, startY: 7 + g.offsetY, gapX: g.gapX, gapY: g.gapY, cols: g.cols }
  }
  let slot = 24
  let cols: number
  if (iconResizing) {
    if (count <= 15) {
      slot = 40
      cols = 3
    } else if (count <= 20) {
      slot = 40
      cols = 4
    } else cols = Math.max(4, Math.min(7, trunc((count + 8) / 9)))
  } else cols = count <= 28 ? 4 : Math.max(4, Math.min(7, trunc((count + 8) / 9)))
  const maxGap = iconResizing ? trunc((5 * slot) / 7) : slot
  const gapX = Math.max(0, Math.min(maxGap, trunc((184 - slot * cols) / (cols - 1))))
  const rows = Math.max(1, trunc((count + (cols - 1)) / cols))
  const gapY = rows >= 2 ? Math.max(0, Math.min(gapX, trunc((240 - slot * rows) / (rows - 1)))) : 0
  const width = cols * slot + (cols - 1) * gapX
  const height = rows * slot + (rows - 1) * gapY
  const effH = iconResizing ? height : Math.max(height, 210)
  return { slotSize: slot, startX: 7 + trunc(6 / 2) + trunc((184 - width) / 2), startY: 7 + trunc((240 - effH) / 2), gapX, gapY, cols }
}

/** Combat level. */
export function combatLevel(stats: Record<'attack' | 'strength' | 'defence' | 'ranged' | 'magic' | 'prayer' | 'hitpoints', { max: number }>): number {
  const base = 0.25 * (stats.defence.max + stats.hitpoints.max + Math.floor(stats.prayer.max / 2))
  const melee = 0.325 * (stats.attack.max + stats.strength.max)
  const range = 0.325 * (Math.floor(stats.ranged.max / 2) + stats.ranged.max)
  const mage = 0.325 * (Math.floor(stats.magic.max / 2) + stats.magic.max)
  return Math.floor(base + Math.max(melee, range, mage))
}
