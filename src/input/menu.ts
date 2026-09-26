/**
 * Right-click menu entries, their text / colours, and Custom Menu Swaps.
 * Pure functions shared by the viewport (ViewportInput) and the inventory's
 * right-click menu (CLIENT-UI). Re-implements scim.gg's builders:
 *, NPC entries /
 *, ground items, swaps
 *.
 */

export type ClickType = 'yellow' | 'red'

export interface MenuEntry {
  action: string
  target?: string
  /** Colour of the target text; the menu falls back to the pack's primary-hover colour. */
  targetColor?: string
  onClick?: () => void
  /** Cross drawn when the entry is selected. Examine / Cancel have none. */
  clickType?: ClickType
  disabled?: boolean
  /** Submenu (e.g. NPC); entries with action `swatch` render as colour squares. */
  submenu?: MenuEntry[]
}

export interface MenuContent {
  entries: MenuEntry[]
}

/** Menu target colours. */
export const MENU_TARGET_COLORS = { npc: '#f8e868', loc: '#78e8e0', item: '#f8c070' } as const

/** Cursor tooltip colours; slightly different from the menu's. */
export const TOOLTIP_COLORS = {
  action: '#ffffff',
  item: '#f5c080',
  npc: '#f5ec78',
  loc: '#80e8e0',
  spell: '#f5c080',
  prayer: '#f5c080',
  ui: '#f5c080',
} as const

// ---------------------------------------------------------------------------
// Custom Menu Swaps
// ---------------------------------------------------------------------------

export type Matcher = (value: string) => boolean

export interface SwapRule {
  option: Matcher
  target: Matcher
  topOption: Matcher
  topTarget: Matcher
}

const matchAny: Matcher = () => true

/** Lowercase + trim. */
export function normalizeSwapField(value: string | undefined | null): string {
  return (value ?? '').toLowerCase().trim()
}

/**
 * Wildcard compiler: no `*` = exact; `*` = anything; `x*` =
 * startsWith; `*x` = endsWith; `*x*` = includes; anything else = anchored
 * regex with `*` -> `.*`.
 */
export function compileWildcard(pattern: string): Matcher {
  const first = pattern.indexOf('*')
  if (first === -1) return (v) => v === pattern
  if (pattern === '*') return matchAny
  const last = pattern.lastIndexOf('*')
  if (first === last) {
    if (first === 0) {
      const suffix = pattern.slice(1)
      return (v) => v.endsWith(suffix)
    }
    if (first === pattern.length - 1) {
      const prefix = pattern.slice(0, -1)
      return (v) => v.startsWith(prefix)
    }
  } else if (first === 0 && last === pattern.length - 1 && pattern.indexOf('*', 1) === last) {
    const inner = pattern.slice(1, -1)
    return (v) => v.includes(inner)
  }
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  const re = new RegExp(`^${source}$`)
  return (v) => re.test(v)
}

/** One rule per line: `option,target[,topOption[,topTarget]]`; blank lines skipped. */
export function parseMenuSwapRules(text: string): SwapRule[] {
  const rules: SwapRule[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const fields = line.split(',')
    rules.push({
      option: compileWildcard(normalizeSwapField(fields[0])),
      target: compileWildcard(normalizeSwapField(fields[1])),
      topOption: fields.length > 2 ? compileWildcard(normalizeSwapField(fields[2])) : matchAny,
      topTarget: fields.length > 3 ? compileWildcard(normalizeSwapField(fields[3])) : matchAny,
    })
  }
  return rules
}

/** Rules in effect for the current settings (empty when the plugin is off). */
export function swapRulesFromSettings(enabled: boolean, text: string): SwapRule[] {
  return enabled ? parseMenuSwapRules(text) : []
}

/** Target used for matching: normalised, leading `*` (current-target mark) removed. */
export function swapTargetKey(entry: Pick<MenuEntry, 'target'>): string {
  const t = normalizeSwapField(entry.target)
  return t.startsWith('*') ? t.slice(1).trim() : t
}

