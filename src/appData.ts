import { Pack, PackCollisions } from "./packFileTypes";
import { NodeLinks, NodeSkill, SkillAndIcons } from "./skills";
import { SupportedGames, supportedGames, SupportedLanguage } from "./supportedGames";
import Trie from "./utility/trie";

interface AppData {
  skillsData?: {
    subtypesToSet: Record<string, string[]>;
    setToNodes: Record<string, string[]>;
    nodeLinks: NodeLinks;
    nodeToSkill: Record<string, NodeSkill>;
    skillsToEffects: Record<string, Effect[]>;
    skills: SkillAndIcons;
    locs: Record<string, Trie<string>>;
    icons: Record<string, string>;
    effectsToEffectData: Record<string, EffectData>;
    nodeToSkillLocks: NodeToSkillLocks;
  };
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
  allVanillaPackNames: string[];
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
  waitForModIds: string[];
  subscribedModIds: string[];
  isCompatCheckingVanillaPacks: boolean;
  modsToResubscribeTo: Mod[];
  isViewerReady: boolean;
  areSkillsReady: boolean;
  queuedViewerData: (PackViewData | undefined)[];
  queuedSkillsData: SkillsData | undefined;
  isChangingGameProcessPriority: boolean;
  currentLanguage?: SupportedLanguage;
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
  compatData: {
    packTableCollisions: [],
    packFileCollisions: [],
    missingTableReferences: {},
    uniqueIdsCollisions: {},
    scriptListenerCollisions: {},
    packFileAnalysisErrors: {},
    missingFileRefs: {},
  },
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
  allVanillaPackNames: [],
  vanillaPacksDBFileNames: [],
  waitForModIds: [],
  subscribedModIds: [],
  isCompatCheckingVanillaPacks: false,
  modsToResubscribeTo: [],
  isViewerReady: false,
  areSkillsReady: false,
  queuedViewerData: [],
  queuedSkillsData: undefined,
  isChangingGameProcessPriority: false,
  currentLanguage: "en",
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
  attila: undefined,
  troy: undefined,
  pharaoh: undefined,
  dynasties: undefined,
  rome2: undefined,
};
(appData as AppData).gameToPresets = {
  wh2: [],
  wh3: [],
  threeKingdoms: [],
  attila: [],
  troy: [],
  pharaoh: [],
  dynasties: [],
  rome2: [],
};

export default appData as AppData;
