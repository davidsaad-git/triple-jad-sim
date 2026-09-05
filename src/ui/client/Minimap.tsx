import { useStore } from '../../app/GameStore'
import { hudStore, type UiActions } from '../../app/HudState'
import './Minimap.css'

export function Minimap({ actions }: { actions: UiActions }) {
  const hp = useStore(hudStore, (s) => s.hitpoints)
  const maxHp = useStore(hudStore, (s) => s.maxHitpoints)
  const prayer = useStore(hudStore, (s) => s.prayerPoints)
  const maxPrayer = useStore(hudStore, (s) => s.maxPrayerPoints)
  const run = useStore(hudStore, (s) => s.runEnergy)
  const running = useStore(hudStore, (s) => s.running)
  const spec = useStore(hudStore, (s) => s.specialEnergy)
  const compass = useStore(hudStore, (s) => s.compass)
  const anyPrayer = useStore(hudStore, (s) => s.activePrayers.length > 0)

  return (
    <div className="minimap">
      <div className="minimap__compass" style={{ transform: `rotate(${(compass / 2048) * 360}deg)` }} title="Compass">
        N
      </div>
      <div className="minimap__map" />
      <Orb className="orb--hp" value={hp} max={maxHp} title="Hitpoints" color="#22c55e" low={hp <= Math.floor(maxHp * 0.2)} />
      <Orb className="orb--prayer" value={prayer} max={maxPrayer} title="Prayer" color="#7dd3fc" active={anyPrayer} onClick={actions.toggleQuickPrayers} />
      <Orb className="orb--run" value={run} max={100} title={running ? 'Run (on)' : 'Run (off)'} color="#facc15" active={running} onClick={actions.toggleRun} />
      <Orb className="orb--spec" value={spec} max={100} title="Special attack" color="#38bdf8" />
    </div>
  )
}

function Orb({
  className,
  value,
  max,
  title,
  color,
  active,
  low,
  onClick,
}: {
  className: string
  value: number
  max: number
  title: string
  color: string
  active?: boolean
  low?: boolean
  onClick?: () => void
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <button type="button" className={`orb ${className}${active ? ' orb--active' : ''}${low ? ' orb--low' : ''}`} title={title} onClick={onClick}>
      <span className="orb__value">{Math.round(value)}</span>
      <span className="orb__globe">
        <span className="orb__fill" style={{ height: `${fraction * 100}%`, background: color }} />
      </span>
    </button>
  )
}