/**
 * Index of the entry the highest-numbered matching rule selects (later lines
 * win; ties go to the earlier entry), or -1. Entry 0 is the "top".
 */
export function findSwapIndex(entries: readonly Pick<MenuEntry, 'action' | 'target'>[], rules: readonly SwapRule[]): number {
  const top = entries[0]
  if (!top || rules.length === 0) return -1
  const topOption = normalizeSwapField(top.action)
  const topTarget = swapTargetKey(top)
  let bestEntry = -1
  let bestRule = -1
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) continue
    const option = normalizeSwapField(entry.action)
    const target = swapTargetKey(entry)
    for (let r = rules.length - 1; r > bestRule; r--) {
      const rule = rules[r]
      if (rule && rule.option(option) && rule.target(target) && rule.topOption(topOption) && rule.topTarget(topTarget)) {
        bestEntry = i
        bestRule = r
        break
      }
    }
  }
  return bestEntry
}

// ---------------------------------------------------------------------------
// NPC entries
// ---------------------------------------------------------------------------

/** The cache fields the menus need (NpcType). */
export interface NpcTypeInfo {
  name: string
  actions: readonly (string | null)[]
  combatLevel: number
}

/** `<col=RRGGBB>Name</col>` names carry their own colour. */
export function parseColoredName(name: string, fallbackColor: string): { name: string; color: string } {
  const m = /^<col=([0-9a-f]{6})>([^<>]+)<\/col>$/i.exec(name)
  return m?.[1] && m[2] !== undefined ? { name: m[2], color: `#${m[1]}` } : { name, color: fallbackColor }
}

/** `  (level-N)` with two spaces, omitted for level 0 or less. */
export function levelSuffix(combatLevel: number): string {
  return combatLevel > 0 ? `  (level-${combatLevel})` : ''
}

export function npcHasAnyAction(type: NpcTypeInfo): boolean {
  return type.actions.some((a) => a != null)
}

export function npcHasAttack(type: NpcTypeInfo): boolean {
  return type.actions.some((a) => a === 'Attack')
}

export type NpcHighlightModeId = 'trueTile' | 'swTile' | 'clickbox'

export const NPC_TAG_MODES: readonly { mode: NpcHighlightModeId; label: string }[] = [
  { mode: 'trueTile', label: 'True Tile' },
  { mode: 'swTile', label: 'SW Tile' },
  { mode: 'clickbox', label: 'Clickbox' },
]

/** Shift/Ctrl menu "Tag" submenu context (scim's `npcHighlightContext`). */
export interface NpcTagContext {
  isHighlighted(npcTypeId: number, mode: NpcHighlightModeId): boolean
  getHighlightColor(npcTypeId: number, mode: NpcHighlightModeId): string | undefined
  onToggleHighlight(npcName: string, npcTypeId: number, mode: NpcHighlightModeId): void
  onOpenColorPicker?: (npcName: string, npcTypeId: number, mode: NpcHighlightModeId, color: string) => void
}

export interface NpcEntryOptions {
  npcType: NpcTypeInfo
  npcTypeId: number
  /** NPC highlight colour when "colour menu entries" applies, else MENU_TARGET_COLORS.npc. */
  color: string
  /** Marks the target with a leading `*` (the player's current attack target). */
  isAttackTarget: boolean
  /** Handler for the `Attack` action (red cross). Other actions do nothing. */
  onAttack?: () => void
  /** Present only for the extended (Shift/Ctrl) menu. */
  tagContext?: NpcTagContext
}

/**
 * One NPC's entries: its non-null cache actions in cache order, `Examine`,
 * then (extended menu only) with its submenu (scim +).
 */
