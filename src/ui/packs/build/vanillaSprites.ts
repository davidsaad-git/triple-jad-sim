/**
 * Where every file of scim.gg's resource pack comes from in the
 * OSRS cache (OpenRS2 #2720). scim's Vanilla pack is the game's own sprites
 * saved under RuneLite resource-pack names; each entry below names the sprite
 * archive (index 8) and frame, or a small composition.
 *
 * How the ids were identified (scripts in the CLIENT-UI report):
 * - interface definitions decoded from index 3 (548 fixed toplevel, 161/164
 *   resizable toplevels, 160 orbs, 387 equipment, 593 combat) give the exact
 *   sprite each component draws;
 * - dbtable 213 (skill guide rows) gives the spell and prayer icon ids by name;
 * - everything else was matched against the RuneLite resource packs in
 *   .reference/assets/packs (same file names, same pixel sizes) and checked by
 *   eye on contact sheets.
 */

export type SpriteSource =
  | { kind: 'sprite'; id: number; frame?: number }
  /** Composite onto a transparent `w x h` canvas; flips apply per layer. */
  | { kind: 'compose'; w: number; h: number; layers: { id: number; frame?: number; x: number; y: number; flipH?: boolean; flipV?: boolean }[] }

const s = (id: number, frame = 0): SpriteSource => ({ kind: 'sprite', id, frame })
const flipped = (id: number, flipH: boolean, flipV: boolean): SpriteSource => ({ kind: 'compose', w: 0, h: 0, layers: [{ id, x: 0, y: 0, flipH, flipV }] })

/** Prayer book icons (enabled sprite, disabled sprite) under scim's icon names. */
export const PRAYER_ICON_SPRITES: Readonly<Record<string, readonly [number, number]>> = {
  thick_skin: [115, 135],
  burst_of_strength: [116, 136],
  clarity_of_thought: [117, 137],
  rock_skin: [118, 138],
  superhuman_strength: [119, 139],
  improved_reflexes: [120, 140],
  rapid_restore: [121, 141],
  rapid_heal: [122, 142],
  protect_item: [123, 143],
  steel_skin: [124, 144],
  ultimate_strength: [125, 145],
  incredible_reflexes: [126, 146],
  protect_from_magic: [127, 147],
  protect_from_missiles: [128, 148],
  protect_from_melee: [129, 149],
  redemption: [130, 150],
  retribution: [131, 151],
  smite: [132, 152],
  sharp_eye: [133, 153],
  mystic_will: [134, 154],
  hawk_eye: [502, 506],
  mystic_lore: [503, 507],
  eagle_eye: [504, 508],
  mystic_might: [505, 509],
  chivalry: [945, 949],
  piety: [946, 950],
  preserve: [947, 951],
  rigour: [1420, 1424],
  augury: [1421, 1425],
  deadeye: [1422, 1426],
  mystic_vigour: [1423, 1427],
}

/** Stats-tab skill icons (25x25, "staticons"), scim's names. */
export const SKILL_ICON_SPRITES: Readonly<Record<string, number>> = {
  attack: 197,
  strength: 198,
  defence: 199,
  ranged: 200,
  prayer: 201,
  magic: 202,
  hitpoints: 203,
  agility: 204,
  herblore: 205,
  thieving: 206,
  crafting: 207,
  fletching: 208,
  mining: 209,
  smithing: 210,
  fishing: 211,
  cooking: 212,
  firemaking: 213,
  woodcutting: 214,
  runecraft: 215,
  slayer: 216,
  farming: 217,
  hunter: 220,
  construction: 221,
}

export interface SpellIconIds {
  /** 24x24 icon and its greyed-out variant. */
  small: number
  smallDisabled: number
  /** 40x40 "icon resizing" variants, when the cache has them. */
  large?: number
  largeDisabled?: number
}

function ancient(small: number): SpellIconIds {
  // Small disabled = +50; large = +1567, large disabled = +30 from large (1892-1945).
  return { small, smallDisabled: small + 50, large: small + 1567, largeDisabled: small + 1567 + 30 }
}

