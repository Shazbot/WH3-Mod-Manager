import { Pack, PackCollisions } from "./packFileTypes";
import { SupportedGames, supportedGames } from "./supportedGames";

interface AppData {
  presets: Preset[];

  // gamePaths: Record<string, string>;
  // contentFolders: Record<string, string>;
  // dataFolders: Record<string, string>;
  gamesToGameFolderPaths: Record<string, GameFolderPaths>;
  gamesToSteamAppsFolderPaths: Record<string, string>;
  gameSaves: GameSave[];
  saveSetupDone: boolean;
  isMakeUnitsGeneralsEnabled: boolean;
  hasReadConfig: boolean;
  packsData: Pack[];
  compatData: PackCollisions;
  currentlyReadingModPaths: string[];
  vanillaPacks: Pack[];
  overwrittenDataPackedFiles: Record<string, string[]>;
  outdatedPackFiles: Record<string, string[]>;
  enabledMods: Mod[];
  startArgs: string[];
  isAdmin: boolean;
  gameUpdates: GameUpdateData[];
  isWH3Running: boolean;
  currentGame: SupportedGames;
  gameToCurrentPreset: Record<SupportedGames, Preset | undefined>;
  gameToPresets: Record<SupportedGames, Preset[]>;
  vanillaPacksDBFileNames: string[];
}

export type GameFolderPaths = {
  gamePath: string | undefined;
  contentFolder: string | undefined;
  dataFolder: string | undefined;
};

const appData = {
  presets: [],
  // gamePaths: {},
  // contentFolders: {},
  // dataFolders: {},
  gamesToGameFolderPaths: {},
  gamesToSteamAppsFolderPaths: {},
  gameSaves: [],
  saveSetupDone: false,
  isMakeUnitsGeneralsEnabled: false,
  hasReadConfig: false,
  packsData: [],
  compatData: { packTableCollisions: [], packFileCollisions: [], missingTableReferences: {} },
  currentlyReadingModPaths: [],
  overwrittenDataPackedFiles: {},
  outdatedPackFiles: {},
  enabledMods: [],
  startArgs: [],
  isAdmin: false,
  gameUpdates: [],
  isWH3Running: false,
  currentGame: "wh3",
  vanillaPacks: [],
  vanillaPacksDBFileNames: [],
} as Omit<AppData, "gameToCurrentPreset" | "gameToPresets">;
for (const supportedGame of supportedGames) {
  appData.gamesToGameFolderPaths[supportedGame] = {
    gamePath: undefined,
    dataFolder: undefined,
    contentFolder: undefined,
  };
}

(appData as AppData).gameToCurrentPreset = {
  wh2: undefined,
  wh3: undefined,
  threeKingdoms: undefined,
};
(appData as AppData).gameToPresets = {
  wh2: [],
  wh3: [],
  threeKingdoms: [],
};

export default appData as AppData;