export function buildNpcEntries(opts: NpcEntryOptions): MenuEntry[] {
  const { name, color } = parseColoredName(opts.npcType.name || 'NPC', opts.color)
  const suffix = levelSuffix(opts.npcType.combatLevel)
  const target = `${opts.isAttackTarget ? '*' : ''}${name}${suffix}`
  const out: MenuEntry[] = []
  for (const action of opts.npcType.actions) {
    if (action == null) continue
    const onClick = action === 'Attack' ? opts.onAttack : undefined
    out.push({ action, target, targetColor: color, ...(onClick ? { onClick, clickType: 'red' as const } : {}) })
  }
  out.push({ action: 'Examine', target, targetColor: color })
  const tag = opts.tagContext
  if (tag) {
    const submenu: MenuEntry[] = []
    for (const { mode, label } of NPC_TAG_MODES) {
      const tagged = tag.isHighlighted(opts.npcTypeId, mode)
      submenu.push({
        action: tagged ? 'Untag' : 'Tag',
        target: label,
        targetColor: MENU_TARGET_COLORS.npc,
        onClick: () => tag.onToggleHighlight(name, opts.npcTypeId, mode),
      })
      const current = tag.getHighlightColor(opts.npcTypeId, mode)
      const openPicker = tag.onOpenColorPicker
      if (tagged && current && openPicker) {
        submenu.push({ action: 'swatch', targetColor: current, onClick: () => openPicker(name, opts.npcTypeId, mode, current) })
      }
    }
    out.push({ action: 'Tag', target: name + suffix, targetColor: color, submenu })
  }
  return out
}

// ---------------------------------------------------------------------------
// Ground items
// ---------------------------------------------------------------------------

export interface GroundItemMenuItem {
  groundItemId: string
  itemId: number
}

export interface ItemTypeInfo {
  name: string
  groundActions: readonly (string | null)[]
}

/** Item display name: cache name unless missing / "null". */
export function itemDisplayName(itemId: number, name: string | null | undefined, fallback = 'Item'): string {
  void itemId
  return name && name !== 'null' ? name : fallback
}

/**
 * Entries for ground items (newest first): their ground actions with `Take`
 * prepended when missing, then `Examine`. Only `Take` does
 * something (take, red cross).
 */
export function buildGroundItemEntries(
  items: readonly GroundItemMenuItem[],
  loadItem: (itemId: number) => ItemTypeInfo | null,
  onTake: (groundItemId: string) => void,
): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const item of items) {
    let name = 'Item'
    let actions: string[] = []
    const type = loadItem(item.itemId)
    if (type) {
      name = itemDisplayName(item.itemId, type.name)
      actions = type.groundActions.filter((a): a is string => a != null)
    }
    if (!actions.some((a) => a.toLowerCase() === 'take')) actions = ['Take', ...actions]
    for (const action of actions) {
      const isTake = action.toLowerCase() === 'take'
      out.push({
        action,
        target: name,
        targetColor: MENU_TARGET_COLORS.item,
        ...(isTake ? { onClick: () => onTake(item.groundItemId), clickType: 'red' as const } : {}),
      })
    }
    out.push({ action: 'Examine', target: name, targetColor: MENU_TARGET_COLORS.item })
  }
  return out
}

/** Ground items on a tile, newest drop first. */
export function groundItemsOnTile<T extends { position: readonly [number, number]; droppedTick: number }>(
  items: readonly T[],
  tile: readonly [number, number],
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.position[0] === tile[0] && item.position[1] === tile[1])
    .sort((a, b) => b.item.droppedTick - a.item.droppedTick || b.index - a.index)
    .map(({ item }) => item)
}

// ---------------------------------------------------------------------------
// Tile / line marker entries (extended menu)
// ---------------------------------------------------------------------------

export interface TileMarkerMenuContext {
  hasMarker(tile: readonly [number, number]): boolean
  onMark(tile: readonly [number, number]): void
  onUnmark(tile: readonly [number, number]): void
  onLabel(tile: readonly [number, number]): void
  onColor(tile: readonly [number, number]): void
}

export type TileEdgeName = 'north' | 'east' | 'south' | 'west'