function arceuusA(small: number): SpellIconIds {
  // 1247-1271: disabled +25; large 2052-2076 (+805), large disabled +40.
  return { small, smallDisabled: small + 25, large: small + 805, largeDisabled: small + 805 + 40 }
}

function arceuusB(small: number): SpellIconIds {
  // 1300-1312: disabled +19; large 2077-2089 (+777), large disabled +40.
  return { small, smallDisabled: small + 19, large: small + 777, largeDisabled: small + 777 + 40 }
}

function arceuusC(small: number, large: number): SpellIconIds {
  // 1315-1318 and 2979-2984: disabled +19 / +6; large 2991-3000, large disabled +10.
  return { small, smallDisabled: small + (small >= 2979 ? 6 : 19), large, largeDisabled: large + 10 }
}

const HOME_TELEPORT: SpellIconIds = { small: 356, smallDisabled: 406, large: 1802 }
const MINIGAME_TELEPORT: SpellIconIds = { small: 7479, smallDisabled: 7480, large: 1808 }

/** Ancient Magicks icons under scim's icon names. Ids from dbtable 213. */
export const ANCIENT_SPELL_ICONS: Readonly<Record<string, SpellIconIds>> = {
  home_teleport: HOME_TELEPORT,
  minigame_teleport: MINIGAME_TELEPORT,
  ice_rush: ancient(325),
  ice_burst: ancient(326),
  ice_blitz: ancient(327),
  ice_barrage: ancient(328),
  smoke_rush: ancient(329),
  smoke_burst: ancient(330),
  smoke_blitz: ancient(331),
  smoke_barrage: ancient(332),
  blood_rush: ancient(333),
  blood_burst: ancient(334),
  blood_blitz: ancient(335),
  blood_barrage: ancient(336),
  shadow_rush: ancient(337),
  shadow_burst: ancient(338),
  shadow_blitz: ancient(339),
  shadow_barrage: ancient(340),
  paddewwa_teleport: ancient(341),
  senntisten_teleport: ancient(342),
  kharyrll_teleport: ancient(343),
  lassar_teleport: ancient(344),
  dareeyak_teleport: ancient(345),
  carrallangar_teleport: ancient(346),
  annakarl_teleport: ancient(347),
  ghorrock_teleport: ancient(348),
  teleport_to_target: { small: 359, smallDisabled: 409, large: 1799 },
}

/** Arceuus icons under scim's icon names (scim spells "ressurect"). Ids from dbtable 213. */
export const ARCEUUS_SPELL_ICONS: Readonly<Record<string, SpellIconIds>> = {
  home_teleport: { small: 1251, smallDisabled: 1276, large: 2056, largeDisabled: 2096 },
  minigame_teleport: MINIGAME_TELEPORT,
  basic_reanimation: arceuusA(1247),
  adept_reanimation: arceuusA(1248),
  expert_reanimation: arceuusA(1249),
  master_reanimation: arceuusA(1250),
  arceuus_library_teleport: arceuusA(1252),
  draynor_manor_teleport: arceuusA(1253),
  battlefront_teleport: arceuusA(1255),
  mind_altar_teleport: arceuusA(1256),
  respawn_teleport: arceuusA(1257),
  salve_graveyard_teleport: arceuusA(1258),
  fenkenstrains_castle_teleport: arceuusA(1259),
  west_ardougne_teleport: arceuusA(1260),
  harmony_island_teleport: arceuusA(1261),
  barrows_teleport: arceuusA(1262),
  ape_atoll_teleport: arceuusA(1263),
  cemetary_teleport: arceuusA(1264),
  reanimate_crops: arceuusA(1266),
  ghostly_grasp: arceuusA(1267),
  skeletal_grasp: arceuusA(1268),
  undead_grasp: arceuusA(1269),
  ressurect_lesser_ghost: arceuusA(1270),
  ressurect_lesser_skeleton: arceuusA(1271),
  ressurect_lesser_zombie: arceuusB(1300),
  inferior_demonbane: arceuusB(1302),
  superior_demonbane: arceuusB(1303),
  dark_demonbane: arceuusB(1304),
  mark_of_darkness: arceuusB(1305),
  ward_of_arceuus: arceuusB(1306),
  lesser_corruption: arceuusB(1307),
  greater_corruption: arceuusB(1308),
  death_charge: arceuusB(1310),
  demonic_offering: arceuusB(1311),
  sinister_offering: arceuusB(1312),
  shadow_veil: arceuusC(1315, 2991),
  dark_lure: arceuusC(1316, 2992),
  vile_vigour: arceuusC(1317, 2993),
  degrime: arceuusC(1318, 2994),
  ressurect_superior_ghost: arceuusC(2979, 2995),
  ressurect_greater_ghost: arceuusC(2980, 2996),
  ressurect_superior_skeleton: arceuusC(2981, 2997),
  ressurect_greater_skeleton: arceuusC(2982, 2998),
  ressurect_superior_zombie: arceuusC(2983, 2999),
  ressurect_greater_zombie: arceuusC(2984, 3000),
}

