import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useKeybinds } from '../../app/keybinds'
import { type ClientLayoutMode, type PanelPosition, settingsStore, useSetting } from '../../app/settings/settings'
import { bindContextMenu } from '../../input/contextMenuStore'
import { onPanelTabSelect } from '../../input/hotkeys'
import { hideTooltip } from '../../input/tooltip'
import { packAsset, useActivePack } from '../packs'
import { panelModesStore, quickPrayerSetupStore, selectGamePanelTab, TAB_CHANGED_EVENT, useGamePanelTab, usePanelModes } from './clientState'
import { usePresentation, useSimState } from './context'
import { DraggablePanel } from './DraggablePanel'
import {
  CLASSIC_SHELL,
  clampModernPanelPosition,
  CONTENT_BOX,
  DEFAULT_GAME_PANEL_POSITION,
  DEFAULT_TAB_BAR_POSITION,
  type Box,
  type EdgeSprite,
  FIXED,
  FIXED_SHELL,
  GAME_PANEL_TABS,
  type GamePanelTabId,
  modernPanelDefault,
  MODERN_TAB_BAR,
  selectedStone,
  type ShellGeometry,
  snapRect,
  type StoneKind,
  type TabDef,
  TAB_STONE,
  type TabRowGeometry,
} from './layout'
import { ComposedSprite } from './sprites/ComposedSprite'
import { tileImage } from './sprites/imageStore'
import { useDevicePixelRatio, usePanelScale } from './sprites/scale'
import { type LayerSprite, SpriteLayer } from './sprites/SpriteLayer'
import { StatusBars } from './StatusBars'
import { CombatTab } from './tabs/CombatTab'
import { EquipmentTab } from './tabs/EquipmentTab'
import { InventoryTab } from './tabs/InventoryTab'
import { PrayerTab } from './tabs/PrayerTab'
import { SettingsTab, type SettingsSubTab, keyLabel } from './tabs/SettingsTab'
import { SkillsTab } from './tabs/SkillsTab'
import { SpellbookTab } from './tabs/SpellbookTab'

/**
 * The side panel ("game panel", scim
 *): the seven tabs, the per-layout shell (Modern / Classic / Fixed) and
 * the modern tab bar.
 */

const EDGE_SPRITES: Readonly<Record<EdgeSprite, string>> = {
  classicLeft: 'panel/side_panel_edge_left.png',
  classicRight: 'panel/side_panel_edge_right.png',
  fixedLeftUpper: 'other/old_school_mode_side_panel_edge_left_upper.png',
  fixedLeftLower: 'other/old_school_mode_side_panel_edge_left_lower.png',
  fixedRight: 'other/old_school_mode_side_panel_edge_right.png',
}

const STONE_SPRITES: Readonly<Record<StoneKind, string>> = {
  topLeft: 'tabs/stone_top_left_selected.png',
  topRight: 'tabs/stone_top_right_selected.png',
  bottomLeft: 'tabs/stone_bottom_left_selected.png',
  bottomRight: 'tabs/stone_bottom_right_selected.png',
  middle: 'tabs/stone_middle_selected.png',
}