export interface TileEdgeRef {
  x: number
  y: number
  edge: TileEdgeName
}

export interface LineMarkerMenuContext {
  edge: TileEdgeRef | null
  hasEdge(edge: TileEdgeRef): boolean
  onMark(edge: TileEdgeRef): void
  onUnmark(edge: TileEdgeRef): void
  onLabel(edge: TileEdgeRef): void
  onColor(edge: TileEdgeRef): void
}

const EDGE_LABEL: Record<TileEdgeName, string> = { north: 'North', east: 'East', south: 'South', west: 'West' }

/** Edge -> stored line: south/north are horizontal lines, west/east vertical. */
export function edgeToLine(edge: TileEdgeRef): { x: number; y: number; orientation: 'horizontal' | 'vertical' } {
  switch (edge.edge) {
    case 'south':
      return { x: edge.x, y: edge.y, orientation: 'horizontal' }
    case 'north':
      return { x: edge.x, y: edge.y + 1, orientation: 'horizontal' }
    case 'west':
      return { x: edge.x, y: edge.y, orientation: 'vertical' }
    case 'east':
      return { x: edge.x + 1, y: edge.y, orientation: 'vertical' }
  }
}

function tileMarkerEntries(tile: readonly [number, number] | null, ctx: TileMarkerMenuContext | undefined): MenuEntry[] {
  if (!tile || !ctx) return []
  const color = MENU_TARGET_COLORS.loc
  if (ctx.hasMarker(tile)) {
    return [
      { action: 'Unmark', target: 'tile', targetColor: color, onClick: () => ctx.onUnmark(tile) },
      { action: 'Label', target: 'tile', targetColor: color, onClick: () => ctx.onLabel(tile) },
      { action: 'Color', target: 'tile', targetColor: color, onClick: () => ctx.onColor(tile) },
    ]
  }
  return [{ action: 'Mark', target: 'tile', targetColor: color, onClick: () => ctx.onMark(tile) }]
}

function lineMarkerEntries(ctx: LineMarkerMenuContext | undefined): MenuEntry[] {
  const edge = ctx?.edge
  if (!ctx || !edge) return []
  const color = MENU_TARGET_COLORS.loc
  const target = `${EDGE_LABEL[edge.edge]} line`
  if (ctx.hasEdge(edge)) {
    return [
      { action: 'Unmark', target, targetColor: color, onClick: () => ctx.onUnmark(edge) },
      { action: 'Label', target, targetColor: color, onClick: () => ctx.onLabel(edge) },
      { action: 'Color', target, targetColor: color, onClick: () => ctx.onColor(edge) },
    ]
  }
  return [{ action: 'Mark', target, targetColor: color, onClick: () => ctx.onMark(edge) }]
}

// ---------------------------------------------------------------------------
// Whole menu
// ---------------------------------------------------------------------------

/** Examine entries go to the examine list; everything else is an action. */
function splitExamines(entries: readonly MenuEntry[], actions: MenuEntry[], examines: MenuEntry[]): void {
  for (const e of entries) (e.action === 'Examine' ? examines : actions).push(e)
}

export interface MenuSources {
  /** Tile under the cursor (null over the sky). */
  tile: readonly [number, number] | null
  /** Per picked NPC (nearest first), its entries from buildNpcEntries. */
  npcEntries: readonly MenuEntry[][]
  /** Entries from buildGroundItemEntries (items on the picked tile, newest first). */
  groundItemEntries: readonly MenuEntry[]
  /** Loc entries (none in the triple-Jad arena, kept for completeness). */
  locEntries?: readonly MenuEntry[]
  /** Walk handler for `Walk here` (yellow cross). */
  onWalk: (tile: readonly [number, number]) => void
  swapRules: readonly SwapRule[]
}

export interface MenuParts {
  actions: MenuEntry[]
  walkHere: MenuEntry | null
  examines: MenuEntry[]
  /** Index into [...actions, walkHere] chosen by Custom Menu Swaps, or -1. */
  swapIndex: number
}

