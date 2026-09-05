import './panels.css'

const SKILLS = [
  'Attack', 'Hitpoints', 'Mining', 'Strength', 'Agility', 'Smithing', 'Defence', 'Herblore', 'Fishing',
  'Ranged', 'Thieving', 'Cooking', 'Prayer', 'Crafting', 'Firemaking', 'Magic', 'Fletching', 'Woodcutting',
  'Runecraft', 'Slayer', 'Farming', 'Construction', 'Hunter', 'Sailing',
]

export function StatsPanel() {
  return (
    <div className="stats">
      {SKILLS.map((name) => (
        <div key={name} className="stat" title={name}>
          <span className="stat__name">{name.slice(0, 3)}</span>
          <span>99/99</span>
        </div>
      ))}
    </div>
  )
}