/** The modern side-panel border: 7 px bands of 32 px edge sprites + corners, at device resolution. */
function ModernBorder() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scale = usePanelScale()
  const dpr = useDevicePixelRatio()
  const pack = useActivePack()
  const names = ['edge_top', 'edge_bottom', 'edge_left', 'edge_right', 'corner_top_left', 'corner_top_right', 'corner_bottom_left', 'corner_bottom_right']
  const urls = names.map((n) => packAsset(`dialog/bottom_line_mode_side_panel_${n}.png`, pack))
  const key = urls.join('|')
  useEffect(() => {
    let cancelled = false
    const k = scale * dpr
    Promise.all(
      urls.map(
        (u) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image()
            img.decoding = 'async'
            img.onload = () => resolve(img)
            img.onerror = reject
            img.src = u
          }),
      ),
    )
      .then(([top, bottom, left, right, tl, tr, bl, br]) => {
        const c = canvasRef.current
        if (cancelled || !c || !top || !bottom || !left || !right || !tl || !tr || !bl || !br) return
        const ctx = c.getContext('2d')
        if (!ctx) return
        const W = Math.round(204 * k)
        const H = Math.round(275 * k)
        if (c.width !== W) c.width = W
        if (c.height !== H) c.height = H
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, W, H)
        const px = (v: number): number => Math.round(v * k)
        const band = Math.round(7 * k)
        const tile = Math.round(32 * k)
        const hCount = Math.ceil(144 / 32) + 2
        const vCount = Math.ceil(215 / 32) + 2
        for (let i = 0; i < hCount; i++) {
          const a = px(30 + i * 32)
          const b = px(30 + (i + 1) * 32)
          ctx.drawImage(top, 0, 13, 32, 7, a, 0, b - a, band)
          ctx.drawImage(bottom, 0, 13, 32, 7, a, H - band, b - a, band)
        }
        for (let i = 0; i < vCount; i++) {
          const a = px(30 + i * 32)
          const b = px(30 + (i + 1) * 32)
          ctx.drawImage(left, 13, 0, 7, 32, 0, a, band, b - a)
          ctx.drawImage(right, 13, 0, 7, 32, W - band, a, band, b - a)
        }
        const inner = tile - band
        const corner = (img: HTMLImageElement, x: number, y: number, isLeft: boolean, isTop: boolean): void => {
          const sEdgeX = isLeft ? 0 : 25
          const sInX = isLeft ? 7 : 0
          const dEdgeX = isLeft ? x : x + inner
          const dInX = isLeft ? x + band : x
          const sEdgeY = isTop ? 0 : 25
          const sInY = isTop ? 7 : 0
          const dEdgeY = isTop ? y : y + inner
          const dInY = isTop ? y + band : y
          ctx.drawImage(img, sEdgeX, sEdgeY, 7, 7, dEdgeX, dEdgeY, band, band)
          ctx.drawImage(img, sInX, sEdgeY, 25, 7, dInX, dEdgeY, inner, band)
          ctx.drawImage(img, sEdgeX, sInY, 7, 25, dEdgeX, dInY, band, inner)
          ctx.drawImage(img, sInX, sInY, 25, 25, dInX, dInY, inner, inner)
        }
        corner(tl, 0, 0, true, true)
        corner(tr, W - tile, 0, false, true)
        corner(bl, 0, H - tile, true, false)
        corner(br, W - tile, H - tile, false, false)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [scale, dpr, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: 204, height: 275, zIndex: 2, pointerEvents: 'none', imageRendering: 'pixelated' }} />
}

function TabButton({ def, active, highlight }: { def: TabDef; active: boolean; highlight: boolean }) {
  const key = useKeybinds((k) => (k.gamePanel as Record<string, string>)[def.tab] ?? '')
  const modes = usePanelModes()
  const menu =
    def.tab === 'prayer'
      ? bindContextMenu(() => ({
          entries: [
            { action: modes.prayerReordering ? 'Disable' : 'Enable', target: 'prayer reordering', onClick: () => panelModesStore.update({ prayerReordering: !panelModesStore.get().prayerReordering }) },
            { action: modes.prayerFiltering ? 'Disable' : 'Enable', target: 'prayer filtering', onClick: () => panelModesStore.update({ prayerFiltering: !panelModesStore.get().prayerFiltering }) },
            { action: 'Cancel' },
          ],
        }))
      : def.tab === 'spellbook'
        ? bindContextMenu(() => ({
            entries: [
              { action: modes.spellReordering ? 'Disable' : 'Enable', target: 'spellbook reordering', onClick: () => panelModesStore.update({ spellReordering: !panelModesStore.get().spellReordering }) },
              { action: modes.spellFiltering ? 'Disable' : 'Enable', target: 'spellbook filtering', onClick: () => panelModesStore.update({ spellFiltering: !panelModesStore.get().spellFiltering }) },
              { action: 'Cancel' },
            ],
          }))
        : null
  return (
    <button
      type="button"
      onClick={() => selectGamePanelTab(def.tab)}
      onMouseDown={menu?.onMouseDown}
      onContextMenu={menu?.onContextMenu ?? ((e) => e.preventDefault())}
      className={highlight ? 'shortcut-hint-glow' : undefined}
      aria-label={key ? `${def.label} (${keyLabel(key)})` : def.label}
      aria-pressed={active}
      data-tab={def.tab}
      data-active={active || undefined}
      style={{ width: TAB_STONE.width, height: TAB_STONE.height, padding: 0, border: 'none', borderRadius: 0, backgroundColor: 'transparent', cursor: 'default', transition: 'none', position: 'relative' }}
    />
  )
}

