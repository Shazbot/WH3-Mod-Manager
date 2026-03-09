import { Pack, PackCollisions, PackedFile } from "./packFileTypes";
import { NodeLinks, NodeSkill, SkillAndIcons } from "./skills";
import { SupportedGames, supportedGames, SupportedLanguage } from "./supportedGames";
import Trie from "./utility/trie";

interface AppData {
  skillsData?: {
    subtypesToSet: Record<string, string[]>;
    subtypeAndSets: {
      key: string;
      agentSubtype: string;
      agentKey: string;
      campaignKey: string;
      factionKey: string;
      subculture: string;
      forArmy: string;
      forNavy: string;
    }[];
    setToNodes: Record<string, string[]>;
    nodeLinks: NodeLinks;
    nodeToSkill: Record<string, NodeSkill>;
    skillsToEffects: Record<string, Effect[]>;
    skills: SkillAndIcons;
    locs: Record<string, Trie<string>>;
    icons: Record<string, string>;
    effectsToEffectData: Record<string, EffectData>;
    nodeToSkillLocks: NodeToSkillLocks;
    skillsDataPackPaths: string[];
    effectToUnitAbilityEnables: Record<string, AbilityEnableMapping[]>;
    unitAbilitiesByKey: Record<
      string,
      {
        key: string;
        iconName: string;
        type: string;
        sourceType: string;
        overpowerOption?: string;
      }
    >;
    unitSpecialAbilitiesByKey: Record<
      string,
      {
        key: string;
        targetInterceptRange: number;
        rechargeTime: number;
        activeTime: number;
        effectRange: number;
        affectSelf: boolean;
        numEffectedFriendlyUnits: number;
        numEffectedEnemyUnits: number;
        targetFriends: boolean;
        targetEnemies: boolean;
        targetSelf: boolean;
        manaCost: number;
        miscastChance: number;
        minRange: number;
        activatedProjectile?: string;
        bombardment?: string;
        vortex?: string;
      }
    >;
    bombardmentsByKey: Record<
      string,
      {
        key: string;
        numProjectiles: number;
        projectileType: string;
      }
    >;
    projectilesByKey: Record<
      string,
      {
        key: string;
        damage: number;
        apDamage: number;
        projectileNumber: number;
        explosionType?: string;
        spawnedVortex?: string;
      }
    >;
    explosionsByKey: Record<
      string,
      {
        key: string;
        detonationDamage: number;
        detonationDamageAp: number;
        detonationRadius: number;
        detonationDuration: number;
      }
    >;
    vortexesByKey: Record<
      string,
      {
        key: string;
        damage: number;
        damageAp: number;
        duration: number;
        goalRadius: number;
        startRadius: number;
        movementSpeed: number;
        numVortexes: number;
      }
    >;
    abilityToPhaseIds: Record<string, string[]>;
    phasesById: Record<
      string,
      {
        id: string;
        damageAmount: number;
        maxDamagedEntities: number;
        hpChangeFrequency: number;
        duration: number;
        fatigueChangeRatio: number;
        affectsAllies: boolean;
        affectsEnemies: boolean;
      }
    >;
    phaseStatEffectsByPhaseId: Record<
      string,
      {
        stat: string;
        value: number;
        how: string;
      }[]
    >;
    uiUnitStatIconsByStat: Record<string, string>;
    kvDirectDamageMinUnary: number;
    kvDirectDamageLarge: number;
    abilityToAdditionalUiEffectKeys: Record<string, string[]>;
    additionalUiEffectsByKey: Record<
      string,
      {
        key: string;
        sortOrder: number;
        effectState: string;
      }
    >;
    abilityToGroupKeys: Record<string, string[]>;
    specialAbilityGroupsByKey: Record<
      string,
      {
        key: string;
        iconPath: string;
      }
    >;
    abilityToAutoDeactivateFlags: Record<string, string[]>;
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
  isFeaturesForModdersEnabled: boolean;
  moddersPrefix: string;
  isShowingSkillNodeSetNames: boolean;
  isShowingHiddenSkills: boolean;
  isShowingHiddenModifiersInsideSkills: boolean;
  isCheckingSkillRequirements: boolean;
  hasReadConfig: boolean;
  packsData: Pack[];
  unsavedPacksData: Record<string, PackedFile[]>;
  compatData: PackCollisions;
  currentlyReadingModPaths: string[];
  vanillaPacks: Pack[];
  allVanillaPackNames: Set<string>;
  overwrittenDataPackedFiles: Record<string, string[]>;
  outdatedPackFiles: Record<string, string[]>;
  enabledMods: Mod[];
  allMods: Mod[];
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
  lastGetCustomizableMods?: string[];
  customizableMods: Record<string, string[]>;
  packMetaData: Record<string, { size: number; lastChangedLocal: number }>;
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
  isFeaturesForModdersEnabled: false,
  moddersPrefix: "",
  isShowingSkillNodeSetNames: false,
  isShowingHiddenSkills: true,
  isShowingHiddenModifiersInsideSkills: true,
  isCheckingSkillRequirements: true,
  hasReadConfig: false,
  packsData: [],
  unsavedPacksData: {},
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
  allMods: [],
  startArgs: [],
  isAdmin: false,
  gameUpdates: [],
  isWH3Running: false,
  currentGame: "wh3",
  vanillaPacks: [],
  allVanillaPackNames: new Set<string>(),
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
  customizableMods: {},
  packMetaData: {},
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
  shogun2: undefined,
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
  shogun2: [],
};

export default appData as AppData;
