/**
 * The left sidebar tabs the user can hide from Other Options.
 *
 * All Mods is missing on purpose: it is the tab everything falls back to when the current one stops
 * being available. Skill Trees and Tech Trees are missing too, since Tree Display already decides
 * whether they are a tab, a window, or off.
 */
export const hideableMainWindowTabs: {
  tab: MainWindowTab;
  labelKey: string;
  fallbackLabel: string;
  /** Only ever shown while Features For Modders is on. */
  isForModders?: boolean;
  /** On top of Features For Modders, only shown when the app runs from source. */
  isDevOnly?: boolean;
}[] = [
  { tab: "enabledMods", labelKey: "enabledModsCapitalized", fallbackLabel: "Enabled Mods" },
  { tab: "categories", labelKey: "categories", fallbackLabel: "Categories" },
  { tab: "presets", labelKey: "presetsTab", fallbackLabel: "Presets" },
  { tab: "unitViewer", labelKey: "unitViewerTab", fallbackLabel: "Unit Viewer" },
  { tab: "buildings", labelKey: "buildingsTab", fallbackLabel: "Buildings" },
  { tab: "ancillaries", labelKey: "ancillariesTab", fallbackLabel: "Ancillaries" },
  { tab: "map", labelKey: "mapTab", fallbackLabel: "Map" },
  { tab: "visuals", labelKey: "visualsTab", fallbackLabel: "Visuals", isForModders: true, isDevOnly: true },
  { tab: "nodeEditor", labelKey: "nodeEditorTab", fallbackLabel: "Node Editor", isForModders: true },
];

const hideableTabs = new Set<MainWindowTab>(hideableMainWindowTabs.map((entry) => entry.tab));

export const isHideableMainWindowTab = (tab: MainWindowTab) => hideableTabs.has(tab);