/**
 * Combat style icons (34x24, sprites 233-291) under scim's icon names (`gy`). Ranged/magic/unarmed ones are certain; several melee categories
 * are best-effort visual matches (see the CLIENT-UI report).
 */
export const COMBAT_STYLE_ICON_SPRITES: Readonly<Record<string, number>> = {
  // Axe (battleaxe)
  'axe_chop.png': 233,
  'axe_hack.png': 234,
  'axe_smash.png': 235,
  'axe_block.png': 236,
  // Slash sword (scimitar/longsword)
  'slash_sword_chop.png': 237,
  'slash_sword_slash.png': 238,
  'slash_sword_lunge.png': 239,
  'slash_sword_block.png': 240,
  // 2h sword
  '2h_chop.png': 237,
  '2h_slash.png': 238,
  '2h_smash.png': 252,
  '2h_block.png': 240,
  // Stab sword (dagger/rapier)
  'stab_sword_stab.png': 257,
  'stab_sword_lunge.png': 239,
  'stab_sword_slash.png': 238,
  'stab_sword_block.png': 240,
  // Spear
  'spear_lunge.png': 241,
  'spear_swipe.png': 242,
  'spear_pound.png': 252,
  'spear_block.png': 250,
  // Blunt (warhammer/maul)
  'blunt_pound.png': 243,
  'blunt_pummel.png': 244,
  'blunt_block.png': 256,
  // Bludgeon
  'bludgeon_pound.png': 253,
  'bludgeon_pummel.png': 254,
  'bludgeon_smash.png': 255,
  // Spiked (mace)
  'spiked_pound.png': 245,
  'spiked_pummel.png': 244,
  'spiked_spike.png': 246,
  'spiked_block.png': 256,
  // Claw
  'claw_chop.png': 273,
  'claw_slash.png': 274,
  'claw_lunge.png': 275,
  'claw_block.png': 276,
  // Pickaxe
  'pickaxe_spike.png': 261,
  'pickaxe_impale.png': 262,
  'pickaxe_smash.png': 271,
  'pickaxe_block.png': 272,
  // Scythe
  'scythe_reap.png': 277,
  'scythe_chop.png': 278,
  'scythe_jab.png': 279,
  'scythe_block.png': 280,
  // Polearm (halberd)
  'polearm_jab.png': 283,
  'polearm_swipe.png': 285,
  'polearm_fend.png': 284,
  // Partisan
  'partisan_stab.png': 241,
  'partisan_lunge.png': 266,
  'partisan_pound.png': 252,
  'partisan_block.png': 250,
  // Banner
  'banner_lunge.png': 241,
  'banner_swipe.png': 242,
  'banner_pound.png': 252,
  'banner_block.png': 250,
  // Bulwark
  'bulwark_pummel.png': 244,
  'bulwark_block.png': 288,
  // Whip
  'whip_flick.png': 286,
  'whip_lash.png': 287,
  'whip_deflect.png': 288,
  // Unarmed
  'unarmed_punch.png': 247,
  'unarmed_kick.png': 248,
  'unarmed_block.png': 249,
  // Bow / crossbow / thrown
  'bow_accurate.png': 268,
  'bow_rapid.png': 269,
  'bow_longrange.png': 270,
  'crossbow_accurate.png': 258,
  'crossbow_rapid.png': 259,
  'crossbow_longrange.png': 260,
  'thrown_accurate.png': 263,
  'thrown_rapid.png': 264,
  'thrown_longrange.png': 265,
  // Staff (melee styles) and casting; the combat interface's Spell buttons draw 780 (and 760 behind it for defensive).
  'staff_bash.png': 245,
  'staff_pound.png': 246,
  'staff_focus.png': 257,
  'staff_spell.png': 780,
  'staff_spell_defensive.png': 760,
  'powered_staff_accurate.png': 780,
  'powered_staff_longrange.png': 780,
}

