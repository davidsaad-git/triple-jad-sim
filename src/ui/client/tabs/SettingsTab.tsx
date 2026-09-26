import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_KEYBINDS, keybindStore, useKeybinds } from '../../../app/keybinds'
import { DEFAULT_SETTINGS, settingsStore, useSetting } from '../../../app/settings/settings'
import { beginKeyCapture } from '../../../input/modifiers'
import { packAsset, useActivePack } from '../../packs'
import { CONTENT_BOX } from '../layout'
import { ComposedSprite } from '../sprites/ComposedSprite'
import { tileImage } from '../sprites/imageStore'
import { PixelSprite } from '../sprites/PixelSprite'

/**
 * The in-game Settings tab, labelled "Keybinds": "Audio" (Master Volume, Sound Effects,
 * Area Sounds with OSRS sliders, Mute when unfocused) and "Keybindings".
 */

export type SettingsSubTab = 'audio' | 'keybinds'
const PAGES: readonly { id: SettingsSubTab; label: string }[] = [
  { id: 'audio', label: 'Audio' },
  { id: 'keybinds', label: 'Keybindings' },
]

/** Reset affordance: the reset-killcount sprite, 15x14. */
export function ResetButton({ onClick, disabled, label = 'Reset to default', className = '', hidden }: { onClick?: () => void; disabled?: boolean; label?: string; className?: string; hidden?: boolean }) {
  const pack = useActivePack()
  return (
    <button type="button" disabled={disabled} className={`reset-button ${className}`.trim()} aria-label={label} aria-hidden={hidden || undefined} onClick={onClick}>
      <PixelSprite src={packAsset(disabled ? 'other/reset_killcount_button.png' : 'other/reset_killcount_button_hovered.png', pack)} width={15} height={14} alt="" aria-hidden="true" />
    </button>
  )
}

/** Row with the modified marker and a reset button. */
export function SettingRow({ modified, onReset, children, className }: { modified: boolean; onReset: () => void; children: ReactNode; className?: string }) {
  return (
    <div className={`setting-row${modified ? ' setting-row--modified' : ''}${className ? ` ${className}` : ''}`}>
      {children}
      <ResetButton className="setting-row__reset" onClick={onReset} label="Reset to default" hidden={!modified} disabled={!modified} />
    </div>
  )
}

const SLIDER_W = 184
/** Slider marks: [sprite, x]. */
const MARKS: readonly [string, number][] = [
  ['options/slider_new_left_caret.png', 0],
  ['options/slider_new_dot_darker.png', 16],
  ['options/slider_new_half_dot_left.png', 42],
  ['options/slider_new_half_dot_right.png', 58],
  ['options/slider_new_dot_regular.png', 84],
  ['options/slider_new_half_dot_left.png', 110],
  ['options/slider_new_half_dot_right.png', 126],
  ['options/slider_new_dot_regular.png', 152],
  ['options/slider_new_right_caret.png', 168],
]

/** Thumb x for a percentage: 16 + round(136 * pct / 100). */
export function sliderThumbX(percent: number): number {
  return 16 + Math.round((136 * percent) / 100)
}

