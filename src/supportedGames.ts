export const supportedGames = ["wh3", "wh2", "threeKingdoms"] as const;
export type SupportedGames = typeof supportedGames[number];

export const supportedGameOptions = [
  "MakeUnitsGenerals",
  "SkipIntroMovies",
  "ScriptLogging",
  "AutoStartCustomBattle",
] as const;
export type SupportedGameOptions = typeof supportedGameOptions[number];

export const supportedGameOptionToStartGameOption: Record<
  SupportedGameOptions,
  keyof StartGameSpecificOptions
> = {
  MakeUnitsGenerals: "isMakeUnitsGeneralsEnabled",
  SkipIntroMovies: "isSkipIntroMoviesEnabled",
  ScriptLogging: "isScriptLoggingEnabled",
  AutoStartCustomBattle: "isAutoStartCustomBattleEnabled",
};

export const gameToGameFolder: Record<SupportedGames, string> = {
  wh2: "Total War WARHAMMER II",
  wh3: "Total War WARHAMMER III",
  threeKingdoms: "Total War Three Kingdoms",
};

export const gameToGameName: Record<SupportedGames, string> = {
  wh2: "Warhammer 2",
  wh3: "Warhammer 3",
  threeKingdoms: "Three Kingdoms",
};

export const gameToSteamId: Record<SupportedGames, string> = {
  wh2: "594570",
  wh3: "1142710",
  threeKingdoms: "779340",
};

export const gameToProcessName: Record<SupportedGames, string> = {
  wh2: "Warhammer2.exe",
  wh3: "Warhammer3.exe",
  threeKingdoms: "Three_Kingdoms.exe",
};

export const gameToIntroMovies: Record<SupportedGames, string[]> = {
  wh2: [
    // "movies\\startup_movie_01.ca_vp8",
    // "movies\\startup_movie_02.ca_vp8",
    // "movies\\startup_movie_03.ca_vp8",
  ],
  wh3: [
    "movies\\epilepsy_warning\\epilepsy_warning_en.ca_vp8",
    "movies\\gam_int.ca_vp8",
    "movies\\startup_movie_01.ca_vp8",
    "movies\\startup_movie_02.ca_vp8",
    "movies\\startup_movie_03.ca_vp8",
    "movies\\startup_movie_04.ca_vp8",
  ],
  threeKingdoms: ["movies\\startup_movie_01.ca_vp8", "movies\\startup_movie_02.ca_vp8"],
};

export const gameToSupportedGameOptions: Record<SupportedGames, SupportedGameOptions[]> = {
  wh2: ["ScriptLogging"],
  wh3: ["MakeUnitsGenerals", "SkipIntroMovies", "ScriptLogging", "AutoStartCustomBattle"],
  threeKingdoms: ["SkipIntroMovies", "ScriptLogging"],
};