function buildVanilla(): Record<string, SpriteSource> {
  const t: Record<string, SpriteSource> = {}
  // buttons/ stone button nine-slice (normal 1141-1149, selected 1150-1158)
  const nine = ['corner_top_left', 'edge_top', 'corner_top_right', 'edge_left', 'middle', 'edge_right', 'corner_bottom_left', 'edge_bottom', 'corner_bottom_right']
  nine.forEach((name, i) => {
    t[`buttons/${name}.png`] = s(1141 + i)
    t[`buttons/${name}_selected.png`] = s(1150 + i)
  })
  t['buttons/combat_style_narrow.png'] = s(293)
  t['buttons/combat_style_narrow_selected.png'] = s(294)
  t['buttons/combat_style_thin.png'] = s(295)
  t['buttons/combat_style_thin_selected.png'] = s(296)
  const eqFrame = ['equipment_metal_corner_top_left', 'equipment_metal_corner_top_right', 'equipment_metal_corner_bottom_left', 'equipment_metal_corner_bottom_right', 'equipment_edge_left', 'equipment_edge_top', 'equipment_edge_right', 'equipment_edge_bottom']
  eqFrame.forEach((name, i) => (t[`buttons/${name}.png`] = s(913 + i)))
  // interface 387 components 2/4/6/8
  t['buttons/equipment_stats_icon.png'] = s(675)
  t['buttons/equipment_guide_prices.png'] = s(1090)
  t['buttons/equipment_items_lost_on_death.png'] = s(912)
  t['buttons/equipment_call_follower.png'] = s(1343)

  t['chatbox/chat_background.png'] = s(1017)
  t['chatbox/chatbox_buttons_background_stones.png'] = s(1018)
  t['chatbox/chatbox_button.png'] = s(3051)
  t['chatbox/chatbox_button_hovered.png'] = s(3052)
  t['chatbox/chatbox_button_selected.png'] = s(3053)
  t['chatbox/chatbox_button_selected_hovered.png'] = s(3054)
  t['chatbox/chatbox_report_button.png'] = s(3057)
  t['chatbox/chatbox_report_button_hovered.png'] = s(3058)

  t['combat/auto_retaliate.png'] = s(1748)
  t['combat/auto_retaliate_selected.png'] = s(1749)

  t['dialog/background.png'] = s(297)
  t['dialog/background_brighter.png'] = s(1545)
  const side: Record<string, number> = {
    edge_top: 820,
    edge_left: 821,
    edge_bottom: 822,
    edge_right: 823,
    corner_top_left: 824,
    corner_top_right: 825,
    corner_bottom_left: 826,
    corner_bottom_right: 827,
    edge_horizontal: 828,
    intersection_left: 829,
    intersection_right: 830,
    intersection_bottom: 839,
    intersection_top: 840,
  }
  for (const [k, id] of Object.entries(side)) t[`dialog/bottom_line_mode_side_panel_${k}.png`] = s(id)
  const chatLines: Record<string, number> = {
    edge_vertical: 841,
    intersection_top: 842,
    intersection_bottom: 843,
    corner_top_left: 846,
    corner_top_right: 847,
    corner_bottom_left: 848,
    corner_bottom_right: 849,
    intersection_middle: 850,
  }
  for (const [k, id] of Object.entries(chatLines)) t[`dialog/bottom_line_mode_${k}.png`] = s(id)
  t['dialog/iron_rivets_vertical.png'] = s(172)
  t['dialog/iron_rivets_horizontal.png'] = s(173)
  t['dialog/iron_rivets_edge_top.png'] = s(314)
  t['dialog/iron_rivets_edge_right.png'] = s(315)
  t['dialog/iron_rivets_bottom.png'] = s(173)
  t['dialog/iron_rivets_corner_top_left.png'] = s(310)
  t['dialog/iron_rivets_corner_top_right.png'] = s(311)
  t['dialog/iron_rivets_corner_bottom_left.png'] = s(312)
  t['dialog/iron_rivets_corner_bottom_right.png'] = s(313)

  const slots: Record<string, number> = { head: 156, cape: 157, neck: 158, weapon: 159, ring: 160, torso: 161, shield: 162, legs: 163, hands: 164, feet: 165, ammunition: 166, tile: 170, selected: 179 }
  for (const [k, id] of Object.entries(slots)) t[`equipment-slots/slot_${k}.png`] = s(id)
  t['equipment-slots/weight.png'] = s(649)

  t['options/round_check_box.png'] = s(697)
  t['options/round_check_box_crossed.png'] = s(698)
  t['options/round_check_box_checked.png'] = s(699)
  t['options/round_check_box_crossed2.png'] = s(1212)
  t['options/round_check_box_checked_green.png'] = s(1213)
  t['options/checkbox_empty.png'] = s(180)
  t['options/checkbox_checked_red.png'] = s(181)
  t['options/square_check_box.png'] = s(1215)
  t['options/square_check_box_crossed.png'] = s(1216)
  t['options/square_check_box_checked.png'] = s(1217)
  const slider: Record<string, number> = {
    left_caret: 2852,
    dot_darker: 2853,
    dot_regular: 2854,
    empty: 2855,
    dot_lighter: 2856,
    right_caret: 2857,
    dot_blue: 2858,
    dot_green: 2860,
    half_dot_left: 2861,
    half_dot_right: 2862,
    just_dot: 2863,
  }
  for (const [k, id] of Object.entries(slider)) t[`options/slider_new_${k}.png`] = s(id)

  const other: Record<string, number> = {
    compass: 169,
    minimap_orb_empty: 1059,
    minimap_orb_frame: 1071,
    minimap_orb_frame_hovered: 1072,
    minimap_orb_frame_flashing: 2140,
    minimap_orb_frame_small: 2138,
    minimap_orb_frame_small_hovered: 2139,
    minimap_orb_hitpoints: 1060,
    minimap_orb_hitpoints_poison: 1061,
    minimap_orb_hitpoints_disease: 1062,
    minimap_orb_hitpoints_venom: 1102,
    minimap_orb_prayer: 1063,
    minimap_orb_prayer_activated: 1066,
    minimap_orb_run: 1064,
    minimap_orb_run_activated: 1065,
    minimap_orb_special: 1607,
    minimap_orb_special_activated: 1608,
    minimap_orb_hitpoints_icon: 1067,
    minimap_orb_hitpoints_low_life_icon: 3017,
    minimap_orb_prayer_icon: 1068,
    minimap_orb_prayer_icon_activated: 1058,
    minimap_orb_run_icon: 1069,
    minimap_orb_run_icon_activated: 1070,
    minimap_orb_run_icon_slowed_depletion: 1092,
    minimap_orb_special_icon: 1610,
    minimap_orb_world_map_frame: 1438,
    minimap_orb_world_map_planet: 1439,
    minimap_orb_world_map_planet_hovered: 1440,
    minimap_orb_xp: 1196,
    minimap_orb_xp_activated: 1197,
    minimap_orb_xp_hovered: 1198,
    minimap_orb_xp_activated_hovered: 1199,
    old_school_mode_side_panel_edge_left_upper: 1033,
    old_school_mode_side_panel_edge_left_lower: 1034,
    old_school_mode_side_panel_edge_right: 1035,
    reset_killcount_button: 1428,
    reset_killcount_button_hovered: 1429,
    window_close_button: 535,
    window_close_button_hovered: 536,
    window_frame_edge_left: 4,
  }
  for (const [k, id] of Object.entries(other)) t[`other/${k}.png`] = s(id)

  const panel: Record<string, number> = {
    fixed_mode_minimap_and_compass_frame: 1182,
    fixed_mode_minimap_frame_bottom: 1611,
    fixed_mode_minimap_left_edge: 1037,
    fixed_mode_minimap_right_edge: 1038,
    fixed_mode_side_panel_background: 1031,
    fixed_mode_tabs_row_bottom: 1032,
    fixed_mode_tabs_top_row: 1036,
    fixed_mode_top_right_corner: 1441,
    fixed_mode_window_frame_edge_top: 1039,
    minimap_and_compass_frame: 1177,
    side_panel_background: 897,
    side_panel_edge_left: 1175,
    side_panel_edge_right: 1176,
    tab_stone_middle: 1180,
    tab_stone_middle_selected: 1181,
    tabs_top_row: 1173,
    tabs_bottom_row: 1174,
  }
  for (const [k, id] of Object.entries(panel)) t[`panel/${k}.png`] = s(id)

  t['prayer/activated_background.png'] = s(155)
  t['prayer/icon_small.png'] = s(651)
  for (const [name, [on, off]] of Object.entries(PRAYER_ICON_SPRITES)) {
    t[`prayer/${name}.png`] = s(on)
    t[`prayer/${name}_disabled.png`] = s(off)
  }

  t['scrollbar/arrow_up.png'] = s(773)
  t['scrollbar/arrow_down.png'] = s(788)
  t['scrollbar/thumb_top.png'] = s(789)
  t['scrollbar/thumb_middle.png'] = s(790)
  t['scrollbar/thumb_bottom.png'] = s(791)
  t['scrollbar/thumb_middle_dark.png'] = s(792)

  for (const [name, id] of Object.entries(SKILL_ICON_SPRITES)) t[`skill/${name}.png`] = s(id)
  t['stats/new_tile_left.png'] = s(187)
  t['stats/new_tile_right_with_slash.png'] = s(188)

  t['tabs/combat.png'] = s(168)
  t['tabs/stats.png'] = s(898)
  t['tabs/inventory.png'] = s(900)
  t['tabs/equipment.png'] = s(901)
  t['tabs/prayer.png'] = s(902)
  t['tabs/magic.png'] = s(903)
  t['tabs/options.png'] = s(908)
  // Fixed-mode selected stones: this cache ships 1027-1030 fully transparent
  // (the client flips 1026 instead), so build the five from 1026 / 1181.
  t['tabs/stone_top_left_selected.png'] = s(1026)
  t['tabs/stone_top_right_selected.png'] = flipped(1026, true, false)
  t['tabs/stone_bottom_left_selected.png'] = flipped(1026, false, true)
  t['tabs/stone_bottom_right_selected.png'] = flipped(1026, true, true)
  t['tabs/stone_middle_selected.png'] = { kind: 'compose', w: 38, h: 36, layers: [{ id: 1181, x: 0, y: 0 }] }

  const spellFiles = (book: string, icons: Readonly<Record<string, SpellIconIds>>): void => {
    for (const [name, ids] of Object.entries(icons)) {
      t[`spells/${book}/${name}.png`] = s(ids.small)
      t[`spells/${book}/${name}_disabled.png`] = s(ids.smallDisabled)
      if (ids.large !== undefined) t[`spells/${book}/${name}_resized.png`] = s(ids.large)
      if (ids.largeDisabled !== undefined) t[`spells/${book}/${name}_disabled_resized.png`] = s(ids.largeDisabled)
      else if (ids.large !== undefined) t[`spells/${book}/${name}_disabled_resized.png`] = s(ids.large)
    }
  }
  spellFiles('ancient_spell', ANCIENT_SPELL_ICONS)
  spellFiles('arceuus_spell', ARCEUUS_SPELL_ICONS)
  return t
}

