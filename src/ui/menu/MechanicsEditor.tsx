/**
 * Mechanics editor shared by the Configure rail and the Practice Controls
 * panel (scim +/`xz`/`yz`).
 * No reset affordances are shown for mechanics rows (scim passes no defaults).
 */
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { EncounterCommand, MechanicsConfig, NpcState } from '../../sim/api'
import { Checkbox, InfoHint, OsrsButton, SettingRow } from './controls'
import type { DebugActionDef, MechanicsChoice, MechanicsToggleDef } from './simBridge'

type Config = Record<string, boolean | string | number>

/** scim: dependants follow their parent. */
export function orderByDependency(list: readonly MechanicsToggleDef[]): MechanicsToggleDef[] {
  const children = new Map<string, MechanicsToggleDef[]>()
  for (const t of list) {
    if (t.dependsOn === undefined || !list.some((p) => p.key === t.dependsOn)) continue
    const arr = children.get(t.dependsOn) ?? []
    arr.push(t)
    children.set(t.dependsOn, arr)
  }
  const out: MechanicsToggleDef[] = []
  for (const t of list) {
    if (t.dependsOn !== undefined && children.has(t.dependsOn) && list.some((p) => p.key === t.dependsOn)) continue
    out.push(t, ...(children.get(t.key) ?? []))
  }
  return out
}

/** scim: anything with group `aid` (or whose parent is) goes to Practice Aids, then setup, else mechanics. */
export function partitionToggles(list: readonly MechanicsToggleDef[]): { setup: MechanicsToggleDef[]; mechanics: MechanicsToggleDef[]; aids: MechanicsToggleDef[] } {
  const kind = (t: MechanicsToggleDef): 'setup' | 'mechanics' | 'aid' => {
    const parent = t.dependsOn === undefined ? undefined : list.find((p) => p.key === t.dependsOn)
    if (t.group === 'aid' || parent?.group === 'aid') return 'aid'
    if (t.setup || parent?.setup) return 'setup'
    return 'mechanics'
  }
  return {
    setup: orderByDependency(list.filter((t) => kind(t) === 'setup')),
    mechanics: orderByDependency(list.filter((t) => kind(t) === 'mechanics')),
    aids: orderByDependency(list.filter((t) => kind(t) === 'aid')),
  }
}

/** Choice icons: the left/right arrows. */
function ChoiceIcon({ icon }: { icon: string }) {
  let path: ReactNode = null
  if (icon === 'left') path = <path d="M15 9H3m5-5L3 9l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  else if (icon === 'right') path = <path d="M3 9h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  else return null
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
      {path}
    </svg>
  )
}

