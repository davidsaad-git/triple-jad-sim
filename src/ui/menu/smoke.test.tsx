/**
 * Render smoke tests: every MENUS surface renders to static markup with
 * scim's texts (node environment, react-dom/server; effects do not run).
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { RuntimeContext } from '../../app/runtime/RuntimeContext'
import type { SimRuntime, TickSnapshot } from '../../app/runtime/types'
import type { DpsProjection, NpcState, SimState } from '../../sim/api'
import { HudTools } from '../hud/HudTools'
import { DefeatModal } from '../screens/Screens'
import { AppMenus } from './AppMenus'
import { menuController } from './menuState'

function npc(id: string, hp: number, archetypeId = 'zuk_jad', npcTypeId = 7700): NpcState {
  return {
    id,
    npcTypeId,
    archetypeId,
    role: 'npc',
    alive: hp > 0,
    position: [24, 36],
    previousPosition: [24, 36],
    facingAngle: 0,
    combatTargetId: 'player',
    size: 5,
    hp,
    maxHp: 350,
    history: new Map(),
  }
}

const state = {
  currentTick: 42,
  playerHP: 80,
  maxHP: 99,
  playerPosition: [31, 33],
  npcs: [npc('jad1', 300), npc('jad2', 350), npc('h1', 45, 'zuk_jad_healer', 7701)],
  attackTarget: 'jad1',
  lastAttackTarget: 'jad1',
  damageHistory: [
    { tick: 30, source: 'PlayerAttack', targetId: 'jad1', baseDamage: 50, attackType: 'range', activePrayer: null, prayedCorrectly: null, effectiveDamage: 50, hpBefore: 350, hpAfter: 300, expectedHit: 30 },
    { tick: 35, source: 'JadMagic', sourceNpcTypeId: 7700, targetId: 'player', baseDamage: 19, attackType: 'magic', activePrayer: null, prayedCorrectly: false, effectiveDamage: 19, hpBefore: 99, hpAfter: 80 },
  ],
  encounterOutcome: { phase: 'active' },
  failedCondition: 'Death',
  prayerState: { points: 50, maxPoints: 99, drainCounter: 0, activePrayers: [], prayerActivationTicks: {} },
  activePrayer: null,
  offensivePrayer: null,
  independentPrayers: [],
  introActive: false,
  isAlive: true,
} as unknown as SimState

const projection: DpsProjection = {
  style: 'ranged',
  dps: 7.5,
  accuracy: 0.9,
  maxHit: 83,
  baseMaxHit: null,
  profileMaxHit: null,
  baseAttackRoll: null,
  baseDefenceRoll: null,
  outgoingDamageMultiplier: 1,
  specialAttackDamageMultiplier: 1,
  expectedAppliedDamagePerAttack: 22.5,
  attackSpeedTicks: 5,
  attackIntervalSeconds: 3,
  hits: [],
}

const snapshot: TickSnapshot = { state, events: [], tickTimeMs: 0 }
const noop = () => () => {}
const runtime = {
  engine: { getAdjustedTheoreticalDps: () => projection },
  clock: { now: () => 0, tickDurationMs: 600, lastTickAt: 0, interpolatedTick: () => 42, suspended: false, onSuspendChange: noop },
  cache: null,
  getSnapshot: () => snapshot,
  onTick: noop,
  dispatch: () => {},
  dispatchImmediate: () => {},
  setTargetTile: () => {},
  getTargetTile: () => null,
  getDisplayedTargetTile: () => null,
  onTargetTileChange: noop,
  scheduler: { request: () => 0, cancel: () => {} },
  setSceneReady: () => {},
  onDispatch: noop,
  onTickWindow: noop,
  onRestart: noop,
  isPaused: () => false,
  setPaused: () => {},
  togglePause: () => {},
  onPauseChange: noop,
  tickStats: { getStats: () => ({ expectedMs: 600, lastMs: null, avgMs: null, minMs: null, maxMs: null, stddevMs: null, maxJitterMs: null, samples: 0, recent: [] }) },
  restart: () => {},
  stepOnce: () => {},
} as unknown as SimRuntime

afterEach(() => menuController.closeAll())

describe('MENUS render smoke', () => {
  it('renders the nav, settings, plugins, picker, configure and modals', () => {
    for (const s of ['settings', 'plugins', 'encounters', 'configure', 'shortcuts', 'whatsNew', 'training', 'replays'] as const) menuController.open(s)
    const html = renderToStaticMarkup(<AppMenus runtime={runtime} cache={null} onStart={() => {}} />)
    for (const text of [
      'Settings',
      'What&#x27;s New',
      'Encounters',
      'Training',
      'Replays',
      'Plugins',
      'Restart Simulation',
      'Playback Speed',
      'Input Lag',
      'Pause simulator when unfocused',
      'View Mode',
      'FPS Cap',
      'Resource Pack',
      'Show Shortcut Hints',
      'Not affiliated with Jagex',
      'Anti Drag',
      'Attack Timer Metronome',
      'Tick Counter',
      'XP Drops',
      'Debug Overlays',
      'Search encounters...',
      'Triple Jads',
      'Inferno · Wave 68',
      'Standard Fight',
      'Configure',
      'Enter',
      'LOADOUT',
      'Presets',
      'Max Tbow',
      'PREPARATION',
      'Auto-Prepot',
      'Practice Aids',
      'Infinite Health',
      'Set all to 99',
      'Import from Hiscores',
      'Double Death Charge',
      'Start Encounter',
      'Shortcuts',
      'Open encounter picker',
      'No tutorials available',
      'No replays yet',
    ])
      expect(html, text).toContain(text)
    expect(html).not.toContain('Set Timer')
  })

  it('renders the HUD tool stack with DPS and max hit', () => {
    const html = renderToStaticMarkup(
      <RuntimeContext.Provider value={runtime}>
        <HudTools runtime={runtime} viewportWidth={988} viewportHeight={914} />
      </RuntimeContext.Provider>,
    )
    expect(html).toContain('hud-tools-stack')
    expect(html).toContain('>HUD<')
    expect(html).toContain('Practice')
    expect(html).toContain('Zuk_jad')
    // 50 damage over (42 - 30) * 0.6 = 7.2 s; expected 30 / 7.2
    expect(html).toContain('6.94')
    expect(html).toContain('4.17')
    expect(html).toContain('hud-dps-lucky')
    expect(html).toContain('>83<')
    expect(html).toContain('>42<')
  })

  it('renders the defeat modal damage table', () => {
    const html = renderToStaticMarkup(<DefeatModal state={state} visible onRestart={() => {}} />)
    expect(html).toContain('YOU DIED')
    expect(html).toContain('Slain in combat')
    expect(html).toContain('JalTok-Jad')
    expect(html).toContain('Try Again')
    expect(html).toContain('death-modal-row is-wrong')
  })
})