/** scim: NPC, loc, ground item entries; `Walk here`; examines; swap index. */
export function buildMenuParts(src: MenuSources): MenuParts {
  const actions: MenuEntry[] = []
  const examines: MenuEntry[] = []
  for (const entries of src.npcEntries) splitExamines(entries, actions, examines)
  if (src.locEntries) splitExamines(src.locEntries, actions, examines)
  splitExamines(src.groundItemEntries, actions, examines)
  const tile = src.tile
  const walkHere: MenuEntry | null = tile ? { action: 'Walk here', onClick: () => src.onWalk(tile), clickType: 'yellow' } : null
  const candidates = walkHere ? [...actions, walkHere] : actions
  const swapIndex = src.swapRules.length > 0 ? findSwapIndex(candidates, src.swapRules) : -1
  return { actions, walkHere, examines, swapIndex }
}

export type SwappedLeftClick = { kind: 'walk'; entry: MenuEntry } | { kind: 'action'; entry: MenuEntry }

/** Left-click override from Custom Menu Swaps. */
export function resolveSwappedLeftClick(parts: MenuParts): SwappedLeftClick | null {
  if (parts.swapIndex < 0) return null
  const candidates = parts.walkHere ? [...parts.actions, parts.walkHere] : parts.actions
  const entry = candidates[parts.swapIndex]
  if (!entry) return null
  return { kind: entry === parts.walkHere ? 'walk' : 'action', entry }
}

export interface ExtendedMenuContext {
  tileMarkers?: TileMarkerMenuContext
  lineMarkers?: LineMarkerMenuContext
}

export type RightClickResolution = { kind: 'menu'; content: MenuContent } | { kind: 'camera-drag' } | { kind: 'none' }

/**
 * Final entry list: actions, tile-marker entries,
 * line-marker entries, `Walk here`, examines, `Cancel`; then the swapped
 * entry trades places with entry 0.
 */
export function buildContextMenu(tile: readonly [number, number] | null, parts: MenuParts, ext: ExtendedMenuContext = {}): {
  content: MenuContent | null
  hasActionEntries: boolean
} {
  const tileEntries = tileMarkerEntries(tile, ext.tileMarkers)
  const lineEntries = lineMarkerEntries(ext.lineMarkers)
  const { actions, walkHere, examines, swapIndex } = parts
  if (!tile && actions.length === 0 && examines.length === 0 && tileEntries.length === 0 && lineEntries.length === 0) {
    return { content: null, hasActionEntries: false }
  }
  const entries: MenuEntry[] = [...actions, ...tileEntries, ...lineEntries, ...(walkHere ? [walkHere] : []), ...examines, { action: 'Cancel' }]
  if (swapIndex > 0) {
    const candidates = walkHere ? [...actions, walkHere] : actions
    const swapped = candidates[swapIndex]
    const top = candidates[0]
    if (swapped && top) {
      const a = entries.indexOf(swapped)
      const b = entries.indexOf(top)
      if (a >= 0 && b >= 0) {
        entries[b] = swapped
        entries[a] = top
      }
    }
  }
  return { content: { entries }, hasActionEntries: actions.length > 0 || tileEntries.length > 0 || lineEntries.length > 0 }
}

/**
 * scim: with "right click moves camera", a menu opens only when
 * it has action entries, otherwise the right-drag rotates the camera.
 */
export function resolveRightClick(
  tile: readonly [number, number] | null,
  parts: MenuParts,
  ext: ExtendedMenuContext,
  rightClickMovesCamera: boolean,
): RightClickResolution {
  const { content, hasActionEntries } = buildContextMenu(tile, parts, ext)
  if (rightClickMovesCamera) return content && hasActionEntries ? { kind: 'menu', content } : { kind: 'camera-drag' }
  return content ? { kind: 'menu', content } : { kind: 'none' }
}

// ---------------------------------------------------------------------------
// Tooltip content
// ---------------------------------------------------------------------------

