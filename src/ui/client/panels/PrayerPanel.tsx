import { useStore } from '../../../app/GameStore'
import { hudStore, type UiActions } from '../../../app/HudState'
import { PRAYERS } from '../../../data/prayers'
import './panels.css'

const ABBREV: Record<string, string> = {
  protectFromMagic: 'PMag',
  protectFromMissiles: 'PRng',
  protectFromMelee: 'PMel',
  rigour: 'Rig',
  augury: 'Aug',
  piety: 'Pie',
  eagleEye: 'Eag',
  mysticMight: 'MyM',
  deadeye: 'Dead',
  mysticVigour: 'MyV',
  redemption: 'Red',
  retribution: 'Ret',
  smite: 'Smi',
  chivalry: 'Chiv',
  steelSkin: 'Steel',
  ultimateStrength: 'Ult',
  incredibleReflexes: 'Inc',
  preserve: 'Pres',
  rapidHeal: 'RHeal',
  rapidRestore: 'RRest',
  protectItem: 'PItm',
  hawkEye: 'Hawk',
  mysticLore: 'MyL',
  thickSkin: 'Thk',
  burstOfStrength: 'Brst',
  clarityOfThought: 'Clar',
  sharpEye: 'Shrp',
  mysticWill: 'MyW',
  rockSkin: 'Rock',
  superhumanStrength: 'Sup',
  improvedReflexes: 'Imp',
}

/** Order the prayer book shows them (rows of 5). */
const BOOK_ORDER = [
  'thickSkin', 'burstOfStrength', 'clarityOfThought', 'sharpEye', 'mysticWill',
  'rockSkin', 'superhumanStrength', 'improvedReflexes', 'rapidRestore', 'rapidHeal',
  'protectItem', 'hawkEye', 'mysticLore', 'steelSkin', 'ultimateStrength',
  'incredibleReflexes', 'protectFromMagic', 'protectFromMissiles', 'protectFromMelee', 'eagleEye',
  'mysticMight', 'retribution', 'redemption', 'smite', 'preserve',
  'chivalry', 'piety', 'rigour', 'augury', 'deadeye', 'mysticVigour',
] as const

export function PrayerPanel({ actions }: { actions: UiActions }) {
  const active = useStore(hudStore, (s) => s.activePrayers)
  const points = useStore(hudStore, (s) => s.prayerPoints)
  const max = useStore(hudStore, (s) => s.maxPrayerPoints)
  const activeSet = new Set(active)
  return (
    <div>
      <div className="prayers">
        {BOOK_ORDER.map((key) => {
          const def = PRAYERS.find((p) => p.key === key)!
          const locked = def.level > max
          return (
            <button
              key={key}
              type="button"
              className={`prayer${activeSet.has(key) ? ' prayer--active' : ''}${locked ? ' prayer--locked' : ''}`}
              title={`${def.name} (level ${def.level})`}
              onClick={() => !locked && actions.togglePrayer(key)}
            >
              <span className="prayer__icon">{ABBREV[key] ?? def.name.slice(0, 4)}</span>
            </button>
          )
        })}
      </div>
      <div className="prayer-points">
        {points} / {max}
      </div>
    </div>
  )
}
