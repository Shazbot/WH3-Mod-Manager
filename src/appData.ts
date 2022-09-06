import { Pack } from "./packFileDataManager";

interface AppData {
  presets: Preset[];
  gamePath: string;
  contentFolder: string | undefined;
  dataFolder: string | undefined;
  gameSaves: GameSave[];
  saveSetupDone: boolean;
  isMakeUnitsGeneralsEnabled: boolean;
  hasReadConfig: boolean;
  packsData: Pack[];
}

export default {
  presets: [],
  gamePath: "",
  contentFolder: undefined,
  dataFolder: undefined,
  gameSaves: [],
  saveSetupDone: false,
  isMakeUnitsGeneralsEnabled: false,
  hasReadConfig: false,
  packsData: [],
} as AppData;