export const gameToManifest: Record<SupportedGames, string[] | undefined> = {
  wh3: undefined,
  wh2: [
    "audio_base.pack",
    "audio_base_2.pack",
    "audio_base_bl.pack",
    "audio_base_bm.pack",
    "audio_base_br.pack",
    "audio_base_cst.pack",
    "audio_base_gc.pack",
    "audio_base_m.pack",
    "audio_base_tk.pack",
    "audio_base_we.pack",
    "audio_en.pack",
    "audio_en_2.pack",
    "audio_en_bm.pack",
    "audio_en_br.pack",
    "audio_en_cst.pack",
    "audio_en_tk.pack",
    "audio_en_we.pack",
    "audio_fr.pack",
    "audio_fr_2.pack",
    "audio_fr_bm.pack",
    "audio_fr_br.pack",
    "audio_fr_cst.pack",
    "audio_fr_tk.pack",
    "audio_fr_we.pack",
    "audio_ge.pack",
    "audio_ge_2.pack",
    "audio_ge_bm.pack",
    "audio_ge_br.pack",
    "audio_ge_cst.pack",
    "audio_ge_tk.pack",
    "audio_ge_we.pack",
    "audio_it.pack",
    "audio_it_2.pack",
    "audio_it_bm.pack",
    "audio_it_br.pack",
    "audio_it_cst.pack",
    "audio_it_tk.pack",
    "audio_it_we.pack",
    "audio_pl.pack",
    "audio_pl_2.pack",
    "audio_pl_bm.pack",
    "audio_pl_br.pack",
    "audio_pl_cst.pack",
    "audio_pl_tk.pack",
    "audio_pl_we.pack",
    "audio_ru.pack",
    "audio_ru_2.pack",
    "audio_ru_bm.pack",
    "audio_ru_br.pack",
    "audio_ru_cst.pack",
    "audio_ru_tk.pack",
    "audio_ru_we.pack",
    "audio_sp.pack",
    "audio_sp_2.pack",
    "audio_sp_bm.pack",
    "audio_sp_br.pack",
    "audio_sp_cst.pack",
    "audio_sp_tk.pack",
    "audio_sp_we.pack",
    "boot.pack",
    "campaign_variants.pack",
    "campaign_variants_2.pack",
    "campaign_variants_bl.pack",
    "campaign_variants_pro09_.pack",
    "campaign_variants_sb.pack",
    "campaign_variants_sf.pack",
    "campaign_variants_twa02_.pack",
    "campaign_variants_wp_.pack",
    "data.pack",
    "data_1.pack",
    "data_2.pack",
    "data_bl.pack",
    "data_bm.pack",
    "data_gc.pack",
    "data_hb.pack",
    "data_pro09_.pack",
    "data_pw.pack",
    "data_sb.pack",
    "data_sc.pack",
    "data_sf.pack",
    "data_tk.pack",
    "data_twa01_.pack",
    "data_twa02_.pack",
    "data_we.pack",
    "data_wp_.pack",
    "local_br.pack",
    "local_br_2.pack",
    "local_br_gc.pack",
    "local_cn.pack",
    "local_cn_2.pack",
    "local_cn_gc.pack",
    "local_cz.pack",
    "local_cz_2.pack",
    "local_cz_gc.pack",
    "local_en.pack",
    "local_en_2.pack",
    "local_en_gc.pack",
    "local_fr.pack",
    "local_fr_2.pack",
    "local_fr_gc.pack",
    "local_ge.pack",
    "local_ge_2.pack",
    "local_ge_gc.pack",
    "local_it.pack",
    "local_it_2.pack",
    "local_it_gc.pack",
    "local_kr.pack",
    "local_kr_2.pack",
    "local_kr_gc.pack",
    "local_pl.pack",
    "local_pl_2.pack",
    "local_pl_gc.pack",
    "local_ru.pack",
    "local_ru_2.pack",
    "local_ru_gc.pack",
    "local_sp.pack",
    "local_sp_2.pack",
    "local_sp_gc.pack",
    "local_tr.pack",
    "local_tr_2.pack",
    "local_tr_gc.pack",
    "local_zh.pack",
    "local_zh_2.pack",
    "local_zh_gc.pack",
    "models.pack",
    "models_2.pack",
    "models_gc.pack",
    "models2.pack",
    "models2_2.pack",
    "models2_gc.pack",
    "movies.pack",
    "movies_2.pack",
    "movies_sf.pack",
    "movies2.pack",
    "movies3.pack",
    "shaders.pack",
    "shaders_bl.pack",
    "terrain.pack",
    "terrain_2.pack",
    "terrain_gc.pack",
    "terrain2.pack",
    "terrain2_2.pack",
    "terrain2_gc.pack",
    "terrain3.pack",
    "terrain3_2.pack",
    "terrain3_gc.pack",
    "terrain4.pack",
    "terrain4_2.pack",
    "terrain5.pack",
    "terrain7.pack",
    "terrain7_2.pack",
    "terrain7_gc.pack",
    "terrain8.pack",
    "terrain8_2.pack",
    "terrain9.pack",
    "variants.pack",
    "variants_2.pack",
    "variants_bl.pack",
    "variants_gc.pack",
    "variants_hb.pack",
    "variants_sb.pack",
    "variants_sc.pack",
    "variants_sf.pack",
    "variants_wp_.pack",
    "variants_dds.pack",
    "variants_dds_2.pack",
    "variants_dds_bl.pack",
    "variants_dds_gc.pack",
    "variants_dds_sb.pack",
    "variants_dds_sf.pack",
    "variants_dds_wp_.pack",
    "variants_dds2.pack",
    "variants_dds2_2.pack",
    "variants_dds2_sb.pack",
    "variants_dds2_sc.pack",
    "variants_dds2_sf.pack",
    "variants_dds2_wp_.pack",
    "warmachines.pack",
    "warmachines_2.pack",
    "warmachines_hb.pack",
  ],
  threeKingdoms: [
    "audio.pack",
    "boot.pack",
    "data.pack",
    "data_dlc06.pack",
    "data_ep.pack",
    "data_mh.pack",
    "database.pack",
    "fast.pack",
    "language.txt",
    "local_br.pack",
    "local_cn.pack",
    "local_cz.pack",
    "local_en.pack",
    "local_fr.pack",
    "local_ge.pack",
    "local_it.pack",
    "local_kr.pack",
    "local_pl.pack",
    "local_ru.pack",
    "local_sp.pack",
    "local_tr.pack",
    "local_zh.pack",
    "models.pack",
    "models2.pack",
    "movies.pack",
    "movies_dlc06.pack",
    "movies_ep.pack",
    "movies_mh.pack",
    "movies_wb.pack",
    "movies2.pack",
    "shaders.pack",
    "terrain.pack",
    "terrain2.pack",
    "terrain3.pack",
    "terrain4.pack",
    "terrain5.pack",
    "variants.pack",
    "variants_dds.pack",
    "vegetation.pack",
  ],
};