function ChoiceRow({
  label,
  info,
  choices,
  value,
  disabled,
  dependent,
  onSelect,
}: {
  label: string
  info: string | undefined
  choices: MechanicsChoice[]
  value: MechanicsChoice['value']
  disabled: boolean
  dependent: boolean
  onSelect: (v: MechanicsChoice['value']) => void
}) {
  const labelRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const hasIcons = choices.some((c) => c.icon)
  return (
    <SettingRow isModified={false} hideReset onReset={() => {}} className={dependent ? 'setting-row--dependent' : undefined}>
      <div className={`mechanics-choice${disabled ? ' is-disabled' : ''}`}>
        <div ref={labelRef} className={`mechanics-choice-label${info ? ' info-hint-region' : ''}`}>
          {label}
          {info && <InfoHint label={label} text={info} hoverRegionRef={labelRef} />}
        </div>
        <div
          ref={groupRef}
          className={`mechanics-choice-segmented${hasIcons ? ' has-icons' : ''}`}
          role="radiogroup"
          aria-label={label}
          aria-disabled={disabled || undefined}
          style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}
        >
          {choices.map((c, i) => (
            <button
              key={String(c.value)}
              type="button"
              role="radio"
              aria-checked={c.value === value}
              tabIndex={c.value === value ? 0 : -1}
              disabled={disabled}
              className={`mechanics-choice-segment${c.value === value ? ' is-active' : ''}`}
              data-choice-icon={c.icon}
              title={c.icon ? c.label : undefined}
              aria-label={c.icon ? c.label : undefined}
              onClick={() => onSelect(c.value)}
              onKeyDown={(e) => {
                if (disabled) return
                let next: number
                switch (e.key) {
                  case 'ArrowRight':
                  case 'ArrowDown':
                    next = (i + 1) % choices.length
                    break
                  case 'ArrowLeft':
                  case 'ArrowUp':
                    next = (i + choices.length - 1) % choices.length
                    break
                  case 'Home':
                    next = 0
                    break
                  case 'End':
                    next = choices.length - 1
                    break
                  default:
                    return
                }
                e.preventDefault()
                e.stopPropagation()
                onSelect(choices[next]!.value)
                groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
              }}
            >
              {c.icon && <ChoiceIcon icon={c.icon} />}
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>
    </SettingRow>
  )
}

function ToggleRow({ label, info, checked, dependent, onToggle }: { label: string; info: string | undefined; checked: boolean; dependent: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const box = <Checkbox checked={checked} onChange={onToggle} label={label} />
  return (
    <SettingRow isModified={false} hideReset onReset={() => {}} className={dependent ? 'setting-row--dependent' : undefined}>
      {info ? (
        <div ref={ref} className="mechanics-toggle-info info-hint-region">
          {box}
          <InfoHint label={label} text={info} hoverRegionRef={ref} />
        </div>
      ) : (
        box
      )}
    </SettingRow>
  )
}

// ---------------------------------------------------------------------------
// Boss / Jad health widget
// ---------------------------------------------------------------------------

/** scim: archetype id -> display name (camelCase split, first letter capitalised). */
export function archetypeLabel(archetypeId: string): string {
  return archetypeId.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

export function hpColour(pct: number): string {
  return pct < 33 ? '#d46a60' : pct < 66 ? '#d4a848' : '#6dba6d'
}

export function BossHealthWidget({
  target,
  onSetHp,
  presets,
  onApplyPreset,
}: {
  target: NpcState
  onSetHp: (hp: number) => void
  presets?: { label: string; hp: number; hint?: string }[] | undefined
  onApplyPreset?: ((hp: number) => void) | undefined
}) {
  const max = Math.max(1, target.maxHp)
  // Local value while dragging: the snapshot only refreshes on the next tick.
  const [draft, setDraft] = useState<number | null>(null)
  const liveHp = Math.max(0, Math.min(max, target.hp))
  useEffect(() => {
    if (draft !== null && liveHp === draft) setDraft(null)
  }, [liveHp, draft])
  const hp = draft ?? liveHp
  const pct = Math.round((hp / max) * 100)
  const name = archetypeLabel(target.archetypeId)
  const colour = hpColour(pct)
  const setHp = (v: number) => {
    if (Number.isNaN(v)) return
    const next = Math.max(0, Math.min(max, Math.round(v)))
    setDraft(next)
    onSetHp(next)
  }
  return (
    <div className="boss-health">
      <div className="boss-health-head">
        <span className="boss-health-name" title={name}>
          {name}
        </span>
        <span className="boss-health-value">
          {hp}
          <span className="boss-health-sep">/</span>
          {target.maxHp}
        </span>
      </div>
      <input
        type="range"
        className="boss-health-slider"
        min={0}
        max={max}
        step={1}
        value={hp}
        onChange={(e) => setHp(Number(e.target.value))}
        onBlur={() => setDraft(null)}
        aria-label={`Set ${name} health`}
        style={{ background: `linear-gradient(to right, ${colour} 0%, ${colour} ${pct}%, rgba(255, 255, 255, 0.05) ${pct}%, rgba(255, 255, 255, 0.05) 100%)` }}
      />
      {presets && presets.length > 0 && (
        <fieldset className="boss-health-phases">
          <legend className="boss-health-name">Phases</legend>
          <div className="boss-health-presets">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className="boss-health-preset"
                onClick={() => (onApplyPreset ?? onSetHp)(Math.max(0, Math.min(max, p.hp)))}
                aria-label={`Set ${name} to ${p.label} (${p.hp} HP)`}
                title={`${p.hp} HP${p.hint ? `: ${p.hint}` : ''}`}
              >
                <span className="boss-health-preset-label">{p.label}</span>
                <span className="boss-health-preset-hp">{p.hp}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export interface MechanicsEditorProps {
  variant?: 'configurer' | 'practice'
  config: MechanicsConfig
  onConfigChange: (next: MechanicsConfig) => void
  toggles: readonly MechanicsToggleDef[]
  debugActions?: readonly DebugActionDef[]
  onExecuteCommand?: (command: EncounterCommand) => void
  /** Fight Setup health widget. */
  healthWidget?: ReactNode
  setupField?: ReactNode
  /** Practice: side-by-side (wide) layout with independent group scrolling. */
  independentScroll?: boolean
  maxColumns?: number
}

export function MechanicsEditor({
  variant = 'configurer',
  config,
  onConfigChange,
  toggles,
  debugActions = [],
  onExecuteCommand,
  healthWidget,
  setupField,
  independentScroll = false,
  maxColumns = 4,
}: MechanicsEditorProps) {
  const cfg = config as unknown as Config
  const [collapsed, setCollapsed] = useState<string[]>([])
  const baseId = useId()
  const toggleGroup = (id: string) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const change = (key: string, value: boolean | string | number) => onConfigChange({ ...cfg, [key]: value } as unknown as MechanicsConfig)

  const row = (t: MechanicsToggleDef) => {
    const value = cfg[t.key] ?? false
    const parentOff = t.dependsOn !== undefined && toggles.some((x) => x.key === t.dependsOn) && cfg[t.dependsOn] !== true
    if (t.choices && t.choices.length > 0) {
      const selected = (t.choices.find((c) => c.value === value) ?? t.choices[0]!).value
      return (
        <ChoiceRow
          key={t.key}
          label={t.label}
          info={t.info}
          choices={t.choices}
          value={selected}
          disabled={parentOff}
          dependent={t.dependsOn !== undefined && !t.setup}
          onSelect={(v) => change(t.key, v)}
        />
      )
    }
    return <ToggleRow key={t.key} label={t.label} info={t.info} checked={value === true} dependent={t.dependsOn !== undefined} onToggle={() => change(t.key, value !== true)} />
  }
  const actions = (list: readonly DebugActionDef[]) =>
    onExecuteCommand ? (
      <div className="mechanics-actions">
        {list.map((a) => (
          <OsrsButton key={JSON.stringify(a.command)} variant="small" onClick={() => onExecuteCommand(a.command)}>
            {a.label}
          </OsrsButton>
        ))}
      </div>
    ) : null

  if (variant === 'practice') {
    const { setup, mechanics, aids } = partitionToggles(toggles)
    const families = (list: MechanicsToggleDef[]) => {
      const fams: { key: string; toggles: MechanicsToggleDef[] }[] = []
      for (const t of list) {
        const parent = t.dependsOn ? fams.find((f) => f.key === t.dependsOn) : undefined
        if (parent) parent.toggles.push(t)
        else fams.push({ key: t.key, toggles: [t] })
      }
      fams.sort((a, b) => Number(a.toggles.length > 1) - Number(b.toggles.length > 1))
      return (
        <div className="mechanics-toggles">
          {fams.map((f) => (
            <div key={f.key} className="mechanics-toggle-family">
              {f.toggles.map(row)}
            </div>
          ))}
        </div>
      )
    }
    const inspection = debugActions.filter((a) => a.purpose === 'inspection')
    const regular = debugActions.filter((a) => a.purpose !== 'inspection')
    const groups: { id: string; title: string; content: ReactNode }[] = []
    if (healthWidget || setup.length > 0)
      groups.push({
        id: 'fightSetup',
        title: 'Fight Setup',
        content: (
          <div className="mechanics-fight-setup">
            {healthWidget}
            {setup.map(row)}
          </div>
        ),
      })
    if (mechanics.length > 0) groups.push({ id: 'mechanics', title: 'Mechanics', content: families(mechanics) })
    if (aids.length > 0) groups.push({ id: 'aids', title: 'Practice Aids', content: families(aids) })
    if (debugActions.length > 0 && onExecuteCommand) groups.push({ id: 'actions', title: 'Actions', content: actions([...regular, ...inspection]) })

    const collapsedGroups = groups.filter((g) => collapsed.includes(g.id))
    const openCount = groups.length - collapsedGroups.length
    let layout: 'inline' | 'closed' | 'side' | 'footer' = 'inline'
    if (independentScroll && collapsedGroups.length > 0) {
      if (openCount === 0) layout = 'closed'
      else if (maxColumns >= 4) layout = 'side'
      else if (maxColumns > 1 && openCount <= maxColumns) layout = 'footer'
    }
    const railed = layout !== 'inline'
    const columns = Math.max(1, Math.min(maxColumns - Number(layout === 'side'), railed ? openCount : groups.length))
    return (
      <div className="mechanics-settings mechanics-settings--practice" data-collapse-layout={independentScroll ? layout : undefined}>
        <div
          className="mechanics-practice-groups"
          hidden={layout === 'closed'}
          style={independentScroll ? { gridTemplateColumns: `repeat(${columns}, minmax(0, max-content))` } : undefined}
        >
          {groups.map((g) => (
            <PracticeGroup
              key={g.id}
              id={g.id}
              sectionId={`${baseId}-${g.id}`}
              title={g.title}
              collapsed={collapsed.includes(g.id)}
              hideWhenCollapsed={railed}
              scrollable={independentScroll}
              onToggle={toggleGroup}
            >
              {g.content}
            </PracticeGroup>
          ))}
        </div>
        {railed && (
          <fieldset className="practice-restore-rail" aria-label="Collapsed sections">
            {collapsedGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                className="mechanics-group-toggle practice-restore-toggle"
                data-practice-restore={g.id}
                aria-expanded={false}
                aria-controls={`${baseId}-${g.id}`}
                onClick={() => toggleGroup(g.id)}
              >
                <span className="mechanics-group-title">{g.title}</span>
                <svg className="mechanics-group-indicator" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 7h8M7 3v8" />
                </svg>
              </button>
            ))}
          </fieldset>
        )}
      </div>
    )
  }

  // Configurer variant (Configure rail): toggles, a rule between mechanics and aids, then choices.
  const isChoice = (t: MechanicsToggleDef) => (t.choices?.length ?? 0) > 0
  const plain = toggles.filter((t) => !isChoice(t) && t.group !== 'aid')
  const aidRows = toggles.filter((t) => !isChoice(t) && t.group === 'aid')
  const choiceRows = toggles.filter(isChoice)
  const all = [...plain, ...aidRows]
  const ruleAt = aidRows.length > 0 && plain.length > 0 ? plain.length : -1
  const ruleBeforeChoices = (setupField != null || choiceRows.length > 0) && all.length > 0
  return (
    <div className="mechanics-settings">
      {healthWidget}
      <div className="mechanics-toggles">
        {all.map((t, i) => (
          <Fragment key={t.key}>
            {i === ruleAt && <div className="mechanics-group-rule" />}
            {row(t)}
          </Fragment>
        ))}
        {ruleBeforeChoices && <div className="mechanics-group-rule" />}
        {setupField != null && (
          <SettingRow isModified={false} onReset={() => {}} hideReset>
            {setupField}
          </SettingRow>
        )}
        {choiceRows.map(row)}
      </div>
      {debugActions.length > 0 && actions(debugActions)}
    </div>
  )
}

function PracticeGroup({
  id,
  sectionId,
  title,
  collapsed,
  hideWhenCollapsed,
  scrollable,
  onToggle,
  children,
}: {
  id: string
  sectionId: string
  title: string
  collapsed: boolean
  hideWhenCollapsed: boolean
  scrollable: boolean
  onToggle: (id: string) => void
  children: ReactNode
}) {
  const bodyId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const scroll = useRef(0)
  useLayoutEffect(() => {
    if (!collapsed && bodyRef.current) bodyRef.current.scrollTop = scrollable ? scroll.current : 0
  }, [collapsed, scrollable])
  return (
    <section id={sectionId} className={`mechanics-group${collapsed ? ' is-collapsed' : ''}`} data-practice-group={id} hidden={collapsed && hideWhenCollapsed}>
      <h3 className="mechanics-group-heading">
        <button type="button" className="mechanics-group-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => onToggle(id)}>
          <span className="mechanics-group-title">{title}</span>
          <svg className="mechanics-group-indicator" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7h8" />
            {collapsed && <path d="M7 3v8" />}
          </svg>
        </button>
      </h3>
      <div
        ref={bodyRef}
        id={bodyId}
        className={`mechanics-group-body${scrollable ? ' practice-scroll-body' : ''}`}
        hidden={collapsed}
        onScroll={(e) => {
          if (!collapsed && scrollable) scroll.current = e.currentTarget.scrollTop
        }}
      >
        {children}
      </div>
    </section>
  )
}
