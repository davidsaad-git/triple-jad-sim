import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePluginStore, antiDragStore, inventoryTagsStore } from '../../../app/plugins/stores'
import { useSettings } from '../../../app/settings/settings'
import { bindContextMenu } from '../../../input/contextMenuStore'
import { openColorPicker } from '../../../input/dialogs'
import { inventoryItemTooltip, type MenuEntry, MENU_TARGET_COLORS } from '../../../input/menu'
import { hideTooltip, showTooltip, bindTooltip } from '../../../input/tooltip'
import type { EquipSlot, Inventory, InventoryItem } from '../../../sim/api'
import { consumableDef } from '../../../sim/items/consumables'
import { itemIconUrl } from '../../packs'
import { activateItem, dropItem, equipFromInventory, swapInventorySlots } from '../actions'
import { useClient, useSimState } from '../context'
import { dragStarted, inventoryPressRules, useWindowDrag } from '../drag'
import { useModifiers } from '../hooks'
import { inventoryClickAction, type ItemInfo, itemDisplayName, itemLookup, predictEquip } from '../items'
import { CONTENT_BOX, formatStackQuantity, inventorySlotAt, inventorySlotOrigin } from '../layout'
import { PixelSprite } from '../sprites/PixelSprite'
import { usePanelScale } from '../sprites/scale'
import { type LayerSprite, SpriteLayer } from '../sprites/SpriteLayer'

/**
 * Inventory tab (scim, 03):
 * a 4x7 grid of 36x32 transparent buttons over one sprite canvas. Left click
 * acts on release unless the press became a drag (Anti Drag thresholds);
 * drags swap slots immediately; right click opens the item menu.
 */

const SLOT_W = 36
const SLOT_H = 32
const CELL_W = 42
const CELL_H = 36

interface Press {
  index: number
  startX: number
  startY: number
  startTime: number
  curX: number
  curY: number
  dragging: boolean
  canDrag: boolean
  shiftDrop: boolean
  thresholdMs: number
}

function tagOutline(color: string): string {
  return [`drop-shadow(1px 0 0.5px ${color})`, `drop-shadow(-1px 0 0.5px ${color})`, `drop-shadow(0 1px 0.5px ${color})`, `drop-shadow(0 -1px 0.5px ${color})`].join(' ')
}

function Quantity({ item }: { item: InventoryItem }) {
  const q = item.quantity ?? 1
  if (q <= 1) return null
  const f = formatStackQuantity(q)
  return (
    <span style={{ position: 'absolute', top: 0, left: 0, fontSize: 10, lineHeight: '9px', fontWeight: 'bold', color: f.color, textShadow: '1px 1px 0 #000', fontFamily: 'monospace', pointerEvents: 'none' }}>{f.text}</span>
  )
}

