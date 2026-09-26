/**
 * Resource pack resolution.
 *
 * `packAsset(path)` returns `/assets/ui/packs/<active>/<path>` when the active
 * pack is Vanilla or the pack ships that file, else the Vanilla copy, so
 * pack-vanilla must contain every file the chrome uses. Which files each
 * non-vanilla pack ships comes from scripts/build-ui-assets.ts
 * (packFiles.generated.ts = scim's whitelist ∩ files actually built).
 */
import { settingsStore, useSetting, type ResourcePackId } from '../../app/settings/settings'
import { PACK_FILES } from './packFiles.generated'

export interface ResourcePackInfo {
  id: ResourcePackId
  name: string
  description: string
  author?: string
  authorUrl?: string
}

/** scim, in its order. */
export const RESOURCE_PACKS: readonly ResourcePackInfo[] = [
  { id: 'pack-vanilla', name: 'Vanilla', description: 'Default OSRS interface' },
  { id: 'pack-browntown', name: 'Brown Theme', description: 'Warm brown classic OSRS look', author: 'Nichy' },
  { id: 'pack-toblite', name: 'TOBLite', description: 'Theatre of Blood inspired dark theme', author: 'Sayolko', authorUrl: 'https://sayolko.framer.website' },
  { id: 'pack-duckscape', name: 'Duckscape', description: 'Playful duck-themed interface', author: 'Sayolko', authorUrl: 'https://sayolko.framer.website' },
]

export const DEFAULT_PACK: ResourcePackId = 'pack-browntown'
export const VANILLA_PACK: ResourcePackId = 'pack-vanilla'

const PACK_FILE_SETS: ReadonlyMap<string, ReadonlySet<string>> = new Map(Object.entries(PACK_FILES).map(([k, v]) => [k, new Set(v)]))

/** Known pack id or Vanilla (scim: unknown ids fall back to Vanilla). */
export function resolvePackId(id: string | null | undefined): ResourcePackId {
  return RESOURCE_PACKS.some((p) => p.id === id) ? (id as ResourcePackId) : VANILLA_PACK
}

/** Vite base URL ('/' in dev), always ending in '/'. */
import { publicUrl } from '../../app/publicUrl'
export { baseUrl, publicUrl } from '../../app/publicUrl'

/** True when `pack` ships its own copy of `path`. */
export function packHasFile(pack: string, path: string): boolean {
  if (pack === VANILLA_PACK) return true
  return PACK_FILE_SETS.get(pack)?.has(path) ?? false
}

/** The pack folder `path` resolves to for `pack`. */
export function resolvePackFolder(path: string, pack: string): ResourcePackId {
  const id = resolvePackId(pack)
  return packHasFile(id, path) ? id : VANILLA_PACK
}

/** URL of a pack sprite, with the Vanilla fallback. `pack` defaults to the active setting. */
export function packAsset(path: string, pack: string = settingsStore.get().activeResourcePack): string {
  return publicUrl(`assets/ui/packs/${resolvePackFolder(path, pack)}/${path}`)
}

/** Vanilla URL of a pack path, independent of the active pack (scim hard-codes a few). */
export function vanillaAsset(path: string): string {
  return publicUrl(`assets/ui/packs/${VANILLA_PACK}/${path}`)
}

/** Item icon URL (`/assets/items/<id>.png`, not pack-dependent; scim). */
export function itemIconUrl(itemId: number): string {
  return publicUrl(`assets/items/${itemId}.png`)
}

/** Non-pack UI asset URL (`/assets/ui/<path>`). */
export function uiAsset(path: string): string {
  return publicUrl(`assets/ui/${path}`)
}

/** React: the active resource pack (re-renders on change). */
export function useActivePack(): ResourcePackId {
  return resolvePackId(useSetting('activeResourcePack'))
}

/** React: a pack sprite URL that follows the active pack. */
export function usePackAsset(path: string): string {
  const pack = useActivePack()
  return packAsset(path, pack)
}

