import { type CSSProperties, type MouseEvent as ReactMouseEvent, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../../app/GameStore'
import { useSetting } from '../../app/settings/settings'
import { bindContextMenu } from '../../input/contextMenuStore'
import { UI_TOOLTIPS } from '../../input/menu'
import { bindTooltip } from '../../input/tooltip'
import { packAsset, useActivePack } from '../packs'
import { toggleQuickPrayers, toggleRun, toggleSpecialAttack } from './actions'
import { openQuickPrayerSetup, panelFiltersStore, prayerOrbOverlayStore } from './clientState'
import { useClient, usePresentation, useSimState } from './context'
import { hasSpecialAttack } from './items'
import { arcOrbCentres, COMPACT_ORB_LAYOUTS, type CompactOrbsLayout, fixedOrbCentres, flickSweep, normalizeOrbOrder, type OrbId, ORB_IDS, orbEmptyHeight, orbValueColor, type Point } from './layout'
import { PixelSprite } from './sprites/PixelSprite'
import { effectiveQuickPrayers } from './tabs/prayerBook'

/**
 * Minimap orbs:
 * HP, Prayer (99-point scale, quick-prayers), Run, Special. Clicks act on
 * mouse down; the prayer orb draws the Prayer plugin's flick sweep.
 */

const SWEEP_COLOR = '#69c7d3'

/** The Prayer plugin's orb sweep: a 1 px line tracing the fill disc once per tick. */
function FlickSweep() {
  const { runtime } = useClient()
  const lineRef = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    let handle = 0
    let last = ''
    const frame = (): void => {
      const tick = runtime.clock.interpolatedTick()
      const s = flickSweep(tick - Math.floor(tick), 26)
      const t = `translate(${s.x}px, ${s.y}px) scaleY(${s.height / 26})`
      if (t !== last && lineRef.current) {
        last = t
        lineRef.current.style.transform = t
      }
      handle = runtime.scheduler.request(frame)
    }
    handle = runtime.scheduler.request(frame)
    return () => runtime.scheduler.cancel(handle)
  }, [runtime])
  return (
    <div className="prayer-orb-flick-sweep" aria-hidden style={{ position: 'absolute', left: 27, top: 4, width: 26, height: 26, overflow: 'hidden', pointerEvents: 'none' }}>
      <span ref={lineRef} style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 26, transform: 'scaleY(0)', transformOrigin: '0 0', background: SWEEP_COLOR, boxShadow: '1px 0 0 rgba(0, 0, 0, 0.75), -1px 0 0 rgba(0, 0, 0, 0.75)' }} />
    </div>
  )
}

interface OrbProps {
  alt: string
  cx: number
  cy: number
  current?: number
  max?: number
  fill?: string
  icon?: string
  iconActive?: string
  active?: boolean
  disabled?: boolean
  hoverable?: boolean
  sweep?: boolean
  onPress?: (e: ReactMouseEvent) => void
  menu?: ReturnType<typeof bindContextMenu> | undefined
  tooltip?: ReturnType<typeof bindTooltip> | undefined
  dataTutorial?: string
}

