export type CustomizableModsDiscoveryState = {
  customizableMods: Record<string, string[]>;
  packMetaData: Record<string, { size: number; lastChangedLocal: number }>;
  lastGetCustomizableMods?: string[];
};

export const invalidateCustomizableModPath = (state: CustomizableModsDiscoveryState, packPath: string): void => {
  delete state.packMetaData[packPath];
  delete state.customizableMods[packPath];
  if (state.lastGetCustomizableMods) {
    state.lastGetCustomizableMods = state.lastGetCustomizableMods.filter((path) => path !== packPath);
  }
};
