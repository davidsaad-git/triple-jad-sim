/**
 * Loadout editor of the Configure dialog (scim, bar
 *, equipment grid, rune pouch,
 * spellbook row `hde`).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { EquipSlot, Loadout, RunePouch, Spellbook } from '../../sim/api'
import { useHoverCard } from './controls'
import { CombatStatsPanel } from './CombatStatsPanel'
import { getPresets, loadCustomPresets, saveCustomPresets, type CustomPreset, type VerificationIssue } from './encounter'
import { copyToClipboard, exportInventorySetup, importInventorySetup, readClipboard } from './inventorySetups'
import type { CatalogItem, ItemCatalog } from './itemCatalog'
import { RUNE_GROUPS } from './itemCatalog'
import { ItemIcon, ItemPicker } from './ItemPicker'
import {
  ALL_BLOCKED_NOTE,
  autoSwitchPreset,
  CUSTOM_KEY,
  hasQuiver,
  hasUnmet,
  loadoutEqual,
  matchPresetKey,
  normalizeLoadout,
  sameName,
  setEquipmentSlot,
  setInventorySlot,
  setRunePouchSlot,
  setSpellbook,
  SKILL_LABELS,
  SKILLS,
  switchedNote,
  tileIconIds,
  uniqueName,
  unmetRequirements,
  type BaseLevels,
  type Requirements,
} from './loadoutModel'
import { PACK_PATHS, PackImg } from './packAssets'
import { spellBookOf } from './simBridge'
import { uiAsset } from '../packs'

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function ReqChips({ requirements }: { requirements: Requirements }) {
  return (
    <span className="loadout-req-chips">
      {SKILLS.filter((s) => requirements[s] !== undefined).map((s) => (
        <span key={s} className="loadout-req-chip">
          <img crossOrigin="anonymous" className="loadout-req-chip-icon" src={uiAsset(`skill-${s}.png`)} alt={SKILL_LABELS[s]} />
          <span className="loadout-req-chip-level">{requirements[s]}</span>
        </span>
      ))}
    </span>
  )
}

function TileIcons({ ids }: { ids: number[] }) {
  const list: (number | undefined)[] = ids.length > 0 ? ids : [undefined]
  return (
    <span className="loadout-tile-icons" aria-hidden="true">
      {list.map((id, i) => (
        <span key={i} className="loadout-tile-icon">
          {id !== undefined && <ItemIcon id={id} />}
        </span>
      ))}
    </span>
  )
}

function StatusIcon({ kind }: { kind: 'success' | 'error' }) {
  return (
    <svg className={`loadout-status-icon loadout-status-icon--${kind}`} aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
      {kind === 'success' ? (
        <path d="M2.5 7.2L5.4 10L11.5 3.8" />
      ) : (
        <>
          <path d="M7 2.5V8" />
          <path d="M7 10.8V11" />
        </>
      )}
    </svg>
  )
}

interface IoOutcome {
  button: 'import' | 'export'
  failed: boolean
  note: string | null
  seq: number
}

const FAILED_LABEL = 'Failed'
const OUTCOME_MS = { confirmed: 1800, failed: 6000 }
const STATUS_MS = 4200

/** scim: import/export button with Imported/Copied/Failed feedback. */
function IoButton({
  idleLabel,
  doneLabel,
  outcome,
  className,
  icon,
  disabled = false,
  ariaLabel,
  title,
  defaultNote,
  onPress,
  onDismissOutcome,
}: {
  idleLabel: string
  doneLabel: string
  outcome: IoOutcome | null
  className: string
  icon: ReactNode
  disabled?: boolean
  ariaLabel: string
  title?: string | undefined
  defaultNote: string
  onPress: () => void
  onDismissOutcome: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const failed = outcome?.failed === true
  const done = outcome?.failed === false
  const { card } = useHoverCard({
    content: outcome?.note ?? defaultNote,
    anchorRef: ref,
    placement: 'above',
    forceOpen: failed,
    className: outcome?.note == null ? undefined : `hover-card--outcome${failed ? ' hover-card--outcome-failed' : ''}`,
  })
  useEffect(() => {
    if (!outcome) return
    const t = window.setTimeout(onDismissOutcome, outcome.failed ? OUTCOME_MS.failed : OUTCOME_MS.confirmed)
    return () => window.clearTimeout(t)
  }, [outcome, onDismissOutcome])
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`${className}${done ? ' loadout-io-btn--confirmed' : ''}${failed ? ' loadout-io-btn--failed' : ''}`}
        aria-disabled={disabled || undefined}
        aria-label={ariaLabel}
        title={title}
        onClick={() => {
          if (!disabled) onPress()
        }}
      >
        <svg className="loadout-io-icon" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
          {failed ? <path d="M3.5 3.5L8.5 8.5M8.5 3.5L3.5 8.5" /> : done ? <path d="M2 6L5 9L10 3" /> : icon}
        </svg>
        <span className="loadout-io-label">
          <span className="loadout-io-label-face">{failed ? FAILED_LABEL : done ? doneLabel : idleLabel}</span>
          {[idleLabel, doneLabel, FAILED_LABEL].map((l) => (
            <span key={l} className="loadout-io-label-lock" aria-hidden="true">
              {l}
            </span>
          ))}
        </span>
      </button>
      {card}
    </>
  )
}

