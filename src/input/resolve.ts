import type { Tile } from '../sim/api'
import {
  buildGroundItemEntries,
  buildMenuParts,
  buildNpcEntries,
  type ClickType,
  type GroundItemMenuItem,
  groundItemTooltip,
  type ItemTypeInfo,
  MENU_TARGET_COLORS,
  type MenuEntry,
  type MenuParts,
  type NpcTagContext,
  type NpcTypeInfo,
  npcHasAnyAction,
  npcHasAttack,
  npcTooltip,
  resolveSwappedLeftClick,
  type SwapRule,
  swappedEntryTooltip,
  type TooltipContent,
} from './menu'

/**
 * Viewport hit resolution, independent of the DOM: which NPC / item a hover
 * or click means, what the tooltip says, what a left click does, and the
 * right-click menu parts. Re-implements scim's hover resolver `kve`
 *, left-click resolver
 *.
 */

export interface PickedNpc {
  actorId: string
  npcTypeId: number
  position: Tile
  /** null when the NPC type failed to load. */
  type: NpcTypeInfo | null
}

export interface PickedGroundItem {
  groundItemId: string
  itemId: number
  position: Tile
}

export interface PickContext {
  /** Terrain tile under the cursor (null over the sky). */
  tile: Tile | null
  /** Picked NPCs, nearest first, one per actor. */
  npcs: PickedNpc[]
  /** Ground items hit by the ray, nearest first. */
  groundItems: PickedGroundItem[]
  /** Ground items the menu lists (all items on the picked tile, newest first). */
  menuGroundItems: GroundItemMenuItem[]
  /** The player's attack target (its menu target gets a leading `*`). */
  attackTargetId: string | null
  /** NPC highlight colour for menus/tooltips when "Color menu and hover text" is on. */
  npcMenuColor?: ((npcTypeId: number) => string | undefined) | undefined
  swapRules: readonly SwapRule[]
  loadItem(itemId: number): ItemTypeInfo | null
}

export interface ViewportActionHandlers {
  /** Walk to a tile (the `Walk here` entry / swapped walk). */
  onWalk(tile: Tile): void
  /** Attack an NPC (menu `Attack` entry / swapped Attack). */
  onAttack(npc: PickedNpc): void
  onTake(groundItemId: string): void
}

const NO_HANDLERS: ViewportActionHandlers = { onWalk: () => {}, onAttack: () => {}, onTake: () => {} }

/**
 * First picked NPC whose type has any non-null action; NPCs without actions
 * are click-through. A failed type load is remembered as a fallback.
 */
export function firstInteractiveNpc(npcs: readonly PickedNpc[]): { npc: PickedNpc; type: NpcTypeInfo | null } | null {
  let fallback: { npc: PickedNpc; type: NpcTypeInfo | null } | null = null
  for (const npc of npcs) {
    if (!npc.type) {
      fallback ??= { npc, type: null }
      continue
    }
    if (npcHasAnyAction(npc.type)) return { npc, type: npc.type }
  }
  return fallback
}