/** Every pack path the chrome draws (the preloader warms these; tests check Vanilla has them). */
export const CHROME_PACK_PATHS: readonly string[] = [
  'panel/side_panel_background.png',
  'panel/side_panel_edge_left.png',
  'panel/side_panel_edge_right.png',
  'other/old_school_mode_side_panel_edge_left_upper.png',
  'other/old_school_mode_side_panel_edge_left_lower.png',
  'other/old_school_mode_side_panel_edge_right.png',
  'panel/fixed_mode_side_panel_background.png',
  'panel/fixed_mode_tabs_top_row.png',
  'panel/fixed_mode_tabs_row_bottom.png',
  'panel/fixed_mode_window_frame_edge_top.png',
  'other/window_frame_edge_left.png',
  'panel/fixed_mode_top_right_corner.png',
  'panel/tab_stone_middle.png',
  'panel/tab_stone_middle_selected.png',
  'tabs/stone_top_left_selected.png',
  'tabs/stone_top_right_selected.png',
  'tabs/stone_bottom_left_selected.png',
  'tabs/stone_bottom_right_selected.png',
  'tabs/stone_middle_selected.png',
  'panel/tabs_top_row.png',
  'panel/tabs_bottom_row.png',
  'dialog/bottom_line_mode_side_panel_corner_top_left.png',
  'dialog/bottom_line_mode_side_panel_corner_top_right.png',
  'dialog/bottom_line_mode_side_panel_corner_bottom_left.png',
  'dialog/bottom_line_mode_side_panel_corner_bottom_right.png',
  'dialog/bottom_line_mode_side_panel_edge_top.png',
  'dialog/bottom_line_mode_side_panel_edge_bottom.png',
  'dialog/bottom_line_mode_side_panel_edge_left.png',
  'dialog/bottom_line_mode_side_panel_edge_right.png',
  'prayer/activated_background.png',
  'prayer/icon_small.png',
  'options/round_check_box_checked_green.png',
  'options/round_check_box_crossed2.png',
  'options/round_check_box_checked.png',
  'options/slider_new_empty.png',
  'options/slider_new_left_caret.png',
  'options/slider_new_dot_darker.png',
  'options/slider_new_dot_regular.png',
  'options/slider_new_half_dot_left.png',
  'options/slider_new_half_dot_right.png',
  'options/slider_new_right_caret.png',
  'options/slider_new_dot_green.png',
  'other/reset_killcount_button.png',
  'other/reset_killcount_button_hovered.png',
  'stats/new_tile_left.png',
  'stats/new_tile_right_with_slash.png',
  'tabs/combat.png',
  'tabs/stats.png',
  'tabs/inventory.png',
  'tabs/equipment.png',
  'tabs/prayer.png',
  'tabs/magic.png',
  'tabs/options.png',
  'equipment-slots/slot_tile.png',
  'equipment-slots/slot_head.png',
  'equipment-slots/slot_cape.png',
  'equipment-slots/slot_neck.png',
  'equipment-slots/slot_ammunition.png',
  'equipment-slots/slot_weapon.png',
  'equipment-slots/slot_torso.png',
  'equipment-slots/slot_shield.png',
  'equipment-slots/slot_legs.png',
  'equipment-slots/slot_hands.png',
  'equipment-slots/slot_feet.png',
  'equipment-slots/slot_ring.png',
  'combat/auto_retaliate.png',
  'combat/auto_retaliate_selected.png',
  'buttons/middle.png',
  'buttons/corner_top_left.png',
  'buttons/corner_top_right.png',
  'buttons/corner_bottom_left.png',
  'buttons/corner_bottom_right.png',
  'buttons/edge_top.png',
  'buttons/edge_bottom.png',
  'buttons/edge_left.png',
  'buttons/edge_right.png',
  'buttons/middle_selected.png',
  'buttons/corner_top_left_selected.png',
  'buttons/corner_top_right_selected.png',
  'buttons/corner_bottom_left_selected.png',
  'buttons/corner_bottom_right_selected.png',
  'buttons/edge_top_selected.png',
  'buttons/edge_bottom_selected.png',
  'buttons/edge_left_selected.png',
  'buttons/edge_right_selected.png',
  'buttons/equipment_edge_top.png',
  'buttons/equipment_edge_bottom.png',
  'buttons/equipment_edge_left.png',
  'buttons/equipment_edge_right.png',
  'buttons/equipment_metal_corner_top_left.png',
  'buttons/equipment_metal_corner_top_right.png',
  'buttons/equipment_metal_corner_bottom_left.png',
  'buttons/equipment_metal_corner_bottom_right.png',
  'buttons/equipment_stats_icon.png',
  'buttons/equipment_guide_prices.png',
  'buttons/equipment_items_lost_on_death.png',
  'buttons/equipment_call_follower.png',
  'dialog/iron_rivets_vertical.png',
  'dialog/iron_rivets_horizontal.png',
  'scrollbar/arrow_up.png',
  'scrollbar/arrow_down.png',
  'scrollbar/thumb_top.png',
  'scrollbar/thumb_middle.png',
  'scrollbar/thumb_bottom.png',
  'scrollbar/thumb_middle_dark.png',
  'chatbox/chat_background.png',
  'chatbox/chatbox_buttons_background_stones.png',
  'chatbox/chatbox_button.png',
  'chatbox/chatbox_button_hovered.png',
  'chatbox/chatbox_button_selected.png',
  'chatbox/chatbox_button_selected_hovered.png',
  'chatbox/chatbox_report_button.png',
  'chatbox/chatbox_report_button_hovered.png',
  'panel/minimap_and_compass_frame.png',
  'panel/fixed_mode_minimap_and_compass_frame.png',
  'panel/fixed_mode_minimap_left_edge.png',
  'panel/fixed_mode_minimap_right_edge.png',
  'panel/fixed_mode_minimap_frame_bottom.png',
  'other/compass.png',
  'other/minimap_orb_frame.png',
  'other/minimap_orb_frame_hovered.png',
  'other/minimap_orb_xp.png',
  'other/minimap_orb_xp_activated.png',
  'other/minimap_orb_xp_hovered.png',
  'other/minimap_orb_xp_activated_hovered.png',
  'other/minimap_orb_empty.png',
  'other/minimap_orb_hitpoints.png',
  'other/minimap_orb_hitpoints_poison.png',
  'other/minimap_orb_hitpoints_venom.png',
  'other/minimap_orb_prayer.png',
  'other/minimap_orb_prayer_activated.png',
  'other/minimap_orb_run.png',
  'other/minimap_orb_run_activated.png',
  'other/minimap_orb_special.png',
  'other/minimap_orb_special_activated.png',
  'other/minimap_orb_hitpoints_icon.png',
  'other/minimap_orb_hitpoints_low_life_icon.png',
  'other/minimap_orb_prayer_icon.png',
  'other/minimap_orb_prayer_icon_activated.png',
  'other/minimap_orb_run_icon.png',
  'other/minimap_orb_run_icon_activated.png',
  'other/minimap_orb_special_icon.png',
]
