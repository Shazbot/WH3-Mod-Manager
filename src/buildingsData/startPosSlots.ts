/**
 * Which slot templates each region gets, per campaign.
 *
 * This is `start_pos_region_slot_templates_tables`, which does **not** exist in db.pack - the whole
 * `start_pos_*` family lives in startpos.esf, which the app cannot read yet. Without it the
 * derivation has no way to get from a region to its permitted building chains, so this is bundled as
 * a fallback and used only when the packs do not supply the table. Once startpos reading exists the
 * real rows will win and this becomes dead weight that can be deleted.
 *
 * Generated from a dump of the vanilla table; 1810 rows over 826 campaign+region
 * pairs and 562 distinct slot templates. Interned rather than stored flat, which turns
 * ~164 KB of repeated strings into ~49 KB.
 */

/** Slot template keys, referenced by index from {@link STARTPOS_REGION_SLOTS}. */
const SLOT_TEMPLATES = [
  "wh2_dlc09_special_bhagar_primary",
  "wh2_dlc09_special_bhagar_secondary",
  "wh2_dlc09_special_black_tower_of_arkhan_secondary",
  "wh2_dlc09_special_ka_sabar_primary",
  "wh2_dlc09_special_ka_sabar_secondary",
  "wh2_dlc09_special_numas_primary",
  "wh2_dlc09_special_numas_secondary",
  "wh2_dlc09_special_quatar_primary",
  "wh2_dlc09_special_quatar_secondary",
  "wh2_dlc09_special_zandri_primary",
  "wh2_dlc09_special_zandri_secondary",
  "wh2_dlc10_special_gaean_vale_primary",
  "wh2_dlc10_special_gaean_vale_secondary",
  "wh2_dlc14_special_copher_port",
  "wh2_dlc14_special_dragon_isle_port",
  "wh2_dlc14_special_fyrus_secondary",
  "wh2_dlc14_special_gnoblar_country_pigbarter_primary",
  "wh2_dlc14_special_gnoblar_country_pigbarter_secondary",
  "wh2_dlc14_special_the_broken_teeth_nagashizar_secondary",
  "wh2_dlc14_special_the_wolf_lands_crookback_mountain_primary",
  "wh2_dlc14_special_the_wolf_lands_crookback_mountain_secondary",
  "wh2_dlc15_special_grom_peak_secondary",
  "wh2_dlc15_special_morgheim_secondary",
  "wh2_dlc15_special_mount_arachnos_primary",
  "wh2_dlc15_special_mount_arachnos_secondary",
  "wh2_dlc15_special_tor_yvresse_primary",
  "wh2_dlc16_forest_of_gloom_secondary",
  "wh2_dlc16_gryphon_wood_secondary",
  "wh2_dlc16_sacred_pools_secondary",
  "wh2_dlc16_witchwood_secondary",
  "wh2_dlc17_mine_of_bearded_skulls_major_primary",
  "wh2_dlc17_mine_of_bearded_skulls_major_secondary",
  "wh2_main_human_major_secondary_gems",
  "wh2_main_human_major_secondary_medicine",
  "wh2_main_human_minor_secondary_animals",
  "wh2_main_human_minor_secondary_gems",
  "wh2_main_human_minor_secondary_medicine",
  "wh2_main_human_minor_secondary_obsidian",
  "wh2_main_human_minor_secondary_spices",
  "wh2_main_oreons_camp_secondary",
  "wh2_main_special_altar_of_ultimate_darkness_primary",
  "wh2_main_special_altar_of_ultimate_darkness_secondary",
  "wh2_main_special_axlotl_minor_primary",
  "wh2_main_special_axlotl_minor_secondary",
  "wh2_main_special_castle_drachenfels_primary",
  "wh2_main_special_castle_drachenfels_secondary",
  "wh2_main_special_chamber_of_visions_primary",
  "wh2_main_special_chamber_of_visions_secondary",
  "wh2_main_special_clar_karond_primary",
  "wh2_main_special_clar_karond_secondary",
  "wh2_main_special_def_vauls_anvil_primary",
  "wh2_main_special_def_vauls_anvil_secondary",
  "wh2_main_special_elven_colony_major_primary",
  "wh2_main_special_elven_colony_minor_primary",
  "wh2_main_special_empire_fort_primary",
  "wh2_main_special_fallen_gates_primary",
  "wh2_main_special_fallen_gates_secondary",
  "wh2_main_special_fortress_gate_eagle_primary",
  "wh2_main_special_fortress_gate_griffon_primary",
  "wh2_main_special_fortress_gate_phoenix_primary",
  "wh2_main_special_fortress_gate_secondary",
  "wh2_main_special_fortress_gate_unicorn_primary",
  "wh2_main_special_galbaraz_primary",
  "wh2_main_special_galbaraz_secondary",
  "wh2_main_special_galleons_graveyard_port",
  "wh2_main_special_galleons_graveyard_primary",
  "wh2_main_special_galleons_graveyard_secondary",
  "wh2_main_special_ghrond_primary",
  "wh2_main_special_ghrond_secondary",
  "wh2_main_special_golden_tower_of_the_gods_primary",
  "wh2_main_special_golden_tower_of_the_gods_secondary",
  "wh2_main_special_gor_gazan_primary",
  "wh2_main_special_gor_gazan_secondary",
  "wh2_main_special_hag_graef_primary",
  "wh2_main_special_hag_graef_secondary",
  "wh2_main_special_har_ganeth_primary",
  "wh2_main_special_har_ganeth_secondary",
  "wh2_main_special_hef_vauls_anvil_primary",
  "wh2_main_special_hef_vauls_anvil_secondary",
  "wh2_main_special_hellpit_primary",
  "wh2_main_special_hellpit_secondary",
  "wh2_main_special_hexoatl_primary",
  "wh2_main_special_hexoatl_secondary",
  "wh2_main_special_iron_rock_primary",
  "wh2_main_special_iron_rock_secondary",
  "wh2_main_special_isle_of_wights_port",
  "wh2_main_special_itza_primary",
  "wh2_main_special_itza_secondary",
  "wh2_main_special_karag_orrud_primary",
  "wh2_main_special_karag_orrud_secondary",
  "wh2_main_special_karak_izor_primary",
  "wh2_main_special_karak_izor_secondary",
  "wh2_main_special_karak_zorn_primary",
  "wh2_main_special_karak_zorn_secondary",
  "wh2_main_special_karond_kar_primary",
  "wh2_main_special_karond_kar_secondary",
  "wh2_main_special_khemri_primary",
  "wh2_main_special_khemri_secondary",
  "wh2_main_special_konquata_primary",
  "wh2_main_special_kraka_drak_primary",
  "wh2_main_special_kraka_drak_secondary",
  "wh2_main_special_lahmia_primary",
  "wh2_main_special_lahmia_secondary",
  "wh2_main_special_laurelorn_forest_primary",
  "wh2_main_special_laurelorn_forest_secondary",
  "wh2_main_special_lothern_port",
  "wh2_main_special_lothern_primary",
  "wh2_main_special_lothern_secondary",
  "wh2_main_special_mousillon_primary",
  "wh2_main_special_mousillon_secondary",
  "wh2_main_special_naggarond_primary",
  "wh2_main_special_naggarond_secondary",
  "wh2_main_special_oyxl_primary",
  "wh2_main_special_oyxl_secondary",
  "wh2_main_special_parravon_primary",
  "wh2_main_special_parravon_secondary",
  "wh2_main_special_pyramid_of_nagash_primary",
  "wh2_main_special_pyramid_of_nagash_secondary",
  "wh2_main_special_quetza_primary",
  "wh2_main_special_quetza_secondary",
  "wh2_main_special_quintex_primary",
  "wh2_main_special_quintex_secondary",
  "wh2_main_special_salzenmund_primary",
  "wh2_main_special_salzenmund_secondary",
  "wh2_main_special_sartosa_primary",
  "wh2_main_special_sartosa_secondary",
  "wh2_main_special_shrine_of_asuryan_primary",
  "wh2_main_special_shrine_of_asuryan_secondary",
  "wh2_main_special_shrine_of_khaine_primary",
  "wh2_main_special_shrine_of_khaine_secondary",
  "wh2_main_special_shrine_of_sotek_secondary",
  "wh2_main_special_skavenblight_primary",
  "wh2_main_special_skavenblight_secondary",
  "wh2_main_special_skeggi_primary_major",
  "wh2_main_special_skeggi_secondary_major",
  "wh2_main_special_the_awakening_primary",
  "wh2_main_special_the_awakening_secondary",
  "wh2_main_special_tlaxtlan_primary",
  "wh2_main_special_tlaxtlan_secondary",
  "wh2_main_special_tor_achare_primary",
  "wh2_main_special_tor_achare_secondary",
  "wh2_main_special_tor_anlec_primary",
  "wh2_main_special_tor_anlec_secondary",
  "wh2_main_special_tor_anroc_primary",
  "wh2_main_special_tor_anroc_secondary",
  "wh2_main_special_tor_elyr_primary",
  "wh2_main_special_tor_elyr_secondary",
  "wh2_main_special_tor_koruali_primary",
  "wh2_main_special_tor_koruali_secondary",
  "wh2_main_special_tor_yvresse_secondary",
  "wh2_main_special_tower_of_hoeth_primary",
  "wh2_main_special_tower_of_hoeth_secondary",
  "wh2_main_special_xlanhuapec_primary",
  "wh2_main_special_xlanhuapec_secondary",
  "wh2_main_special_ziggurat_of_dawn_primary",
  "wh2_main_special_ziggurat_of_dawn_secondary",
  "wh2_main_special_zoishenk_primary",
  "wh2_main_special_zoishenk_secondary",
  "wh3_cp1_human_major_primary_crooked_fang_fort",
  "wh3_cp1_human_major_primary_ekrund",
  "wh3_cp1_human_major_primary_karak_azgal",
  "wh3_cp1_human_major_primary_shang_wu",
  "wh3_cp1_human_major_primary_shi_wu",
  "wh3_cp1_human_major_primary_silver_pinnacle",
  "wh3_cp1_human_major_secondary_bamboo_crossing",
  "wh3_cp1_human_major_secondary_fu_chow",
  "wh3_cp1_human_major_secondary_gateway_to_khuresh",
  "wh3_cp1_human_major_secondary_hanyu_port",
  "wh3_cp1_human_major_secondary_zhanshi",
  "wh3_cp1_human_minor_primary_falls_of_doom",
  "wh3_cp1_human_minor_primary_high_place",
  "wh3_cp1_human_minor_primary_maw_gate",
  "wh3_cp1_human_minor_primary_village_of_the_tigermen",
  "wh3_cp1_human_minor_secondary_amblepeak",
  "wh3_cp1_human_minor_secondary_city_of_the_shugengan",
  "wh3_cp1_human_minor_secondary_gorger_rock",
  "wh3_cp1_human_minor_secondary_medicine_village_of_the_tigermen",
  "wh3_cp1_human_minor_secondary_mount_thug",
  "wh3_cp1_human_minor_secondary_titans_notch",
  "wh3_cp1_human_minor_secondary_valayas_sorrow",
  "wh3_cp1_human_minor_secondary_vale_of_titans",
  "wh3_cp1_human_minor_secondary_valley_of_horns",
  "wh3_cp1_human_minor_secondary_yhetee_peak",
  "wh3_cp1_port_myrmidens",
  "wh3_cp1_special_shi_wu_secondary_obsidian",
  "wh3_dlc20_chaos_dark_fortress_primary",
  "wh3_dlc20_chaos_dark_fortress_secondary",
  "wh3_dlc20_chaos_fortress_secondary",
  "wh3_dlc20_combi_special_the_crystal_spires_secondary",
  "wh3_dlc20_combi_special_the_writhing_fortress_secondary",
  "wh3_dlc20_special_bjornlings_gathering_major_primary",
  "wh3_dlc20_special_bjornlings_gathering_secondary",
  "wh3_dlc20_special_black_rock_major_primary",
  "wh3_dlc20_special_black_rock_secondary_obsidian",
  "wh3_dlc20_special_blood_haven_major_primary",
  "wh3_dlc20_special_blood_haven_secondary",
  "wh3_dlc20_special_brass_keep_secondary",
  "wh3_dlc20_special_citadel_of_lead_major_primary",
  "wh3_dlc20_special_citadel_of_lead_major_secondary",
  "wh3_dlc20_special_city_of_splinters_major_primary",
  "wh3_dlc20_special_city_of_splinters_secondary",
  "wh3_dlc20_special_daemons_gate_major_primary",
  "wh3_dlc20_special_daemons_gate_secondary_obsidian",
  "wh3_dlc20_special_doomkeep_major_primary",
  "wh3_dlc20_special_doomkeep_secondary_marble",
  "wh3_dlc20_special_empire_fort_secondary",
  "wh3_dlc20_special_fortress_of_the_damned_major_primary",
  "wh3_dlc20_special_fortress_of_the_damned_secondary",
  "wh3_dlc20_special_frozen_landing_major_primary",
  "wh3_dlc20_special_frozen_landing_secondary",
  "wh3_dlc20_special_godless_crater_major_primary",
  "wh3_dlc20_special_godless_crater_secondary",
  "wh3_dlc20_special_icedrake_fjord_major_primary",
  "wh3_dlc20_special_icedrake_fjord_secondary",
  "wh3_dlc20_special_infernius_major_primary",
  "wh3_dlc20_special_karak_dum_major_primary",
  "wh3_dlc20_special_karak_dum_secondary",
  "wh3_dlc20_special_okkams_forever_maze_major_primary",
  "wh3_dlc20_special_okkams_forever_maze_secondary",
  "wh3_dlc20_special_plains_of_zanbaijin_major_primary",
  "wh3_dlc20_special_plains_of_zanbaijin_secondary",
  "wh3_dlc20_special_the_crystal_spires_major_primary",
  "wh3_dlc20_special_the_forbidden_citadel_major_primary",
  "wh3_dlc20_special_the_forbidden_citadel_secondary_iron",
  "wh3_dlc20_special_the_gallows_tree_major_primary",
  "wh3_dlc20_special_the_gallows_tree_secondary_timber",
  "wh3_dlc20_special_the_howling_citadel_major_primary",
  "wh3_dlc20_special_the_howling_citadel_secondary",
  "wh3_dlc20_special_the_palace_of_ruin_secondary_spices",
  "wh3_dlc20_special_the_shifting_monolith_major_primary",
  "wh3_dlc20_special_the_shifting_monolith_secondary_gold",
  "wh3_dlc20_special_the_silvered_tower_of_sorcerers_major_primary",
  "wh3_dlc20_special_the_silvered_tower_of_sorcerers_secondary",
  "wh3_dlc20_special_the_sunken_sewers_major_primary",
  "wh3_dlc20_special_the_twisted_towers_major_primary",
  "wh3_dlc20_special_the_twisted_towers_secondary",
  "wh3_dlc20_special_the_volary_major_primary",
  "wh3_dlc20_special_the_writhing_fortress_major_primary",
  "wh3_dlc20_special_tower_of_khrakk_major_primary",
  "wh3_dlc20_special_tower_of_khrakk_secondary",
  "wh3_dlc20_special_troll_fjord_major_primary",
  "wh3_dlc20_special_troll_fjord_secondary_salt",
  "wh3_dlc20_special_zerulous_major_primary",
  "wh3_dlc20_special_zerulous_secondary",
  "wh3_dlc20_special_zharr_naggrund_major_primary",
  "wh3_dlc20_special_zharr_naggrund_secondary_obsidian",
  "wh3_dlc23_special_anurells_tomb_primary",
  "wh3_dlc23_special_anurells_tomb_secondary",
  "wh3_dlc23_special_bitter_bay_primary",
  "wh3_dlc23_special_bitter_bay_secondary",
  "wh3_dlc23_special_black_fortress_primary",
  "wh3_dlc23_special_black_fortress_secondary",
  "wh3_dlc23_special_daemons_stump_primary",
  "wh3_dlc23_special_daemons_stump_secondary",
  "wh3_dlc23_special_flayed_rock_major_secondary",
  "wh3_dlc23_special_flayed_rock_primary",
  "wh3_dlc23_special_flayed_rock_secondary",
  "wh3_dlc23_special_fortress_of_dawn_port",
  "wh3_dlc23_special_fortress_of_dawn_secondary",
  "wh3_dlc23_special_gates_of_zharr_primary",
  "wh3_dlc23_special_gates_of_zharr_secondary",
  "wh3_dlc23_special_iron_storm_primary",
  "wh3_dlc23_special_iron_storm_secondary",
  "wh3_dlc23_special_the_sentinels_primary",
  "wh3_dlc23_special_the_sentinels_secondary",
  "wh3_dlc23_special_the_volary_secondary_combi",
  "wh3_dlc23_special_uzkulak_primary",
  "wh3_dlc23_special_uzkulak_secondary",
  "wh3_dlc24_special_black_pit_secondary",
  "wh3_dlc24_special_bleak_hold_fortress_secondary",
  "wh3_dlc24_special_castle_alexandronov_minor_secondary",
  "wh3_dlc24_special_castle_alexandronov_minor_secondary_wine",
  "wh3_dlc24_special_castle_of_splendour_secondary",
  "wh3_dlc24_special_deff_gorge_secondary",
  "wh3_dlc24_special_dolganyeir_secondary",
  "wh3_dlc24_special_fateweavers_crevasse_secondary",
  "wh3_dlc24_special_haichai_secondary",
  "wh3_dlc24_special_maw_gate_secondary",
  "wh3_dlc24_special_plesk_secondary",
  "wh3_dlc24_special_shang_wu_major_secondary_animals",
  "wh3_dlc24_special_shrine_of_kurnous_secondary",
  "wh3_dlc24_special_tower_of_ashshair_secondary",
  "wh3_dlc25_chaos_region_mount_gunbad_special",
  "wh3_dlc25_special_chaos_dark_fortress_secondary_middenheim",
  "wh3_dlc25_special_silver_pinnacle_secondary",
  "wh3_dlc25_special_temple_of_elemental_winds",
  "wh3_dlc25_special_the_gallows_tree_secondary_timber",
  "wh3_dlc26_special_cuexotl_primary",
  "wh3_dlc26_special_cuexotl_secondary",
  "wh3_dlc26_special_great_hall_of_greasus_major_primary",
  "wh3_dlc26_special_jade_wind_mountain_primary",
  "wh3_dlc26_special_jade_wind_mountain_secondary",
  "wh3_dlc26_special_pahuax_primary",
  "wh3_dlc26_special_pahuax_secondary",
  "wh3_dlc26_special_springs_of_eternal_life_primary",
  "wh3_dlc26_special_springs_of_eternal_life_secondary",
  "wh3_dlc26_special_stormhenge_primary",
  "wh3_dlc26_special_stormhenge_secondary",
  "wh3_dlc27_broken_mount_primary",
  "wh3_dlc27_broken_mount_secondary",
  "wh3_dlc27_dark_tower_primary",
  "wh3_dlc27_dark_tower_secondary",
  "wh3_dlc27_desolation_ridge_primary",
  "wh3_dlc27_desolation_ridge_secondary",
  "wh3_dlc27_human_major_primary_port",
  "wh3_dlc27_human_minor_primary_port",
  "wh3_dlc27_rotten_stone_primary",
  "wh3_dlc27_rotten_stone_secondary",
  "wh3_dlc27_special_arnheim_secondary",
  "wh3_dlc27_special_citadel_of_dusk_secondary",
  "wh3_dlc27_special_gronti_mingol_secondary",
  "wh3_dlc27_special_languille_secondary",
  "wh3_dlc27_special_monument_of_the_moon_primary",
  "wh3_dlc27_special_secondary_bloodpeak",
  "wh3_dlc27_special_secondary_cliff_of_beasts",
  "wh3_dlc27_special_secondary_desolation_of_drakenmoor",
  "wh3_dlc27_special_secondary_dok_karaz",
  "wh3_dlc27_special_secondary_dragon_fang_mount",
  "wh3_dlc27_special_secondary_dragonhorn_mines",
  "wh3_dlc27_special_secondary_gisoreux",
  "wh3_dlc27_special_secondary_great_skull_lakes",
  "wh3_dlc27_special_secondary_grimtop",
  "wh3_dlc27_special_secondary_grotrilexs_glare_lighthouse",
  "wh3_dlc27_special_secondary_hoteks_column",
  "wh3_dlc27_special_secondary_ice_rock_gorge",
  "wh3_dlc27_special_secondary_khazid_irkulaz",
  "wh3_dlc27_special_secondary_monolith_of_bubonicus",
  "wh3_dlc27_special_secondary_monolith_of_festerlung",
  "wh3_dlc27_special_secondary_montenas",
  "wh3_dlc27_special_secondary_mount_athull",
  "wh3_dlc27_special_secondary_mountain_pass",
  "wh3_dlc27_special_secondary_rackdo_gorge",
  "wh3_dlc27_special_secondary_shi_long",
  "wh3_dlc27_special_secondary_the_bleeding_spire",
  "wh3_dlc27_special_secondary_the_blighted_grove",
  "wh3_dlc27_special_secondary_the_forest_of_decay",
  "wh3_dlc27_special_secondary_the_gates_of_zharr",
  "wh3_dlc27_special_secondary_the_lost_palace",
  "wh3_dlc27_special_secondary_the_tower_of_flies",
  "wh3_dlc27_special_secondary_tlanxla",
  "wh3_dlc27_special_secondary_vulture_mountain",
  "wh3_dlc27_special_tor_elasor_secondary",
  "wh3_dlc27_special_tower_of_the_stars_secondary",
  "wh3_dlc27_special_tower_of_the_sun_secondary",
  "wh3_dlc27_special_wolfenburg_secondary",
  "wh3_main_chaos_region_dragon_fang_mount_special_secondary_medicine_roc_only",
  "wh3_main_chaos_region_fire_mouth_special_secondary_furs_roc_only",
  "wh3_main_chaos_region_floating_mountain_special_secondary_marble_roc_only",
  "wh3_main_chaos_region_wei_jin_special_secondary_spices_roc_only",
  "wh3_main_combi_jungles_of_chian_secondary",
  "wh3_main_combi_special_bloodwind_keep_secondary",
  "wh3_main_combi_special_red_fortress_secondary",
  "wh3_main_combi_special_the_challenge_stone_secondary",
  "wh3_main_combi_the_haunted_forest_secondary",
  "wh3_main_cth_bastion_primary",
  "wh3_main_cth_bastion_secondary",
  "wh3_main_erengrad_city_primary",
  "wh3_main_erengrad_city_secondary",
  "wh3_main_human_minor_secondary_ivory",
  "wh3_main_kislev_city_primary",
  "wh3_main_kislev_city_secondary",
  "wh3_main_praag_city_primary",
  "wh3_main_praag_city_secondary",
  "wh3_main_prologue_dervingard_primary",
  "wh3_main_prologue_dervingard_secondary",
  "wh3_main_prologue_minor_primary",
  "wh3_main_prologue_minor_secondary",
  "wh3_main_special_blood_mountain_minor_primary",
  "wh3_main_special_blood_mountain_primary",
  "wh3_main_special_blood_mountain_secondary_iron",
  "wh3_main_special_bloodpeak_primary",
  "wh3_main_special_bloodwind_keep_minor_primary",
  "wh3_main_special_bloodwind_keep_secondary_obsidian",
  "wh3_main_special_brass_keep_primary",
  "wh3_main_special_castle_of_splendour_primary",
  "wh3_main_special_clarak_spire_secondary",
  "wh3_main_special_cliff_of_beasts_primary",
  "wh3_main_special_desolation_of_drakenmoor_primary",
  "wh3_main_special_dok_karaz_primary",
  "wh3_main_special_drackle_spire_secondary",
  "wh3_main_special_dragon_fang_mount_primary",
  "wh3_main_special_dragonhorn_mines_primary",
  "wh3_main_special_fire_mouth_minor_primary",
  "wh3_main_special_fire_mouth_secondary_furs",
  "wh3_main_special_fortress_of_the_damned_minor_primary",
  "wh3_main_special_fortress_of_the_damned_secondary_marble",
  "wh3_main_special_fu_hung_major_primary",
  "wh3_main_special_fu_hung_secondary_dyes",
  "wh3_main_special_gisoreux_primary",
  "wh3_main_special_great_hall_of_greasus_secondary_gold",
  "wh3_main_special_great_skull_lakes_primary",
  "wh3_main_special_grimtop_primary",
  "wh3_main_special_gristle_valley_minor_primary",
  "wh3_main_special_gristle_valley_secondary_ivory",
  "wh3_main_special_grom_peak_primary",
  "wh3_main_special_grotrilexs_glare_lighthouse_primary",
  "wh3_main_special_hoteks_column_primary",
  "wh3_main_special_ice_rock_gorge_primary",
  "wh3_main_special_infernius_major_secondary",
  "wh3_main_special_karak_azorn_secondary",
  "wh3_main_special_karak_vrag_secondary",
  "wh3_main_special_khazid_bordkarag_secondary",
  "wh3_main_special_khazid_irkulaz_primary",
  "wh3_main_special_li_temple_secondary",
  "wh3_main_special_massif_orcal_primary",
  "wh3_main_special_misty_mountain_secondary",
  "wh3_main_special_monolith_of_bubonicus_primary",
  "wh3_main_special_monolith_of_festerlung_primary",
  "wh3_main_special_montenas_primary",
  "wh3_main_special_mordheim_secondary",
  "wh3_main_special_morgheim_primary",
  "wh3_main_special_mount_athull_primary",
  "wh3_main_special_mountain_pass_primary",
  "wh3_main_special_nan_gau_major_primary",
  "wh3_main_special_nan_gau_secondary_pottery",
  "wh3_main_special_nuln_secondary_iron",
  "wh3_main_special_palace_of_princes_secondary",
  "wh3_main_special_rackdo_gorge_primary",
  "wh3_main_special_red_fortress_major_primary",
  "wh3_main_special_red_fortress_secondary_ivory",
  "wh3_main_special_sabre_mountain_secondary",
  "wh3_main_special_shang_yang_major_primary",
  "wh3_main_special_shang_yang_secondary_spices",
  "wh3_main_special_shi_long_primary",
  "wh3_main_special_shiyamas_rest_secondary",
  "wh3_main_special_the_bleeding_spire_primary",
  "wh3_main_special_the_blighted_grove_primary",
  "wh3_main_special_the_challenge_stone_secondary",
  "wh3_main_special_the_crystal_spires_secondary",
  "wh3_main_special_the_forest_of_decay_primary",
  "wh3_main_special_the_gates_of_zharr_primary",
  "wh3_main_special_the_great_desert_secondary",
  "wh3_main_special_the_lost_palace_primary",
  "wh3_main_special_the_moot_primary",
  "wh3_main_special_the_palace_of_ruin_major_primary",
  "wh3_main_special_the_palace_of_ruin_primary",
  "wh3_main_special_the_palace_of_ruin_secondary_marble",
  "wh3_main_special_the_sky_monolith_secondary",
  "wh3_main_special_the_sunken_sewers_secondary",
  "wh3_main_special_the_tower_of_flies_primary",
  "wh3_main_special_the_twisted_towers_secondary",
  "wh3_main_special_the_volary_secondary",
  "wh3_main_special_the_writhing_fortress_secondary",
  "wh3_main_special_tlanxla_primary",
  "wh3_main_special_tower_of_gorgoth_primary",
  "wh3_main_special_tower_of_gorgoth_secondary",
  "wh3_main_special_volksgrad_secondary",
  "wh3_main_special_vulture_mountain_primary",
  "wh3_main_special_wei_jin_major_primary",
  "wh3_main_special_wei_jin_secondary_spices",
  "wh3_main_special_weng_chang_minor_primary",
  "wh3_main_special_weng_chang_secondary_iron",
  "wh3_main_special_xing_po_minor_primary",
  "wh3_main_special_xing_po_secondary_gems",
  "wh_dlc05_elf_major_primary_oak_of_ages",
  "wh_dlc05_elf_major_secondary_oak_of_ages",
  "wh_dlc15_special_plain_of_bones_darkhold_secondary",
  "wh_dlc15_special_plain_of_bones_fortress_of_vorag_secondary_major",
  "wh_dlc24_special_fu_chow_port",
  "wh_dlc24_special_southern_sentinels_secondary",
  "wh_dlc24_special_star_tower_secondary",
  "wh_dlc24_special_the_turtle_isle_secondary",
  "wh_main_dwarf_orc_major_secondary_savage",
  "wh_main_dwarf_orc_minor_secondary_savage",
  "wh_main_human_major_primary",
  "wh_main_human_major_secondary",
  "wh_main_human_major_secondary_dyes",
  "wh_main_human_major_secondary_gold",
  "wh_main_human_major_secondary_iron",
  "wh_main_human_major_secondary_marble",
  "wh_main_human_major_secondary_pastures",
  "wh_main_human_major_secondary_pottery",
  "wh_main_human_major_secondary_salt",
  "wh_main_human_major_secondary_timber",
  "wh_main_human_major_secondary_wine",
  "wh_main_human_minor_primary",
  "wh_main_human_minor_secondary",
  "wh_main_human_minor_secondary_dyes",
  "wh_main_human_minor_secondary_furs",
  "wh_main_human_minor_secondary_gold",
  "wh_main_human_minor_secondary_iron",
  "wh_main_human_minor_secondary_marble",
  "wh_main_human_minor_secondary_pastures",
  "wh_main_human_minor_secondary_pottery",
  "wh_main_human_minor_secondary_salt",
  "wh_main_human_minor_secondary_timber",
  "wh_main_human_minor_secondary_wine",
  "wh_main_norsca_major_secondary",
  "wh_main_norsca_major_secondary_dervingard_special",
  "wh_main_norsca_minor_secondary",
  "wh_main_norsca_minor_secondary_iron",
  "wh_main_norsca_minor_secondary_marble",
  "wh_main_norsca_minor_secondary_obsidian",
  "wh_main_norsca_port",
  "wh_main_port",
  "wh_main_special_altdorf_primary",
  "wh_main_special_altdorf_secondary",
  "wh_main_special_bay_of_blades_secondary",
  "wh_main_special_black_crag_primary",
  "wh_main_special_black_crag_secondary",
  "wh_main_special_bordeleaux_port",
  "wh_main_special_bordeleux_primary",
  "wh_main_special_bordeleux_secondary",
  "wh_main_special_carcassonne_primary",
  "wh_main_special_carcassonne_secondary",
  "wh_main_special_carroburg_primary",
  "wh_main_special_carroburg_secondary",
  "wh_main_special_castle_drakenhof_primary",
  "wh_main_special_castle_drakenhof_secondary",
  "wh_main_special_citadel_of_lead_secondary",
  "wh_main_special_couronne_primary",
  "wh_main_special_couronne_secondary",
  "wh_main_special_crag_halls_primary",
  "wh_main_special_crag_halls_secondary",
  "wh_main_special_doomkeep_secondary",
  "wh_main_special_eight_peaks_primary",
  "wh_main_special_eight_peaks_secondary",
  "wh_main_special_erengrad_port",
  "wh_main_special_karag_dromar_primary",
  "wh_main_special_karag_dromar_secondary",
  "wh_main_special_karak_azgal_secondary",
  "wh_main_special_karak_azul_primary",
  "wh_main_special_karak_azul_secondary",
  "wh_main_special_karak_hirn_secondary",
  "wh_main_special_karak_kadrin_2_secondary",
  "wh_main_special_karak_kadrin_primary",
  "wh_main_special_karak_norn_secondary",
  "wh_main_special_karak_ungor_secondary",
  "wh_main_special_karaz_a_karak_primary",
  "wh_main_special_karaz_a_karak_secondary",
  "wh_main_special_konquata_secondary",
  "wh_main_special_luccini_secondary",
  "wh_main_special_magritta_primary",
  "wh_main_special_magritta_secondary",
  "wh_main_special_marienburg_port",
  "wh_main_special_marienburg_primary",
  "wh_main_special_marienburg_secondary",
  "wh_main_special_massif_orca_secondary",
  "wh_main_special_middenheim_primary",
  "wh_main_special_middenheim_secondary",
  "wh_main_special_miragliano_primary",
  "wh_main_special_miragliano_secondary",
  "wh_main_special_monolith_of_katam_secondary",
  "wh_main_special_moot_secondary",
  "wh_main_special_mount_gunbad_primary",
  "wh_main_special_mount_gunbad_secondary",
  "wh_main_special_nuln_primary",
  "wh_main_special_nuln_secondary",
  "wh_main_special_pfeildorf_secondary",
  "wh_main_special_sjoktraken_secondary",
  "wh_main_special_talabheim_primary",
  "wh_main_special_talabheim_secondary",
  "wh_main_special_talabheim_secondary_roc",
  "wh_main_special_tobaro_secondary",
  "wh_main_special_ubersreik_secondary",
  "wh_main_special_vauls_anvil_primary",
  "wh_main_special_vauls_anvil_secondary",
  "wh_main_special_waterfall_palace_primary",
  "wh_main_special_waterfall_palace_secondary",
  "wh_main_special_yn_edryl_korian_primary",
  "wh_main_special_yn_edryl_korian_secondary",
  "wh_main_special_zhufbar_secondary",
];