/** Menu parts for the viewport (NPC entries per picked NPC, ground items, Walk here). */
export function buildViewportMenuParts(ctx: PickContext, handlers: ViewportActionHandlers, tagContext?: NpcTagContext): MenuParts {
  const npcEntries: MenuEntry[][] = []
  for (const npc of ctx.npcs) {
    if (!npc.type) continue
    const color = ctx.npcMenuColor?.(npc.npcTypeId) ?? MENU_TARGET_COLORS.npc
    npcEntries.push(
      buildNpcEntries({
        npcType: npc.type,
        npcTypeId: npc.npcTypeId,
        color,
        isAttackTarget: ctx.attackTargetId === npc.actorId,
        onAttack: () => handlers.onAttack(npc),
        ...(tagContext ? { tagContext } : {}),
      }),
    )
  }
  const groundItemEntries = ctx.menuGroundItems.length > 0 ? buildGroundItemEntries(ctx.menuGroundItems, ctx.loadItem, handlers.onTake) : []
  return buildMenuParts({ tile: ctx.tile, npcEntries, groundItemEntries, onWalk: handlers.onWalk, swapRules: ctx.swapRules })
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export interface HoverResult {
  /** Changes only when what the tooltip shows changes (scim shows/hides on key change). */
  key: string
  tooltip: TooltipContent | null
  /** Cross colour when a left click falls through to a walk. */
  leftClickType: ClickType
  /** Last hovered attackable NPC, used as the tile-click fallback. */
  hoveredNpcId: string | null
}

const NONE: HoverResult = { key: 'none', tooltip: null, leftClickType: 'yellow', hoveredNpcId: null }

/**
 * scim priority: off canvas -> nothing; Shift -> nothing; a resolving
 * Custom Menu Swap; nearest NPC with actions (tooltip only with Attack);
 * nearest ground item; plain tiles never get a tooltip.
 */
export function resolveHover(ctx: PickContext | null, shiftHeld: boolean): HoverResult {
  if (!ctx) return NONE
  if (shiftHeld) return { key: 'shift', tooltip: null, leftClickType: 'yellow', hoveredNpcId: null }
  if (ctx.swapRules.length > 0) {
    const swap = resolveSwappedLeftClick(buildViewportMenuParts(ctx, NO_HANDLERS))
    if (swap?.kind === 'walk') return { key: 'swap:walk', tooltip: null, leftClickType: 'yellow', hoveredNpcId: null }
    if (swap) {
      const e = swap.entry
      return { key: `swap:${e.action}:${e.target ?? ''}:${e.targetColor ?? ''}`, tooltip: swappedEntryTooltip(e), leftClickType: 'red', hoveredNpcId: null }
    }
  }
  const hit = firstInteractiveNpc(ctx.npcs)
  if (hit) {
    const { npc, type } = hit
    if (!type) return { key: `npc-no-tooltip:${npc.actorId}`, tooltip: null, leftClickType: 'yellow', hoveredNpcId: npc.actorId }
    if (npcHasAttack(type)) {
      const color = ctx.npcMenuColor?.(npc.npcTypeId)
      return { key: `npc:${npc.actorId}:${color ?? ''}`, tooltip: npcTooltip(type, color), leftClickType: 'red', hoveredNpcId: npc.actorId }
    }
    return { key: `npc-no-action:${npc.actorId}`, tooltip: null, leftClickType: 'yellow', hoveredNpcId: null }
  }
  const item = ctx.groundItems[0]
  if (item) return { key: `item:${item.groundItemId}`, tooltip: groundItemTooltip(item.itemId, ctx.loadItem(item.itemId)), leftClickType: 'red', hoveredNpcId: null }
  return NONE
}

// ---------------------------------------------------------------------------
// Left click
// ---------------------------------------------------------------------------

export type LeftClickResolution =
  /** A swapped menu entry: run its onClick (possibly none), red cross. */
  | { kind: 'entry'; entry: MenuEntry }
  /** Attack the NPC (tile click on its position with its id), red cross. */
  | { kind: 'attack'; npc: PickedNpc }
  /** Take the ground item, red cross. */
  | { kind: 'take'; groundItemId: string }
  /** Not handled: walk to the terrain tile (if any) with the hover colour. */
  | { kind: 'walk'; clearHoveredNpc: boolean }

/** scim: what a left mousedown on the viewport does. */
export function resolveLeftClick(ctx: PickContext, shiftHeld: boolean, handlers: ViewportActionHandlers): LeftClickResolution {
  if (shiftHeld) return { kind: 'walk', clearHoveredNpc: false }
  if (ctx.swapRules.length > 0) {
    const swap = resolveSwappedLeftClick(buildViewportMenuParts(ctx, handlers))
    if (swap?.kind === 'walk') return { kind: 'walk', clearHoveredNpc: true }
    if (swap) return { kind: 'entry', entry: swap.entry }
  }
  const hit = firstInteractiveNpc(ctx.npcs)
  if (hit) {
    if (hit.type && npcHasAttack(hit.type)) return { kind: 'attack', npc: hit.npc }
    return { kind: 'walk', clearHoveredNpc: true }
  }
  const item = ctx.groundItems[0]
  if (item) return { kind: 'take', groundItemId: item.groundItemId }
  return { kind: 'walk', clearHoveredNpc: false }
}