/** Tab content (204x275), switching sub-views back when the tab changes. */
function TabContent({ tab }: { tab: GamePanelTabId }) {
  const [equipmentView, setEquipmentView] = useState<'equipment' | 'stats'>('equipment')
  const [settingsTab, setSettingsTab] = useState<SettingsSubTab>('audio')
  useEffect(() => {
    if (tab !== 'equipment') setEquipmentView('equipment')
    if (tab !== 'settings') setSettingsTab('audio')
    if (tab !== 'prayer') panelModesStore.update({ prayerFilterViewOpen: false })
    if (tab !== 'spellbook') panelModesStore.update({ spellFilterViewOpen: false })
  }, [tab])
  switch (tab) {
    case 'inventory':
      return <InventoryTab />
    case 'combat':
      return <CombatTab />
    case 'skills':
      return <SkillsTab />
    case 'spellbook':
      return <SpellbookTab />
    case 'prayer':
      return <PrayerTab />
    case 'equipment':
      return <EquipmentTab view={equipmentView} onViewChange={setEquipmentView} />
    case 'settings':
      return <SettingsTab subTab={settingsTab} onSubTabChange={setSettingsTab} />
  }
}

function useSettingsHintGlow(): boolean {
  const [glow, setGlow] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const on = (): void => {
      setGlow(true)
      clearTimeout(timer)
      timer = setTimeout(() => setGlow(false), 4000)
    }
    window.addEventListener('shortcut-hint:highlight-settings', on)
    return () => {
      window.removeEventListener('shortcut-hint:highlight-settings', on)
      clearTimeout(timer)
    }
  }, [])
  return glow
}

/** Tab-change side effects: F-key selection, hide the tooltip, announce the change. */
function useTabEffects(tab: GamePanelTabId): void {
  useEffect(() => onPanelTabSelect((t) => selectGamePanelTab(t)), [])
  const first = useRef(true)
  useEffect(() => {
    hideTooltip()
    if (first.current) {
      first.current = false
      return
    }
    if (tab !== 'prayer' && quickPrayerSetupStore.get().open) quickPrayerSetupStore.set({ open: false })
    window.dispatchEvent(new CustomEvent(TAB_CHANGED_EVENT, { detail: { tab } }))
  }, [tab])
}

export interface GamePanelProps {
  mode: ClientLayoutMode
  uiScale: number
  /** Fixed layout: client scale (frame width / 765). */
  fixedScale: number
  frameWidth: number
  frameHeight: number
  exclusionRects?: readonly Box[]
}

function StatusBarsOverlay({ mode }: { mode: ClientLayoutMode }) {
  const enabled = useSetting('statusBarsEnabled')
  const showValues = useSetting('statusBarsShowValues')
  const state = useSimState()
  const presentation = usePresentation()
  const instantInventory = useSetting('instantInventoryEnabled')
  const instantPrayerSetting = useSetting('instantPrayerEnabled')
  const instantPrayer = instantInventory && instantPrayerSetting
  if (!enabled) return null
  const anyLit = presentation.prayerDisplay(state, instantPrayer).anyLit
  return <StatusBars mode={mode} hp={state.playerHP} maxHp={state.maxHP} prayer={state.prayerState.points} maxPrayer={state.prayerState.maxPoints} anyPrayerActive={anyLit} showValues={showValues} />
}

