import { useStore } from '../app/GameStore'
import { overlayStore } from '../app/OverlayState'
import './ViewportOverlay.css'

/** DOM layer over the 3D viewport: hitsplats, health bars, overheads, wave text. */
export function ViewportOverlay() {
  const snap = useStore(overlayStore, (s) => s)
  return (
    <div className="viewport-overlay">
      {snap.actors.map((a) => (
        <div key={a.id} className="ov-actor" style={{ left: a.x, top: a.headY }}>
          {a.overhead && <div className="ov-overhead" data-prayer={a.overhead} />}
          {a.inCombat && (
            <div className="ov-healthbar">
              <div className="ov-healthbar__fill" style={{ width: `${Math.max(0, Math.min(100, (a.hitpoints / Math.max(1, a.maxHitpoints)) * 100))}%` }} />
            </div>
          )}
          {a.hitsplats.map((h, i) => (
            <div key={i} className={`ov-hitsplat ov-hitsplat--${h.kind}`} style={{ top: 20 + i * 18 }}>
              {h.amount}
            </div>
          ))}
        </div>
      ))}
      {snap.boss && (
        <div className="ov-boss">
          <div className="ov-boss__name">
            {snap.boss.name} <span className="ov-boss__hp">{snap.boss.hitpoints} / {snap.boss.maxHitpoints}</span>
          </div>
          <div className="ov-boss__bar">
            <div className="ov-boss__fill" style={{ width: `${(snap.boss.hitpoints / snap.boss.maxHitpoints) * 100}%` }} />
          </div>
        </div>
      )}
      {snap.setTimerTicks >= 0 && (
        <div className="ov-set-timer" title="Next Zuk set">
          Set in {formatTicks(snap.setTimerTicks)}
        </div>
      )}
      <div className="ov-wave">
        {snap.wave > 0 && (
          <>
            <div className="ov-wave__title">Wave {snap.wave}</div>
            {snap.spawnCountdown >= 0 && <div className="ov-wave__sub">Spawning in {snap.spawnCountdown}</div>}
            {snap.phase === 'waveCleared' && <div className="ov-wave__sub">Wave cleared</div>}
            {snap.phase === 'defeat' && <div className="ov-wave__sub ov-wave__sub--bad">You have been defeated</div>}
            {snap.phase === 'victory' && <div className="ov-wave__sub">Inferno complete!</div>}
          </>
        )}
      </div>
    </div>
  )
}

function formatTicks(ticks: number): string {
  const totalSeconds = Math.ceil((ticks * 600) / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