// ---------------------------------------------------------------------------
// Equipment grid (scim: 3 columns, quiver only with a quiver)
// ---------------------------------------------------------------------------

type GridSlotId = EquipSlot | 'ammo' | 'quiverAmmo'

const EQUIP_LAYOUT: { id: GridSlotId; label: string; row: number; col: number }[] = [
  { id: 'head', label: 'Head', row: 1, col: 2 },
  { id: 'quiverAmmo', label: 'Quiver', row: 1, col: 3 },
  { id: 'cape', label: 'Cape', row: 2, col: 1 },
  { id: 'amulet', label: 'Amulet', row: 2, col: 2 },
  { id: 'ammo', label: 'Ammo', row: 2, col: 3 },
  { id: 'weapon', label: 'Weapon', row: 3, col: 1 },
  { id: 'body', label: 'Body', row: 3, col: 2 },
  { id: 'shield', label: 'Shield', row: 3, col: 3 },
  { id: 'hands', label: 'Hands', row: 4, col: 1 },
  { id: 'legs', label: 'Legs', row: 4, col: 2 },
  { id: 'ring', label: 'Ring', row: 4, col: 3 },
  { id: 'boots', label: 'Boots', row: 5, col: 2 },
]

type PickerTarget = { kind: 'gear'; slot: EquipSlot } | { kind: 'ammo' } | { kind: 'quiverAmmo' } | { kind: 'inventory'; index: number }

function targetKey(t: PickerTarget): string {
  return t.kind === 'gear' ? `gear:${t.slot}` : t.kind === 'inventory' ? `inventory:${t.index}` : t.kind
}

function gridSlotTarget(id: GridSlotId): PickerTarget {
  return id === 'ammo' ? { kind: 'ammo' } : id === 'quiverAmmo' ? { kind: 'quiverAmmo' } : { kind: 'gear', slot: id }
}

function gridSlotItem(l: Loadout, id: GridSlotId): number | undefined {
  if (id === 'ammo') return l.supplies.equippedAmmo?.id
  if (id === 'quiverAmmo') return l.supplies.quiverAmmo?.id
  return l.equipment[id]
}

// ---------------------------------------------------------------------------
// Spellbook + rune pouch
// ---------------------------------------------------------------------------

/** Selectable books (scim: only those flagged available) and labels (`mde`). */
const SPELLBOOKS: { id: Spellbook; label: string }[] = [
  { id: 'arceuus', label: 'Arceuus' },
  { id: 'ancient', label: 'Ancient' },
]

function SpellbookRow({ spellbook, onSelect }: { spellbook: Spellbook; onSelect: (b: Spellbook) => void }) {
  return (
    <div className="spellbook-row">
      <span className="section-label" id="spellbook-group-label">
        SPELLBOOK
      </span>
      <div className="spellbook-options" role="radiogroup" aria-labelledby="spellbook-group-label">
        {SPELLBOOKS.map((b) => (
          <label key={b.id} className={`spellbook-option${b.id === spellbook ? ' spellbook-option--selected' : ''}`}>
            <input type="radio" name="encounter-spellbook" value={b.id} checked={b.id === spellbook} onChange={() => onSelect(b.id)} />
            {b.label}
          </label>
        ))}
      </div>
    </div>
  )
}

const NO_RUNE = 'No rune'
const RUNE_RUNS: { key: string; choices: (number | null)[] }[] = [{ key: 'clear', choices: [null] }, ...RUNE_GROUPS.map((g) => ({ key: g.key, choices: g.runes as (number | null)[] }))]

