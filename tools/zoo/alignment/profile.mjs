import { C_SEEDED_PROFILE_ID } from "./seed-startup.mjs";
// Explicit pinned C defaults; opt-in measurement profile, not a Borg policy change.
export const C_POINT_BUY_PROFILE = {
  id: "c-point-buy-v1",
  c_source: "e473720ed88a0f0c7ca66815cef3000eb4a38bc3",
  birth_method: "native default recommended point buy",
  activeOptions: { pickup_always: true, pickup_inven: true },
  options: {
    none: false,
    rogue_like_commands: false,
    autoexplore_commands: false,
    use_sound: false,
    show_damage: false,
    use_old_target: false,
    pickup_always: false,
    pickup_inven: true,
    show_flavors: false,
    show_target: true,
    highlight_player: false,
    disturb_near: true,
    solid_walls: false,
    hybrid_walls: false,
    view_yellow_light: false,
    animate_flicker: false,
    center_player: false,
    purple_uniques: false,
    auto_more: false,
    hp_changes_color: true,
    mouse_movement: true,
    notify_recharge: false,
    effective_speed: false,
    cheat_hear: false,
    score_hear: false,
    cheat_room: false,
    score_room: false,
    cheat_xtra: false,
    score_xtra: false,
    cheat_live: false,
    score_live: false,
    birth_randarts: false,
    birth_connect_stairs: true,
    birth_force_descend: false,
    birth_no_recall: false,
    birth_no_artifacts: false,
    birth_stacking: true,
    birth_lose_arts: false,
    birth_feelings: true,
    birth_no_selling: true,
    birth_start_kit: true,
    birth_ai_learn: true,
    birth_know_runes: false,
    birth_know_flavors: false,
    birth_levels_persist: false,
    birth_percent_damage: false,
  },
};

export function alignedBirth(core, pack, name, raceName, className) {
  if (name === undefined) return {};
  if (name !== C_POINT_BUY_PROFILE.id && name !== C_SEEDED_PROFILE_ID)
    throw new Error("Unknown birth profile: " + name);
  const players = core.bindPlayer(pack.player),
    race = players.raceByName(raceName),
    cls = players.classByName(className);
  if (!race || !cls)
    throw new Error("Aligned birth requires explicit valid race and class");
  const buy = core.generateStats(
    race,
    cls,
    C_POINT_BUY_PROFILE.options.birth_percent_damage,
  );
  return {
    roller: "point",
    birthStats: [...buy.stats],
    optionOverrides: { ...C_POINT_BUY_PROFILE.options },
  };
}