const SLOT_TYPE_BY_CHAR: Record<string, string> = { p: "primary", s: "secondary", o: "port" };

/** `campaign<TAB>region<TAB><typeChar><templateIndex> …` */
const STARTPOS_REGION_SLOTS = `\
wh3_main_chaos	wh3_main_chaos_region_krudenwald	s476 p475
wh3_main_chaos	wh3_main_chaos_region_fort_dorznye_vort	p475 s476
wh3_main_chaos	wh3_main_chaos_region_black_fang	s476 p475
wh3_main_combi	wh3_main_combi_region_hag_hall	s470 p464
wh3_main_combi	wh3_main_combi_region_village_of_the_moon	s476 p475
wh3_main_chaos	wh3_main_chaos_region_hanyu_port	s465 p464
wh3_main_combi	wh3_main_combi_region_the_sinhall_monolith	s358 p475
wh3_main_combi	wh3_main_combi_region_the_twisted_towers	s235 p234
wh3_main_combi	wh3_main_combi_region_storag_kor	p475 s476
wh3_main_combi	wh3_main_combi_region_hanyu_port	p304 o494 s167
wh3_main_combi	wh3_main_combi_region_talabheim	s551 p550
wh3_main_combi	wh3_main_combi_region_dawns_light	p305 s476 o494
wh3_main_combi	wh3_main_combi_region_winter_pyre	s489 o494 p305
wh3_main_combi	wh3_main_combi_region_chaqua	p475 s485
wh3_main_combi	wh3_main_combi_region_the_cursed_jungle	p475 s36
wh3_main_combi	wh3_main_combi_region_khymerica_spire	s484 p475
wh3_main_combi	wh3_main_combi_region_the_sacred_pools	s28 p557
wh3_main_combi	wh3_main_combi_region_ka_sabar	p3 s4
wh3_main_chaos	wh3_main_chaos_region_xen_wu	s476 p475
wh3_main_combi	wh3_main_combi_region_griffon_gate	s60 p58
wh3_main_combi	wh3_main_combi_region_gaean_vale	p11 s12
wh3_main_combi	wh3_main_combi_region_lyonesse	o494 p304 s470
wh3_main_combi	wh3_main_combi_region_pools_of_despair	s476 p475
wh3_main_chaos	wh3_main_chaos_region_nuln	s415 p546
wh3_main_combi	wh3_main_combi_region_waldenhof	s476 p475
wh3_main_combi	wh3_main_combi_region_soteks_trail	p475 s476
wh3_main_chaos	wh3_main_chaos_region_tai_tzu	s476 p475
wh3_main_combi	wh3_main_combi_region_aarnau	s476 p475
wh3_main_combi	wh3_main_combi_region_the_copper_landing	o493 p305 s476
wh3_main_combi	wh3_main_combi_region_eldar_spire	s476 p475
wh3_main_combi	wh3_main_combi_region_eye_of_the_panther	p475 s35
wh3_main_combi	wh3_main_combi_region_grotrilexs_glare_lighthouse	o494 p395 s322
wh3_main_chaos	wh3_main_chaos_region_mist_gorge	p475 s476
wh3_main_combi	wh3_main_combi_region_xlanzec	s476 p475
wh3_main_combi	wh3_main_combi_region_tor_elasor	p53 s341 o494
wh3_main_chaos	wh3_main_chaos_region_nan_li	p475 s476
wh3_main_chaos	wh3_main_chaos_region_castle_drachenfels	s481 p475
wh3_main_combi	wh3_main_combi_region_zhufbar	p464 s561
wh3_main_combi	wh3_main_combi_region_bridge_of_heaven	o494 p305 s478
wh3_main_combi	wh3_main_combi_region_tor_koruali	p147 o494 s148
wh3_main_combi	wh3_main_combi_region_zarakzil	s476 p475
wh3_main_chaos	wh3_main_chaos_region_the_daemons_stump	p252 s253
wh3_main_combi	wh3_main_combi_region_castle_drakenhof	s508 p507
wh3_main_combi	wh3_main_combi_region_couronne	p510 s511
wh3_main_combi	wh3_main_combi_region_zvorak	p475 s481
wh3_main_combi	wh3_main_combi_region_gor_gazan	p71 s72
wh3_main_chaos	wh3_main_chaos_region_novchozy	s477 p475
wh3_main_combi	wh3_main_combi_region_the_twisted_glade	o494 p304 s465
wh3_main_combi	wh3_main_combi_region_unicorn_gate	p61 s60
wh3_main_combi	wh3_main_combi_region_khemri	s97 p96
wh3_main_combi	wh3_main_combi_region_plain_of_spiders	p475 s37
wh3_main_chaos	wh3_main_chaos_region_karak_krakaten	p475 s358
wh3_main_combi	wh3_main_combi_region_eagle_gate	s60 p57
wh3_main_combi	wh3_main_combi_region_oakenhammer	s476 p475
wh3_main_combi	wh3_main_combi_region_dragonhorn_mines	p381 s318
wh3_main_chaos	wh3_main_chaos_region_the_gates_of_zharr	p259 s260
wh3_main_chaos	wh3_main_chaos_region_siegfriedhof	s476 p475
wh3_main_combi	wh3_main_combi_region_citadel_of_dusk	p52 o494 s309
wh3_main_combi	wh3_main_combi_region_fuming_serpent	s476 p305 o494
wh3_main_combi	wh3_main_combi_region_hag_graef	o494 p73 s74
wh3_main_combi	wh3_main_combi_region_the_crystal_spires	p221 s188
wh3_main_combi	wh3_main_combi_region_serpent_jetty	o493 s489 p305
wh3_main_combi	wh3_main_combi_region_copher	o13 p305 s38
wh3_main_combi	wh3_main_combi_region_granite_spikes	s476 p475
wh3_main_combi	wh3_main_combi_region_the_awakening	s136 p135 o494
wh3_main_combi	wh3_main_combi_region_pack_ice_bay	o494 p305 s490
wh3_main_combi	wh3_main_combi_region_dark_tower	s301 p300
wh3_main_combi	wh3_main_combi_region_krugenheim	s476 p475
wh3_main_combi	wh3_main_combi_region_altar_of_spawns	s489 p475
wh3_main_combi	wh3_main_combi_region_karak_norn	p464 s526
wh3_main_combi	wh3_main_combi_region_bitterstone_mine	s476 p475
wh3_main_combi	wh3_main_combi_region_essen	s482 p475
wh3_main_chaos	wh3_main_chaos_region_bechafen	p464 s465
wh3_main_combi	wh3_main_combi_region_elisia	s485 p305 o494
wh3_main_combi	wh3_main_combi_region_bloodpeak	p370 s313
wh3_main_combi	wh3_main_combi_region_the_dust_gate	s476 p475
wh3_main_combi	wh3_main_combi_region_bamboo_crossing	p304 s164 o494
wh3_main_chaos	wh3_main_chaos_region_city_of_the_shugengan	s476 p475
wh3_main_chaos	wh3_main_chaos_region_wolfenburg	s467 p464
wh3_main_combi	wh3_main_combi_region_citadel_of_lead	p475 s509
wh3_main_chaos	wh3_main_chaos_region_po_mei	p464 s469
wh3_main_chaos	wh3_main_chaos_region_bohsenfels	p475 s476
wh3_main_chaos	wh3_dlc20_chaos_region_grung_zint	p475 s481
wh3_main_combi	wh3_main_combi_region_the_star_tower	s460 p52 o494
wh3_main_combi	wh3_main_combi_region_erengrad	p356 s357 o517
wh3_main_combi	wh3_main_combi_region_bilbali	p304 o494 s474
wh3_main_chaos	wh3_main_chaos_region_the_last_sky_castle	s484 p475
wh3_main_combi	wh3_main_combi_region_the_pillars_of_grungni	s476 p475
wh3_main_chaos	wh3_main_chaos_region_hellcade_drove	s476 p475
wh3_main_combi	wh3_main_combi_region_grung_zint	p475 s481
wh3_main_chaos	wh3_main_chaos_region_floating_mountain	p475 s347
wh3_main_combi	wh3_dlc20_combi_region_glacial_gardens	p475 s476
wh3_main_combi	wh3_main_combi_region_deff_gorge	p464 s273
wh3_main_combi	wh3_main_combi_region_the_southern_sentinels	p464 s459
wh3_main_chaos	wh3_main_chaos_region_oakenhammer	p475 s476
wh3_main_combi	wh3_main_combi_region_desolation_of_nagash	p475 s476
wh3_main_chaos	wh3_main_chaos_region_zerulous	s243 p242
wh3_main_combi	wh3_main_combi_region_fallen_gates	p55 s56
wh3_main_combi	wh3_main_combi_region_sartosa	s125 o494 p124
wh3_main_combi	wh3_main_combi_region_wei_jin	s449 p448
wh3_main_chaos	wh3_dlc20_chaos_region_fort_sollace	s476 o494 p475
wh3_main_combi	wh3_main_combi_region_lahmia	p101 s102
wh3_main_chaos	wh3_main_chaos_region_black_fortress	s251 p250
wh3_main_combi	wh3_main_combi_region_altar_of_the_crimson_harvest	o494 s213 p212
wh3_main_combi	wh3_main_combi_region_mighdal_vongalbarak	s476 p475
wh3_main_combi	wh3_main_combi_region_desolation_of_drakenmoor	p377 s315
wh3_main_chaos	wh3_main_chaos_region_grimtop	p475 s476
wh3_main_combi	wh3_main_combi_region_grom_peak	s21 p394
wh3_main_combi	wh3_main_combi_region_shard_bastion	s476 p475
wh3_main_combi	wh3_main_combi_region_elessaeli	o494 p304 s466
wh3_main_combi	wh3_main_combi_region_zharr_naggrund	p244 s245
wh3_main_chaos	wh3_main_chaos_region_castle_alexandronov	s271 p475 o494
wh3_main_combi	wh3_main_combi_region_turtle_gate	s355 p354
wh3_main_chaos	wh3_main_chaos_region_shang_wu	s279 p464
wh3_main_chaos	wh3_main_chaos_region_gorssel	s476 p475
wh3_main_chaos	wh3_main_chaos_region_eilhart	s476 p475
wh3_main_chaos	wh3_main_chaos_region_kraka_dorden	s476 p475
wh3_main_combi	wh3_main_combi_region_the_golden_colossus	p464 s465
wh3_main_combi	wh3_main_combi_region_the_high_sentinel	s480 o494 p305
wh3_main_combi	wh3_main_combi_region_itza	s87 p86
wh3_main_chaos	wh3_main_chaos_region_chimera_plateau	p475 s34
wh3_main_combi	wh3_main_combi_region_wolfenburg	s344 p464
wh3_main_combi	wh3_main_combi_region_city_of_the_shugengan	s174 p475
wh3_main_combi	wh3_main_combi_region_eilhart	p475 s476
wh3_main_combi	wh3_main_combi_region_mordheim	s409 p475
wh3_main_combi	wh3_main_combi_region_chamber_of_visions	p46 s47
wh3_main_chaos	wh3_main_chaos_region_rosche	p475 s476
wh3_main_combi	wh3_main_combi_region_great_turtle_isle	p52 o494 s461
wh3_main_chaos	wh3_main_chaos_region_shattered_stone_bay	p475 s485 o494
wh3_main_combi	wh3_main_combi_region_valayas_sorrow	p475 s179
wh3_main_chaos	wh3_main_chaos_region_marienburg	p535 s536 o534
wh3_main_combi	wh3_main_combi_region_lothern	s107 p106 o105
wh3_main_combi	wh3_main_combi_region_pfeildorf	s548 p464
wh3_main_chaos	wh3_dlc20_chaos_region_neuland	p475 o494 s476
wh3_main_combi	wh3_main_combi_region_iron_storm	p261 s262
wh3_main_combi	wh3_main_combi_region_shrine_of_sotek	o494 s130 p305
wh3_main_combi	wh3_main_combi_region_chill_road	s476 p475
wh3_main_chaos	wh3_main_chaos_region_the_monolith_of_kjarl_deathaxe	p475 s476 o494
wh3_main_combi	wh3_main_combi_region_temple_of_tlencan	s476 o494 p305
wh3_main_combi	wh3_main_combi_region_pigbarter	p16 s17
wh3_main_combi	wh3_main_combi_region_the_maw_gate	p171 s277
wh3_main_chaos	wh3_main_chaos_region_karak_azorn	p464 s399
wh3_main_chaos	wh3_main_chaos_region_blood_haven	s195 p194
wh3_main_combi	wh3_main_combi_region_ash_ridge_mountains	s463 p475
wh3_main_combi	wh3_main_combi_region_the_howling_citadel	s227 p226
wh3_main_chaos	wh3_main_chaos_region_hell_pit	s80 p79
wh3_main_combi	wh3_main_combi_region_qiang	s476 p475
wh3_main_combi	wh3_main_combi_region_tower_of_the_stars	s342 p53 o494
wh3_main_combi	wh3_main_combi_region_the_fortress_of_vorag	p464 s457
wh3_main_chaos	wh3_main_chaos_region_plesk	s278 p475
wh3_main_combi	wh3_main_combi_region_dread_rock	o494 p304 s465
wh3_main_chaos	wh3_main_chaos_region_mines_of_gorgoth	s479 p475
wh3_main_combi	wh3_main_combi_region_shagrath	p305 s476 o494
wh3_main_combi	wh3_main_combi_region_varg_camp	p305 o494 s489
wh3_main_chaos	wh3_main_chaos_region_laurelorn_forest	s104 p103
wh3_main_chaos	wh3_main_chaos_region_chasm_of_torment	s476 p475
wh3_main_combi	wh3_main_combi_region_zhizhu	s476 p475
wh3_main_combi	wh3_main_combi_region_temple_of_skulls	p464 s470
wh3_main_combi	wh3_main_combi_region_matorca	s484 p305 o494
wh3_main_combi	wh3_main_combi_region_mousillon	p108 o494 s109
wh3_main_combi	wh3_main_combi_region_the_blood_hall	o494 p304 s465
wh3_main_combi	wh3_main_combi_region_phoenix_gate	s60 p59
wh3_main_combi	wh3_main_combi_region_the_galleons_graveyard	o64 s66 p65
wh3_main_combi	wh3_main_combi_region_great_hall_of_greasus	s389 p289
wh3_main_combi	wh3_main_combi_region_karak_vrag	p464 s400
wh3_main_combi	wh3_main_combi_region_skeggi	s134 p133 o494
wh3_main_combi	wh3_main_combi_region_karak_bhufdar	p475 s485
wh3_main_combi	wh3_main_combi_region_shattered_stone_isle	p305 o494 s476
wh3_main_combi	wh3_main_combi_region_red_fortress	s351 p418
wh3_main_chaos	wh3_main_chaos_region_sjoktraken	p475 o494 s476
wh3_main_combi	wh3_main_combi_region_thrice_cursed_peak	s476 p475
wh3_main_combi	wh3_main_combi_region_stormvrack_mount	p475 s476
wh3_main_combi	wh3_main_combi_region_grey_rock_point	s476 o494 p305
wh3_main_combi	wh3_main_combi_region_oyxl	s113 p112
wh3_main_combi	wh3_main_combi_region_sun_tree_glades	s463 p475
wh3_main_combi	wh3_main_combi_region_plain_of_dogs	p464 s465
wh3_main_combi	wh3_main_combi_region_evershale	p305 o494 s476
wh3_main_combi	wh3_main_combi_region_troll_fjord	s489 p305 o494
wh3_main_combi	wh3_main_combi_region_ironfrost	p475 s489
wh3_main_combi	wh3_main_combi_region_gnobbly_gorge	s476 p475
wh3_main_combi	wh3_main_combi_region_sump_pit	p475 s476
wh3_main_chaos	wh3_main_chaos_region_castle_drakenhof	p507 s508
wh3_main_combi	wh3_main_combi_region_iron_rock	s84 p83
wh3_main_combi	wh3_main_combi_region_shroktak_mount	s476 p475
wh3_main_prologue	wh3_prologue_region_mirror_marshes_the_loci_palace	p365 s366
wh3_main_chaos	wh3_main_chaos_region_temple_of_heimkel	p475 s476
wh3_main_chaos	wh3_main_chaos_region_howling_rock	p475 s476
wh3_main_combi	wh3_main_combi_region_stonemine_tower	p305 s476 o494
wh3_main_combi	wh3_main_combi_region_crooked_fang_fort	p158 s465
wh3_main_combi	wh3_main_combi_region_karak_azul	p521 s522
wh3_main_chaos	wh3_main_chaos_region_leblya	s476 p475
wh3_main_combi	wh3_main_combi_region_har_kaldra	s476 p475
wh3_main_combi	wh3_main_combi_region_yhetee_peak	s182 p464
wh3_main_combi	wh3_main_combi_region_dringorackaz	s485 p475
wh3_main_combi	wh3_main_combi_region_bleak_hold_fortress	p475 s269
wh3_main_combi	wh3_main_combi_region_marienburg	s536 p535 o534
wh3_main_combi	wh3_main_combi_region_karak_angazhar	s482 p475
wh3_main_combi	wh3_main_combi_region_altar_of_ultimate_darkness	p40 s41
wh3_main_chaos	wh3_main_chaos_region_qiang	s476 p475
wh3_main_combi	wh3_main_combi_region_wizard_caliphs_palace	s465 p464
wh3_main_combi	wh3_main_combi_region_shrine_of_the_alchemist	p475 s476
wh3_main_chaos	wh3_main_chaos_region_iron_storm	s262 p261
wh3_main_chaos	wh3_main_chaos_region_mount_gunbad	s282 p475
wh3_main_combi	wh3_main_combi_region_karak_azorn	p464 s399
wh3_main_combi	wh3_main_combi_region_the_black_pit	s268 p464
wh3_main_combi	wh3_main_combi_region_tor_yvresse	s149 p25
wh3_main_combi	wh3_main_combi_region_dietershafen	o494 p305 s478
wh3_main_chaos	wh3_main_chaos_region_kurak_peak	p475 s476
wh3_main_combi	wh3_main_combi_region_altdorf	p495 s496 o494
wh3_main_combi	wh3_main_combi_region_vauls_anvil_naggaroth	p50 s51
wh3_main_combi	wh3_main_combi_region_tower_of_ashung	p464 s465
wh3_main_combi	wh3_main_combi_region_bechafen	s471 p464
wh3_main_chaos	wh3_main_chaos_region_sepukzy	p475 s476
wh3_main_combi	wh3_main_combi_region_quatar	p7 s8
wh3_main_combi	wh3_main_combi_region_amblepeak	s173 p475
wh3_main_chaos	wh3_main_chaos_region_the_falls_of_doom	p475 s476
wh3_main_combi	wh3_main_combi_region_lybaras	s38 o494 p305
wh3_main_combi	wh3_main_combi_region_nahuontl	o494 p305 s485
wh3_main_combi	wh3_main_combi_region_dragon_fang_mount	s317 p380 o14
wh3_main_combi	wh3_main_combi_region_chimai	o494 p305 s476
wh3_main_combi	wh3_main_combi_region_port_reaver	s476 p305 o494
wh3_main_combi	wh3_main_combi_region_waili_village	p475 s484
wh3_main_combi	wh3_main_combi_region_mangrove_coast	o494 s36 p305
wh3_main_combi	wh3_main_combi_region_fu_hung	p386 s387 o494
wh3_main_combi	wh3_main_combi_region_hidden_landing	p305 o494 s476
wh3_main_combi	wh3_main_combi_region_desolation_ridge	s303 p302
wh3_main_chaos	wh3_main_chaos_region_altar_of_the_crimson_harvest	p185 s186
wh3_main_chaos	wh3_main_chaos_region_pack_ice_bay	o494 p475 s476
wh3_main_chaos	wh3_main_chaos_region_hissing_pits	p475 s476
wh3_main_combi	wh3_main_combi_region_bitter_bay	o494 p248 s249
wh3_main_combi	wh3_main_combi_region_tlanxla	s339 p443
wh3_main_combi	wh3_main_combi_region_vitevo	s476 p475
wh3_main_combi	wh3_main_combi_region_forest_of_gloom	p557 s26
wh3_main_combi	wh3_main_combi_region_stormhenge	s297 p296
wh3_main_combi	wh3_main_combi_region_marks_of_the_old_ones	s476 p475
wh3_main_combi	wh3_main_combi_region_the_moon_shard	p305 o494 s485
wh3_main_combi	wh3_main_combi_region_shi_long	p423 o494 s332
wh3_main_combi	wh3_main_combi_region_kemperbad	p475 s476
wh3_main_chaos	wh3_main_chaos_region_bloodwind_keep	s372 p371
wh3_main_combi	wh3_main_combi_region_fort_straghov	s476 p475
wh3_main_combi	wh3_main_combi_region_niedling	s476 p475
wh3_main_combi	wh3_main_combi_region_ming_zhu	s476 p475
wh3_main_combi	wh3_main_combi_region_kislev	s360 p359
wh3_main_chaos	wh3_main_chaos_region_infernius	p214 s398
wh3_main_combi	wh3_main_combi_region_arnheim	o494 s308 p52
wh3_main_combi	wh3_main_combi_region_palace_of_princes	s416 p475
wh3_main_combi	wh3_main_combi_region_dargoth	s37 p475
wh3_main_chaos	wh3_main_chaos_region_the_challenge_stone	p475 s427
wh3_main_combi	wh3_main_combi_region_subatuun	s482 p475
wh3_main_combi	wh3_main_combi_region_antoch	s476 p475
wh3_main_chaos	wh3_main_chaos_region_city_of_splinters	s200 p199
wh3_main_combi	wh3_main_combi_region_yetchitch	p475 s476
wh3_main_chaos	wh3_main_chaos_region_fortress_of_the_damned	s385 p384
wh3_main_chaos	wh3_main_chaos_region_icedrake_fjord	s476 o494 p475
wh3_main_chaos	wh3_main_chaos_region_uzkulak	s267 p266
wh3_main_combi	wh3_main_combi_region_rotten_stone	p306 s307
wh3_main_prologue	wh3_prologue_region_the_falls_of_circatrex_the_rookery	s487 p464
wh3_main_combi	wh3_main_combi_region_li_zhu	s486 o494 p305
wh3_main_chaos	wh3_dlc20_chaos_region_losteriksons_landing	o494 p475 s476
wh3_main_combi	wh3_main_combi_region_tower_of_gorgoth	p444 s445
wh3_main_combi	wh3_main_combi_region_baleful_hills	s482 p475
wh3_main_chaos	wh3_main_chaos_region_the_red_abyss	s477 p475
wh3_main_combi	wh3_main_combi_region_the_witchwood	s29 p557
wh3_main_combi	wh3_main_combi_region_floating_village	s476 p475
wh3_main_combi	wh3_main_combi_region_deaths_head_monoliths	o494 s476 p305
wh3_main_chaos	wh3_main_chaos_region_igerov	p475 s476
wh3_main_chaos	wh3_main_chaos_region_cliff_of_beasts	p475 s476
wh3_main_combi	wh3_main_combi_region_terracotta_graveyard	s476 p475
wh3_main_chaos	wh3_main_chaos_region_nonchang	p475 s476
wh3_main_combi	wh3_main_combi_region_khazid_bordkarag	p475 s401
wh3_main_combi	wh3_main_combi_region_blizzardpeak	s484 p475
wh3_main_combi	wh3_main_combi_region_kunlan	s465 p464
wh3_main_combi	wh3_main_combi_region_dragons_crossroad	p475 s476
wh3_main_combi	wh3_main_combi_region_brass_keep	s196 p373
wh3_main_combi	wh3_main_combi_region_cragroth_deep	p475 s34
wh3_main_combi	wh3_main_combi_region_castle_alexandronov	s270 o494 p305
wh3_main_combi	wh3_main_combi_region_karak_azgal	p160 s520
wh3_main_chaos	wh3_main_chaos_region_longship_graveyard	p475 o494 s476
wh3_main_combi	wh3_main_combi_region_li_temple	p475 s403
wh3_main_combi	wh3_main_combi_region_the_palace_of_ruin	p435 s228
wh3_main_combi	wh3_main_combi_region_karak_hirn	p464 s523
wh3_main_combi	wh3_main_combi_region_tor_dranil	o494 p305 s476
wh3_main_combi	wh3_main_combi_region_blacklight_tower	p304 o494 s465
wh3_main_combi	wh3_main_combi_region_worlds_edge_archway	s476 p475
wh3_main_prologue	wh3_prologue_region_plains_of_brass_the_tah_camp	s487 p464
wh3_main_combi	wh3_main_combi_region_dai_cheng	o494 p305 s476
wh3_main_chaos	wh3_main_chaos_region_zoishenk	p475 s476
wh3_main_combi	wh3_main_combi_region_praag	s362 p361
wh3_main_combi	wh3_main_combi_region_miragliano	o494 p540 s541
wh3_main_chaos	wh3_main_chaos_region_glut_port	o494 s476 p475
wh3_main_combi	wh3_main_combi_region_black_tower_of_arkhan	p464 s2
wh3_main_combi	wh3_main_combi_region_isle_of_wights	s489 o85 p305
wh3_main_combi	wh3_main_combi_region_skrap_towers	p475 s476
wh3_main_combi	wh3_main_combi_region_the_frozen_city	s186 p185
wh3_main_chaos	wh3_main_chaos_region_osterwald	p475 s476
wh3_main_combi	wh3_main_combi_region_petrified_forest	p475 s476
wh3_main_chaos	wh3_main_chaos_region_dushyka	p475 s476
wh3_main_chaos	wh3_main_chaos_region_zhufbar	p464 s468
wh3_main_chaos	wh3_main_chaos_region_mount_cragg	p475 s476
wh3_main_chaos	wh3_main_chaos_region_foul_fortress	p185 s186
wh3_main_combi	wh3_main_combi_region_riffraffa	p475 s476
wh3_main_chaos	wh3_main_chaos_region_the_tower_of_torment	s476 p475
wh3_main_chaos	wh3_main_chaos_region_winter_pyre	p475 s476
wh3_main_chaos	wh3_main_chaos_region_dharko_wharf	o494 p475 s476
wh3_main_combi	wh3_main_combi_region_okkams_forever_maze	p217 s218
wh3_main_chaos	wh3_main_chaos_region_the_gallows_tree	s225 p224
wh3_main_combi	wh3_main_combi_region_martek	s480 p475
wh3_main_combi	wh3_main_combi_region_dagraks_end	s186 p185
wh3_main_combi	wh3_main_combi_region_mountain_pass	s330 p412
wh3_main_combi	wh3_main_combi_region_haichai	o494 s276 p304
wh3_main_chaos	wh3_main_chaos_region_xing_po	s453 p452
wh3_main_combi	wh3_main_combi_region_karak_kadrin	p525 s524
wh3_main_combi	wh3_main_combi_region_graeling_moot	p475 s489
wh3_main_chaos	wh3_main_chaos_region_norden	p475 o494 s476
wh3_main_combi	wh3_main_combi_region_fateweavers_crevasse	s275 p185
wh3_main_combi	wh3_main_combi_region_zhanshi	s168 p304 o494
wh3_main_combi	wh3_main_combi_region_castle_bastonne	s465 p464
wh3_main_combi	wh3_main_combi_region_karak_ungor	s527 p475
wh3_main_combi	wh3_main_combi_region_hexoatl	p81 s82
wh3_main_combi	wh3_main_combi_region_howling_rock	p475 s476
wh3_main_chaos	wh3_main_chaos_region_wurtbad	s474 p464
wh3_main_combi	wh3_main_combi_region_fyrus	p475 s15
wh3_main_combi	wh3_main_combi_region_varenka_hills	s478 p475
wh3_main_combi	wh3_main_combi_region_the_haunted_forest	s353 p557
wh3_main_combi	wh3_main_combi_region_bhagar	p0 s1
wh3_main_chaos	wh3_main_chaos_region_blood_mountain	p367 s369
wh3_main_combi	wh3_main_combi_region_venom_glade	s478 p475
wh3_main_chaos	wh3_dlc20_chaos_region_citadel_of_lead	p197 s198
wh3_main_prologue	wh3_prologue_region_crimson_vale_hall_of_the_keepers	p363 s364
wh3_main_combi	wh3_main_combi_region_altar_of_facades	s476 p475
wh3_main_combi	wh3_main_combi_region_nan_li	s476 p475
wh3_main_chaos	wh3_main_chaos_region_frozen_landing	p208 o494 s209
wh3_main_combi	wh3_main_combi_region_gateway_to_khuresh	s166 p464
wh3_main_combi	wh3_main_combi_region_gronti_mingol	p53 s310 o494
wh3_main_combi	wh3_main_combi_region_grimtop	s321 p391
wh3_main_combi	wh3_main_combi_region_al_haikk	o494 p304 s472
wh3_main_chaos	wh3_main_chaos_region_waldenhof	s476 p475
wh3_main_combi	wh3_main_combi_region_fortress_of_eyes	p475 s476
wh3_main_combi	wh3_main_combi_region_po_mei	p464 s469
wh3_main_combi	wh3_main_combi_region_middenheim	p538 s539
wh3_main_chaos	wh3_main_chaos_region_stormvrack_mount	s476 p475
wh3_main_chaos	wh3_main_chaos_region_yetchitch	s476 p475
wh3_main_combi	wh3_main_combi_region_flayed_rock	p464 s254
wh3_main_combi	wh3_main_combi_region_forest_of_arnheim	p475 s485
wh3_main_chaos	wh3_main_chaos_region_shambletown	s482 p475
wh3_main_chaos	wh3_main_chaos_region_mount_grimfang	p475 s476
wh3_main_combi	wh3_main_combi_region_luccini	o494 s531 p305
wh3_main_combi	wh3_main_combi_region_statues_of_the_gods	s463 p475
wh3_main_combi	wh3_main_combi_region_chupayotl	o494 s479 p305
wh3_main_combi	wh3_main_combi_region_the_high_place	s476 p170
wh3_main_combi	wh3_main_combi_region_the_bone_gulch	p475 s456
wh3_main_combi	wh3_main_combi_region_hualotal	s465 p464
wh3_main_combi	wh3_main_combi_region_shrine_of_khaine	p128 s129
wh3_main_combi	wh3_main_combi_region_igerov	s476 p475
wh3_main_combi	wh3_main_combi_region_black_crag	p498 s499
wh3_main_combi	wh3_main_combi_region_great_desert_of_araby	s431 p475
wh3_main_combi	wh3_main_combi_region_hell_pit	p79 s80
wh3_main_combi	wh3_main_combi_region_quetza	p118 s119
wh3_main_combi	wh3_main_combi_region_scarpels_lair	s34 p475
wh3_main_combi	wh3_main_combi_region_agrul_migdhal	s463 p475
wh3_main_combi	wh3_main_combi_region_cliff_of_beasts	s314 p376
wh3_main_combi	wh3_main_combi_region_silver_pinnacle	s284 p163
wh3_main_combi	wh3_main_combi_region_cairn_thel	p475 s477
wh3_main_combi	wh3_main_combi_region_swamp_town	p305 s483 o494
wh3_main_combi	wh3_main_combi_region_mount_thug	p475 s177
wh3_main_combi	wh3_main_combi_region_yuatek	p475 s36
wh3_main_chaos	wh3_main_chaos_region_fort_bergbres	p475 s476
wh3_main_chaos	wh3_main_chaos_region_palace_of_princes	p475 s416
wh3_main_combi	wh3_main_combi_region_numas	p5 s6
wh3_main_chaos	wh3_main_chaos_region_sabre_mountain	s476 p475
wh3_main_chaos	wh3_main_chaos_region_the_silver_pinnacle	s284 p464
wh3_main_chaos	wh3_main_chaos_region_zanbaijin	s476 p475
wh3_main_combi	wh3_main_combi_region_nagrar	s485 p305 o494
wh3_main_combi	wh3_main_combi_region_fortress_of_the_damned	o494 s207 p206
wh3_main_combi	wh3_main_combi_region_monolith_of_flesh	s492 p305 o494
wh3_main_combi	wh3_main_combi_region_ssildra_tor	s486 p475
wh3_main_combi	wh3_main_combi_region_bloodwind_keep	p242 s350
wh3_main_combi	wh3_main_combi_region_foundry_of_bones	s476 p475
wh3_main_chaos	wh3_main_chaos_region_dragon_gate	s355 p354
wh3_main_combi	wh3_main_combi_region_castle_templehof	s473 p464
wh3_main_combi	wh3_main_combi_region_shi_wu	p162 s184
wh3_main_chaos	wh3_main_chaos_region_serpent_jetty	s476 p475 o494
wh3_main_combi	wh3_main_combi_region_longship_graveyard	p305 o493 s489
wh3_main_chaos	wh3_main_chaos_region_the_fortress_of_vorag	s457 p464
wh3_main_chaos	wh3_main_chaos_region_great_hall_of_greasus	s389 p289
wh3_main_combi	wh3_main_combi_region_plain_of_tuskers	o494 p305 s478
wh3_main_chaos	wh3_main_chaos_region_zamoski	p475 s476
wh3_main_combi	wh3_main_combi_region_gorssel	s484 p475
wh3_main_chaos	wh3_main_chaos_region_snake_gate	p354 s355
wh3_main_combi	wh3_main_combi_region_ruins_end	s476 p305 o494
wh3_main_combi	wh3_main_combi_region_karak_azgaraz	s476 p475
wh3_main_combi	wh3_main_combi_region_mount_squighorn	p475 s476
wh3_main_combi	wh3_main_combi_region_the_forbidden_citadel	s223 p222
wh3_main_chaos	wh3_main_chaos_region_village_of_the_tigermen	s33 p464
wh3_main_chaos	wh3_main_chaos_region_karak_vlag	p464 s469
wh3_main_combi	wh3_main_combi_region_weismund	s485 p475
wh3_main_combi	wh3_main_combi_region_kaiax	s465 o494 p304
wh3_main_combi	wh3_main_combi_region_the_skull_carvers_abode	s479 p475
wh3_main_combi	wh3_main_combi_region_village_of_the_tigermen	s176 p172
wh3_main_combi	wh3_main_combi_region_the_blighted_grove	s334 p426
wh3_main_combi	wh3_main_combi_region_karak_eight_peaks	s516 p515
wh3_main_combi	wh3_main_combi_region_darkhold	s476 p475
wh3_main_combi	wh3_main_combi_region_the_writhing_fortress	s189 p237
wh3_main_combi	wh3_main_combi_region_sunken_khernarch	p475 s476
wh3_main_combi	wh3_main_combi_region_great_skull_lakes	p390 s320
wh3_main_combi	wh3_main_combi_region_the_monolith_of_katam	p185 o494 s542
wh3_main_chaos	wh3_main_chaos_region_the_shifting_monolith	s230 p229
wh3_main_combi	wh3_main_combi_region_ironspike	s480 p475
wh3_main_prologue	wh3_prologue_region_river_of_the_flux_the_fording_place	s364 p363
wh3_main_combi	wh3_main_combi_region_jade_wind_mountain	s291 p290
wh3_main_combi	wh3_main_combi_region_wissenburg	p475 s481
wh3_main_combi	wh3_main_combi_region_mount_gunbad	p544 s545
wh3_main_combi	wh3_main_combi_region_nuja	o494 s38 p305
wh3_main_combi	wh3_main_combi_region_lost_plateau	s476 p475
wh3_main_combi	wh3_main_combi_region_southern_outpost	p475 s476
wh3_main_combi	wh3_main_combi_region_shang_yang	s422 p421
wh3_main_combi	wh3_main_combi_region_temple_of_khaine	p475 s476
wh3_main_combi	wh3_main_combi_region_tobaro	p305 s553 o494
wh3_main_combi	wh3_main_combi_region_the_folly_of_malofex	s36 p305 o494
wh3_main_chaos	wh3_main_chaos_region_troll_fjord	o494 s241 p240
wh3_main_combi	wh3_main_combi_region_rasetra	s476 p475
wh3_main_combi	wh3_main_combi_region_fu_chow	o458 s165 p304
wh3_main_combi	wh3_main_combi_region_macu_peaks	p475 s481
wh3_main_combi	wh3_main_combi_region_the_forest_of_decay	s335 p429
wh3_main_chaos	wh3_main_chaos_region_bolgasgrad	s476 p475
wh3_main_combi	wh3_main_combi_region_temple_of_kara	o494 s476 p305
wh3_main_combi	wh3_main_combi_region_vauls_anvil_ulthuan	p77 s78
wh3_main_combi	wh3_main_combi_region_tor_achare	p139 s140
wh3_main_chaos	wh3_main_chaos_region_kraka_drak	p99 s100
wh3_main_chaos	wh3_main_chaos_region_pigbarter	s38 p475
wh3_main_chaos	wh3_main_chaos_region_crookback_mountain	s468 p464
wh3_main_chaos	wh3_main_chaos_region_the_tower_of_khrakk	s476 p475
wh3_main_combi	wh3_main_combi_region_tower_of_the_sun	p52 s343 o494
wh3_main_combi	wh3_main_combi_region_karag_dromar	s519 p518
wh3_main_combi	wh3_main_combi_region_castle_artois	p464 s473
wh3_main_combi	wh3_main_combi_region_spektazuma	p464 s32
wh3_main_combi	wh3_main_combi_region_kings_glade	p559 s560
wh3_main_chaos	wh3_main_chaos_region_mount_grey_hag	p475 s476
wh3_main_combi	wh3_main_combi_region_quittax	p475 s476
wh3_main_chaos	wh3_main_chaos_region_icespewer	p475 s476
wh3_main_combi	wh3_main_combi_region_tralinia	p305 s476 o494
wh3_main_combi	wh3_main_combi_region_fort_bergbres	p54 s205
wh3_main_combi	wh3_main_combi_region_bay_of_blades	o494 p305 s497
wh3_main_combi	wh3_main_combi_region_el_kalabad	p475 s477
wh3_main_combi	wh3_main_combi_region_wreckers_point	o494 s476 p305
wh3_main_combi	wh3_main_combi_region_tor_surpindar	s476 p475
wh3_main_combi	wh3_main_combi_region_zlatlan	p304 s32 o494
wh3_main_combi	wh3_main_combi_region_mahrak	p475 s476
wh3_main_combi	wh3_main_combi_region_crucible_of_delights	s481 p475
wh3_main_chaos	wh3_main_chaos_region_granite_spikes	p475 s476
wh3_main_combi	wh3_main_combi_region_port_of_secrets	o494 p305 s476
wh3_main_combi	wh3_main_combi_region_helmgart	p54 s205
wh3_main_chaos	wh3_main_chaos_region_fortress_of_eyes	p475 s476
wh3_main_combi	wh3_main_combi_region_black_fang	p475 s476
wh3_main_combi	wh3_main_combi_region_quenelles	s482 p475
wh3_main_combi	wh3_main_combi_region_ubersreik	s554 p475
wh3_main_combi	wh3_main_combi_region_whitepeak	o494 s481 p305
wh3_main_combi	wh3_main_combi_region_mount_arachnos	s24 p23
wh3_main_combi	wh3_main_combi_region_the_tower_of_khrakk	p238 s239
wh3_main_combi	wh3_main_combi_region_temple_of_heimkel	o493 p305 s480
wh3_main_chaos	wh3_main_chaos_region_dragon_fang_mount	o494 p464 s345
wh3_main_combi	wh3_main_combi_region_karaz_a_karak	s529 p528
wh3_main_chaos	wh3_main_chaos_region_kusel	p475 s484
wh3_main_combi	wh3_dlc23_combi_region_blasted_expanse	p475 s476
wh3_main_combi	wh3_main_combi_region_the_gallows_tree	s286 p475
wh3_main_chaos	wh3_main_chaos_region_fort_dolganyeir	s274 p475
wh3_main_chaos	wh3_main_chaos_region_the_tower_of_gorgoth	s445 p444
wh3_main_chaos	wh3_main_chaos_region_karak_azgaraz	s476 p475
wh3_main_chaos	wh3_main_chaos_region_kislev	p359 s360
wh3_main_chaos	wh3_main_chaos_region_bay_of_blades	p475 s476 o494
wh3_main_combi	wh3_main_combi_region_kradtommen	p475 s476
wh3_main_combi	wh3_main_combi_region_tlaxtlan	p137 s138
wh3_main_combi	wh3_main_combi_region_eagle_eyries	s34 p475
wh3_main_chaos	wh3_main_chaos_region_the_folly_of_malofex	s476 p475
wh3_main_combi	wh3_main_combi_region_shrine_of_asuryan	s127 p126
wh3_main_combi	wh3_main_combi_region_fort_jakova	s468 p464
wh3_main_chaos	wh3_main_chaos_region_gerslev	p475 s476
wh3_main_combi	wh3_main_combi_region_the_never_ending_chasm	p475 s476
wh3_main_chaos	wh3_main_chaos_region_weng_chang	s451 p450
wh3_main_combi	wh3_main_combi_region_averheim	p464 s465
wh3_main_combi	wh3_main_combi_region_serpent_coast	s476 p305 o494
wh3_main_combi	wh3_main_combi_region_the_challenge_stone	s352 p185
wh3_main_combi	wh3_main_combi_region_mine_of_the_bearded_skulls	p30 s31
wh3_main_chaos	wh3_main_chaos_region_shrine_of_the_alchemist	p475 s478
wh3_main_combi	wh3_main_combi_region_xen_wu	s476 p475
wh3_main_combi	wh3_main_combi_region_titans_notch	s178 p475
wh3_main_chaos	wh3_dlc23_chaos_region_flayed_rock	p255 s256
wh3_main_chaos	wh3_main_chaos_region_broekwater	s476 p475
wh3_main_combi	wh3_main_combi_region_barag_dawazbag	s476 p475
wh3_main_combi	wh3_main_combi_region_blood_mountain	s369 p368
wh3_main_combi	wh3_main_combi_region_mount_athull	s329 p411
wh3_main_combi	wh3_main_combi_region_tor_elyr	p145 s146
wh3_main_chaos	wh3_main_chaos_region_dragons_death	p475 s476
wh3_main_combi	wh3_main_combi_region_salzenmund	s123 p122
wh3_main_chaos	wh3_main_chaos_region_pillar_of_skulls	s358 p475
wh3_main_chaos	wh3_main_chaos_region_kunlan	s479 p475
wh3_main_chaos	wh3_main_chaos_region_middenheim	s283 p185
wh3_main_chaos	wh3_main_chaos_region_karak_dum	p475 s476
wh3_main_chaos	wh3_main_chaos_region_volksgrad	s485 p475
wh3_main_chaos	wh3_main_chaos_region_karak_raziak	s476 p475
wh3_main_combi	wh3_main_combi_region_waterfall_palace	s558 p557
wh3_main_chaos	wh3_main_chaos_region_zhanshi	s465 p464
wh3_main_combi	wh3_main_combi_region_misty_mountain	s405 p475
wh3_main_prologue	wh3_prologue_region_mountain_pass_kislev_refuge	p365 s366
wh3_main_combi	wh3_main_combi_region_granite_massif	s476 p475
wh3_main_combi	wh3_main_combi_region_the_black_forests	p475 s476
wh3_main_chaos	wh3_main_chaos_region_darkhold	p475 s456
wh3_main_combi	wh3_main_combi_region_sorcerers_islands	o494 s476 p305
wh3_main_combi	wh3_main_combi_region_wellsprings_of_eternity	p475 s482
wh3_main_combi	wh3_main_combi_region_kraka_drak	s100 p99
wh3_main_combi	wh3_main_combi_region_naggarond	s111 o494 p110
wh3_main_combi	wh3_main_combi_region_tor_saroir	p475 s485
wh3_main_chaos	wh3_main_chaos_region_gristle_valley	p392 s393
wh3_main_combi	wh3_main_combi_region_sulpharets	s476 p475
wh3_main_combi	wh3_main_combi_region_kappelburg	s485 p475
wh3_main_combi	wh3_main_combi_region_steingart	p475 s476
wh3_main_combi	wh3_main_combi_region_middenstag	p475 s476
wh3_main_combi	wh3_main_combi_region_flensburg	s476 p475
wh3_main_combi	wh3_main_combi_region_tlax	s476 p475
wh3_main_combi	wh3_main_combi_region_clarak_spire	p464 s375
wh3_main_combi	wh3_main_combi_region_the_sentinels	p263 s264
wh3_main_chaos	wh3_main_chaos_region_the_monolith_of_the_void	p475 s476
wh3_main_combi	wh3_main_combi_region_norden	p305 o494 s476
wh3_main_combi	wh3_main_combi_region_floating_mountain	p475 s481
wh3_main_combi	wh3_main_combi_region_xlanhuapec	s153 p152
wh3_main_chaos	wh3_main_chaos_region_titans_notch	s476 p475
wh3_main_combi	wh3_main_combi_region_zandri	s10 p9 o494
wh3_main_combi	wh3_main_combi_region_broken_mount	s299 p298
wh3_main_combi	wh3_main_combi_region_sabre_mountain	s420 p464
wh3_main_chaos	wh3_main_chaos_region_shi_long	s476 p475
wh3_main_chaos	wh3_main_chaos_region_the_forbidden_citadel	p222 s223
wh3_main_prologue	wh3_prologue_region_frozen_plains_dervingard	s488 p363
wh3_main_chaos	wh3_main_chaos_region_praag	p361 s362
wh3_main_combi	wh3_main_combi_region_castle_of_splendour	o494 s272 p374
wh3_main_chaos	wh3_main_chaos_region_bridge_of_heaven	s476 p475
wh3_main_combi	wh3_main_combi_region_konquata	p98 s530
wh3_main_combi	wh3_main_combi_region_shiyamas_rest	s424 p475
wh3_main_combi	wh3_main_combi_region_volcanos_heart	p475 s476
wh3_main_combi	wh3_main_combi_region_bilious_cliffs	p305 s476 o494
wh3_main_combi	wh3_main_combi_region_zavastra	s476 p475
wh3_main_combi	wh3_main_combi_region_the_blood_swamps	p305 s476 o494
wh3_main_combi	wh3_main_combi_region_monument_of_izzatal	p475 s476
wh3_main_chaos	wh3_main_chaos_region_graeling_moot	s489 p475 o494
wh3_main_combi	wh3_main_combi_region_sudenburg	p304 s474 o494
wh3_main_combi	wh3_main_combi_region_bordeleaux	s502 o500 p501
wh3_main_combi	wh3_main_combi_region_tor_anlec	p141 o494 s142
wh3_main_combi	wh3_main_combi_region_spitepeak	s476 p475
wh3_main_combi	wh3_main_combi_region_castle_von_rauken	p475 s476
wh3_main_combi	wh3_main_combi_region_karag_orrud	p88 s89
wh3_main_chaos	wh3_main_chaos_region_fort_straghov	p475 s476
wh3_main_combi	wh3_dlc20_combi_region_krudenwald	s476 p475
wh3_main_combi	wh3_main_combi_region_nuln	p546 s547
wh3_main_chaos	wh3_main_chaos_region_bridge_of_brass	s476 p475
wh3_main_combi	wh3_main_combi_region_laurelorn_forest	p103 s104
wh3_main_combi	wh3_main_combi_region_karag_dron	s485 p475
wh3_main_combi	wh3_main_combi_region_fort_oberstyre	s476 p475
wh3_main_combi	wh3_main_combi_region_the_gates_of_zharr	p430 s336
wh3_main_combi	wh3_main_combi_region_weng_chang	p450 s451
wh3_main_combi	wh3_main_combi_region_isle_of_the_crimson_skull	o494 s465 p304
wh3_main_combi	wh3_main_combi_region_grimhold	p475 s476
wh3_main_combi	wh3_main_combi_region_galbaraz	p62 s63
wh3_main_combi	wh3_main_combi_region_naglfari_plain	p475 s491
wh3_main_combi	wh3_main_combi_region_spite_reach	p475 s486
wh3_main_combi	wh3_main_combi_region_ghrond	s68 p67
wh3_main_combi	wh3_main_combi_region_mount_silverspear	p475 s481
wh3_main_chaos	wh3_dlc23_chaos_region_desolation_of_drakenmoor	p475 s476
wh3_main_combi	wh3_main_combi_region_infernius	s476 p475
wh3_main_combi	wh3_main_combi_region_tribeslaughter	p475 s476
wh3_main_chaos	wh3_main_chaos_region_city_of_monkeys	s482 p475
wh3_main_combi	wh3_main_combi_region_the_black_pillar	p475 s477
wh3_main_combi	wh3_main_combi_region_beichai	s484 p305 o494
wh3_main_combi	wh3_main_combi_region_montenas	p408 s328
wh3_main_combi	wh3_main_combi_region_the_great_arena	p475 s476
wh3_main_chaos	wh3_dlc23_chaos_region_anurells_tomb	p246 s247
wh3_main_chaos	wh3_main_chaos_region_fallen_city	s481 p475
wh3_main_combi	wh3_main_combi_region_temple_of_addaioth	s476 p475
wh3_main_combi	wh3_main_combi_region_ekrund	s462 p159
wh3_main_combi	wh3_main_combi_region_the_golden_tower	s70 p69
wh3_main_combi	wh3_main_combi_region_skavenblight	p131 s132
wh3_main_combi	wh3_main_combi_region_shattered_cove	p305 o494 s485
wh3_main_chaos	wh3_main_chaos_region_skrap_towers	s476 p475
wh3_main_combi	wh3_main_combi_region_celestial_monastery	s486 p475
wh3_main_combi	wh3_main_combi_region_pillar_of_skulls	p475 s358
wh3_main_chaos	wh3_main_chaos_region_brass_keep	s196 p185
wh3_main_combi	wh3_main_combi_region_cuexotl	s288 p287
wh3_main_combi	wh3_main_combi_region_karak_raziak	s476 p475
wh3_main_combi	wh3_main_combi_region_pox_marsh	p305 o494 s483
wh3_main_chaos	wh3_main_chaos_region_ubersreik	p475 s476
wh3_main_chaos	wh3_main_chaos_region_wurzen	s476 p475
wh3_main_combi	wh3_main_combi_region_altar_of_the_horned_rat	o494 s465 p304
wh3_main_combi	wh3_main_combi_region_sentinels_of_xeti	s476 p475
wh3_main_combi	wh3_main_combi_region_pahuax	s293 p292
wh3_main_combi	wh3_main_combi_region_rackdo_gorge	p417 s331
wh3_main_combi	wh3_main_combi_region_the_tower_of_flies	s338 p439
wh3_main_combi	wh3_main_combi_region_volksgrad	p464 s446
wh3_main_combi	wh3_main_combi_region_ashrak	s476 p475
wh3_main_chaos	wh3_main_chaos_region_karak_kadrin	s524 p525
wh3_main_combi	wh3_main_combi_region_ziggurat_of_dawn	o494 s155 p154
wh3_main_combi	wh3_main_combi_region_dusk_peaks	s476 p475
wh3_main_chaos	wh3_main_chaos_region_fire_mouth	s346 p382
wh3_main_chaos	wh3_main_chaos_region_the_silvered_tower_of_sorcerers	s232 p231
wh3_main_chaos	wh3_main_chaos_region_doomkeep	p203 s204
wh3_main_chaos	wh3_dlc23_chaos_region_pillars_of_grungni	s465 p464
wh3_main_combi	wh3_main_combi_region_crookback_mountain	p19 s20
wh3_main_chaos	wh3_main_chaos_region_the_fetid_catacombs	s476 p475
wh3_main_combi	wh3_main_combi_region_black_iron_mine	s480 p475
wh3_main_combi	wh3_main_combi_region_the_volary	p236 s265
wh3_main_combi	wh3_main_combi_region_fallen_king_mountain	p475 s476
wh3_main_combi	wh3_main_combi_region_mount_grey_hag	s476 p475
wh3_main_chaos	wh3_main_chaos_region_foundry_of_bones	p475 s476
wh3_main_combi	wh3_main_combi_region_rothkar_spire	p475 s476
wh3_main_combi	wh3_main_combi_region_nan_gau	p413 s414
wh3_main_combi	wh3_main_combi_region_magritta	o494 s533 p532
wh3_main_combi	wh3_main_combi_region_karak_ziflin	p475 s477
wh3_main_chaos	wh3_main_chaos_region_red_fortress	p418 s419
wh3_main_chaos	wh3_main_chaos_region_grim_duraz	p464 s465
wh3_main_combi	wh3_main_combi_region_brionne	p305 s484 o494
wh3_main_combi	wh3_main_combi_region_blackstone_post	p44 s45
wh3_main_chaos	wh3_main_chaos_region_blackstone_tower	p475 s476
wh3_main_combi	wh3_main_combi_region_circle_of_destruction	p305 s476 o494
wh3_main_combi	wh3_main_combi_region_oreons_camp	p557 s39
wh3_main_combi	wh3_main_combi_region_tor_finu	p475 s480
wh3_main_prologue	wh3_prologue_region_the_scarlet_steppes_the_blood_moot	s364 p363
wh3_main_combi	wh3_dlc20_combi_region_dragons_death	p475 s476
wh3_main_combi	wh3_main_combi_region_gisoreux	p388 s319
wh3_main_combi	wh3_main_combi_region_aquitaine	s476 p475
wh3_main_chaos	wh3_main_chaos_region_the_vale_of_nightmares	s478 p475
wh3_main_combi	wh3_main_combi_region_the_lost_palace	s337 p432
wh3_main_chaos	wh3_main_chaos_region_amblepeak	s476 p475
wh3_main_combi	wh3_main_combi_region_uzkulak	p266 s267
wh3_main_combi	wh3_main_combi_region_lashiek	s483 o494 p305
wh3_main_chaos	wh3_main_chaos_region_the_brass_glacier	p475 s476
wh3_main_combi	wh3_main_combi_region_jungles_of_chian	s349 p557
wh3_main_combi	wh3_main_combi_region_swartzhafen	s482 p475
wh3_main_chaos	wh3_main_chaos_region_zharr_naggrund	p244 s245
wh3_main_combi	wh3_main_combi_region_ancient_city_of_quintex	p120 s121
wh3_main_prologue	wh3_prologue_region_broken_lands_tong_hall	p464 s487
wh3_main_combi	wh3_main_combi_region_zanbaijin	s220 p219
wh3_main_chaos	wh3_main_chaos_region_the_tower_of_flies	s476 p475
wh3_main_chaos	wh3_main_chaos_region_khazid_irkulaz	p475 s476
wh3_main_combi	wh3_main_combi_region_volulltrax	o494 s476 p305
wh3_main_combi	wh3_main_combi_region_xing_po	p452 s453
wh3_main_chaos	wh3_main_chaos_region_altar_of_spawns	o494 s476 p475
wh3_main_combi	wh3_main_combi_region_hergig	s473 p464
wh3_main_combi	wh3_main_combi_region_pillars_of_unseen_constellations	s476 p475
wh3_main_prologue	wh3_prologue_region_fleshlands_blood_haven	p363 s364
wh3_main_combi	wh3_main_combi_region_nonchang	s470 p464
wh3_main_chaos	wh3_main_chaos_region_jade_wind_mountain	p475 s358
wh3_main_combi	wh3_main_combi_region_novchozy	s476 p475
wh3_main_combi	wh3_main_combi_region_argalis	p475 s476
wh3_main_combi	wh3_main_combi_region_whitefire_tor	s35 o494 p305
wh3_main_chaos	wh3_main_chaos_region_karak_ungor	p475 s476
wh3_main_chaos	wh3_main_chaos_region_yhetee_peak	p475 s480
wh3_main_chaos	wh3_dlc23_chaos_region_deadrock_gap	s476 p475
wh3_main_combi	wh3_main_combi_region_black_creek_spire	p475 s476
wh3_main_chaos	wh3_dlc20_chaos_region_wreckers_point	s476 o494 p475
wh3_main_chaos	wh3_main_chaos_region_the_sky_monolith	p475 s437
wh3_main_prologue	wh3_prologue_region_canyons_of_gore_gore_town	s487 p464
wh3_main_combi	wh3_main_combi_region_drackla_spire	p475 s379
wh3_main_combi	wh3_main_combi_region_castle_carcassonne	p503 s504
wh3_main_combi	wh3_main_combi_region_barak_varr	p304 o494 s466
wh3_main_chaos	wh3_main_chaos_region_dietershafen	o494 p475 s476
wh3_main_chaos	wh3_dlc20_chaos_region_tancred_castle	s465 p464
wh3_main_combi	wh3_dlc23_combi_region_uzkulak_port	p475 s476
wh3_main_chaos	wh3_main_chaos_region_volcanos_heart	p475 s476
wh3_main_chaos	wh3_main_chaos_region_black_gulch	p475 s476
wh3_main_combi	wh3_main_combi_region_tor_anroc	o494 s144 p143
wh3_main_combi	wh3_main_combi_region_the_tower_of_torment	s476 p475
wh3_main_combi	wh3_main_combi_region_teotiqua	s465 p464
wh3_main_chaos	wh3_main_chaos_region_the_crystal_spires	s428 p221
wh3_main_combi	wh3_main_combi_region_xahutec	p475 s36
wh3_main_combi	wh3_main_combi_region_port_elistor	o494 p305 s476
wh3_main_combi	wh3_main_combi_region_the_moot	s543 p433
wh3_main_combi	wh3_main_combi_region_fort_soll	s205 p54
wh3_main_combi	wh3_main_combi_region_xhotl	s476 p475
wh3_main_combi	wh3_main_combi_region_zoishenk	s157 p156
wh3_main_combi	wh3_main_combi_region_sjoktraken	o494 s549 p305
wh3_main_chaos	wh3_main_chaos_region_bloodpeak	s476 p475
wh3_main_chaos	wh3_main_chaos_region_fortenhof	p475 s482
wh3_main_combi	wh3_main_combi_region_the_daemons_stump	s253 p252
wh3_main_chaos	wh3_main_chaos_region_the_volary	p236 s441
wh3_main_chaos	wh3_main_chaos_region_gnashraks_lair	p475 s476
wh3_main_combi	wh3_main_combi_region_the_sentinel_of_time	p475 s476
wh3_main_combi	wh3_main_combi_region_nagashizzar	p464 s18
wh3_main_combi	wh3_main_combi_region_morgheim	s22 p410
wh3_main_combi	wh3_main_combi_region_fortress_of_dawn	o257 s258 p52
wh3_main_combi	wh3_main_combi_region_monolith_of_bubonicus	p406 s326
wh3_main_combi	wh3_main_combi_region_shang_wu	s279 p161
wh3_main_combi	wh3_main_combi_region_doomkeep	s514 p203
wh3_main_combi	wh3_main_combi_region_snake_gate	p354 s355
wh3_main_combi	wh3_main_combi_region_temple_of_elemental_winds	p475 s285
wh3_main_combi	wh3_main_combi_region_angerrial	o494 p305 s486
wh3_main_combi	wh3_main_combi_region_karak_zorn	s93 p92
wh3_main_combi	wh3_main_combi_region_black_fortress	s251 p250
wh3_main_chaos	wh3_main_chaos_region_village_of_the_moon	p475 s476
wh3_main_chaos	wh3_main_chaos_region_shang_yang	s422 p421
wh3_main_combi	wh3_main_combi_region_verdanos	s34 p475
wh3_main_combi	wh3_main_combi_region_grenzstadt	s483 p475
wh3_main_chaos	wh3_main_chaos_region_the_blighted_grove	p475 s485
wh3_main_chaos	wh3_main_chaos_region_the_writhing_fortress	s442 p237
wh3_main_combi	wh3_main_combi_region_khazid_irkulaz	p402 s325
wh3_main_chaos	wh3_main_chaos_region_tree_of_damned_shades	s476 p475
wh3_main_prologue	wh3_prologue_region_icecaid_pass_claw_reach	p365 s366
wh3_main_combi	wh3_main_combi_region_doom_glade	p475 s476
wh3_main_chaos	wh3_main_chaos_region_vale_of_titans	p475 s476
wh3_main_combi	wh3_main_combi_region_monument_of_the_moon	s476 o494 p312
wh3_main_combi	wh3_main_combi_region_the_monoliths	s481 p475
wh3_main_chaos	wh3_main_chaos_region_erengrad	s357 p356 o517
wh3_main_combi	wh3_main_combi_region_crag_halls_of_findol	s513 p512
wh3_main_chaos	wh3_main_chaos_region_hergig	s473 p464
wh3_main_combi	wh3_main_combi_region_plesk	p475 s278
wh3_main_combi	wh3_main_combi_region_daemons_gate	s202 p201
wh3_main_chaos	wh3_dlc23_chaos_region_gash_kadrak	s476 p475
wh3_main_combi	wh3_main_combi_region_hoteks_column	s323 p396
wh3_main_chaos	wh3_main_chaos_region_talabheim	p550 s552
wh3_main_combi	wh3_main_combi_region_montfort	p475 s480
wh3_main_combi	wh3_main_combi_region_gnashraks_lair	s477 p475
wh3_main_chaos	wh3_main_chaos_region_karak_vrag	s32 p464
wh3_main_chaos	wh3_main_chaos_region_mines_of_nan_yang	s476 p475
wh3_main_combi	wh3_main_combi_region_tai_tzu	p475 s476
wh3_main_combi	wh3_main_combi_region_fire_mouth	p382 s383
wh3_main_combi	wh3_main_combi_region_dotternbach	s480 p475
wh3_main_combi	wh3_main_combi_region_nagenhof	p475 s476
wh3_main_combi	wh3_main_combi_region_mistnar	o494 s476 p305
wh3_main_chaos	wh3_main_chaos_region_fort_jakova	p475 s476
wh3_main_combi	wh3_main_combi_region_vulture_mountain	p447 s340
wh3_main_combi	wh3_main_combi_region_shrine_of_kurnous	p475 s280
wh3_main_chaos	wh3_main_chaos_region_the_burning_monolith	p475 s476
wh3_main_prologue	wh3_prologue_region_ice_canyon_beacon_fort	p365 s366
wh3_main_combi	wh3_main_combi_region_monolith_of_festerlung	s327 p407
wh3_main_combi	wh3_main_combi_region_eschen	s486 p475
wh3_main_combi	wh3_main_combi_region_black_rock	p192 s193
wh3_main_chaos	wh3_main_chaos_region_grissenwald	s476 p475
wh3_main_chaos	wh3_main_chaos_region_the_sentinels	p263 s264
wh3_main_combi	wh3_main_combi_region_shrine_of_loec	s476 p305 o494
wh3_main_combi	wh3_dlc23_combi_region_gash_kadrak	p475 s476
wh3_main_combi	wh3_main_combi_region_temple_avenue_of_gold	p464 s467
wh3_main_chaos	wh3_main_chaos_region_wei_jin	s348 p448
wh3_main_combi	wh3_main_combi_region_karak_krakaten	s358 p475
wh3_main_combi	wh3_main_combi_region_gristle_valley	s393 p392
wh3_main_chaos	wh3_main_chaos_region_the_monolith_of_katam	s476 p475
wh3_main_combi	wh3_main_combi_region_golden_ziggurat	p475 s476
wh3_main_chaos	wh3_main_chaos_region_altdorf	o494 s496 p495
wh3_main_chaos	wh3_main_chaos_region_konigstein_tower	p475 s476
wh3_main_chaos	wh3_main_chaos_region_kraz_und	p475 s476
wh3_main_chaos	wh3_main_chaos_region_fort_ostrosk	s476 p475
wh3_main_chaos	wh3_main_chaos_region_blizzardpeak	p475 s37
wh3_main_combi	wh3_main_combi_region_carroburg	s506 p505
wh3_main_combi	wh3_main_combi_region_tlaqua	s470 p464
wh3_main_combi	wh3_main_combi_region_the_fetid_catacombs	p475 s476
wh3_main_chaos	wh3_main_chaos_region_the_sunken_sewers	p233 s438
wh3_main_combi	wh3_main_combi_region_gryphon_wood	p557 s27
wh3_main_combi	wh3_main_combi_region_monolith_of_borkill_the_bloody_handed	s191 p190
wh3_main_chaos	wh3_main_chaos_region_dhazhyn	p475 s476
wh3_main_combi	wh3_main_combi_region_the_burning_monolith	p475 s476
wh3_main_chaos	wh3_main_chaos_region_terracotta_graveyard	s476 p475
wh3_main_chaos	wh3_main_chaos_region_eagle_eyries	p475 s34
wh3_main_combi	wh3_main_combi_region_slavers_point	p305 s476 o494
wh3_main_chaos	wh3_main_chaos_region_turtle_gate	p354 s355
wh3_main_combi	wh3_main_combi_region_karond_kar	o494 s95 p94
wh3_main_chaos	wh3_dlc20_chaos_region_chantillon	p475 o494 s485
wh3_main_combi	wh3_main_combi_region_karak_vlag	p185 s187
wh3_main_combi	wh3_main_combi_region_the_bleeding_spire	p425 s333
wh3_main_chaos	wh3_dlc20_chaos_region_black_pit	p464 s465
wh3_main_combi	wh3_main_combi_region_the_godless_crater	p210 s211
wh3_main_combi	wh3_main_combi_region_icespewer	s476 p475
wh3_main_chaos	wh3_main_chaos_region_salzenmund	p122 s123
wh3_main_chaos	wh3_main_chaos_region_delberz	p475 s476
wh3_main_combi	wh3_main_combi_region_sarl_encampment	s489 p475
wh3_main_combi	wh3_main_combi_region_karak_izor	p90 s91
wh3_main_combi	wh3_main_combi_region_tor_sethai	p475 s34
wh3_main_combi	wh3_main_combi_region_clar_karond	s49 p48
wh3_main_combi	wh3_main_combi_region_frozen_landing	p305 o493 s489
wh3_main_combi	wh3_main_combi_region_shrine_of_ladrielle	s476 p475
wh3_main_chaos	wh3_main_chaos_region_karak_ziflin	s466 p464
wh3_main_combi	wh3_main_combi_region_har_ganeth	s76 p75
wh3_main_chaos	wh3_main_chaos_region_ice_caverns_of_ymirdrak	s476 p475
wh3_main_combi	wh3_main_combi_region_akendorf	p464 s470
wh3_main_chaos	wh3_main_chaos_region_the_palace_of_ruin	s436 p434
wh3_main_combi	wh3_main_combi_region_vauls_anvil_loren	s556 p555
wh3_main_chaos	wh3_main_chaos_region_uzkulany	p475 s482
wh3_main_combi	wh3_main_combi_region_axlotl	p42 s43
wh3_main_combi	wh3_main_combi_region_kauark	s476 p475
wh3_main_chaos	wh3_main_chaos_region_the_bleeding_spire	s476 p475
wh3_main_combi	wh3_main_combi_region_myrmidens	s471 p304 o183
wh3_main_combi	wh3_main_combi_region_vale_of_titans	p475 s180
wh3_main_chaos	wh3_main_chaos_region_temple_of_elemental_winds	s485 p475
wh3_main_combi	wh3_main_combi_region_springs_of_eternal_life	s295 p294
wh3_main_prologue	wh3_prologue_region_the_void_steppes_the_monolith_of_the_void	s364 p363
wh3_main_combi	wh3_main_combi_region_avethir	s476 p475
wh3_main_combi	wh3_main_combi_region_languille	p305 o494 s311
wh3_main_combi	wh3_main_combi_region_black_pyramid_of_nagash	s117 p116
wh3_main_combi	wh3_main_combi_region_floating_pyramid	s476 p475
wh3_main_combi	wh3_main_combi_region_ice_rock_gorge	p397 s324
wh3_main_combi	wh3_main_combi_region_grunburg	s482 p475
wh3_main_combi	wh3_main_combi_region_tower_of_lysean	p475 s476
wh3_main_combi	wh3_dlc20_combi_region_glacier_encampment	s476 p475
wh3_main_prologue	wh3_prologue_region_the_maze_keep_mansion_of_eyes	p365 s366
wh3_main_chaos	wh3_main_chaos_region_seep_gore	s476 p475
wh3_main_combi	wh3_main_combi_region_caverns_of_sotek	p475 s34
wh3_main_chaos	wh3_main_chaos_region_mount_thug	s38 p475
wh3_main_combi	wh3_main_combi_region_the_oak_of_ages	s455 p454
wh3_main_combi	wh3_main_combi_region_dragon_gate	p354 s355
wh3_main_chaos	wh3_main_chaos_region_tower_of_grief	s476 p475
wh3_main_combi	wh3_main_combi_region_gorger_rock	p475 s175
wh3_main_chaos	wh3_main_chaos_region_ming_zhu	p475 s476
wh3_main_combi	wh3_main_combi_region_dok_karaz	s316 p378
wh3_main_combi	wh3_dlc23_combi_region_fort_dorznye_vort	p475 s476
wh3_main_chaos	wh3_main_chaos_region_tower_of_ashshair	p475 s281
wh3_main_chaos	wh3_main_chaos_region_dragons_crossroad	p475 s476
wh3_main_combi	wh3_main_combi_region_massif_orcal	p404 s537
wh3_main_combi	wh3_main_combi_region_karak_dum	s216 p215
wh3_main_combi	wh3_main_combi_region_parravon	p114 s115
wh3_main_combi	wh3_main_combi_region_white_tower_of_hoeth	s151 p150
wh3_main_chaos	wh3_main_chaos_region_the_forest_of_decay	p475 s36
wh3_main_combi	wh3_main_combi_region_tyrant_peak	s465 p464
wh3_main_chaos	wh3_main_chaos_region_black_rock	s193 p192
wh3_main_combi	wh3_main_combi_region_valley_of_horns	p475 s181
wh3_main_combi	wh3_main_combi_region_the_silvered_tower_of_sorcerers	p231 s232
wh3_main_combi	wh3_main_combi_region_wurtbad	s474 p464
wh3_main_chaos	wh3_main_chaos_region_gorger_rock	s476 p475
wh3_main_combi	wh3_main_combi_region_the_falls_of_doom	s476 p169
wh3_main_chaos	wh3_dlc23_chaos_region_the_haunted_forest	s465 p464
wh3_main_chaos	wh3_main_chaos_region_the_twisted_towers	p475 s440
wh3_main_chaos	wh3_main_chaos_region_nan_gau	p413 s414
wh3_main_combi	wh3_main_combi_region_fort_ostrosk	s465 p464`;

/** Rows shaped exactly like the DB table, so the builder can treat them as if a pack supplied them. */
export const getBundledStartPosRegionSlotTemplates = (): Array<Record<string, string>> => {
  const rows: Array<Record<string, string>> = [];
  for (const line of STARTPOS_REGION_SLOTS.split("\n")) {
    if (line === "") continue;
    const [campaign, region, slots] = line.split("\t");
    if (!campaign || !region || !slots) continue;
    for (const slot of slots.split(" ")) {
      const slotType = SLOT_TYPE_BY_CHAR[slot[0]];
      const slotTemplate = SLOT_TEMPLATES[Number(slot.slice(1))];
      if (!slotType || !slotTemplate) continue;
      // The id only has to be unique: it is a key column, so a collision would drop a row.
      rows.push({ campaign, region, slot_type: slotType, slot_template: slotTemplate, id: `${rows.length}` });
    }
  }
  return rows;
};