export function Orb({ alt, cx, cy, current, max, fill, icon, iconActive, active = false, disabled = false, hoverable = false, sweep = false, onPress, menu, tooltip, dataTutorial }: OrbProps) {
  const pack = useActivePack()
  const [hover, setHover] = useState(false)
  const overlay = useStore(prayerOrbOverlayStore, (s) => s.render)
  const hasValue = current !== undefined && max !== undefined
  const value = hasValue ? current : 0
  const clamped = hasValue ? Math.max(0, Math.min(max, current)) : 0
  const empty = hasValue ? orbEmptyHeight(current, max) : 26
  const iconSrc = active && iconActive ? iconActive : icon
  const dim: CSSProperties | null = disabled ? { opacity: 0.45 } : null
  return (
    <div style={{ position: 'absolute', left: cx - 40, top: cy - 17, width: 57, height: 34, pointerEvents: 'none' }} data-tutorial={dataTutorial}>
      {hasValue && (
        <span style={{ position: 'absolute', left: 0, width: 27, top: 21, transform: 'translateY(-50%)', zIndex: 3, fontFamily: '"RuneScape Small", sans-serif', fontSize: 16, lineHeight: '16px', whiteSpace: 'nowrap', textAlign: 'center', overflow: 'hidden', color: orbValueColor(clamped, max), textShadow: '1px 1px 0 #000', WebkitFontSmoothing: 'none' }}>
          {Math.floor(value)}
        </span>
      )}
      <PixelSprite src={packAsset(hoverable && hover ? 'other/minimap_orb_frame_hovered.png' : 'other/minimap_orb_frame.png', pack)} alt="" aria-hidden width={57} height={34} style={{ position: 'absolute', left: 0, top: 0, imageRendering: 'pixelated', ...dim }} />
      {(fill || iconSrc) && (
        <div style={{ position: 'absolute', left: 27, top: 4, width: 26, height: 26, overflow: 'hidden', pointerEvents: 'none' }}>
          {fill && hasValue && <PixelSprite src={fill} alt="" aria-hidden width={26} height={26} style={{ position: 'absolute', left: 0, top: 0, imageRendering: 'pixelated', ...dim }} />}
          {empty > 0 && (
            <div style={{ position: 'absolute', left: 0, top: 0, width: 26, height: empty, overflow: 'hidden' }}>
              <PixelSprite src={packAsset('other/minimap_orb_empty.png', pack)} alt="" aria-hidden width={26} height={26} style={{ position: 'absolute', left: 0, top: 0, imageRendering: 'pixelated' }} />
            </div>
          )}
        </div>
      )}
      {iconSrc && <PixelSprite src={iconSrc} alt={alt} width={26} height={26} style={{ position: 'absolute', left: 27, top: 4, imageRendering: 'pixelated', pointerEvents: 'none', ...dim }} />}
      {sweep && (overlay ? overlay() : <FlickSweep />)}
      <button
        type="button"
        aria-label={alt}
        onMouseDown={
          disabled
            ? menu?.onMouseDown
            : (e) => {
                menu?.onMouseDown(e)
                if (e.button === 0) onPress?.(e)
              }
        }
        onContextMenu={menu?.onContextMenu ?? ((e) => e.preventDefault())}
        {...(tooltip ? { 'data-tooltip-bound': tooltip['data-tooltip-bound'], onMouseMove: tooltip.onMouseMove } : {})}
        onMouseEnter={(e) => {
          tooltip?.onMouseEnter(e)
          if (hoverable) setHover(true)
        }}
        onMouseLeave={() => {
          tooltip?.onMouseLeave()
          setHover(false)
        }}
        style={{ position: 'absolute', left: 0, top: 0, width: 57, height: 34, border: 'none', background: 'transparent', padding: 0, margin: 0, outline: 'none', cursor: 'default', pointerEvents: 'auto', clipPath: 'inset(4px 4px 4px 0)' }}
      />
    </div>
  )
}

export type OrbLayout = 'arc' | 'fixed' | CompactOrbsLayout

/** Where each orb's centre is for a layout (scim placement). */
export function orbCentres(layout: OrbLayout, order: readonly OrbId[] = ORB_IDS): Record<OrbId, Point> {
  const pts = layout === 'arc' ? arcOrbCentres() : layout === 'fixed' ? fixedOrbCentres() : COMPACT_ORB_LAYOUTS[layout].centres
  const seq = layout !== 'arc' && layout !== 'fixed' ? order : ORB_IDS
  const out = {} as Record<OrbId, Point>
  for (const id of ORB_IDS) out[id] = pts[seq.indexOf(id)] ?? pts[ORB_IDS.indexOf(id)]!
  return out
}

