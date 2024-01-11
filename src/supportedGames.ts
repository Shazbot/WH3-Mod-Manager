export const supportedGames = ["wh3", "wh2", "threeKingdoms"] as const;
export type SupportedGames = typeof supportedGames[number];

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

export const gameToManifest: Record<SupportedGames, string[] | undefined> = {
  wh2: undefined,
  wh3: undefined,
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