function RunePouchEditor({
  pouch,
  openSlot,
  onSelectSlot,
  onChoose,
  nameOf,
}: {
  pouch: RunePouch
  openSlot: number | null
  onSelectSlot: (i: number | null) => void
  onChoose: (slot: number, id: number | undefined) => void
  nameOf: (id: number) => string
}) {
  const labelId = useId()
  const trayId = useId()
  const open = openSlot !== null
  const heldAt = new Map<number, number>()
  pouch.slots.forEach((s, i) => {
    if (s && !heldAt.has(s.id)) heldAt.set(s.id, i)
  })
  const current = open ? (pouch.slots[openSlot] ?? null) : null
  return (
    <div className={`rune-pouch-row${open ? ' rune-pouch-row--open' : ''}`}>
      <div className="rune-pouch-bar">
        <span className="section-label" id={labelId}>
          Rune pouch
        </span>
        <div className="rune-pouch-slots" role="group" aria-labelledby={labelId}>
          {pouch.slots.map((s, i) => {
            const selected = openSlot === i
            const name = s ? nameOf(s.id) : 'Empty'
            return (
              <button
                key={i}
                type="button"
                className={['inventory-slot', 'rune-pouch-slot', s ? 'inventory-slot--filled' : '', selected ? 'inventory-slot--selected' : ''].filter(Boolean).join(' ')}
                aria-expanded={selected}
                aria-controls={trayId}
                aria-label={`Rune pouch slot ${i + 1}: ${name}`}
                onClick={() => onSelectSlot(selected ? null : i)}
              >
                {s && <ItemIcon id={s.id} className="rune-pouch-icon" style={{ maxWidth: 32, maxHeight: 32 }} />}
              </button>
            )
          })}
        </div>
      </div>
      <div className="rune-pouch-reveal" data-expanded={open} inert={!open || undefined}>
        <div className="rune-pouch-clip">
          <div className="rune-pouch-tray-panel">
            <p className="rune-pouch-caption">
              <span className="section-label">{open ? `Rune pouch / Slot ${openSlot + 1}` : ''}</span>
              <span className="rune-pouch-readout">{current ? nameOf(current.id) : NO_RUNE}</span>
            </p>
            <div id={trayId} className="rune-pouch-tray" role="listbox" aria-label={openSlot === null ? 'Runes' : `Runes for pouch slot ${openSlot + 1}`}>
              {RUNE_RUNS.map((run) => (
                <div key={run.key} className="rune-pouch-tray-run" role="presentation">
                  {run.choices.map((id) => {
                    const at = id === null ? undefined : heldAt.get(id)
                    const held = at !== undefined && at === openSlot
                    const taken = at !== undefined && at !== openSlot
                    const label = id === null ? NO_RUNE : nameOf(id)
                    return (
                      <button
                        key={id ?? 'clear'}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={held}
                        aria-disabled={taken || undefined}
                        aria-label={taken && at !== undefined ? `${label}, in slot ${at + 1}` : label}
                        title={label}
                        className={['inventory-slot', 'rune-pouch-choice', id !== null ? 'inventory-slot--filled' : '', held ? 'rune-pouch-choice--held' : '', taken ? 'rune-pouch-choice--taken' : '']
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          if (openSlot === null || taken) return
                          onChoose(openSlot, id ?? undefined)
                        }}
                      >
                        {id === null ? (
                          <span className="rune-pouch-none">
                            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none">
                              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                              <path d="M4 12L12 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          </span>
                        ) : (
                          <ItemIcon id={id} className="rune-pouch-icon" style={{ maxWidth: 32, maxHeight: 32 }} />
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

interface ImportDraft {
  suggestedName: string
  verificationIssues: VerificationIssue[]
}

type Status = { kind: 'success' | 'error'; message: string } | null

export interface LoadoutEditorProps {
  loadout: Loadout
  onLoadoutChange: (l: Loadout) => void
  levels: BaseLevels
  onLevelsChange: (l: BaseLevels) => void
  catalog: ItemCatalog | null
  /** Reports whether the loadout is an unsaved draft (Start Encounter is blocked while drafting). */
  onDraftChange?: (drafting: boolean) => void
  /** Increment to scroll to and pulse "Save loadout". */
  saveNudge?: number
  accountUnlocks?: ReactNode
}

const EMPTY_LIST: CatalogItem[] = []

export function LoadoutEditor({ loadout, onLoadoutChange, levels, onLevelsChange, catalog, onDraftChange, saveNudge = 0, accountUnlocks }: LoadoutEditorProps) {
  const presets = getPresets()
  const realPresets = presets.filter((p) => !p.isFallback)
  const shownPresets = realPresets.length > 0 ? realPresets : presets
  const [customs, setCustoms] = useState<CustomPreset[]>(loadCustomPresets)
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [status, setStatus] = useState<Status>(null)
  const [statusSeq, setStatusSeq] = useState(0)
  const [io, setIo] = useState<IoOutcome | null>(null)
  const [picker, setPicker] = useState<{ target: PickerTarget; anchor: HTMLElement } | null>(null)
  const [pouchSlot, setPouchSlot] = useState<number | null>(null)
  const [switchNote, setSwitchNote] = useState<{ note: string; desiredKey: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [settle, setSettle] = useState(0)
  const [lastSelection, setLastSelection] = useState<string | null>(null)
  const importSeq = useRef(0)
  const saveRef = useRef<HTMLButtonElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const quiver = hasQuiver(loadout)
  const presetKey = useMemo(() => matchPresetKey(presets, loadout), [presets, loadout])
  const customMatch = useMemo(() => customs.find((c) => loadoutEqual(c.loadout, loadout)), [customs, loadout])
  const selectedKey = customMatch ? `custom:${customMatch.id}` : presetKey
  const drafting = draft !== null || selectedKey === CUSTOM_KEY
  const barKey = draft === null ? selectedKey : CUSTOM_KEY
  const selectedPreset = presets.find((p) => p.id === presetKey)
  const onFallback = realPresets.length > 0 && selectedPreset?.isFallback === true
  const unmetByKey = useMemo(() => new Map(presets.map((p) => [p.id, unmetRequirements(levels, p.requirements)])), [presets, levels])
  const selectedUnmet = unmetByKey.get(presetKey) ?? {}

  useEffect(() => {
    onDraftChange?.(drafting)
  }, [drafting, onDraftChange])
  useEffect(() => {
    if (!drafting && lastSelection !== selectedKey) setLastSelection(selectedKey)
  }, [drafting, selectedKey, lastSelection])

  const nameOfKey = (key: string): string | undefined => (key.startsWith('custom:') ? customs.find((c) => c.id === key.slice(7))?.name : presets.find((p) => p.id === key)?.name)
  const revertName = lastSelection === null || (!lastSelection.startsWith('custom:') && hasUnmet(unmetByKey.get(lastSelection))) ? null : (nameOfKey(lastSelection) ?? null)

  const apply = useCallback(
    (l: Loadout) => {
      setPicker(null)
      setPouchSlot(null)
      onLoadoutChange(l)
      setSettle((s) => s + 1)
    },
    [onLoadoutChange],
  )
  const edit = (l: Loadout) => {
    setStatus(null)
    setIo(null)
    onLoadoutChange(l)
  }

  // Auto-switch when the selected preset's requirements become unmet.
  useEffect(() => {
    const next = autoSwitchPreset(presets, levels, presetKey)
    if (next === null) return
    const p = presets.find((x) => x.id === next)
    if (!p) return
    const bothReal = selectedPreset?.isFallback !== true && p.isFallback !== true
    apply(normalizeLoadout(p.loadout))
    setSwitchNote(bothReal ? { note: switchedNote(selectedPreset?.name ?? 'Your loadout', p.name), desiredKey: presetKey } : null)
  }, [presets, levels, presetKey, selectedPreset, apply])
  useEffect(() => {
    if (switchNote && !hasUnmet(unmetByKey.get(switchNote.desiredKey))) setSwitchNote(null)
  }, [switchNote, unmetByKey])
  useEffect(() => {
    if (status === null) return
    const t = window.setTimeout(() => setStatus(null), STATUS_MS)
    return () => window.clearTimeout(t)
  }, [status])
  useEffect(() => {
    if (naming) {
      nameRef.current?.focus()
      nameRef.current?.select()
    }
  }, [naming])
  useEffect(() => {
    if (saveNudge === 0) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    saveRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    saveRef.current?.focus()
  }, [saveNudge])

  const showStatus = (s: Status) => {
    setStatus(s)
    setStatusSeq((n) => n + 1)
  }

  const selectKey = (key: string) => {
    setNaming(false)
    setStatus(null)
    setIo(null)
    setDraft(null)
    if (key.startsWith('custom:')) {
      const c = customs.find((x) => x.id === key.slice(7))
      if (c) {
        apply(normalizeLoadout(c.loadout))
        setSwitchNote(null)
      }
      return
    }
    const p = presets.find((x) => x.id === key)
    if (!p || hasUnmet(unmetByKey.get(key))) return
    apply(normalizeLoadout(p.loadout))
    setSwitchNote(null)
  }

  const allNames = () => [...customs.map((c) => c.name), ...presets.map((p) => p.name)]
  const save = () => {
    if (!naming) {
      setStatus(null)
      const base = draft?.suggestedName ?? (revertName === null ? 'Custom loadout' : `${revertName} (custom)`)
      setDraftName(uniqueName(base, allNames()))
      setNaming(true)
      return
    }
    const name = draftName.trim()
    if (name.length === 0) return showStatus({ kind: 'error', message: 'Enter a name to save this loadout.' })
    if (allNames().some((n) => sameName(n, name))) return showStatus({ kind: 'error', message: `A loadout named ${name} already exists. Choose a different name.` })
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
    const entry: CustomPreset = { id, name, loadout: normalizeLoadout(loadout), ...(draft?.verificationIssues.length ? { verificationIssues: draft.verificationIssues } : {}) }
    const next = [...customs, entry]
    setCustoms(next)
    saveCustomPresets(next)
    setNaming(false)
    setDraft(null)
    showStatus({ kind: 'success', message: `Saved ${name} to your loadouts.` })
  }
  const deleteCustom = (key: string) => {
    const id = key.slice(7)
    const c = customs.find((x) => x.id === id)
    const next = customs.filter((x) => x.id !== id)
    setCustoms(next)
    saveCustomPresets(next)
    setConfirmDelete(null)
    showStatus({ kind: 'success', message: `Deleted ${c?.name ?? 'the loadout'}.` })
  }

  const exportName = draft?.suggestedName ?? customMatch?.name ?? selectedPreset?.name ?? 'Custom loadout'
  const doExport = async () => {
    const ok = await copyToClipboard(exportInventorySetup(exportName, loadout))
    setIo((p) => ({ button: 'export', failed: !ok, note: ok ? null : 'Your browser refused clipboard access. Allow it and try again.', seq: (p?.seq ?? 0) + 1 }))
  }
  const doImport = async () => {
    const seq = ++importSeq.current
    const text = await readClipboard()
    if (seq !== importSeq.current) return
    const fail = (note: string) => setIo((p) => ({ button: 'import', failed: true, note, seq: (p?.seq ?? 0) + 1 }))
    if (!text) return fail('Nothing readable in the clipboard. Copy a setup, then try again.')
    if (!catalog) return fail('The item list is still loading. Try again in a moment.')
    const r = importInventorySetup(text, catalog)
    if (r.kind === 'error') return fail(r.message)
    setNaming(false)
    apply(r.loadout)
    const matchCustom = customs.find((c) => loadoutEqual(c.loadout, r.loadout))?.name
    const mk = matchPresetKey(presets, r.loadout)
    const matched = matchCustom ?? (mk === CUSTOM_KEY ? undefined : presets.find((p) => p.id === mk)?.name)
    setDraft(matched === undefined ? { suggestedName: r.name, verificationIssues: r.verificationIssues } : null)
    const omitted = r.verificationIssues.filter((i) => i.omitted).length
    const tail = omitted === 0 ? '' : ` ${omitted} unsupported ${omitted === 1 ? 'item was' : 'items were'} left out.`
    const note = matched === undefined ? (omitted === 0 ? null : `Imported ${r.name}.${tail}`) : `This setup matches ${matched}, now selected.${tail}`
    setIo((p) => ({ button: 'import', failed: false, note, seq: (p?.seq ?? 0) + 1 }))
  }
  const dismissIo = useCallback(() => setIo(null), [])

  // Requirements shown in the stats grid ($e2).
  const firstReal = realPresets[0]
  const statsRequirements: Requirements = switchNote ? (unmetByKey.get(switchNote.desiredKey) ?? {}) : onFallback && firstReal ? (unmetByKey.get(firstReal.id) ?? {}) : selectedUnmet

  const selectedLabel =
    draft !== null
      ? 'Custom (unsaved)'
      : customMatch
        ? customMatch.name
        : presetKey === CUSTOM_KEY
          ? 'Custom (unsaved)'
          : onFallback
            ? `${selectedPreset?.name ?? 'No Equipment'} (fallback)`
            : (selectedPreset?.name ?? 'Custom')

  // Options
  const options: { key: string; name: string; icons: number[] }[] = []
  const blocked: { key: string; name: string; icons: number[]; requirements: Requirements }[] = []
  for (const p of shownPresets) {
    const u = unmetByKey.get(p.id)
    const icons = tileIconIds(normalizeLoadout(p.loadout))
    if (hasUnmet(u)) blocked.push({ key: p.id, name: p.name, icons, requirements: u ?? {} })
    else options.push({ key: p.id, name: p.name, icons })
  }
  const listRef = useRef<HTMLDivElement>(null)
  const moveFocus = (d: number) => {
    const opts = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? []).filter((e) => e.closest('[inert]') === null)
    if (opts.length === 0) return
    const i = opts.indexOf(document.activeElement as HTMLElement)
    opts[(i + d + opts.length) % opts.length]?.focus()
  }
  const listKeys = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      moveFocus(1)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      moveFocus(-1)
    }
  }
  const tile = (o: { key: string; name: string; icons: number[] }) => (
    <button
      key={o.key}
      type="button"
      role="option"
      aria-selected={o.key === barKey}
      className={`loadout-tile${o.key === barKey ? ' loadout-tile--selected' : ''}`}
      inert={confirmDelete === o.key || undefined}
      onClick={() => selectKey(o.key)}
    >
      <TileIcons ids={o.icons} />
      <span className="loadout-tile-name">{o.name}</span>
    </button>
  )

  const nameOf = (id: number) => catalog?.name(id) ?? `Item ${id}`
  const openPicker = (target: PickerTarget, anchor: HTMLElement) => {
    setPouchSlot(null)
    setPicker((p) => (p && targetKey(p.target) === targetKey(target) ? null : { target, anchor }))
  }
  const twoHanded = (id: number) => catalog?.isTwoHanded(id) ?? false

  const renderPicker = () => {
    if (!picker) return null
    const { target, anchor } = picker
    const dismiss = (refocus: boolean) => {
      if (refocus) anchor.focus()
      setPicker(null)
    }
    if (target.kind === 'gear') {
      const label = EQUIP_LAYOUT.find((s) => s.id === target.slot)?.label ?? target.slot
      const lower = label.toLowerCase()
      const cur = loadout.equipment[target.slot]
      return (
        <ItemPicker
          key={targetKey(target)}
          anchor={anchor}
          dialogLabel={`Edit ${lower} slot`}
          searchLabel={`Search supported ${lower} gear`}
          listLabel={`${label} gear`}
          catalogNoun={`${lower} gear`}
          catalog={catalog?.equipment(target.slot) ?? EMPTY_LIST}
          currentItemId={cur}
          currentName={cur === undefined ? undefined : nameOf(cur)}
          emptyIcon={<PackImg className="slot-picker__silhouette" path={PACK_PATHS.slot[target.slot] ?? ''} />}
          onChoose={(id) => edit(setEquipmentSlot(loadout, target.slot, id, twoHanded))}
          onDismiss={dismiss}
        />
      )
    }
    if (target.kind === 'ammo' || target.kind === 'quiverAmmo') {
      const quiverTarget = target.kind === 'quiverAmmo'
      const cur = quiverTarget ? loadout.supplies.quiverAmmo?.id : loadout.supplies.equippedAmmo?.id
      return (
        <ItemPicker
          key={targetKey(target)}
          anchor={anchor}
          dialogLabel={quiverTarget ? 'Edit quiver ammunition' : 'Edit ammunition slot'}
          searchLabel={quiverTarget ? 'Search supported quiver ammunition' : 'Search supported ammunition'}
          listLabel={quiverTarget ? 'Quiver ammunition' : 'Ammunition'}
          catalogNoun="ammunition"
          catalog={(quiverTarget ? catalog?.quiverAmmo() : catalog?.ammo()) ?? EMPTY_LIST}
          currentItemId={cur}
          currentName={cur === undefined ? undefined : nameOf(cur)}
          emptyIcon={<PackImg className="slot-picker__silhouette" path={PACK_PATHS.slot.ammo ?? ''} />}
          onChoose={(id) =>
            edit({ ...loadout, supplies: { ...loadout.supplies, [quiverTarget ? 'quiverAmmo' : 'equippedAmmo']: id === undefined ? null : { id } } })
          }
          onDismiss={dismiss}
        />
      )
    }
    const cur = loadout.inventory[target.index]?.id
    return (
      <ItemPicker
        key={targetKey(target)}
        anchor={anchor}
        dialogLabel={`Edit inventory slot ${target.index + 1}`}
        searchLabel="Search supported inventory items"
        listLabel="Inventory items"
        catalogNoun="inventory item"
        catalog={catalog?.inventory() ?? EMPTY_LIST}
        currentItemId={cur}
        currentName={cur === undefined ? undefined : nameOf(cur)}
        withCategories
        onChoose={(id) => {
          setPouchSlot(null)
          edit(setInventorySlot(loadout, target.index, id))
        }}
        onDismiss={dismiss}
      />
    )
  }

  const selectedPickerKey = picker ? targetKey(picker.target) : null
  const fallbackNoteReqs = onFallback && firstReal ? (unmetByKey.get(firstReal.id) ?? {}) : selectedUnmet

  return (
    <section className={`loadout-section${drafting ? ' loadout-section--drafting' : ''}`}>
      <div className="loadout-picker">
        <div className={`loadout-bar${naming ? ' loadout-bar--naming' : ''}`}>
          <div className="loadout-bar-identity">
            <span className="section-label section-label--primary">LOADOUT</span>
            {drafting && naming ? (
              <input
                ref={nameRef}
                className="loadout-draft-name"
                aria-label="Loadout name"
                value={draftName}
                maxLength={48}
                onChange={(e) => setDraftName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    save()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    setNaming(false)
                  }
                }}
              />
            ) : (
              <span className="loadout-current">{selectedLabel}</span>
            )}
          </div>
          <div className="loadout-bar-actions">
            {drafting && (
              <span className="loadout-bar-draft">
                {naming ? (
                  <button type="button" className="loadout-bar-action loadout-bar-back" onClick={() => setNaming(false)}>
                    Cancel
                  </button>
                ) : (
                  revertName !== null &&
                  lastSelection !== null && (
                    <button type="button" className="loadout-bar-action loadout-bar-back" aria-label={`Revert to ${revertName}`} onClick={() => selectKey(lastSelection)}>
                      Revert
                    </button>
                  )
                )}
                <button ref={saveRef} type="button" className="loadout-bar-action loadout-bar-save" onClick={save}>
                  {naming ? 'Save' : 'Save loadout'}
                  {saveNudge > 0 && <span key={saveNudge} className="loadout-bar-save-beat" aria-hidden="true" />}
                </button>
              </span>
            )}
            <span className="loadout-io">
              <IoButton
                idleLabel="Import"
                doneLabel="Imported"
                outcome={io?.button === 'import' ? io : null}
                className="loadout-io-btn"
                icon={<path d="M6 2V8M3 5L6 8L9 5M2 9V11H10V9" />}
                ariaLabel={io?.button === 'import' ? (io.failed ? 'Import Inventory Setup from the clipboard, last attempt failed' : 'Imported Inventory Setup from the clipboard') : 'Import Inventory Setup from the clipboard'}
                defaultNote="Import Inventory Setup string from clipboard."
                onPress={() => void doImport()}
                onDismissOutcome={dismissIo}
              />
              <IoButton
                idleLabel="Export"
                doneLabel="Copied"
                outcome={io?.button === 'export' ? io : null}
                className="loadout-io-btn loadout-io-btn--export"
                icon={<path d="M6 8V2M3 5L6 2L9 5M2 9V11H10V9" />}
                disabled={drafting}
                ariaLabel={
                  drafting
                    ? 'Export Inventory Setup, unavailable until this loadout is saved'
                    : io?.button === 'export'
                      ? io.failed
                        ? `Export ${exportName} as an Inventory Setup, last attempt failed`
                        : `Copied ${exportName} as an Inventory Setup`
                      : `Export ${exportName} as an Inventory Setup`
                }
                title={drafting ? 'Save this loadout to export it' : undefined}
                defaultNote="Export Inventory Setup string to clipboard."
                onPress={() => void doExport()}
                onDismissOutcome={dismissIo}
              />
              <span className="loadout-io-sr-status" aria-live="polite" aria-atomic="true">
                {io ? (io.note ?? (io.button === 'export' ? `Copied ${exportName} as an Inventory Setup.` : 'Imported Inventory Setup from the clipboard.')) : ''}
              </span>
            </span>
          </div>
        </div>
        {status && (
          <p key={statusSeq} className={`loadout-status${status.kind === 'error' ? ' loadout-status--error' : ''}`} role="status">
            <StatusIcon kind={status.kind} />
            <span>{status.message}</span>
          </p>
        )}
        <div ref={listRef} className="loadout-body">
          <h3 className="loadout-group-heading">Presets</h3>
          <div className="loadout-list" role="listbox" aria-label="Equipment loadout presets" onKeyDown={listKeys}>
            <div className="loadout-grid-tiles">{options.map(tile)}</div>
            {blocked.map((b) => (
              <button key={b.key} type="button" role="option" aria-disabled="true" aria-selected={false} className="loadout-tile loadout-tile--blocked">
                <TileIcons ids={b.icons} />
                <span className="loadout-tile-name">
                  <svg className="loadout-tile-lock" role="img" aria-label="Locked" width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M3.5 5.5V4a2.5 2.5 0 0 1 5 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    <rect x="2" y="5.5" width="8" height="5.3" rx="1.2" fill="currentColor" />
                  </svg>
                  {b.name}
                </span>
                <ReqChips requirements={b.requirements} />
              </button>
            ))}
          </div>
          {customs.length > 0 && (
            <div className="loadout-saved">
              <h3 className="loadout-group-heading">
                Saved <span className="loadout-saved-count">({customs.length})</span>
              </h3>
              <div className="loadout-saved-scroll" role="group" onKeyDown={listKeys}>
                <div className="loadout-grid-tiles">
                  {customs.map((c) => {
                    const key = `custom:${c.id}`
                    return (
                      <div key={key} className="loadout-saved-cell">
                        {tile({ key, name: c.name, icons: tileIconIds(c.loadout) })}
                        {confirmDelete === key ? (
                          <div
                            className="loadout-saved-confirm"
                            role="group"
                            aria-label={`Delete ${c.name}?`}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                e.stopPropagation()
                                setConfirmDelete(null)
                              } else if (e.key.startsWith('Arrow')) e.stopPropagation()
                            }}
                          >
                            <span className="loadout-saved-confirm-name">{c.name}</span>
                            <div className="loadout-saved-confirm-actions">
                              <button type="button" className="loadout-saved-confirm-btn loadout-saved-confirm-btn--delete" onClick={() => deleteCustom(key)}>
                                Delete
                              </button>
                              <button type="button" className="loadout-saved-confirm-btn loadout-saved-confirm-btn--keep" onClick={() => setConfirmDelete(null)}>
                                Keep
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="loadout-saved-delete" aria-label={`Delete ${c.name}`} onClick={() => setConfirmDelete(key)}>
                            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {onFallback ? (
        <p className="loadout-note loadout-note--warn" role="status">
          {ALL_BLOCKED_NOTE}
          {hasUnmet(fallbackNoteReqs) && (
            <>
              {' '}
              <ReqChips requirements={fallbackNoteReqs} />
            </>
          )}
        </p>
      ) : (
        switchNote && (
          <p className="loadout-note loadout-note--switch" role="status">
            {switchNote.note} <ReqChips requirements={unmetByKey.get(switchNote.desiredKey) ?? {}} />
          </p>
        )
      )}
      <div className="loadout-editor">
        {settle > 0 && <span key={settle} className="loadout-editor-settle" aria-hidden="true" />}
        <div className="loadout-frame">
          <div className="loadout-equipment-column">
            <h3 className="section-label loadout-grid-heading">Equipment</h3>
            <div className="equip-grid" role="group" aria-label="Equipment">
              {EQUIP_LAYOUT.filter((s) => s.id !== 'quiverAmmo' || quiver).map((s) => {
                const id = gridSlotItem(loadout, s.id)
                const filled = id !== undefined
                const selected = selectedPickerKey === targetKey(gridSlotTarget(s.id))
                const isAmmo = s.id === 'ammo' || s.id === 'quiverAmmo'
                const name = filled ? nameOf(id) : 'empty'
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={['equip-slot', 'equip-slot--editable', filled ? 'equip-slot--filled' : '', selected ? 'equip-slot--selected' : ''].filter(Boolean).join(' ')}
                    style={{ gridRow: s.row, gridColumn: s.col }}
                    aria-pressed={selected}
                    aria-haspopup="dialog"
                    aria-label={[`${s.label}: ${name}`, isAmmo ? 'Never runs out' : ''].filter(Boolean).join('. ')}
                    onClick={(e) => openPicker(gridSlotTarget(s.id), e.currentTarget)}
                  >
                    <span className="equip-slot-label">{s.label}</span>
                    {filled && <ItemIcon id={id} style={{ maxWidth: 32, maxHeight: 32, position: 'relative', left: 2 }} />}
                    {isAmmo && !filled && (
                      <svg className="equip-slot-unlimited" role="img" aria-label="Unlimited" width={14} height={9} viewBox="0 0 12 8" fill="none">
                        <path d="M3.5 2C1.8 2 1.8 6 3.5 6C5.2 6 6.8 2 8.5 2C10.2 2 10.2 6 8.5 6C6.8 6 5.2 2 3.5 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="loadout-inventory-column">
            <h3 className="section-label loadout-grid-heading">Inventory</h3>
            <div className="inventory-grid" role="group" aria-label="Inventory">
              {loadout.inventory.map((item, i) => {
                const selected = selectedPickerKey === `inventory:${i}`
                const entry = item ? catalog?.inventoryItem(item.id) : undefined
                const unverified = item !== null && catalog !== null && entry?.verified !== true
                return (
                  <button
                    key={i}
                    type="button"
                    className={['inventory-slot', item ? 'inventory-slot--filled' : '', selected ? 'inventory-slot--selected' : '', unverified ? 'inventory-slot--unverified' : ''].filter(Boolean).join(' ')}
                    aria-pressed={selected}
                    aria-haspopup="dialog"
                    aria-label={`Inventory slot ${i + 1}: ${item ? nameOf(item.id) : 'empty'}${unverified ? ', unverified and may not work correctly' : ''}`}
                    onClick={(e) => openPicker({ kind: 'inventory', index: i }, e.currentTarget)}
                  >
                    {item && <ItemIcon id={item.id} style={{ maxWidth: 32, maxHeight: 32 }} />}
                  </button>
                )
              })}
            </div>
          </div>
          <p className="loadout-editor-guidance">Select a slot to change it.</p>
        </div>
        <div className="loadout-supplies">
          <SpellbookRow spellbook={loadout.supplies.spellbook} onSelect={(b) => edit(setSpellbook(loadout, b, spellBookOf))} />
          {loadout.supplies.runePouch && (
            <RunePouchEditor
              pouch={loadout.supplies.runePouch}
              openSlot={pouchSlot}
              onSelectSlot={(i) => {
                setPicker(null)
                setPouchSlot(i)
              }}
              onChoose={(slot, id) => {
                edit(setRunePouchSlot(loadout, slot, id))
                setPouchSlot(null)
              }}
              nameOf={nameOf}
            />
          )}
        </div>
      </div>
      {renderPicker()}
      <CombatStatsPanel levels={levels} onChange={onLevelsChange} requirements={statsRequirements} accountUnlocks={accountUnlocks} />
    </section>
  )
}