/** The four orbs over the minimap or in the compact grid. */
export function Orbs({ layout }: { layout: OrbLayout }) {
  const { runtime } = useClient()
  const presentation = usePresentation()
  const state = useSimState()
  const pack = useActivePack()
  const order = normalizeOrbOrder(useSetting('compactOrbsOrder'))
  const prayerEnabled = useSetting('prayerEnabled')
  const flickOrb = useSetting('prayerFlickOrbEnabled')
  const flickAlways = useSetting('prayerFlickAlwaysOn')
  const instantInventory = useSetting('instantInventoryEnabled')
  const instantPrayerSetting = useSetting('instantPrayerEnabled')
  const selections = useStore(panelFiltersStore, (s) => s.prayer.quickPrayerSelections)
  const pos = orbCentres(layout, order)
  const display = presentation.prayerDisplay(state, instantInventory && instantPrayerSetting)
  const committed = state.activePrayer !== null || state.offensivePrayer !== null
  const predicted = display.anyLit
  const sweep = prayerEnabled && flickOrb && (committed || predicted || flickAlways)
  const poisoned = state.poisonVarp > 0
  const run = presentation.run.get() ?? state.isRunEnabled
  const special = presentation.specialActive(state)
  const specWeapon = hasSpecialAttack(runtime.cache, state.playerEquipment.weapon)
  const quick = state.quickPrayersActive
  const quickSelections = (): ReturnType<typeof effectiveQuickPrayers> =>
    effectiveQuickPrayers(selections, { basePrayerLevel: state.stats.prayer.max, baseDefenceLevel: state.stats.defence.max }, state.mechanicsConfig.deadeyeMysticVigour !== false)
  const p = (path: string): string => packAsset(path, pack)

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none', overflow: 'visible' }}>
      <Orb
        alt="Hitpoints"
        cx={pos.hitpoints.x}
        cy={pos.hitpoints.y}
        current={state.playerHP}
        max={state.maxHP}
        fill={p(state.poisonVarp >= 1_000_000 ? 'other/minimap_orb_hitpoints_venom.png' : poisoned ? 'other/minimap_orb_hitpoints_poison.png' : 'other/minimap_orb_hitpoints.png')}
        icon={p(state.playerHP <= 19 ? 'other/minimap_orb_hitpoints_low_life_icon.png' : 'other/minimap_orb_hitpoints_icon.png')}
        hoverable={poisoned}
      />
      <Orb
        alt="Prayer"
        cx={pos.prayer.x}
        cy={pos.prayer.y}
        current={state.prayerState.points}
        max={99}
        fill={p(quick ? 'other/minimap_orb_prayer_activated.png' : 'other/minimap_orb_prayer.png')}
        icon={p('other/minimap_orb_prayer_icon.png')}
        iconActive={p('other/minimap_orb_prayer_icon_activated.png')}
        active={predicted}
        hoverable
        sweep={sweep}
        onPress={() => toggleQuickPrayers(runtime, quickSelections())}
        menu={bindContextMenu(() => ({
          entries: [
            { action: quick ? 'Deactivate' : 'Activate', target: 'Quick-prayers', onClick: () => toggleQuickPrayers(runtime, quickSelections()) },
            { action: 'Setup', target: 'Quick-prayers', onClick: openQuickPrayerSetup },
            { action: 'Cancel' },
          ],
        }))}
        tooltip={bindTooltip(() => ({ lines: [{ spans: [{ text: `${quick ? 'Deactivate' : 'Activate'} `, color: '#ffffff' }, { text: 'Quick-prayers', color: '#f5c080' }] }] }))}
        dataTutorial="prayer-orb"
      />
      <Orb
        alt="Run Energy"
        cx={pos.run.x}
        cy={pos.run.y}
        current={Math.floor(state.runEnergy.energy / 100)}
        max={100}
        fill={p(run ? 'other/minimap_orb_run_activated.png' : 'other/minimap_orb_run.png')}
        icon={p('other/minimap_orb_run_icon.png')}
        iconActive={p('other/minimap_orb_run_icon_activated.png')}
        active={run}
        hoverable
        onPress={() => toggleRun(runtime, presentation)}
        menu={bindContextMenu(() => ({ entries: [{ action: 'Toggle Run', target: run ? '(on)' : '(off)', onClick: () => toggleRun(runtime, presentation) }, { action: 'Cancel' }] }))}
        tooltip={bindTooltip(() => UI_TOOLTIPS.toggleRun)}
      />
      <Orb
        alt="Special Attack"
        cx={pos.special.x}
        cy={pos.special.y}
        current={state.specialAttack.energy}
        max={100}
        fill={p(special ? 'other/minimap_orb_special_activated.png' : 'other/minimap_orb_special.png')}
        icon={p('other/minimap_orb_special_icon.png')}
        active={special}
        disabled={!specWeapon}
        hoverable={specWeapon}
        onPress={() => toggleSpecialAttack(runtime, presentation)}
        menu={specWeapon ? bindContextMenu(() => ({ entries: [{ action: special ? 'Turn Off' : 'Use', target: 'Special Attack', onClick: () => toggleSpecialAttack(runtime, presentation) }, { action: 'Cancel' }] })) : undefined}
        tooltip={specWeapon ? bindTooltip(() => UI_TOOLTIPS.specialAttack) : undefined}
      />
    </div>
  )
}
