import { useState } from 'react'
import { LAST_WAVE } from '../../data/inferno/waves'
import { LOADOUT_PRESETS } from '../../engine/Loadout'
import './menu.css'

export interface EncounterConfig {
  wave: number
  preset: string
  infiniteHealth: boolean
  infinitePrayer: boolean
}

export interface EncountersDialogProps {
  initial: EncounterConfig
  onStart: (config: EncounterConfig) => void
  onClose: () => void
}

const QUICK_WAVES = [1, 9, 18, 35, 50, 62, 66, 67, 68, 69]

export function EncountersDialog({ initial, onStart, onClose }: EncountersDialogProps) {
  const [config, setConfig] = useState<EncounterConfig>(initial)
  const update = (patch: Partial<EncounterConfig>) => setConfig((c) => ({ ...c, ...patch }))
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <div>
            <div className="dialog__title">The Inferno</div>
            <div className="dialog__subtitle">TzKal-Zuk · Waves 1-69</div>
          </div>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="dialog__body">
          <section className="dialog__section">
            <div className="dialog__label">Start wave</div>
            <div className="wave-picker">
              {QUICK_WAVES.map((w) => (
                <button key={w} type="button" className={`chip${config.wave === w ? ' chip--active' : ''}`} onClick={() => update({ wave: w })}>
                  {w === 67 ? 'Jad' : w === 68 ? 'Triple Jad' : w === 69 ? 'Zuk' : w}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={LAST_WAVE}
                value={config.wave}
                className="wave-input"
                onChange={(e) => update({ wave: Math.max(1, Math.min(LAST_WAVE, Number(e.target.value) || 1)) })}
              />
            </div>
          </section>
          <section className="dialog__section">
            <div className="dialog__label">Loadout</div>
            <div className="wave-picker">
              {Object.keys(LOADOUT_PRESETS).map((name) => (
                <button key={name} type="button" className={`chip${config.preset === name ? ' chip--active' : ''}`} onClick={() => update({ preset: name })}>
                  {name}
                </button>
              ))}
            </div>
          </section>
          <section className="dialog__section">
            <div className="dialog__label">Mechanics</div>
            <label className="toggle">
              <input type="checkbox" checked={config.infiniteHealth} onChange={(e) => update({ infiniteHealth: e.target.checked })} />
              Infinite health
            </label>
            <label className="toggle">
              <input type="checkbox" checked={config.infinitePrayer} onChange={(e) => update({ infinitePrayer: e.target.checked })} />
              Infinite prayer
            </label>
          </section>
        </div>
        <div className="dialog__footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => onStart(config)}>
            Start Encounter
          </button>
        </div>
      </div>
    </div>
  )
}
