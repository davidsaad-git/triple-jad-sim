import type { ClientLayout } from '../client/ClientFrame'
import './menu.css'

export interface SettingsValues {
  layout: ClientLayout
  playbackSpeed: number
  brightness: number
}

export function SettingsDialog({ values, onChange, onClose }: { values: SettingsValues; onChange: (v: SettingsValues) => void; onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <div>
            <div className="dialog__title">Settings</div>
            <div className="dialog__subtitle">Display · Simulation</div>
          </div>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="dialog__body">
          <section className="dialog__section">
            <div className="dialog__label">Layout</div>
            <div className="wave-picker">
              {(['fixed', 'resizable-classic', 'resizable-modern'] as ClientLayout[]).map((l) => (
                <button key={l} type="button" className={`chip${values.layout === l ? ' chip--active' : ''}`} onClick={() => onChange({ ...values, layout: l })}>
                  {l === 'fixed' ? 'Fixed' : l === 'resizable-classic' ? 'Resizable - Classic' : 'Resizable - Modern'}
                </button>
              ))}
            </div>
          </section>
          <section className="dialog__section">
            <div className="dialog__label">Playback speed</div>
            <div className="wave-picker">
              {[0.5, 1, 2].map((s) => (
                <button key={s} type="button" className={`chip${values.playbackSpeed === s ? ' chip--active' : ''}`} onClick={() => onChange({ ...values, playbackSpeed: s })}>
                  {s}x
                </button>
              ))}
            </div>
          </section>
          <section className="dialog__section">
            <div className="dialog__label">Brightness ({values.brightness.toFixed(2)})</div>
            <input type="range" min={0.4} max={1.6} step={0.05} value={values.brightness} onChange={(e) => onChange({ ...values, brightness: Number(e.target.value) })} />
          </section>
        </div>
        <div className="dialog__footer">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