function ShellPanel({ geometry, tab, glow, children }: { geometry: ShellGeometry; tab: GamePanelTabId; glow: boolean; children: ReactNode }) {
  const pack = useActivePack()
  const fixed = geometry.spriteSet === 'fixed'
  const bgUrl = packAsset(fixed ? 'panel/fixed_mode_side_panel_background.png' : 'panel/side_panel_background.png', pack)
  const tiledEdges = geometry.edges.filter((e) => e.tiledFrom !== undefined)
  const bg = geometry.background
  const sources = [bgUrl, ...tiledEdges.map((e) => packAsset(EDGE_SPRITES[e.sprite], pack))]
  const rowSprites = (row: TabRowGeometry, which: 'top' | 'bottom'): LayerSprite[] => {
    const src = packAsset(fixed ? (which === 'top' ? 'panel/fixed_mode_tabs_top_row.png' : 'panel/fixed_mode_tabs_row_bottom.png') : which === 'top' ? 'panel/tabs_top_row.png' : 'panel/tabs_bottom_row.png', pack)
    const out: LayerSprite[] = [{ src, x: row.rect.x, y: row.rect.y, w: row.rect.width, h: row.rect.height, width: row.rect.width, height: row.rect.height }]
    for (const def of GAME_PANEL_TABS.filter((d) => d.row === which)) {
      const x = row.rect.x + (row.slotX[def.slot] ?? 0)
      const y = row.rect.y + row.stoneY
      if (def.tab === tab) {
        const st = selectedStone(which, def.slot, 7)
        out.push({ src: packAsset(STONE_SPRITES[st.stone], pack), x: x + st.dx, y, w: st.width, h: TAB_STONE.height, width: st.width, height: TAB_STONE.height })
      }
      out.push({ src: packAsset(def.icon, pack), x, y, w: TAB_STONE.width, h: TAB_STONE.height })
    }
    return out
  }
  const sprites: LayerSprite[] = [
    ...geometry.edges.filter((e) => e.tiledFrom === undefined).map((e) => ({ src: packAsset(EDGE_SPRITES[e.sprite], pack), x: e.rect.x, y: e.rect.y, w: e.rect.width, h: e.rect.height, width: e.rect.width, height: e.rect.height })),
    ...rowSprites(geometry.tabRowTop, 'top'),
    ...rowSprites(geometry.tabRowBottom, 'bottom'),
  ]
  const tabRow = (row: TabRowGeometry, which: 'top' | 'bottom', tutorial?: string) => (
    <div style={{ position: 'absolute', left: row.rect.x, top: row.rect.y, width: row.rect.width, height: row.rect.height }} data-tutorial={tutorial}>
      {GAME_PANEL_TABS.filter((d) => d.row === which).map((def) => (
        <div key={def.tab} style={{ position: 'absolute', left: row.slotX[def.slot] ?? 0, top: row.stoneY, width: TAB_STONE.width, height: TAB_STONE.height }}>
          <TabButton def={def} active={tab === def.tab} highlight={def.tab === 'settings' && glow} />
        </div>
      ))}
    </div>
  )
  return (
    <div className="panel-surface" style={{ position: 'relative', width: geometry.size.width, height: geometry.size.height }}>
      <ComposedSprite
        cacheKey={`side-column-backdrop|${sources.join('|')}|${geometry.backgroundTiled}|${bg.x},${bg.y},${bg.width},${bg.height}|${geometry.size.width}x${geometry.size.height}`}
        width={geometry.size.width}
        height={geometry.size.height}
        sources={sources}
        draw={(ctx, images) => {
          const b = images.get(bgUrl)
          if (b) {
            if (geometry.backgroundTiled) tileImage(ctx, b, bg.x, bg.y, bg.width, bg.height)
            else ctx.drawImage(b, bg.x, bg.y)
          }
          for (const e of tiledEdges) {
            const img = images.get(packAsset(EDGE_SPRITES[e.sprite], pack))
            if (img) tileImage(ctx, img, e.rect.x, e.rect.y, e.rect.width, e.rect.height)
          }
        }}
      />
      <SpriteLayer width={geometry.size.width} height={geometry.size.height} sprites={sprites} />
      <div style={{ position: 'absolute', left: geometry.panelShell.x, top: geometry.panelShell.y }}>{children}</div>
      {tabRow(geometry.tabRowTop, 'top', 'tab-bar')}
      {tabRow(geometry.tabRowBottom, 'bottom')}
    </div>
  )
}

function ModernContent({ children }: { children: ReactNode }) {
  const bg = packAsset('panel/side_panel_background.png', useActivePack())
  return (
    <div className="panel-surface" style={{ overflow: 'hidden', position: 'relative' }}>
      <img src={bg} alt="" draggable={false} style={{ width: CONTENT_BOX.width, height: CONTENT_BOX.height, position: 'absolute', top: 0, left: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.5, imageRendering: 'pixelated' }} />
      <ModernBorder />
      <div style={{ position: 'relative', zIndex: 1, width: CONTENT_BOX.width, height: CONTENT_BOX.height }}>{children}</div>
    </div>
  )
}

