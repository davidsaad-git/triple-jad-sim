/**
 * Resource-pack sprites used by the menus (reset button, equipment slot
 * silhouettes, orb icons), resolved through CLIENT-UI's pack resolver
 * (src/ui/packs `usePackAsset`, scim with the Vanilla fallback).
 */
import { useState, type CSSProperties } from 'react'
import { usePackAsset } from '../packs'

export const PACK_PATHS = {
  
  resetEnabled: 'other/reset_killcount_button_hovered.png',
  resetDisabled: 'other/reset_killcount_button.png',
  
  slot: {
    head: 'equipment-slots/slot_head.png',
    body: 'equipment-slots/slot_torso.png',
    legs: 'equipment-slots/slot_legs.png',
    weapon: 'equipment-slots/slot_weapon.png',
    shield: 'equipment-slots/slot_shield.png',
    cape: 'equipment-slots/slot_cape.png',
    amulet: 'equipment-slots/slot_neck.png',
    ammo: 'equipment-slots/slot_ammunition.png',
    hands: 'equipment-slots/slot_hands.png',
    boots: 'equipment-slots/slot_feet.png',
    ring: 'equipment-slots/slot_ring.png',
  } as Record<string, string>,
  
  orb: {
    hitpoints: 'other/minimap_orb_hitpoints_icon.png',
    prayer: 'other/minimap_orb_prayer_icon.png',
    run: 'other/minimap_orb_run_icon.png',
    special: 'other/minimap_orb_special_icon.png',
  } as Record<string, string>,
} as const

export function PackImg({ path, className, style, alt = '' }: { path: string; className?: string; style?: CSSProperties; alt?: string }) {
  const src = usePackAsset(path)
  const [broken, setBroken] = useState<string | null>(null)
  return (
    <img
      crossOrigin="anonymous"
      className={className}
      style={{ imageRendering: 'pixelated', ...style, ...(broken === src ? { opacity: 0 } : {}) }}
      src={src}
      alt={alt}
      draggable={false}
      onError={() => setBroken(src)}
    />
  )
}
