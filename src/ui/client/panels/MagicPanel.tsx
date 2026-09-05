import './panels.css'

export function MagicPanel() {
  return (
    <div>
      <div className="panel-title">Arceuus</div>
      <div className="spells">
        {['DC', 'Res', 'Thr', 'Vile', 'Dark', 'Ward'].map((s) => (
          <span key={s} className="spell" title={s}>
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}