export interface TooltipSpan {
  text: string
  color: string
}

export interface TooltipContent {
  lines: { spans: TooltipSpan[] }[]
}

function oneLine(...spans: TooltipSpan[]): TooltipContent {
  return { lines: [{ spans }] }
}

/** NPC hover text: `<first action> ` + `<name>  (level-N)`. */
export function npcTooltip(type: NpcTypeInfo, color?: string): TooltipContent | null {
  const name = type.name || 'NPC'
  const action = type.actions.find((a) => a != null)
  if (!action) return null
  return oneLine({ text: `${action} `, color: TOOLTIP_COLORS.action }, { text: name + levelSuffix(type.combatLevel), color: color ?? TOOLTIP_COLORS.npc })
}

/** Ground item hover text. */
export function groundItemTooltip(itemId: number, type: ItemTypeInfo | null): TooltipContent | null {
  if (!type) return null
  const action = type.groundActions.find((a) => a != null) || 'Take'
  return oneLine({ text: `${action} `, color: TOOLTIP_COLORS.action }, { text: itemDisplayName(itemId, type.name), color: TOOLTIP_COLORS.item })
}

/** Swapped left-click entry hover text. */
export function swappedEntryTooltip(entry: MenuEntry): TooltipContent | null {
  if (!entry.target) return null
  const target = entry.target.startsWith('*') ? entry.target.slice(1) : entry.target
  return oneLine({ text: `${entry.action} `, color: TOOLTIP_COLORS.action }, { text: target, color: entry.targetColor ?? TOOLTIP_COLORS.npc })
}

/** Inventory item hover text: first inventory action (or `Drop` with Shift) + name. */
export function inventoryItemTooltip(itemId: number, type: { name: string; inventoryActions: readonly (string | null)[] } | null, shiftDrop = false): TooltipContent | null {
  if (!type) return null
  const action = shiftDrop ? 'Drop' : type.inventoryActions.find((a) => a != null) || 'Use'
  return oneLine({ text: `${action} `, color: TOOLTIP_COLORS.action }, { text: itemDisplayName(itemId, type.name), color: TOOLTIP_COLORS.item })
}

/** Equipment slot hover text: `Remove <item>`. */
export function equipmentItemTooltip(itemId: number, name: string | null, withRemove = true): TooltipContent {
  const spans: TooltipSpan[] = withRemove ? [{ text: 'Remove ', color: TOOLTIP_COLORS.action }] : []
  spans.push({ text: itemDisplayName(itemId, name), color: TOOLTIP_COLORS.item })
  return { lines: [{ spans }] }
}

/** Prayer icon hover text. */
export function prayerTooltip(prayerName: string, active: boolean): TooltipContent {
  return oneLine({ text: `${active ? 'Deactivate' : 'Activate'} `, color: TOOLTIP_COLORS.action }, { text: prayerName, color: TOOLTIP_COLORS.prayer })
}

/** Spell hover text. */
export function spellTooltip(spellName: string): TooltipContent {
  return oneLine({ text: 'Cast ', color: TOOLTIP_COLORS.action }, { text: spellName, color: TOOLTIP_COLORS.spell })
}

/** Orb / button hover texts (scim, `vpe`, `ype`). */
export const UI_TOOLTIPS = {
  equipmentStats: oneLine({ text: 'View equipment stats', color: TOOLTIP_COLORS.ui }),
  toggleRun: oneLine({ text: 'Toggle ', color: TOOLTIP_COLORS.action }, { text: 'Run', color: TOOLTIP_COLORS.ui }),
  specialAttack: oneLine({ text: 'Use ', color: TOOLTIP_COLORS.action }, { text: 'Special Attack', color: TOOLTIP_COLORS.ui }),
} as const

// ---------------------------------------------------------------------------
// Menu palette (scim over the theme `XC`, retinted per resource pack by)
// ---------------------------------------------------------------------------

