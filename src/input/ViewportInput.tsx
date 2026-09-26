import { type JSX, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { lineMarkersStore, type LineMarker, npcHighlightsStore, type TileMarker, tileMarkersStore } from '../app/plugins/stores'
import type { SimRuntime } from '../app/runtime/types'
import { settingsStore, useSettings } from '../app/settings/settings'
import type { ViewportPicker } from '../render/api'
import type { Tile } from '../sim/api'
import { handleTakeGroundItem, handleTileClick } from './actions'
import { typeLookupFor } from './cacheTypes'
import { ContextMenu } from './ContextMenu'
import { getContextMenu, hideContextMenu, showContextMenu, subscribeContextMenu } from './contextMenuStore'
import { preloadCrosses, showMenuCross, ViewportCross } from './clickCross'
import { InputDialogs, openColorPicker, openLabelDialog } from './dialogs'
import { toElementLocal } from './dom'
import {
  type ClickType,
  edgeToLine,
  type ExtendedMenuContext,
  groundItemsOnTile,
  type LineMarkerMenuContext,
  menuPalette,
  menuScale,
  NPC_TAG_MODES,
  type NpcTagContext,
  resolveRightClick,
  type SwapRule,
  swapRulesFromSettings,
  type TileEdgeRef,
  type TileMarkerMenuContext,
} from './menu'
import { getModifiers, getMouseButtons, onModifiersChange } from './modifiers'
import { buildViewportMenuParts, type PickContext, type PickedGroundItem, type PickedNpc, resolveHover, resolveLeftClick, type ViewportActionHandlers } from './resolve'
import { hideTooltip, showTooltip, TooltipLayer, useMenuUiScale } from './tooltip'

/**
 * Pointer layer over the 3D viewport (scim handlers,
 * hover resolver, left-click, right-click menus
 *).
 *
 * Render it as a sibling of <GameViewport> inside the same positioned
 * container (same size): it attaches capture-phase listeners to its parent
 * element and itself only draws pointer-events:none layers (click cross,
 * tooltip) plus a body portal for the menu and dialogs.
 *
 * - Left mousedown: resolve (Custom Menu Swap, attackable NPC, ground item)
 *   and act with a red cross; otherwise walk to the terrain tile with the
 *   hover colour (yellow, or red when a hovered NPC is the fallback target).
 *   Shift+click always walks; Ctrl inverts run (engine ctrl override).
 * - Right mousedown (not Alt): the "Choose Option" menu; Shift/Ctrl adds the
 *   tile-marker, line-marker and NPC Tag entries. Claimed right clicks are
 *   preventDefault()ed; an unclaimed one (Camera plugin "Right-click moves
 *   camera" with no action entries) is left to the renderer's right-drag.
 * - Middle drag, wheel and camera keys belong to the renderer.
 * - Hover: tooltip card + left-click cross colour, re-resolved on every mouse
 *   move, every frame while the cursor is on the viewport, and on Shift.
 */

export interface ViewportInputProps {
  runtime: SimRuntime
  picker: ViewportPicker | null
}

interface CursorState {
  inside: boolean
  localX: number
  localY: number
}

/** Tile/line marker key: markersByEncounter / linesByEncounter use the encounter kind. */
function encounterKey(runtime: SimRuntime): string {
  return runtime.getSnapshot().state.encounter?.kind || 'tripleJad'
}

function tileMarkersFor(key: string): TileMarker[] {
  return tileMarkersStore.get().markersByEncounter[key] ?? []
}

function linesFor(key: string): LineMarker[] {
  return lineMarkersStore.get().linesByEncounter[key] ?? []
}

function sameLine(a: { x: number; y: number; orientation: string }, b: { x: number; y: number; orientation: string }): boolean {
  return a.x === b.x && a.y === b.y && a.orientation === b.orientation
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
}

// ---- plugin-store operations used by the extended menu ---------------------

function tileMarkerContext(key: string, menuX: number, menuY: number): TileMarkerMenuContext {
  const find = (tile: readonly [number, number]): TileMarker | undefined => tileMarkersFor(key).find((m) => m.x === tile[0] && m.y === tile[1])
  const writeMarkers = (markers: TileMarker[], extra: Partial<ReturnType<typeof tileMarkersStore.get>> = {}): void => {
    const s = tileMarkersStore.get()
    tileMarkersStore.patch({ ...extra, markersByEncounter: { ...s.markersByEncounter, [key]: markers } })
  }
  const anchor = { x: menuX + 6, y: menuY + 6 }
  return {
    hasMarker: (tile) => find(tile) !== undefined,
    // scim: replaces any marker on the tile, uses the last colour/opacity/fill.
    onMark: (tile) => {
      const s = tileMarkersStore.get()
      const next = tileMarkersFor(key).filter((m) => m.x !== tile[0] || m.y !== tile[1])
      next.push({ x: tile[0], y: tile[1], color: s.lastColor, opacity: s.lastOpacity, ...(s.lastFillOpacity > 0 ? { fillOpacity: s.lastFillOpacity } : {}) })
      writeMarkers(next)
    },
    onUnmark: (tile) => writeMarkers(tileMarkersFor(key).filter((m) => m.x !== tile[0] || m.y !== tile[1])),
    onLabel: (tile) => {
      const marker = find(tile)
      openLabelDialog({
        tile,
        anchor,
        initialLabel: marker?.label,
        onApply: (label) => {
          const markers = tileMarkersFor(key)
          const i = markers.findIndex((m) => m.x === tile[0] && m.y === tile[1])
          if (i < 0) return
          const next = [...markers]
          const { label: _old, ...rest } = next[i]!
          void _old
          next[i] = label ? { ...rest, label } : rest
          writeMarkers(next)
        },
      })
    },
    onColor: (tile) => {
      const s = tileMarkersStore.get()
      const marker = find(tile)
      openColorPicker({
        title: 'Tile Marker Color',
        subtitle: 'Outline and fill',
        showFill: true,
        anchor,
        initialColor: marker?.color ?? s.lastColor,
        initialOpacity: marker?.opacity ?? s.lastOpacity,
        initialFillOpacity: marker?.fillOpacity ?? 0,
        // scim: also becomes the last colour / opacity / fill.
        onApply: (color, opacity, fillOpacity) => {
          const markers = tileMarkersFor(key)
          const i = markers.findIndex((m) => m.x === tile[0] && m.y === tile[1])
          if (i < 0) return
          const o = clamp01(opacity)
          const f = clamp01(fillOpacity)
          const next = [...markers]
          const { fillOpacity: _oldFill, ...rest } = next[i]!
          void _oldFill
          next[i] = { ...rest, color, opacity: o, ...(f > 0 ? { fillOpacity: f } : {}) }
          writeMarkers(next, { lastColor: color, lastOpacity: o, lastFillOpacity: f })
        },
      })
    },
  }
}

function lineMarkerContext(key: string, edge: TileEdgeRef | null, menuX: number, menuY: number): LineMarkerMenuContext {
  const anchor = { x: menuX + 6, y: menuY + 6 }
  const writeLines = (lines: LineMarker[], extra: Partial<ReturnType<typeof lineMarkersStore.get>> = {}): void => {
    const s = lineMarkersStore.get()
    lineMarkersStore.patch({ ...extra, linesByEncounter: { ...s.linesByEncounter, [key]: lines } })
  }
  const find = (e: TileEdgeRef): LineMarker | undefined => {
    const line = edgeToLine(e)
    return linesFor(key).find((l) => sameLine(l, line))
  }
  return {
    edge,
    hasEdge: (e) => find(e) !== undefined,
    onMark: (e) => {
      const s = lineMarkersStore.get()
      const line = edgeToLine(e)
      const next = linesFor(key).filter((l) => !sameLine(l, line))
      next.push({ ...line, color: s.lastColor, opacity: s.lastOpacity })
      writeLines(next)
    },
    onUnmark: (e) => {
      const line = edgeToLine(e)
      writeLines(linesFor(key).filter((l) => !sameLine(l, line)))
    },
    onLabel: (e) => {
      const existing = find(e)
      openLabelDialog({
        tile: [e.x, e.y],
        anchor,
        initialLabel: existing?.label,
        onApply: (label) => {
          const line = edgeToLine(e)
          const lines = linesFor(key)
          const i = lines.findIndex((l) => sameLine(l, line))
          if (i < 0) return
          const next = [...lines]
          const { label: _old, ...rest } = next[i]!
          void _old
          next[i] = label ? { ...rest, label } : rest
          writeLines(next)
        },
      })
    },
    onColor: (e) => {
      const existing = find(e)
      const tm = tileMarkersStore.get()
      openColorPicker({
        title: 'Line Marker Color',
        subtitle: 'Line style',
        anchor,
        // scim seeds the line picker with the tile markers' last colour/opacity.
        initialColor: existing?.color ?? tm.lastColor,
        initialOpacity: existing?.opacity ?? tm.lastOpacity,
        onApply: (color, opacity) => {
          const line = edgeToLine(e)
          const lines = linesFor(key)
          const i = lines.findIndex((l) => sameLine(l, line))
          if (i < 0) return
          const o = clamp01(opacity)
          const next = [...lines]
          next[i] = { ...next[i]!, color, opacity: o }
          writeLines(next, { lastColor: color, lastOpacity: o })
        },
      })
    },
  }
}

function npcTagContext(): NpcTagContext {
  const highlights = () => npcHighlightsStore.get().highlights
  const setHighlightColor = (npcName: string, npcTypeId: number, mode: (typeof NPC_TAG_MODES)[number]['mode'], color: string): void => {
    const hs = highlights()
    const exists = hs.some((h) => h.npcTypeId === npcTypeId && h.mode === mode)
    npcHighlightsStore.patch({
      highlights: exists ? hs.map((h) => (h.npcTypeId === npcTypeId && h.mode === mode ? { ...h, color } : h)) : [...hs, { npcName, npcTypeId, mode, color }],
      lastColor: color,
    })
  }
  return {
    isHighlighted: (typeId, mode) => highlights().some((h) => h.npcTypeId === typeId && h.mode === mode),
    getHighlightColor: (typeId, mode) => highlights().find((h) => h.npcTypeId === typeId && h.mode === mode)?.color,
    // scim: remove, or add with the last colour.
    onToggleHighlight: (npcName, npcTypeId, mode) => {
      const s = npcHighlightsStore.get()
      const exists = s.highlights.some((h) => h.npcTypeId === npcTypeId && h.mode === mode)
      npcHighlightsStore.patch({
        highlights: exists ? s.highlights.filter((h) => h.npcTypeId !== npcTypeId || h.mode !== mode) : [...s.highlights, { npcName, npcTypeId, mode, color: s.lastColor }],
      })
    },
    onOpenColorPicker: (npcName, npcTypeId, mode, color) => {
      openColorPicker({
        title: 'NPC Tag Color',
        subtitle: NPC_TAG_MODES.find((m) => m.mode === mode)?.label ?? '',
        showOpacity: false,
        anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
        initialColor: color || '#00ffff',
        initialOpacity: 1,
        onApply: (c) => setHighlightColor(npcName, npcTypeId, mode, c),
      })
    },
  }
}

// ---- component ------------------------------------------------------------------

export function ViewportInput({ runtime, picker }: ViewportInputProps): JSX.Element {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const crossRef = useRef<ViewportCross | null>(null)
  const pickerRef = useRef(picker)
  pickerRef.current = picker
  const cursorRef = useRef<CursorState>({ inside: false, localX: -1, localY: -1 })
  const lastClientRef = useRef({ x: -1, y: -1 })
  const hoverKeyRef = useRef('none')
  const leftClickTypeRef = useRef<ClickType>('yellow')
  const hoveredNpcRef = useRef<string | null>(null)
  const menuOpenRef = useRef(false)
  const swapCacheRef = useRef<{ key: string; rules: SwapRule[] }>({ key: '', rules: [] })
  const menu = useSyncExternalStore(subscribeContextMenu, getContextMenu, getContextMenu)
  const viewportCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const pack = useSettings((s) => s.activeResourcePack)
  const palette = useMemo(() => menuPalette(pack), [pack])
  const scale = menuScale(useMenuUiScale())

  // ---- pick context ---------------------------------------------------------

  const swapRules = useCallback((): SwapRule[] => {
    const s = settingsStore.get()
    const key = `${s.customMenuSwapsEnabled ? 1 : 0}\n${s.customMenuSwaps}`
    if (swapCacheRef.current.key !== key) swapCacheRef.current = { key, rules: swapRulesFromSettings(s.customMenuSwapsEnabled, s.customMenuSwaps) }
    return swapCacheRef.current.rules
  }, [])

  const buildContext = useCallback(
    (x: number, y: number): PickContext | null => {
      const p = pickerRef.current
      if (!p) return null
      const pick = p.pick(x, y)
      const state = runtime.getSnapshot().state
      const lookup = typeLookupFor(runtime.cache)
      const npcs: PickedNpc[] = []
      const seen = new Set<string>()
      for (const id of pick.npcIds) {
        if (seen.has(id)) continue
        seen.add(id)
        const npc = state.npcs.find((n) => n.id === id)
        if (!npc || !npc.alive) continue
        npcs.push({ actorId: npc.id, npcTypeId: npc.npcTypeId, position: npc.position, type: lookup.npc(npc.npcTypeId) })
      }
      const groundItems: PickedGroundItem[] = []
      for (const id of pick.groundItemIds) {
        const g = state.groundItems.find((item) => item.id === id)
        if (g) groundItems.push({ groundItemId: g.id, itemId: g.itemId, position: g.position })
      }
      const itemTile = groundItems[0]?.position ?? pick.tile
      const menuGroundItems = itemTile ? groundItemsOnTile(state.groundItems, itemTile).map((g) => ({ groundItemId: g.id, itemId: g.itemId })) : []
      const hl = npcHighlightsStore.get()
      const npcMenuColor = hl.showHighlights && hl.colorMenuEntries ? (typeId: number) => hl.highlights.find((h) => h.npcTypeId === typeId)?.color : undefined
      return {
        tile: pick.tile,
        npcs,
        groundItems,
        menuGroundItems,
        attackTargetId: state.attackTarget,
        npcMenuColor,
        swapRules: swapRules(),
        loadItem: (itemId) => lookup.item(itemId),
      }
    },
    [runtime, swapRules],
  )

  // ---- tile click ---------------------------------------

  /** Shift -> plain walk; otherwise the given NPC id, else the last hovered NPC. */
  const tileClick = useCallback(
    (tile: Tile, ctrl: boolean, npcId?: string | null): void => {
      if (getModifiers().shift) handleTileClick(runtime, tile, ctrl, null)
      else handleTileClick(runtime, tile, ctrl, npcId === undefined ? hoveredNpcRef.current : npcId)
    },
    [runtime],
  )

  // ---- hover ---------------------------------------------------------------------

  const applyHover = useCallback((ctx: PickContext | null) => {
    const result = resolveHover(ctx, getModifiers().shift)
    if (result.key === hoverKeyRef.current) return
    hoverKeyRef.current = result.key
    if (result.tooltip) showTooltip(result.tooltip)
    else hideTooltip()
    leftClickTypeRef.current = result.leftClickType
    hoveredNpcRef.current = result.hoveredNpcId
  }, [])

  const updateHover = useCallback(() => {
    if (menuOpenRef.current) return
    const c = cursorRef.current
    applyHover(c.inside ? buildContext(c.localX, c.localY) : null)
  }, [applyHover, buildContext])

  // ---- menus ---------------------------------------------------------------------

  /** Hover resets like a pointer leave: the menu overlay covers the viewport. */
  const resetHoverForMenu = useCallback(() => {
    hideTooltip()
    hoverKeyRef.current = 'none'
    leftClickTypeRef.current = 'yellow'
    hoveredNpcRef.current = null
  }, [])

  /**
   * Only the 3D canvas is the viewport: UI panels floating inside the same
   * frame (Modern layout) must not walk / open menus (scim binds to the canvas).
   */
  const isViewportTarget = useCallback((target: unknown): boolean => {
    const host = layerRef.current?.parentElement
    if (!host || !(target instanceof HTMLCanvasElement) || !host.contains(target)) return false
    let canvas = viewportCanvasRef.current
    if (!canvas || !canvas.isConnected || !host.contains(canvas)) {
      let bestArea = -1
      canvas = null
      for (const c of host.querySelectorAll('canvas')) {
        const area = c.clientWidth * c.clientHeight
        if (area > bestArea) {
          canvas = c
          bestArea = area
        }
      }
      viewportCanvasRef.current = canvas
    }
    return target === canvas
  }, [])

  /** Re-evaluate hover at the last cursor position after a menu closes. */
  const recheckHover = useCallback(() => {
    const host = layerRef.current?.parentElement
    const { x, y } = lastClientRef.current
    if (!host || x < 0) return
    const under = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
    if (isViewportTarget(under)) {
      const local = toElementLocal(host, x, y)
      cursorRef.current = { inside: true, localX: local.x, localY: local.y }
    } else cursorRef.current = { inside: false, localX: -1, localY: -1 }
    updateHover()
  }, [isViewportTarget, updateHover])

  // Menus opened anywhere (viewport or inventory) pause viewport hover.
  useEffect(
    () =>
      subscribeContextMenu(() => {
        const open = getContextMenu() !== null
        if (open === menuOpenRef.current) return
        menuOpenRef.current = open
        if (open) resetHoverForMenu()
        else requestAnimationFrame(recheckHover)
      }),
    [resetHoverForMenu, recheckHover],
  )

  // ---- DOM wiring ----------------------------------------------------------------

  useEffect(() => {
    const layer = layerRef.current
    const host = layer?.parentElement
    if (!layer || !host) return
    preloadCrosses()
    const cross = new ViewportCross(layer)
    crossRef.current = cross
    let hoverFrame: number | null = null

    const frameLoop = (): void => {
      hoverFrame = null
      if (!cursorRef.current.inside) return
      updateHover()
      hoverFrame = runtime.scheduler.request(frameLoop)
    }
    const ensureFrameLoop = (): void => {
      if (hoverFrame === null && cursorRef.current.inside) hoverFrame = runtime.scheduler.request(frameLoop)
    }

    const leave = (): void => {
      if (!cursorRef.current.inside) return
      cursorRef.current = { inside: false, localX: -1, localY: -1 }
      updateHover()
    }

    const onMouseDown = (e: MouseEvent): void => {
      if (menuOpenRef.current || !isViewportTarget(e.target)) return
      const local = toElementLocal(host, e.clientX, e.clientY)
      if (e.button === 0) {
        const ctx = buildContext(local.x, local.y)
        if (!ctx) return
        const ctrl = e.ctrlKey
        const handlers: ViewportActionHandlers = {
          onWalk: (tile) => tileClick(tile, ctrl),
          onAttack: (npc) => handleTileClick(runtime, npc.position, ctrl, npc.actorId),
          onTake: (id) => handleTakeGroundItem(runtime, id),
        }
        const res = resolveLeftClick(ctx, getModifiers().shift, handlers)
        switch (res.kind) {
          case 'entry':
            res.entry.onClick?.()
            cross.show(local.x, local.y, 'red')
            return
          case 'attack':
            tileClick(res.npc.position, ctrl, res.npc.actorId)
            cross.show(local.x, local.y, 'red')
            return
          case 'take':
            handleTakeGroundItem(runtime, res.groundItemId)
            cross.show(local.x, local.y, 'red')
            return
          case 'walk': {
            if (res.clearHoveredNpc) hoveredNpcRef.current = null
            if (!ctx.tile) return
            const type = leftClickTypeRef.current
            tileClick(ctx.tile, ctrl)
            cross.show(local.x, local.y, type)
            return
          }
        }
      }
      if (e.button === 2) {
        if (e.altKey) return
        const ctx = buildContext(local.x, local.y) ?? {
          tile: null,
          npcs: [],
          groundItems: [],
          menuGroundItems: [],
          attackTargetId: null,
          swapRules: [],
          loadItem: () => null,
        }
        const extended = e.shiftKey || e.ctrlKey
        const menuX = e.clientX
        const menuY = e.clientY
        const handlers: ViewportActionHandlers = {
          // `Walk here` reads no Ctrl (override false); Shift at selection time still suppresses the NPC fallback.
          onWalk: (tile) => tileClick(tile, false),
          // Attack reads Ctrl when the entry is selected.
          onAttack: (npc) => handleTileClick(runtime, npc.position, getModifiers().ctrl, npc.actorId),
          onTake: (id) => handleTakeGroundItem(runtime, id),
        }
        const parts = buildViewportMenuParts(ctx, handlers, extended ? npcTagContext() : undefined)
        const ext: ExtendedMenuContext = {}
        if (extended) {
          const key = encounterKey(runtime)
          if (tileMarkersStore.get().showMarkers) ext.tileMarkers = tileMarkerContext(key, menuX, menuY)
          const edgePicker = pickerRef.current?.pickTileEdge
          if (lineMarkersStore.get().showLines && edgePicker) {
            ext.lineMarkers = lineMarkerContext(key, edgePicker.call(pickerRef.current, local.x, local.y), menuX, menuY)
          }
        }
        const s = settingsStore.get()
        const rightClickMovesCamera = s.rendererType === 'webgl' && s.cameraPluginEnabled && s.cameraRightClickMovesCamera
        const res = resolveRightClick(ctx.tile, parts, ext, rightClickMovesCamera)
        if (res.kind === 'menu') {
          e.preventDefault()
          resetHoverForMenu()
          menuOpenRef.current = true
          showContextMenu(res.content, menuX, menuY)
        }
      }
    }

    const onMouseMove = (e: MouseEvent): void => {
      lastClientRef.current = { x: e.clientX, y: e.clientY }
      if (menuOpenRef.current) return
      if (!isViewportTarget(e.target)) {
        leave()
        return
      }
      // No hover while the camera is being dragged (scim An2 bails during a drag).
      const buttons = getMouseButtons()
      if (buttons.middle || buttons.right) return
      const local = toElementLocal(host, e.clientX, e.clientY)
      cursorRef.current = { inside: true, localX: local.x, localY: local.y }
      updateHover()
      ensureFrameLoop()
    }

    const onPointerLeave = (e: PointerEvent): void => {
      if (e.target === host || isViewportTarget(e.target)) leave()
    }

    const onContextMenu = (e: MouseEvent): void => e.preventDefault()
    const onAuxClick = (e: MouseEvent): void => {
      if (e.button === 1) e.preventDefault()
    }
    const onWindowMove = (e: MouseEvent): void => {
      lastClientRef.current = { x: e.clientX, y: e.clientY }
    }

    const offShift = (() => {
      let shift = getModifiers().shift
      return onModifiersChange((mods) => {
        if (mods.shift === shift) return
        shift = mods.shift
        updateHover()
      })
    })()

    host.addEventListener('mousedown', onMouseDown, true)
    host.addEventListener('mousemove', onMouseMove, true)
    host.addEventListener('pointerleave', onPointerLeave, true)
    host.addEventListener('contextmenu', onContextMenu)
    host.addEventListener('auxclick', onAuxClick)
    window.addEventListener('mousemove', onWindowMove, true)
    return () => {
      host.removeEventListener('mousedown', onMouseDown, true)
      host.removeEventListener('mousemove', onMouseMove, true)
      host.removeEventListener('pointerleave', onPointerLeave, true)
      host.removeEventListener('contextmenu', onContextMenu)
      host.removeEventListener('auxclick', onAuxClick)
      window.removeEventListener('mousemove', onWindowMove, true)
      offShift()
      if (hoverFrame !== null) runtime.scheduler.cancel(hoverFrame)
      cross.dispose()
      crossRef.current = null
      hideTooltip()
    }
  }, [runtime, buildContext, tileClick, updateHover, resetHoverForMenu, isViewportTarget])

  // A restart invalidates hover state (new NPC ids).
  useEffect(
    () =>
      runtime.onRestart(() => {
        hoverKeyRef.current = ''
        hoveredNpcRef.current = null
        updateHover()
      }),
    [runtime, updateHover],
  )

  const onMenuCross = useCallback((x: number, y: number, type: ClickType) => showMenuCross(x, y, type), [])

  return (
    <>
      <div
        ref={layerRef}
        data-viewport-input=""
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden', zIndex: 10 }}
      />
      <TooltipLayer />
      <ContextMenu menu={menu} palette={palette} scale={scale} onClose={hideContextMenu} onCross={onMenuCross} />
      <InputDialogs />
    </>
  )
}

export default ViewportInput
