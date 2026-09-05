import { useStore } from '../../../app/GameStore'
import { hudStore } from '../../../app/HudState'
import './panels.css'

export function CombatPanel() {
  const spec = useStore(hudStore, (s) => s.specialEnergy)
  return (
    <div className="combat">
      <div className="combat__weapon">Unarmed</div>
      <div className="combat__styles">
        <button type="button" className="combat__style combat__style--active">Accurate</button>
        <button type="button" className="combat__style">Rapid</button>
        <button type="button" className="combat__style">Longrange</button>
        <button type="button" className="combat__style" disabled />
      </div>
      <div className="combat__toggle">
        <span>Auto Retaliate</span>
        <span className="panel-muted">Off</span>
      </div>
      <div className="combat__special" title="Special attack">
        <div className="combat__special-fill" style={{ width: `${spec}%` }} />
        <span className="combat__special-text">Special Attack: {spec}%</span>
      </div>
    </div>
  )
}