export interface MenuPalette {
  action: string
  target: string
  background: string
  backgroundHover: string
  border: string
  headerText: string
  headerBackground: string
  separator: string
  disabled: string
  /** Swatch borders use the pack tokens (CSS variables in scim). */
  swatchBorder: string
  swatchBorderHover: string
  swatchBorderActive: string
}

interface PackTokens {
  bg: string
  surface: string
  borderHighlight: string
  primary: string
  primaryHover: string
  primaryStructure: string
  primaryDim: string
  secondary: string
  textMuted: string
}

/** The pack palette entries the menu uses. */
const PACK_TOKENS: Record<string, PackTokens> = {
  'pack-browntown': {
    bg: 'rgb(30, 24, 18)',
    surface: '#14100c',
    borderHighlight: '#383023',
    primary: '#d4a54a',
    primaryHover: '#dfc06a',
    primaryStructure: '#5d5245',
    primaryDim: 'rgba(212, 165, 74, 0.15)',
    secondary: '#c8aa6e',
    textMuted: '#8a7a5c',
  },
  'pack-vanilla': {
    bg: 'rgb(34, 28, 20)',
    surface: '#181410',
    borderHighlight: '#3e3428',
    primary: '#ff981f',
    primaryHover: '#ffac4d',
    primaryStructure: '#6a5e4e',
    primaryDim: 'rgba(255, 152, 31, 0.15)',
    secondary: '#c8aa6e',
    textMuted: '#8e7c5e',
  },
  'pack-toblite': {
    bg: 'rgb(26, 18, 28)',
    surface: '#120e14',
    borderHighlight: '#3a2d3e',
    primary: '#c45050',
    primaryHover: '#d46a6a',
    primaryStructure: '#564060',
    primaryDim: 'rgba(196, 80, 80, 0.15)',
    secondary: '#b08a94',
    textMuted: '#7a6878',
  },
  'pack-duckscape': {
    bg: 'rgb(22, 18, 26)',
    surface: '#100c14',
    borderHighlight: '#38303e',
    primary: '#8a9ca0',
    primaryHover: '#9cacb0',
    primaryStructure: '#4a5258',
    primaryDim: 'rgba(138, 156, 160, 0.15)',
    secondary: '#a09888',
    textMuted: '#706478',
  },
}

/** `#rrggbb` -> `rgba(r, g, b, a)`. */
export function withAlpha(hex: string, alpha: number): string {
  let h = hex.startsWith('#') ? hex.slice(1) : hex
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6) return hex
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`
}

/** Menu colours for a resource pack (unknown packs fall back to Brown, scim). */
export function menuPalette(packId: string): MenuPalette {
  const t = PACK_TOKENS[packId] ?? PACK_TOKENS['pack-browntown']!
  return {
    action: '#ffffff',
    target: t.primaryHover,
    background: t.bg,
    backgroundHover: t.primaryDim,
    border: withAlpha(t.borderHighlight, 0.5),
    headerText: t.secondary,
    headerBackground: t.surface,
    separator: withAlpha(t.borderHighlight, 0.3),
    disabled: t.textMuted,
    swatchBorder: t.borderHighlight,
    swatchBorderHover: t.primaryStructure,
    swatchBorderActive: t.primary,
  }
}

/** Tooltip card colours (scim: theme background + the fixed `border` token). */
export function tooltipPalette(packId: string): { background: string; border: string } {
  const t = PACK_TOKENS[packId] ?? PACK_TOKENS['pack-browntown']!
  return { background: t.bg, border: 'rgba(16, 16, 16, 0.8)' }
}

/** Menu scale `g = (1 + (uiScale - 1) * 0.4) * 0.85`. */
export function menuScale(uiScale: number): number {
  return (1 + (uiScale - 1) * 0.4) * 0.85
}

/** Tooltip scale `s = 1 + (uiScale - 1) * 0.4`. */
export function tooltipScale(uiScale: number): number {
  return 1 + (uiScale - 1) * 0.4
}
