import { Pack, PackCollisions } from "./packFileTypes";

interface AppData {
  presets: Preset[];
  gamePath: string | undefined;
  contentFolder: string | undefined;
  dataFolder: string | undefined;
  gameSaves: GameSave[];
  saveSetupDone: boolean;
  isMakeUnitsGeneralsEnabled: boolean;
  hasReadConfig: boolean;
  packsData: Pack[];
  compatData: PackCollisions;
  currentlyReadingModPaths: string[];
  dataPack?: Pack;
  overwrittenDataPackedFiles: Record<string, string[]>;
  outdatedPackFiles: Record<string, string[]>;
  enabledMods: Mod[];
  startArgs: string[];
  isAdmin: boolean;
  gameUpdates: GameUpdateData[];
  isWH3Running: boolean;
}

export type AppFolderPaths = { gamePath: string; contentFolder: string };

export default {
  presets: [],
  gamePath: undefined,
  contentFolder: undefined,
  dataFolder: undefined,
  gameSaves: [],
  saveSetupDone: false,
  isMakeUnitsGeneralsEnabled: false,
  hasReadConfig: false,
  packsData: [],
  compatData: { packTableCollisions: [], packFileCollisions: [] },
  currentlyReadingModPaths: [],
  overwrittenDataPackedFiles: {},
  outdatedPackFiles: {},
  enabledMods: [],
  startArgs: [],
  isAdmin: false,
  gameUpdates: [],
  isWH3Running: false,
} as AppData;
