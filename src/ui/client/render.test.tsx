/**
 * Chrome render tests on the real cache and a real triple-Jad engine: static
 * markup of every side-panel tab, the minimap/orbs, the fixed chatbox and the
 * infobox strip (node + react-dom/server; effects do not run), plus the
 * dispatch labels of the actions.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { SimRuntime, TickSnapshot } from '../../app/runtime/types'
import { DEFAULT_SETTINGS, settingsStore } from '../../app/settings/settings'
import type { SimEngine } from '../../sim/api'
import { CACHE_PATH, makeEngine, testCache } from '../../sim/testing/testCache'
import { togglePrayer, toggleQuickPrayers, toggleRun, swapInventorySlots } from './actions'
import { AltHintBar } from './AltHintBar'
import { ClientFrame } from './ClientFrame'
import { gamePanelTabStore } from './clientState'
import { ClientProvider, presentationFor } from './context'
import { PanelSnapProvider } from './DraggablePanel'
import { FixedChatbox } from './FixedChatbox'
import { GamePanel } from './GamePanel'
import { InfoboxStripView } from './Infoboxes'
import type { GamePanelTabId } from './layout'
import { Minimap } from './Minimap'

interface FsLike {
  existsSync(path: string): boolean
}
const fs = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.('node:fs') as FsLike | undefined
const HAS_CACHE = !!fs?.existsSync(CACHE_PATH)

interface FakeRuntime {
  runtime: SimRuntime
  dispatched: { label: string | undefined; immediate: boolean }[]
  engine: SimEngine
}

function fakeRuntime(): FakeRuntime {
  const engine = makeEngine()
  const dispatched: FakeRuntime['dispatched'] = []
  const snapshot = (): TickSnapshot => ({ state: engine.getState(), events: [], tickTimeMs: 0 })
  const noop = () => () => {}
  const runtime = {
    engine,
    clock: { now: () => 0, tickDurationMs: 600, lastTickAt: 0, interpolatedTick: () => engine.getState().currentTick, suspended: false, onSuspendChange: noop },
    cache: testCache(),
    getSnapshot: snapshot,
    onTick: noop,
    dispatch: (apply: (e: SimEngine) => void, label?: string) => {
      dispatched.push({ label, immediate: false })
      apply(engine)
    },
    dispatchImmediate: (apply: (e: SimEngine) => void, label?: string) => {
      dispatched.push({ label, immediate: true })
      apply(engine)
    },
    setTargetTile: () => {},
    getTargetTile: () => null,
    getDisplayedTargetTile: () => null,
    onTargetTileChange: noop,
    scheduler: { request: () => 0, cancel: () => {} },
    setSceneReady: () => {},
    onDispatch: noop,
    onTickWindow: noop,
    onRestart: noop,
    restart: () => {},
    stepOnce: () => {},
  } as unknown as SimRuntime
  return { runtime, dispatched, engine }
}

function renderPanel(runtime: SimRuntime, tab: GamePanelTabId, mode: 'modern' | 'classic' | 'fixed' = 'modern'): string {
  gamePanelTabStore.set({ tab })
  return renderToStaticMarkup(
    <ClientProvider runtime={runtime}>
      <PanelSnapProvider>
        <GamePanel mode={mode} uiScale={1} fixedScale={1} frameWidth={1280} frameHeight={720} />
      </PanelSnapProvider>
    </ClientProvider>,
  )
}

afterEach(() => {
  settingsStore.set({ ...DEFAULT_SETTINGS })
  gamePanelTabStore.set({ tab: 'inventory' })
})

describe.skipIf(!HAS_CACHE)('side panel tabs render (real cache + engine)', () => {
  it('renders every tab in every layout', () => {
    const { runtime } = fakeRuntime()
    for (const mode of ['modern', 'classic', 'fixed'] as const) {
      for (const tab of ['combat', 'skills', 'inventory', 'equipment', 'prayer', 'spellbook', 'settings'] as const) {
        const html = renderPanel(runtime, tab, mode)
        expect(html.length, `${mode}/${tab}`).toBeGreaterThan(200)
        expect(html).toContain('data-tutorial="game-panel"')
      }
    }
  })

  it('shows scim texts and labels per tab (max_tbow preset)', () => {
    const { runtime } = fakeRuntime()
    const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    const combat = renderPanel(runtime, 'combat')
    expect(text(combat)).toContain('Twisted bow')
    expect(text(combat)).toContain('Combat Lvl: 126')
    for (const t of ['Accurate', 'Rapid', 'Longrange', 'Auto Retaliate', '(Off)', 'Category: Bow']) expect(text(combat)).toContain(t)
    for (const t of ['Combat (F1)', 'Skills (F2)', 'Inventory (Esc)', 'Equipment (F4)', 'Prayer (F5)', 'Spellbook (F6)', 'Keybinds (F11)']) expect(combat).toContain(`aria-label="${t}"`)
    const skills = renderPanel(runtime, 'skills')
    expect(skills).toContain('aria-label="Ranged: level 112, base 99"')
    const inventory = renderPanel(runtime, 'inventory')
    expect(inventory.match(/aria-label="Item \d+"/g)?.length).toBe(runtime.getSnapshot().state.inventory.filter(Boolean).length)
    const equipment = renderPanel(runtime, 'equipment')
    for (const t of ['Equipment Stats', 'Guide Prices', 'Items Kept on Death', 'Call Follower']) expect(equipment).toContain(`aria-label="${t}"`)
    const prayer = renderPanel(runtime, 'prayer')
    expect(text(prayer)).toContain('99 / 99')
    for (const t of ['Protect from Magic', 'Protect from Missiles', 'Rigour', 'Augury', 'Deadeye', 'Mystic Vigour']) expect(prayer).toContain(`aria-label="${t}"`)
    const spells = renderPanel(runtime, 'spellbook')
    for (const t of ['Ice Barrage', 'Blood Barrage', 'Teleport to Target']) expect(spells).toContain(`aria-label="${t}"`)
    const settings = renderPanel(runtime, 'settings')
    for (const t of ['Audio', 'Keybindings', 'Master Volume', 'Mute when unfocused', 'Sound Effects', 'Area Sounds']) expect(text(settings)).toContain(t)
  })
})

describe.skipIf(!HAS_CACHE)('actions dispatch through the runtime with scim labels', () => {
  it('labels prayer, quick-prayer, run and drag-swap dispatches', () => {
    const { runtime, dispatched, engine } = fakeRuntime()
    const p = presentationFor(runtime)
    togglePrayer(runtime, p, 'ProtectMagic', false)
    expect(dispatched.at(-1)).toEqual({ label: 'prayer:on', immediate: false })
    expect(engine.getState().pendingProtectionPrayer).toEqual([true, 'ProtectMagic'])
    togglePrayer(runtime, p, 'ProtectMagic', false)
    expect(dispatched.at(-1)?.label).toBe('prayer:off')
    toggleQuickPrayers(runtime, ['ProtectRange'])
    expect(dispatched.at(-1)?.label).toBe('quick-prayer:on')
    toggleRun(runtime, p)
    expect(dispatched.at(-1)?.label).toBe('run')
    const before = engine.getState().inventory.slice()
    swapInventorySlots(runtime, 0, 1)
    expect(dispatched.at(-1)).toEqual({ label: 'swap-inventory', immediate: true })
    expect(engine.getState().inventory[0]).toEqual(before[1])
    expect(engine.getState().inventory[1]).toEqual(before[0])
  })
})

describe.skipIf(!HAS_CACHE)('minimap, chatbox, infoboxes, frame', () => {
  it('renders the minimap block per layout with pack fallbacks', () => {
    const { runtime } = fakeRuntime()
    const render = (mode: 'modern' | 'fixed') =>
      renderToStaticMarkup(
        <ClientProvider runtime={runtime}>
          <Minimap mode={mode} uiScale={1} fixedScale={1} frameWidth={1280} frameHeight={720} onCompassClick={() => {}} />
        </ClientProvider>,
      )
    const modern = render('modern')
    for (const t of ['Face north', 'Hitpoints', 'Prayer', 'Run Energy', 'Special Attack']) expect(modern).toContain(`aria-label="${t}"`)
    // Brown Theme ships the compass and orb frame; orb fills come from Vanilla.
    expect(modern).toContain('/assets/ui/packs/pack-browntown/other/compass.png')
    expect(modern).toContain('/assets/ui/packs/pack-vanilla/other/minimap_orb_hitpoints.png')
    expect(modern).not.toContain('Disable XP drops')
    const fixed = render('fixed')
    expect(fixed).toContain('panel/fixed_mode_minimap_left_edge.png')
    expect(fixed).toContain('aria-label="Disable XP drops"')
    settingsStore.patch({ compactOrbsEnabled: true })
    expect(render('modern')).toContain('display:none')
  })

  it('renders the fixed chatbox, hint bar and infobox strip', () => {
    const { runtime } = fakeRuntime()
    const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    expect(text(renderToStaticMarkup(<FixedChatbox scale={1} visible onToggle={() => {}} />))).toBe('Player: * All Game On Public On Private On Channel On Clan On Trade On Collapse')
    expect(text(renderToStaticMarkup(<FixedChatbox scale={2} visible={false} onToggle={() => {}} />))).toBe('All Game On Public On Private On Channel On Clan On Trade On Uncollapse')
    expect(renderToStaticMarkup(<FixedChatbox scale={2} visible={false} onToggle={() => {}} />)).toContain('left:0;top:960px;width:1038px;height:46px')
    const hint = text(renderToStaticMarkup(<AltHintBar />))
    expect(hint).toContain('UI layout Alt + Drag Alt+Drag Move Move')
    expect(hint).toContain('Alt + Shift Alt+Shift Snap to panels Snap')
    const strip = renderToStaticMarkup(
      <ClientProvider runtime={runtime}>
        <InfoboxStripView contentScale={1} infoboxes={[{ id: 'tick-counter', text: '3', textColor: '#d4a84b', tooltipTitle: 'Tick Counter', tooltipDetail: 'Tick 3 of 4' }]} />
      </ClientProvider>,
    )
    expect(strip).toContain('class="infobox-strip infobox-strip--outlined"')
    expect(strip).toContain('data-infobox-detail="Tick 3 of 4"')
    expect(strip).toContain('infobox-text--solo')
  })

  it('frames the viewport with the game-viewport-frame class', () => {
    const { runtime } = fakeRuntime()
    const html = renderToStaticMarkup(<ClientFrame runtime={runtime} viewport={<canvas id="vp" />} />)
    expect(html).toContain('class="game-viewport-frame game-viewport-frame--fit"')
    expect(html).toContain('<canvas id="vp"></canvas>')
    settingsStore.patch({ clientLayoutMode: 'fixed' })
    expect(renderToStaticMarkup(<ClientFrame runtime={runtime} viewport={null} />)).toContain('game-viewport-frame--fixed')
  })
})