function ModernTabBar({ tab, glow }: { tab: GamePanelTabId; glow: boolean }) {
  const pack = useActivePack()
  const sprites = useMemo(() => {
    const out: LayerSprite[] = []
    GAME_PANEL_TABS.forEach((def, i) => {
      const box = { x: i * MODERN_TAB_BAR.pitch, y: 0, w: TAB_STONE.width, h: TAB_STONE.height }
      out.push({ ...box, src: packAsset('panel/tab_stone_middle.png', pack), width: TAB_STONE.width, height: TAB_STONE.height })
      if (def.tab === tab) out.push({ ...box, src: packAsset('panel/tab_stone_middle_selected.png', pack), width: TAB_STONE.width, height: TAB_STONE.height })
      out.push({ ...box, src: packAsset(def.icon, pack) })
    })
    return out
  }, [tab, pack])
  return (
    <div className="panel-surface" style={{ display: 'flex', alignItems: 'center', gap: 1, position: 'relative' }}>
      <SpriteLayer width={MODERN_TAB_BAR.width} height={MODERN_TAB_BAR.height} sprites={sprites} />
      {GAME_PANEL_TABS.map((def) => (
        <TabButton key={def.tab} def={def} active={tab === def.tab} highlight={def.tab === 'settings' && glow} />
      ))}
    </div>
  )
}

export function GamePanel({ mode, uiScale, fixedScale, frameWidth, frameHeight, exclusionRects }: GamePanelProps) {
  const tab = useGamePanelTab()
  const glow = useSettingsHintGlow()
  const stored = useSetting('gamePanelPosition')
  useTabEffects(tab)
  const onPos = (p: PanelPosition): void => settingsStore.patch({ gamePanelPosition: p })
  const onScale = (s: number): void => settingsStore.patch({ uiScale: Math.max(1, Math.min(3, s)) })

  if (mode !== 'modern') {
    const geometry = mode === 'fixed' ? FIXED_SHELL : CLASSIC_SHELL
    const physical = mode === 'fixed' ? snapRect(FIXED.sidePanelBlock, fixedScale) : undefined
    return (
      <DraggablePanel
        defaultPosition={DEFAULT_GAME_PANEL_POSITION}
        position={mode === 'fixed' ? DEFAULT_GAME_PANEL_POSITION : stored}
        width={geometry.size.width}
        height={geometry.size.height}
        scale={mode === 'fixed' ? fixedScale : uiScale}
        {...(physical ? { physicalSize: { width: physical.width, height: physical.height } } : {})}
        {...(mode === 'fixed' ? {} : { onPositionChange: onPos })}
        onScaleChange={onScale}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        {...(exclusionRects ? { exclusionRects } : {})}
        locked={mode === 'fixed'}
        scaleEnabled={mode !== 'fixed'}
        dataTutorial="game-panel"
      >
        <ShellPanel geometry={geometry} tab={tab} glow={glow}>
          <TabContent tab={tab} />
        </ShellPanel>
        <StatusBarsOverlay mode={mode} />
      </DraggablePanel>
    )
  }

  return (
    <>
      <DraggablePanel
        defaultPosition={modernPanelDefault(uiScale)}
        position={clampModernPanelPosition(stored, uiScale)}
        width={CONTENT_BOX.width}
        height={CONTENT_BOX.height}
        scale={uiScale}
        onPositionChange={onPos}
        onScaleChange={onScale}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        {...(exclusionRects ? { exclusionRects } : {})}
        dataTutorial="game-panel"
      >
        <div style={{ position: 'relative', width: CONTENT_BOX.width, height: CONTENT_BOX.height }}>
          <ModernContent>
            <TabContent tab={tab} />
          </ModernContent>
          <StatusBarsOverlay mode="modern" />
        </div>
      </DraggablePanel>
      <DraggablePanel
        defaultPosition={DEFAULT_TAB_BAR_POSITION}
        width={MODERN_TAB_BAR.width}
        height={MODERN_TAB_BAR.height}
        scale={uiScale}
        onScaleChange={onScale}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        {...(exclusionRects ? { exclusionRects } : {})}
        dataTutorial="tab-bar"
      >
        <ModernTabBar tab={tab} glow={glow} />
      </DraggablePanel>
    </>
  )
}