export function AudioSlider({ id, percent, onChange }: { id: string; percent: number; onChange: (pct: number) => void }) {
  const pack = useActivePack()
  const track = packAsset('options/slider_new_empty.png', pack)
  const thumb = packAsset('options/slider_new_dot_green.png', pack)
  const marks = MARKS.map(([p, x]) => [packAsset(p, pack), x] as const)
  const sources = [track, ...marks.map(([u]) => u), thumb]
  return (
    <div className="audio-slider-control">
      <ComposedSprite
        cacheKey={`audio-slider:${sources.join(':')}:${SLIDER_W}:${percent}`}
        width={SLIDER_W}
        height={24}
        sources={sources}
        draw={(ctx, images) => {
          const t = images.get(track)
          if (t) tileImage(ctx, t, 16, 4, 152, 16)
          for (const [u, x] of marks) {
            const img = images.get(u)
            if (img) ctx.drawImage(img, x, 4)
          }
          const th = images.get(thumb)
          if (th) ctx.drawImage(th, sliderThumbX(percent), 4)
        }}
      />
      <input id={id} type="range" className="audio-slider" min="0" max="100" step="5" value={percent} aria-valuetext={`${percent}%`} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

type VolumeKey = 'masterVolume' | 'sfxVolume' | 'areaVolume'

function Volume({ label, keyName, value }: { label: string; keyName: VolumeKey; value: number }) {
  const def = DEFAULT_SETTINGS[keyName]
  const pct = Math.round(value * 100)
  return (
    <fieldset className="audio-volume" aria-label={label}>
      <SettingRow modified={Math.abs(value - def) > 0.005} onReset={() => settingsStore.patch({ [keyName]: def })}>
        <div className="audio-volume-heading">
          <label htmlFor={`audio-${keyName}`}>{label}</label>
          <output htmlFor={`audio-${keyName}`}>{pct}%</output>
        </div>
      </SettingRow>
      <AudioSlider id={`audio-${keyName}`} percent={pct} onChange={(p) => settingsStore.patch({ [keyName]: p / 100 })} />
    </fieldset>
  )
}

function AudioPage() {
  const s = { master: useSetting('masterVolume'), sfx: useSetting('sfxVolume'), area: useSetting('areaVolume'), mute: useSetting('muteWhenUnfocused') }
  const pack = useActivePack()
  return (
    <div className="game-panel-scroll audio-content">
      <section className="audio-master-group" aria-label="Master audio">
        <Volume label="Master Volume" keyName="masterVolume" value={s.master} />
        <div className="audio-preference">
          <SettingRow modified={s.mute !== DEFAULT_SETTINGS.muteWhenUnfocused} onReset={() => settingsStore.patch({ muteWhenUnfocused: DEFAULT_SETTINGS.muteWhenUnfocused })}>
            <button type="button" role="checkbox" aria-checked={s.mute} className="audio-mute" onClick={() => settingsStore.patch({ muteWhenUnfocused: !s.mute })}>
              <PixelSprite src={packAsset(s.mute ? 'options/round_check_box_checked_green.png' : 'options/round_check_box_crossed2.png', pack)} alt="" width={17} height={17} />
              <span>Mute when unfocused</span>
            </button>
          </SettingRow>
        </div>
      </section>
      <div className="audio-channels">
        <Volume label="Sound Effects" keyName="sfxVolume" value={s.sfx} />
        <Volume label="Area Sounds" keyName="areaVolume" value={s.area} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Keybindings
// ---------------------------------------------------------------------------

type Category = 'Panel' | 'Camera'
interface Binding {
  domain: 'gamePanel' | 'camera'
  action: string
  label: string
  group: 'Panel' | 'Camera' | 'Free Camera'
  icon?: string
}

const PANEL_BINDINGS: readonly Binding[] = [
  ['combat', 'Combat', 'tabs/combat.png'],
  ['inventory', 'Inventory', 'tabs/inventory.png'],
  ['equipment', 'Equipment', 'tabs/equipment.png'],
  ['prayer', 'Prayer', 'tabs/prayer.png'],
  ['spellbook', 'Spells', 'tabs/magic.png'],
  ['skills', 'Skills', 'tabs/stats.png'],
  ['settings', 'Keybinds', 'tabs/options.png'],
].map(([action, label, icon]) => ({ domain: 'gamePanel' as const, action: action!, label: label!, group: 'Panel' as const, icon: icon! }))

const CAMERA_LABELS: Readonly<Record<string, string>> = {
  orbitRotateLeft: 'Rotate Left',
  orbitRotateRight: 'Rotate Right',
  orbitTiltUp: 'Tilt Up',
  orbitTiltDown: 'Tilt Down',
  freeformForward: 'Forward',
  freeformBackward: 'Backward',
  freeformLeft: 'Strafe Left',
  freeformRight: 'Strafe Right',
  freeformUp: 'Fly Up',
  freeformDown: 'Fly Down',
  toggleFreeform: 'Toggle Freeform',
}
const FREE = ['freeformForward', 'freeformBackward', 'freeformLeft', 'freeformRight', 'freeformUp', 'freeformDown']
const CAMERA_BINDINGS: readonly Binding[] = ['orbitRotateLeft', 'orbitRotateRight', 'orbitTiltUp', 'orbitTiltDown', 'toggleFreeform', ...FREE].map((action) => ({
  domain: 'camera' as const,
  action,
  label: CAMERA_LABELS[action]!,
  group: FREE.includes(action) || action === 'toggleFreeform' ? ('Free Camera' as const) : ('Camera' as const),
}))

/** Key display text. */
export function keyLabel(key: string): string {
  if (key === 'Escape') return 'Esc'
  if (key === ' ') return 'Space'
  if (key.startsWith('F') && key.length <= 3) return key
  return key.length === 1 ? key.toUpperCase() : key
}

const RESERVED = new Set(['Tab', 'Enter', 'Alt', 'Control', 'Meta', 'ContextMenu'])

function bindingValue(kb: ReturnType<typeof keybindStore.get>, b: Binding): string {
  return (kb[b.domain] as Record<string, string> | undefined)?.[b.action] ?? ''
}

function defaultValue(b: Binding): string {
  return (DEFAULT_KEYBINDS[b.domain] as Record<string, string>)[b.action] ?? ''
}

/** Save a binding; other bindings in the same domain with that key are unbound. Returns the unbound ones. */
function saveBinding(b: Binding, key: string): Binding[] {
  const kb = keybindStore.get()
  const list = b.domain === 'gamePanel' ? PANEL_BINDINGS : CAMERA_BINDINGS
  const unbound: Binding[] = []
  const patch: Record<string, string> = { [b.action]: key }
  if (key) {
    for (const other of list) {
      if (other.action === b.action) continue
      const sameGroup = b.domain === 'gamePanel' || (other.group === 'Free Camera') === (b.group === 'Free Camera')
      if (sameGroup && bindingValue(kb, other).toLowerCase() === key.toLowerCase()) {
        patch[other.action] = ''
        unbound.push(other)
      }
    }
  }
  keybindStore.patchGroup(b.domain, patch)
  return unbound
}

function KeybindingsPage({ readOnly = false }: { readOnly?: boolean }) {
  const kb = useKeybinds((k) => k)
  const pack = useActivePack()
  const [category, setCategory] = useState<Category>('Panel')
  const [editing, setEditing] = useState<Binding | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; warning?: boolean } | null>(null)
  const list = category === 'Panel' ? PANEL_BINDINGS : CAMERA_BINDINGS
  const groups = [...new Set(list.map((b) => b.group))]

  const finish = (): void => {
    setEditing(null)
  }
  const apply = (b: Binding, key: string): void => {
    if (key && RESERVED.has(key)) {
      setFeedback({ text: 'Reserved. Try another key.', warning: true })
      return
    }
    const unbound = saveBinding(b, key)
    finish()
    setFeedback(unbound.length ? { text: `Unbound: ${unbound.map((u) => u.label).join(', ')}` } : { text: `${b.label} saved.` })
  }

  const row = (b: Binding) => {
    const value = bindingValue(kb, b)
    const isEditing = editing?.action === b.action && editing.domain === b.domain
    return (
      <div key={`${b.domain}:${b.action}`} className="keybindings-row">
        {b.icon && <PixelSprite src={packAsset(b.icon, pack)} alt="" width={15} height={15} />}
        <span className="keybindings-label">{b.label}</span>
        <KeyValueButton value={value} editing={isEditing} readOnly={readOnly} label={b.label} group={b.group} onEdit={() => {
          setFeedback(null)
          setEditing(b)
        }} onKey={(key) => apply(b, key)} onCancel={finish} />
      </div>
    )
  }

  return (
    <fieldset className="keybindings-content" aria-label="Keybindings" onKeyDown={(e) => {
      if (editing || ['Tab', 'Enter', ' '].includes(e.key)) e.stopPropagation()
    }}>
      <div className="keybindings-categories" role="tablist" aria-label="Keybinding categories">
        {(['Panel', 'Camera'] as const).map((c) => (
          <button key={c} type="button" role="tab" aria-selected={category === c} onClick={() => {
            setEditing(null)
            setCategory(c)
            setFeedback(null)
          }}>
            {c}
          </button>
        ))}
      </div>
      <div className="game-panel-scroll keybindings-scroll" role="tabpanel">
        {groups.map((g) =>
          g === 'Free Camera' ? (
            <details key={g} data-keybinding-group={g} tabIndex={-1}>
              <summary>Free camera</summary>
              {list.filter((b) => b.group === g).map(row)}
            </details>
          ) : (
            <section key={g} data-keybinding-group={g} aria-label={g}>
              {list.filter((b) => b.group === g).map(row)}
            </section>
          ),
        )}
      </div>
      <div className={`keybindings-footer${editing ? ' is-editing' : ''}`}>
        <div className={`keybindings-feedback game-panel-scroll${feedback?.warning ? ' is-warning' : ''}`} role="status">
          {feedback?.text ?? (readOnly ? 'Exit replay to edit bindings.' : editing ? 'Press a key. Esc cancels.' : 'Click a key to change it.')}
        </div>
        {editing && !readOnly ? (
          <div className="keybindings-edit-tools">
            <button type="button" className="keybindings-text-button" disabled={!bindingValue(kb, editing)} onClick={() => apply(editing, '')}>
              Unbind
            </button>
            {bindingValue(kb, editing) !== defaultValue(editing) && <ResetButton label={`Reset ${editing.label} binding to default`} onClick={() => apply(editing, defaultValue(editing))} />}
            <button type="button" className="keybindings-text-button keybindings-cancel" onClick={finish}>
              Cancel
            </button>
          </div>
        ) : (
          !readOnly &&
          list.some((b) => bindingValue(kb, b) !== defaultValue(b)) && (
            <ResetButton
              label={`Reset ${category} keybindings`}
              onClick={() => {
                const patch: Record<string, string> = {}
                for (const b of list) patch[b.action] = defaultValue(b)
                keybindStore.patchGroup(list[0]!.domain, patch)
                setFeedback({ text: `${category} keybindings reset.` })
              }}
            />
          )
        )}
      </div>
    </fieldset>
  )
}

function KeyValueButton({ value, editing, readOnly, label, group, onEdit, onKey, onCancel }: { value: string; editing: boolean; readOnly: boolean; label: string; group: string; onEdit: () => void; onKey: (key: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const cb = useRef({ onKey, onCancel })
  cb.current = { onKey, onCancel }
  useLayoutEffect(() => {
    if (!editing) return
    ref.current?.focus({ preventScroll: true })
    const release = beginKeyCapture((e) => {
      if (e.key === 'Escape') {
        cb.current.onCancel()
        return true
      }
      if (e.repeat || e.isComposing) return true
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return true
      cb.current.onKey(e.key)
      return true
    })
    const onBlur = (): void => cb.current.onCancel()
    const onPointer = (e: PointerEvent): void => {
      if (e.target instanceof Node && !ref.current?.contains(e.target) && !(e.target as Element).closest?.('.keybindings-footer')) cb.current.onCancel()
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      release()
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [editing])
  return (
    <button type="button" ref={ref} className={`keybindings-value${editing ? ' is-recording' : ''}${value ? '' : ' is-unbound'}`} disabled={readOnly} aria-label={editing ? 'Record shortcut' : `Rebind ${group}: ${label}`} onClick={onEdit}>
      <kbd>{value ? keyLabel(value) : 'Unbound'}</kbd>
    </button>
  )
}

export function SettingsTab({ subTab, onSubTabChange, readOnly = false }: { subTab: SettingsSubTab; onSubTabChange: (t: SettingsSubTab) => void; readOnly?: boolean }) {
  return (
    <div className="settings-content" style={{ width: CONTENT_BOX.width, height: CONTENT_BOX.height, position: 'relative' }} data-testid="settings-panel">
      <div className="settings-content-inner">
        <fieldset className="settings-pages" aria-label="Settings pages">
          <div aria-hidden="true" className="settings-pages-fill" style={{ position: 'absolute', background: 'var(--color-border)' }} />
          {PAGES.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="settings-page-button"
              style={{ position: 'relative' }}
              aria-pressed={subTab === p.id}
              onClick={() => onSubTabChange(p.id)}
              onKeyDown={(e) => {
                const next = e.key === 'Home' ? PAGES[0] : e.key === 'End' ? PAGES[1] : e.key === 'ArrowRight' || e.key === 'ArrowLeft' ? PAGES[1 - i] : null
                if (next) {
                  e.preventDefault()
                  e.stopPropagation()
                  onSubTabChange(next.id)
                }
              }}
            >
              <span className="settings-page-label">{p.label}</span>
            </button>
          ))}
        </fieldset>
        {subTab === 'audio' && <AudioPage />}
        {subTab === 'keybinds' && <KeybindingsPage readOnly={readOnly} />}
      </div>
    </div>
  )
}