export function InventoryTab() {
  const { runtime } = useClient()
  const state = useSimState()
  const lookup = itemLookup(runtime.cache)
  const scale = usePanelScale()
  const mods = useModifiers()
  const anti = usePluginStore(antiDragStore, (s) => s)
  const tags = usePluginStore(inventoryTagsStore, (s) => s)
  const instantInventory = useSettings((s) => s.instantInventoryEnabled)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const targetRef = useRef<HTMLDivElement | null>(null)
  const pressRef = useRef<Press | null>(null)
  const [press, setPress] = useState<Press | null>(null)
  const [preview, setPreview] = useState<Inventory | null>(null)
  const hoverRef = useRef<number | null>(null)
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // Instant Inventory previews are discarded every tick / inventory change.
  const lastInv = useRef(state.inventory)
  const lastTick = useRef(state.currentTick)
  if (lastInv.current !== state.inventory || lastTick.current !== state.currentTick) {
    lastInv.current = state.inventory
    lastTick.current = state.currentTick
    if (preview) setPreview(null)
  }
  const inventory = preview ?? state.inventory
  const invRef = useRef(inventory)
  invRef.current = inventory

  const shiftDropHover = mods.shift && !(anti.enabled && anti.requireShift)
  const info = useCallback((id: number): ItemInfo | null => lookup.item(id), [lookup])

  const doClick = useCallback(
    (index: number, shiftDrop: boolean) => {
      const item = invRef.current[index]
      if (!item) return
      const action = inventoryClickAction(info(item.id), consumableDef(item.id) !== undefined, shiftDrop)
      if (action.kind === 'drop') {
        setPreview(null)
        dropItem(runtime, index)
      } else if (action.kind === 'use') {
        setPreview(null)
        activateItem(runtime, index)
      } else if (action.kind === 'equip') {
        equipFromInventory(runtime, index, item.id, action.slot)
        if (instantInventory && action.slot !== 'ammo') {
          const s = runtime.getSnapshot().state
          const p = predictEquip(invRef.current, s.playerEquipment, index, action.slot as EquipSlot, info)
          if (p) setPreview(p.inventory)
        }
      }
    },
    [runtime, info, instantInventory],
  )

  const { startDrag } = useWindowDrag({
    onMove: (x, y, t) => {
      const p = pressRef.current
      const root = rootRef.current
      if (!p || !root) return
      p.curX = x
      p.curY = y
      if (!p.dragging && dragStarted({ startX: p.startX, startY: p.startY, startTime: p.startTime, thresholdMs: p.thresholdMs, canDrag: p.canDrag }, x, y, t)) {
        p.dragging = true
        hideTooltip()
        setPress({ ...p })
      }
      if (!p.dragging) return
      const rect = root.getBoundingClientRect()
      const k = scaleRef.current
      if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${(x - rect.left) / k - SLOT_W / 2}px, ${(y - rect.top) / k - SLOT_H / 2}px, 0)`
      if (targetRef.current) {
        const hit = inventorySlotAt((x - rect.left) / k, (y - rect.top) / k)
        const target = hit === p.index ? null : hit
        if (target === null) targetRef.current.style.display = 'none'
        else {
          targetRef.current.style.display = ''
          targetRef.current.style.transform = `translate3d(${20 + (target % 4) * CELL_W}px, ${13 + Math.floor(target / 4) * CELL_H}px, 0)`
        }
      }
    },
    onEnd: (x, y) => {
      const p = pressRef.current
      pressRef.current = null
      setPress(null)
      if (!p) return
      if (p.dragging && rootRef.current) {
        const rect = rootRef.current.getBoundingClientRect()
        const k = scaleRef.current
        const target = inventorySlotAt((x - rect.left) / k, (y - rect.top) / k)
        if (target !== null && target !== p.index) {
          setPreview(null)
          swapInventorySlots(runtime, p.index, target)
        }
      } else doClick(p.index, p.shiftDrop)
    },
  })

  const onSlotMouseDown = (e: ReactMouseEvent, index: number): void => {
    if (e.button !== 0 || e.altKey || !inventory[index]) return
    const rules = inventoryPressRules({ shift: e.shiftKey, ctrl: e.ctrlKey }, anti)
    const p: Press = { index, startX: e.clientX, startY: e.clientY, startTime: e.timeStamp, curX: e.clientX, curY: e.clientY, dragging: false, canDrag: rules.canDrag, shiftDrop: rules.shiftDrop, thresholdMs: rules.thresholdMs }
    pressRef.current = p
    setPress(p)
    e.preventDefault()
    startDrag(e)
  }

  // Keep the hover text in sync with Shift (scim updates it on modifier change).
  useEffect(() => {
    const idx = hoverRef.current
    if (idx === null || press?.dragging) return
    const item = inventory[idx]
    if (!item) return
    const content = inventoryItemTooltip(item.id, info(item.id), shiftDropHover)
    if (content) showTooltip(content)
  }, [shiftDropHover]) // eslint-disable-line react-hooks/exhaustive-deps

  const menuFor = (index: number, item: InventoryItem): MenuEntry[] | null => {
    const inf = info(item.id)
    if (!inf) return null
    const name = itemDisplayName(inf)
    const entries: MenuEntry[] = []
    for (const action of inf.inventoryActions) {
      if (action == null) continue
      let onClick: (() => void) | undefined
      if (action === 'Eat' || action === 'Drink' || action === 'Invigorate' || action === 'Use') onClick = () => {
        setPreview(null)
        activateItem(runtime, index)
      }
      else if (action === 'Guzzle') onClick = () => {
        setPreview(null)
        activateItem(runtime, index, 'guzzle')
      }
      else if (action === 'Wield' || action === 'Wear') onClick = () => doClick(index, false)
      else if (action === 'Drop') onClick = () => {
        setPreview(null)
        dropItem(runtime, index)
      }
      entries.push({ action, target: name, ...(onClick ? { onClick, clickType: 'yellow' as const } : {}) })
    }
    if (!entries.some((e) => e.action === 'Use')) entries.push({ action: 'Use', target: name })
    if (!entries.some((e) => e.action === 'Drop')) entries.push({ action: 'Drop', target: name, onClick: () => dropItem(runtime, index), clickType: 'yellow' })
    const m = modsNow()
    if (m.shift || m.ctrl) {
      const current = tags.tags[String(item.id)]
      const pick = (x: number, y: number) => () =>
        openColorPicker({
          title: 'Inventory Tag Color',
          anchor: { x, y },
          initialColor: current ?? tags.lastColor ?? '#e24040',
          initialOpacity: 1,
          showOpacity: false,
          onApply: (color) => inventoryTagsStore.patch({ tags: { ...inventoryTagsStore.get().tags, [String(item.id)]: color }, lastColor: color }),
        })
      const at = lastMenuPoint.current
      const submenu: MenuEntry[] = [{ action: 'Pick color', onClick: pick(at.x, at.y) }]
      if (current) {
        submenu.push({ action: 'swatch', targetColor: current, onClick: pick(at.x, at.y) })
        submenu.push({
          action: 'Reset inventory tag',
          onClick: () => {
            const next = { ...inventoryTagsStore.get().tags }
            delete next[String(item.id)]
            inventoryTagsStore.patch({ tags: next })
          },
        })
      }
      entries.push({ action: 'Inventory tag', target: name, targetColor: MENU_TARGET_COLORS.item, submenu })
    }
    entries.push({ action: 'Cancel' })
    return entries
  }
  const lastMenuPoint = useRef({ x: 0, y: 0 })
  const modsRef = useRef(mods)
  modsRef.current = mods
  const modsNow = () => modsRef.current

  const sprites = useMemo(() => {
    const list: LayerSprite[] = []
    for (let i = 0; i < 28; i++) {
      const item = inventory[i]
      if (!item) continue
      if (tags.showTags && tags.tags[String(item.id)]) continue
      const o = inventorySlotOrigin(i)
      const opacity = press?.dragging && press.index === i ? 0.3 : press && !press.dragging && press.index === i ? 0.5 : 1
      list.push({ src: itemIconUrl(item.id), x: o.x, y: o.y, w: SLOT_W, h: SLOT_H, opacity })
    }
    return list
  }, [inventory, tags, press])

  const dragItem = press?.dragging ? inventory[press.index] : null
  const marginX = (-SLOT_W * (scale - 1)) / 2
  const marginY = (-SLOT_H * (scale - 1)) / 2

  const itemSprite = (item: InventoryItem, tag?: string) =>
    tag ? (
      <>
        <PixelSprite
          src={itemIconUrl(item.id)}
          alt={`Item ${item.id}`}
          scale={1}
          style={{ pointerEvents: 'none', width: SLOT_W * scale, height: SLOT_H * scale, maxWidth: SLOT_W * scale, maxHeight: SLOT_H * scale, objectFit: 'contain', transform: `scale(${1 / scale})`, transformOrigin: 'center', margin: `${marginY}px ${marginX}px`, imageRendering: 'pixelated', filter: tagOutline(tag) }}
        />
        <Quantity item={item} />
      </>
    ) : (
      <>
        <PixelSprite src={itemIconUrl(item.id)} alt={`Item ${item.id}`} style={{ pointerEvents: 'none', maxWidth: SLOT_W, maxHeight: SLOT_H, imageRendering: 'pixelated' }} />
        <Quantity item={item} />
      </>
    )

  return (
    <div ref={rootRef} style={{ width: CONTENT_BOX.width, height: CONTENT_BOX.height, position: 'relative' }} data-testid="inventory-panel">
      <SpriteLayer width={CONTENT_BOX.width} height={CONTENT_BOX.height} sprites={sprites} />
      {Array.from({ length: 28 }, (_, i) => {
        const item = inventory[i] ?? null
        const o = inventorySlotOrigin(i)
        const dragging = press?.dragging && press.index === i
        const pressed = press && !press.dragging && press.index === i
        const tag = item && tags.showTags ? tags.tags[String(item.id)] : undefined
        const inf = item ? info(item.id) : null
        const tip = item && !press?.dragging ? bindTooltip(() => inventoryItemTooltip(item.id, inf, modsRef.current.shift && !(anti.enabled && anti.requireShift))) : null
        const menu = item && !press?.dragging ? bindContextMenu(() => {
          const entries = menuFor(i, item)
          return entries ? { entries } : null
        }) : null
        return (
          <button
            key={i}
            type="button"
            aria-label={item ? `Item ${item.id}` : undefined}
            data-tooltip-bound={tip ? 'true' : undefined}
            onMouseDown={(e) => {
              lastMenuPoint.current = { x: e.clientX, y: e.clientY }
              menu?.onMouseDown(e)
              if (item) onSlotMouseDown(e, i)
            }}
            onContextMenu={menu?.onContextMenu ?? ((e) => e.preventDefault())}
            onMouseEnter={(e) => {
              hoverRef.current = item ? i : null
              tip?.onMouseEnter(e)
            }}
            onMouseMove={tip?.onMouseMove}
            onMouseLeave={() => {
              hoverRef.current = null
              tip?.onMouseLeave()
            }}
            style={{ position: 'absolute', left: o.x, top: o.y, width: SLOT_W, height: SLOT_H, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default', border: 'none', background: 'transparent', padding: 0, opacity: dragging ? 0.3 : pressed ? 0.5 : 1, borderRadius: 2 }}
          >
            {item && (tag ? itemSprite(item, tag) : <Quantity item={item} />)}
          </button>
        )
      })}
      {dragItem && (
        <div
          ref={ghostRef}
          style={{ position: 'absolute', left: 0, top: 0, transform: ghostTransform(rootRef.current, press, scale), width: SLOT_W, height: SLOT_H, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 100 }}
        >
          {itemSprite(dragItem)}
        </div>
      )}
      {press?.dragging && <div ref={targetRef} style={{ position: 'absolute', left: 0, top: 0, width: CELL_W, height: CELL_H, background: 'rgba(255, 255, 255, 0.12)', borderRadius: 2, pointerEvents: 'none', display: 'none', zIndex: 50 }} />}
    </div>
  )
}

function ghostTransform(root: HTMLDivElement | null, press: Press | null, scale: number): string {
  if (!root || !press) return 'none'
  const rect = root.getBoundingClientRect()
  return `translate3d(${(press.curX - rect.left) / scale - SLOT_W / 2}px, ${(press.curY - rect.top) / scale - SLOT_H / 2}px, 0)`
}

/** Exposed for tests: the action a click on `item` performs. */
export function inventoryItemAction(info: ItemInfo | null, itemId: number, shiftDrop: boolean) {
  return inventoryClickAction(info, consumableDef(itemId) !== undefined, shiftDrop)
}