/** Every file of `/assets/ui/packs/pack-vanilla/`, keyed by its path inside the pack. */
export const VANILLA_SPRITES: Readonly<Record<string, SpriteSource>> = buildVanilla()

/** Non-pack UI assets under `/assets/ui/` (scim's fixed paths). */
export const UI_ASSET_SPRITES: Readonly<Record<string, SpriteSource>> = (() => {
  const t: Record<string, SpriteSource> = {}
  // Overhead health bars (health bar configs 2 / 17 / 20 and the yellow/dark 32 / 34 / 37).
  t['healthbar/default_front_40px.png'] = s(2431)
  t['healthbar/default_back_40px.png'] = s(2432)
  t['healthbar/default_front_60px.png'] = s(2180)
  t['healthbar/default_back_60px.png'] = s(2181)
  t['healthbar/default_front_120px.png'] = s(2186)
  t['healthbar/default_back_120px.png'] = s(2187)
  t['healthbar/yellow_front_40px.png'] = s(2471)
  t['healthbar/dark_back_40px.png'] = s(2472)
  t['healthbar/yellow_front_60px.png'] = s(2475)
  t['healthbar/dark_back_60px.png'] = s(2476)
  t['healthbar/yellow_front_120px.png'] = s(2481)
  t['healthbar/dark_back_120px.png'] = s(2482)
  // Hitsplats (hitsplat configs 26/28/3/6/4 backgrounds).
  t['hitsplat-block.png'] = s(1358)
  t['hitsplat-damage.png'] = s(1359)
  t['hitsplat-poison.png'] = s(1360)
  t['hitsplat-heal.png'] = s(1629)
  t['hitsplat-burn.png'] = s(1633)
  t['hitsplat-venom.png'] = s(1632)
  // Overhead prayer icons (sprite group 440: 0 melee, 1 missiles, 2 magic, 5 redemption).
  t['overhead_melee.png'] = s(440, 0)
  t['overhead_missiles.png'] = s(440, 1)
  t['overhead_magic.png'] = s(440, 2)
  t['overhead_redemption.png'] = s(440, 5)
  // Infobox / XP drop skill icons.
  for (const skill of ['attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints', 'prayer']) t[`skill-${skill}.png`] = s(SKILL_ICON_SPRITES[skill]!)
  // Equipment tab legacy icons.
  t['equipment/equipment-stats.png'] = s(675)
  t['equipment/guide-prices.png'] = s(1090)
  t['equipment/items-kept-on-death.png'] = s(912)
  t['equipment/call-follower.png'] = s(1343)
  // Legacy single-file chrome icons the preloader warms.
  t['combat-icon.png'] = s(168)
  t['inventory-icon.png'] = s(900)
  t['equipment-icon.png'] = s(901)
  t['prayer-icon.png'] = s(902)
  t['spellbook-icon.png'] = s(903)
  t['settings-icon.png'] = s(908)
  t['compass.png'] = s(169)
  t['minimap-frame.png'] = s(1177)
  t['hitpoints-orb.png'] = s(1060)
  t['prayer-orb.png'] = s(1063)
  t['prayer-orb-active.png'] = s(1066)
  t['run-orb.png'] = s(1064)
  t['run-orb-active.png'] = s(1065)
  t['special-orb.png'] = s(1607)
  t['special-orb-active.png'] = s(1608)
  t['prayer-orb-frame0.png'] = s(1071)
  t['run-orb-frame0.png'] = s(1071)
  t['special-orb-frame0.png'] = s(1071)
  t['lobby-teleport.png'] = s(356)
  for (const [file, id] of Object.entries(COMBAT_STYLE_ICON_SPRITES)) t[`combat-styles/${file}`] = s(id)
  return t
})()
