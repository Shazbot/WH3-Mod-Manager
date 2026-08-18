import { GameFolderPaths } from "./appData";
import { PackCollisions } from "./packFileTypes";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import hash from "object-hash";
import { adjustDuplicates, findAlwaysEnabledMods, findMod } from "./modsHelpers";
import { SortingType } from "./utility/modRowSorting";
import {
  compareModNames,
  getSparseLoadOrderByModName,
  sortModsAsInEntries,
  sortByNameAndLoadOrder,
} from "./modSortingHelpers";
import {
  isPresetModEnabled,
  toPresetEntries,
  toSnapshotEntries,
  withoutDuplicateEntries,
} from "./config/presetEntries";
import initialState from "./initialAppState";
import equal from "fast-deep-equal";
import { format } from "date-fns";
import { SupportedGames } from "./supportedGames";
import { packDataStore } from "./components/viewer/packDataStore";
import { getUsedModImport } from "./usedMods";
import { isSupportedLanguage } from "./utility/sharedHelpers";
import { isWorkshopMod, resolveModsBySourcePriority } from "./modSources";
import { sharedModMatchesInstalledMod } from "./sharedModList";

const isMainWindowTabAvailable = (state: AppState, tab: MainWindowTab) => {
  switch (tab) {
    case "mods":
    case "enabledMods":
    case "categories":
    case "presets":
      return true;
    case "skills":
      return state.currentGame === "wh3" && state.skillTreesDisplayMode === "tab";
    case "visuals":
      return state.isFeaturesForModdersEnabled && state.isDev;
    case "unitViewer":
      return state.currentGame === "wh3";
    case "techTrees":
      return state.currentGame === "wh3" && state.technologyTreesDisplayMode === "tab";
    case "buildings":
      return state.currentGame === "wh3";
    case "ancillaries":
      return state.currentGame === "wh3";
    case "map":
      return state.currentGame === "wh3";
    case "nodeEditor":
      return state.isFeaturesForModdersEnabled;
    case "twui":
      return false;
    default:
      return false;
  }
};

const ensureValidCurrentTab = (state: AppState) => {
  if (!isMainWindowTabAvailable(state, state.currentTab)) {
    state.currentTab = "mods";
  }
};

const addCategoryByPayload = (state: AppState, payload: AddCategoryPayload) => {
  const { mods, category } = payload;

  for (const mod of mods) {
    const modInPreset = state.currentPreset.mods.find((iterMod) => iterMod.path === mod.path);
    if (modInPreset) {
      modInPreset.categories = modInPreset.categories || [];
      if (!modInPreset.categories.includes(category)) {
        modInPreset.categories.push(category);
      }
    }
  }

  if (!state.categories.includes(category)) state.categories.push(category);
};

const removeCategoryByPayload = (state: AppState, payload: RemoveCategoryPayload) => {
  const { mods, category } = payload;
  for (const inputMod of mods) {
    const mod = state.currentPreset.mods.find((iterMod) => iterMod.path == inputMod.path);
    if (mod && mod.categories) {
      if (mod.categories.includes(category)) {
        mod.categories = mod.categories.filter((currentCategory) => currentCategory != category);
      }
    }
  }

  if (state.currentPreset.mods.every((mod) => !mod.categories || !mod.categories.includes(category)))
    state.categories = state.categories.filter((iterCategory) => iterCategory != category);
};

const renameCategoryByPayload = (state: AppState, payload: RenameCategoryPayload) => {
  const { oldCategory, newCategory } = payload;

  // Update category name in all mods
  for (const mod of state.currentPreset.mods) {
    if (mod.categories && mod.categories.includes(oldCategory)) {
      mod.categories = mod.categories.map((cat) => (cat === oldCategory ? newCategory : cat));
    }
  }

  // Update category in the categories list
  const categoryIndex = state.categories.indexOf(oldCategory);
  if (categoryIndex !== -1) {
    state.categories[categoryIndex] = newCategory;
  }
};

const sanitizeEnabledModLoadOrders = (mods: Mod[]) => {
  const enabledMods = mods.filter((mod) => mod.isEnabled);
  if (!enabledMods.some((mod) => mod.loadOrder != null)) return;

  const loadOrderByModName = getSparseLoadOrderByModName(sortByNameAndLoadOrder(enabledMods));
  enabledMods.forEach((mod) => {
    const loadOrder = loadOrderByModName.get(mod.name);
    if (loadOrder != null) mod.loadOrder = loadOrder;
  });
};

/** Restores the per-mod data the config keeps that a disk scan can't produce. */
const applyModUserData = (mods: Mod[], modUserData: Record<string, StoredModUserData>) => {
  for (const mod of mods) {
    const userData = modUserData[mod.name];
    if (!userData) continue;

    if (userData.categories) mod.categories = userData.categories;
    if (userData.humanName && mod.humanName === "") mod.humanName = userData.humanName;
    if (userData.author && mod.author === "") mod.author = userData.author;
    if (userData.reqModIdToName && !equal(userData.reqModIdToName, mod.reqModIdToName)) {
      mod.reqModIdToName = userData.reqModIdToName;
    }
  }
};

/** Sets enabled state and load order from preset entries, matching on mod name. */
const applyPresetEntriesToMods = (mods: Mod[], entries: PresetModEntry[]) => {
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));
  for (const mod of mods) {
    const entry = entriesByName.get(mod.name);
    if (!entry) continue;

    mod.isEnabled = isPresetModEnabled(entry);
    mod.loadOrder = mod.isEnabled ? entry.loadOrder : undefined;
  }
};

const setCurrentPresetToMods = (state: AppState, mods: Mod[]) => {
  const previousModsByName = new Map(state.currentPreset.mods.map((mod) => [mod.name, mod]));
  state.allMods = mods;
  state.currentPreset.mods = resolveModsBySourcePriority(
    mods,
    state.appFolderPaths,
    state.isFeaturesForModdersEnabled,
  ).map((mod) => {
    const previousMod = previousModsByName.get(mod.name);
    if (!previousMod) return { ...mod };
    return {
      ...mod,
      isEnabled: previousMod.isEnabled,
      categories: previousMod.categories,
      loadOrder: previousMod.loadOrder,
      humanName: mod.humanName || previousMod.humanName,
      author: mod.author || previousMod.author,
      imgPath: mod.imgPath || previousMod.imgPath,
    };
  });

  const isInitialModPopulation = previousModsByName.size === 0;
  if (isInitialModPopulation && state.dataFromConfig && state.dataFromConfig.currentPreset.version != undefined) {
    state.currentPreset.version = state.dataFromConfig.currentPreset.version;
    console.log("sorting as in preset from config in setMods");
    state.currentPreset.mods = sortModsAsInEntries(state.currentPreset.mods, state.dataFromConfig.currentPreset.mods);
  }

  if (state.dataFromConfig) {
    findAlwaysEnabledMods(state.currentPreset.mods, state.dataFromConfig.alwaysEnabledModNames).forEach(
      (mod) => (mod.isEnabled = true),
    );

    if (isInitialModPopulation) {
      applyModUserData(state.currentPreset.mods, state.dataFromConfig.modUserData);
      applyPresetEntriesToMods(state.currentPreset.mods, state.dataFromConfig.currentPreset.mods);
    }
  }

  sanitizeEnabledModLoadOrders(state.currentPreset.mods);

  const appStartIndex = state.presets.findIndex((preset) => preset.name === "On App Start");
  const newPreset: SavedPreset = {
    name: "On App Start",
    mods: toSnapshotEntries(state.currentPreset.mods),
    version: state.currentPreset.version,
  };
  if (appStartIndex != -1) {
    state.presets.splice(appStartIndex, 1, newPreset);
  } else {
    state.presets.push(newPreset);
  }
};

const setModLoadOrderInternal = (
  ourMod: Mod,
  state: AppState,
  modName: string,
  newLoadOrder: number,
  originalLoadOrder?: number,
) => {
  console.log(`orig order is ${originalLoadOrder}`);
  console.log(`new order is ${newLoadOrder}`);

  state.currentPreset.mods.forEach((mod) => {
    if (mod.name === modName) {
      // console.log(`setting loadOrder to ${newLoadOrder}`);
    } else if (mod.loadOrder) {
      if (originalLoadOrder != null && mod.loadOrder > originalLoadOrder && mod.loadOrder <= newLoadOrder) {
        mod.loadOrder -= 1;
      }
    }
  });

  ourMod.loadOrder = newLoadOrder;
  // console.log(
  //   state.currentPreset.mods
  //     .filter((mod) => mod.loadOrder != null)
  //     .map((mod) => [mod.name, mod.loadOrder])
  // );
  adjustDuplicates(state.currentPreset.mods, ourMod);
};

const applyUsedModsImportToState = (state: AppState, modNames: string[]) => {
  const importedMods = getUsedModImport(
    modNames,
    state.currentPreset.mods.map((mod) => mod.name),
  );
  const importByName = new Map(importedMods.map((mod) => [mod.name, mod]));

  state.currentPreset.mods.forEach((mod) => {
    const importedMod = importByName.get(mod.name);
    mod.isEnabled = importedMod !== undefined;
    mod.loadOrder = importedMod?.loadOrder;
  });
  sanitizeEnabledModLoadOrders(state.currentPreset.mods);
};

const reconcileCurrentPresetModSources = (state: AppState) => {
  const previousModsByName = new Map(state.currentPreset.mods.map((mod) => [mod.name, mod]));
  state.currentPreset.mods = resolveModsBySourcePriority(
    state.allMods,
    state.appFolderPaths,
    state.isFeaturesForModdersEnabled,
  ).map((mod) => {
    const previousMod = previousModsByName.get(mod.name);
    if (!previousMod) return { ...mod };
    return {
      ...mod,
      isEnabled: previousMod.isEnabled,
      categories: previousMod.categories,
      loadOrder: previousMod.loadOrder,
      humanName: mod.humanName || previousMod.humanName,
      author: mod.author || previousMod.author,
      imgPath: mod.imgPath || previousMod.imgPath,
    };
  });
  sanitizeEnabledModLoadOrders(state.currentPreset.mods);
};

/** Adds the mod names that aren't in the list and removes the ones that are. */
const toggleModNames = (names: string[], namesToToggle: string[]) => {
  const existingNames = new Set(names);
  const toggledNames = new Set(namesToToggle);

  return [
    ...names.filter((name) => !toggledNames.has(name)),
    ...[...toggledNames].filter((name) => !existingNames.has(name)),
  ];
};

const disableAllModsInternal = (state: AppState) => {
  console.log("disabling all mods");
  state.currentPreset.mods.forEach((mod) => (mod.isEnabled = false));
};

const enableModsByWorkshopIdsInternal = (state: AppState, ids: string[]) => {
  console.log("ENABLING ALL MODS WITH ids: ", ids);
  state.currentPreset.mods
    .filter((mod) => ids.some((id) => id == mod.workshopId))
    .forEach((mod) => (mod.isEnabled = true));
};

const addPresetInternal = (state: AppState, newPreset: SavedPreset, showAsLastSelected = true) => {
  newPreset.version = 2;
  state.presets.push(newPreset);
  if (showAsLastSelected) state.lastSelectedPreset = newPreset;

  state.toasts.push({
    type: "success",
    messages: ["loc:createdPreset", newPreset.name],
    startTime: Date.now(),
  } as Toast);
};

const applyPresetModsUnaryInternal = (state: AppState, presetEntries: PresetModEntry[]) => {
  state.currentPreset.mods.forEach((mod) => {
    mod.isEnabled = false;
    mod.loadOrder = undefined;
  });

  const normalizedEntries = withoutDuplicateEntries(presetEntries);
  applyPresetEntriesToMods(state.currentPreset.mods, normalizedEntries);

  state.currentPreset.mods = sortModsAsInEntries(state.currentPreset.mods, normalizedEntries);
  state.currentPreset.version = 2;

  findAlwaysEnabledMods(state.currentPreset.mods, state.alwaysEnabledModNames).forEach((mod) => (mod.isEnabled = true));

  sanitizeEnabledModLoadOrders(state.currentPreset.mods);
};

const selectPresetInternal = (state: AppState, presetSelection: SelectOperation, newPreset: SavedPreset) => {
  state.lastSelectedPreset = newPreset;

  if (presetSelection === "unary") {
    applyPresetModsUnaryInternal(state, newPreset.mods);
  } else if (presetSelection === "addition" || presetSelection === "subtraction") {
    newPreset.mods.forEach((entry) => {
      if (isPresetModEnabled(entry)) {
        const modToChange = findMod(state.currentPreset.mods, entry);
        if (modToChange) modToChange.isEnabled = presetSelection !== "subtraction";
      }
    });
  }

  findAlwaysEnabledMods(state.currentPreset.mods, state.alwaysEnabledModNames).forEach((mod) => (mod.isEnabled = true));
  sanitizeEnabledModLoadOrders(state.currentPreset.mods);
};

const createPresetFromCollection = (state: AppState, importSteamCollection: ImportSteamCollection) => {
  const modsIds = importSteamCollection.modIds;

  console.log("all mods in collection are already subbed to");
  const presetEntries: PresetModEntry[] = [];
  for (let i = 0; i < modsIds.length; i++) {
    const modId = modsIds[i];
    const mod =
      state.currentPreset.mods.find((iterMod) => iterMod.workshopId == modId) ??
      state.allMods.find((iterMod) => iterMod.workshopId == modId);
    if (!mod) continue;

    const entry: PresetModEntry = { name: mod.name };
    if (importSteamCollection.isPresetLoadOrdered) entry.loadOrder = i;
    presetEntries.push(entry);
  }

  const newPresetName =
    importSteamCollection.presetName && importSteamCollection.presetName != ""
      ? importSteamCollection.presetName
      : importSteamCollection.name;

  const existingPreset = state.presets.find((preset) => preset.name == newPresetName);
  if (existingPreset) {
    existingPreset.mods = presetEntries;
    existingPreset.version = 2;
  } else {
    addPresetInternal(state, { name: newPresetName, mods: presetEntries });
  }
};

const handleImportSteamCollection = (state: AppState, importSteamCollection: ImportSteamCollection) => {
  console.log("handleImportSteamCollection:", importSteamCollection);
  if (importSteamCollection.doCreatePreset) {
    createPresetFromCollection(state, importSteamCollection);
  }
  if (importSteamCollection.isImmediateImport) {
    if (importSteamCollection.doDisableOtherMods) {
      disableAllModsInternal(state);
    }
    enableModsByWorkshopIdsInternal(state, importSteamCollection.modIds);
    if (importSteamCollection.isLoadOrdered) {
      for (let i = 0; i < importSteamCollection.modIds.length; i++) {
        const mod = state.currentPreset.mods.find((mod) => mod.workshopId == importSteamCollection.modIds[i]);
        if (mod) setModLoadOrderInternal(mod, state, mod.name, i);
      }
    }
    sanitizeEnabledModLoadOrders(state.currentPreset.mods);

    state.toasts.push({
      messages: ["loc:importedModsFromSteamCollection"],
      startTime: Date.now(),
      type: "success",
    });
  }
};

const checkImportedSteamCollections = (state: AppState) => {
  for (const importSteamCollection of Object.values(state.steamCollectionsToImport)) {
    if (
      importSteamCollection.modIds.every((modId) =>
        state.allMods.some((modInAllMods) => modInAllMods.workshopId == modId),
      )
    ) {
      handleImportSteamCollection(state, importSteamCollection);
      delete state.steamCollectionsToImport[importSteamCollection.name];
    }
  }
};

type CreateBisectedModListPresetsPayload = {
  isRandom: boolean;
  ignoreDependencies: boolean;
};

const cloneModsForBisect = (mods: Mod[], isLoadOrderPreset: boolean) =>
  mods.map((mod, i) => {
    const newMod = { ...mod };
    if (isLoadOrderPreset) newMod.loadOrder = i;
    return newMod;
  });

const normalizeBisectedPresetMods = (mods: Mod[], isLoadOrderPreset: boolean) =>
  sortByNameAndLoadOrder(mods).map((mod, i) => {
    const newMod = { ...mod };
    if (isLoadOrderPreset) newMod.loadOrder = i;
    return newMod;
  });

const getBestBisectBoundaryIndex = (groupSizes: number[], targetSize: number) => {
  let bestIndex = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestCount = 0;
  let currentCount = 0;

  for (let i = 0; i <= groupSizes.length; i++) {
    const currentDiff = Math.abs(targetSize - currentCount);
    if (currentDiff < bestDiff || (currentDiff == bestDiff && currentCount > bestCount)) {
      bestIndex = i;
      bestDiff = currentDiff;
      bestCount = currentCount;
    }

    currentCount += groupSizes[i] ?? 0;
  }

  return bestIndex;
};

const shuffleItems = <T>(items: T[]) => {
  const shuffled = [...items];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[i]];
  }

  return shuffled;
};

const createLegacyBisectedPresetMods = (presetMods: Mod[], isRandom: boolean, isLoadOrderPreset: boolean) => {
  const cutoff = Math.ceil(presetMods.length / 2);

  let firstPresetMods: Mod[] = [];
  let secondPresetMods: Mod[] = [];

  if (isRandom) {
    const modsToPickFrom = [...presetMods];
    for (let i = 0; i < cutoff; i++) {
      const modIndex = Math.floor(Math.random() * modsToPickFrom.length);
      firstPresetMods.push(modsToPickFrom[modIndex]);
      modsToPickFrom.splice(modIndex, 1);
    }

    for (let i = modsToPickFrom.length - 1; i >= 0; i--) {
      const modIndex = Math.floor(Math.random() * modsToPickFrom.length);
      secondPresetMods.push(modsToPickFrom[modIndex]);
      modsToPickFrom.splice(modIndex, 1);
    }

    firstPresetMods = normalizeBisectedPresetMods(firstPresetMods, isLoadOrderPreset);
    secondPresetMods = normalizeBisectedPresetMods(secondPresetMods, isLoadOrderPreset);
  } else {
    firstPresetMods = presetMods.slice(0, cutoff);
    secondPresetMods = presetMods.slice(cutoff);
  }

  return [firstPresetMods, secondPresetMods] as const;
};

const getDependencyAwareBisectGroups = (presetMods: Mod[]) => {
  const modsByPath = new Map(presetMods.map((mod) => [mod.path, mod]));
  const modsByName = new Map(presetMods.map((mod) => [mod.name, mod]));
  const modsByWorkshopId = new Map(
    presetMods.filter((mod) => mod.workshopId != "").map((mod) => [mod.workshopId, mod] as const),
  );
  const dependenciesByPath = new Map<string, Set<string>>(
    presetMods.map((mod) => [mod.path, new Set<string>()] as const),
  );

  const addDependencyEdge = (firstPath: string, secondPath: string) => {
    if (firstPath == secondPath) return;
    dependenciesByPath.get(firstPath)?.add(secondPath);
    dependenciesByPath.get(secondPath)?.add(firstPath);
  };

  for (const mod of presetMods) {
    for (const [workshopId] of mod.reqModIdToName ?? []) {
      const dependencyMod = modsByWorkshopId.get(workshopId);
      if (dependencyMod) addDependencyEdge(mod.path, dependencyMod.path);
    }

    for (const dependencyPackName of mod.dependencyPacks ?? []) {
      const dependencyMod = modsByName.get(dependencyPackName);
      if (dependencyMod) addDependencyEdge(mod.path, dependencyMod.path);
    }
  }

  const visitedPaths = new Set<string>();
  const groups: Mod[][] = [];

  for (const mod of presetMods) {
    if (visitedPaths.has(mod.path)) continue;

    const stack = [mod.path];
    const groupMods: Mod[] = [];
    visitedPaths.add(mod.path);

    while (stack.length > 0) {
      const currentPath = stack.pop();
      if (!currentPath) continue;

      const currentMod = modsByPath.get(currentPath);
      if (!currentMod) continue;

      groupMods.push(currentMod);

      for (const dependencyPath of dependenciesByPath.get(currentPath) ?? []) {
        if (visitedPaths.has(dependencyPath)) continue;
        visitedPaths.add(dependencyPath);
        stack.push(dependencyPath);
      }
    }

    groups.push(sortByNameAndLoadOrder(groupMods));
  }

  return groups;
};

const createDependencyAwareBisectedPresetMods = (presetMods: Mod[], isRandom: boolean, isLoadOrderPreset: boolean) => {
  const groups = getDependencyAwareBisectGroups(presetMods);
  const groupsToSplit = isRandom ? shuffleItems(groups) : groups;
  const cutoff = Math.ceil(presetMods.length / 2);
  const boundaryIndex = getBestBisectBoundaryIndex(
    groupsToSplit.map((group) => group.length),
    cutoff,
  );
  const firstPresetMods = normalizeBisectedPresetMods(groupsToSplit.slice(0, boundaryIndex).flat(), isLoadOrderPreset);
  const secondPresetMods = normalizeBisectedPresetMods(groupsToSplit.slice(boundaryIndex).flat(), isLoadOrderPreset);

  return [firstPresetMods, secondPresetMods] as const;
};

const createBisectedModListPresetsInternal = (
  state: AppState,
  { isRandom, ignoreDependencies }: CreateBisectedModListPresetsPayload,
) => {
  const enabledMods = state.currentPreset.mods.filter((mod) => mod.isEnabled);
  const isLoadOrderPreset = enabledMods.some((mod) => mod.loadOrder != undefined);
  const presetMods = cloneModsForBisect(sortByNameAndLoadOrder(enabledMods), isLoadOrderPreset);
  const [firstPresetMods, secondPresetMods] = ignoreDependencies
    ? createLegacyBisectedPresetMods(presetMods, isRandom, isLoadOrderPreset)
    : createDependencyAwareBisectedPresetMods(presetMods, isRandom, isLoadOrderPreset);

  const timeStamp = format(new Date(), "dd-MM-yyyy-HH.mm.ss");
  const newPresetNameFirst = `${timeStamp}_${firstPresetMods.length}_First`;
  const newPresetNameSecond = `${timeStamp}_${secondPresetMods.length}_Second`;

  const newPresetFirst: SavedPreset = { name: newPresetNameFirst, mods: toPresetEntries(firstPresetMods) };
  const newPresetSecond: SavedPreset = {
    name: newPresetNameSecond,
    mods: toPresetEntries(secondPresetMods),
  };

  for (const newPreset of [newPresetFirst, newPresetSecond]) {
    let existingPreset = state.presets.find((preset) => preset.name == newPreset.name);
    while (existingPreset) {
      newPreset.name = newPreset.name + "_";
      existingPreset = state.presets.find((preset) => preset.name == newPreset.name);
    }

    addPresetInternal(state, newPreset, false);
  }
};

const appSlice = createSlice({
  name: "app",
  initialState: initialState,
  reducers: {
    // when mutating mods make sure you get the same mod from state.currentPreset.mods and don't change the mod that's from the payload
    setModRowsSortingType: (state: AppState, action: PayloadAction<SortingType>) => {
      state.modRowsSortingType = action.payload;
    },
    addCategory: (state: AppState, action: PayloadAction<AddCategoryPayload>) =>
      addCategoryByPayload(state, action.payload),
    removeCategory: (state: AppState, action: PayloadAction<RemoveCategoryPayload>) =>
      removeCategoryByPayload(state, action.payload),
    renameCategory: (state: AppState, action: PayloadAction<RenameCategoryPayload>) =>
      renameCategoryByPayload(state, action.payload),
    setCategoryColor: (state: AppState, action: PayloadAction<{ category: string; color: string }>) => {
      if (!state.categoryColors) {
        state.categoryColors = {};
      }
      state.categoryColors[action.payload.category] = action.payload.color;
    },
    toggleMod: (state: AppState, action: PayloadAction<Mod>) => {
      const inputMod = action.payload;
      const mod = state.currentPreset.mods.find((mod) => mod.workshopId == inputMod.workshopId);
      if (mod) {
        mod.isEnabled = !mod.isEnabled;
        if (mod.isEnabled) sanitizeEnabledModLoadOrders(state.currentPreset.mods);
      }
    },
    setIsModEnabled: (state: AppState, action: PayloadAction<SetIsModEnabledPayload>) => {
      const { mod, isEnabled } = action.payload;
      const presetMod = state.currentPreset.mods.find((iterMod) => iterMod.path == mod.path);
      if (presetMod) {
        presetMod.isEnabled = isEnabled;
        if (isEnabled) sanitizeEnabledModLoadOrders(state.currentPreset.mods);
      }
    },
    setAreModsEnabled: (state: AppState, action: PayloadAction<SetIsModEnabledPayload[]>) => {
      const enablePayloads = action.payload;
      for (const { mod, isEnabled } of enablePayloads) {
        const presetMod = state.currentPreset.mods.find((iterMod) => iterMod.path == mod.path);
        if (presetMod) presetMod.isEnabled = isEnabled;
      }
      if (enablePayloads.some(({ isEnabled }) => isEnabled)) {
        sanitizeEnabledModLoadOrders(state.currentPreset.mods);
      }
    },
    orderImportedMods: (state: AppState) => {
      console.log("ordering imported mods");
      if (
        state.importedMods.length === 0 ||
        !state.importedMods.every((importedMod) =>
          state.currentPreset.mods.some((mod) => sharedModMatchesInstalledMod(importedMod, mod)),
        )
      ) {
        return;
      }

      state.currentPreset.mods.forEach((mod) => {
        const importedMod = state.importedMods.find((iterMod) => sharedModMatchesInstalledMod(iterMod, mod));
        mod.isEnabled = importedMod != null;
        mod.loadOrder = importedMod?.loadOrder;
      });

      findAlwaysEnabledMods(state.currentPreset.mods, state.alwaysEnabledModNames).forEach(
        (mod) => (mod.isEnabled = true),
      );

      sanitizeEnabledModLoadOrders(state.currentPreset.mods);
      state.importedMods = [];
    },
    enableAll: (state: AppState) => {
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = true));
      sanitizeEnabledModLoadOrders(state.currentPreset.mods);
    },
    enableModsByName: (state: AppState, action: PayloadAction<string[]>) => {
      const modNames = action.payload;
      console.log("ENABLING ALL MODS WITH NAMES: ", modNames);
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = false));

      const modNameSet = new Set(modNames);
      state.currentPreset.mods.filter((mod) => modNameSet.has(mod.name)).forEach((mod) => (mod.isEnabled = true));
      sanitizeEnabledModLoadOrders(state.currentPreset.mods);
    },
    importModsFromUsedMods: (state: AppState, action: PayloadAction<string[]>) => {
      const importedMods = getUsedModImport(
        action.payload,
        state.currentPreset.mods.map((mod) => mod.name),
      );
      if (importedMods.some((mod) => mod.loadOrder !== undefined)) {
        state.pendingUsedModsImport = action.payload;
        return;
      }

      applyUsedModsImportToState(state, action.payload);
    },
    resolveUsedModsImport: (state: AppState, action: PayloadAction<"automatic" | "previous">) => {
      if (!state.pendingUsedModsImport) return;

      const modNames =
        action.payload === "automatic"
          ? [...state.pendingUsedModsImport].sort(compareModNames)
          : state.pendingUsedModsImport;
      applyUsedModsImportToState(state, modNames);
      if (action.payload === "previous") {
        state.modRowsSortingType = SortingType.Ordered;
      }
      state.pendingUsedModsImport = undefined;
    },
    disableAllMods: (state: AppState) => {
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = false));

      findAlwaysEnabledMods(state.currentPreset.mods, state.alwaysEnabledModNames).forEach(
        (mod) => (mod.isEnabled = true),
      );
      sanitizeEnabledModLoadOrders(state.currentPreset.mods);
    },
    setImportedMods: (state: AppState, action: PayloadAction<ModIdAndLoadOrder[]>) => {
      state.importedMods = action.payload;
    },
    setMods: (state: AppState, action: PayloadAction<Mod[]>) => {
      console.log("appSlice/setMods: SETTING CURRENT PRESET");
      const mods = action.payload;
      setCurrentPresetToMods(state, mods);
    },
    addMod: (state: AppState, action: PayloadAction<Mod>) => {
      const mod = action.payload;

      const alreadyExists = state.currentPreset.mods.find((iterMod) => iterMod.path === mod.path);
      if (alreadyExists) {
        console.log("Added mod already exists, skipping it.");
        return;
      }

      const alreadyExistsByName = state.currentPreset.mods.find((iterMod) => iterMod.name === mod.name);
      if (!alreadyExistsByName) {
        for (const iterMod of state.currentPreset.mods.filter((mod) => mod.loadOrder == undefined)) {
          if (compareModNames(mod.name, iterMod.name) < 1) {
            state.currentPreset.mods.splice(state.currentPreset.mods.indexOf(iterMod), 0, mod);
            break;
          }
        }

        // if we couldn't find a place for it
        if (!state.currentPreset.mods.find((iterMod) => iterMod == mod)) state.currentPreset.mods.push(mod);
      } else if (
        resolveModsBySourcePriority(
          [alreadyExistsByName, mod],
          state.appFolderPaths,
          state.isFeaturesForModdersEnabled,
        )[0] === mod
      ) {
        const previousIndex = state.currentPreset.mods.indexOf(alreadyExistsByName);
        state.currentPreset.mods.splice(previousIndex, 1, mod);
        mod.isEnabled = alreadyExistsByName.isEnabled;
        mod.author = alreadyExistsByName.author;
        mod.imgPath = alreadyExistsByName.imgPath;
        mod.humanName = alreadyExistsByName.humanName;
        mod.categories = alreadyExistsByName.categories;
        mod.loadOrder = alreadyExistsByName.loadOrder;
      }

      if (!state.allMods.find((iterMod) => iterMod.path == mod.path)) {
        state.allMods.push(mod);
      }

      const removedModData = state.removedModsData.find(({ modPath }) => modPath === mod.path);
      if (removedModData) {
        mod.isEnabled = removedModData.isEnabled;
        mod.loadOrder = removedModData.loadOrder;
        mod.tags = removedModData.tags;
        // state.currentPreset.mods.splice(state.currentPreset.mods.indexOf(mod), 1);
        // state.currentPreset.mods.splice(removedModData.indexInMods, 0, mod);
        state.removedModsData = state.removedModsData.filter(({ modPath }) => modPath != mod.path);
      }

      if (state.removedModsCategories[mod.path]) {
        mod.categories = state.removedModsCategories[mod.path];
        delete state.removedModsCategories[mod.path];
      }
      if (mod.isInData && state.dataModsToEnableByName.find((nameOfToEnable) => nameOfToEnable === mod.name)) {
        mod.isEnabled = true;

        state.dataModsToEnableByName.splice(
          state.dataModsToEnableByName.findIndex((nameOfToEnable) => nameOfToEnable === mod.name),
          1,
        );
      }
      // match on name, not path: a mod that moved between data/content/custom folders is still the
      // same mod and should keep the enabled state the config saved for it
      const entryInConfig = state.dataFromConfig?.currentPreset.mods.find((entry) => entry.name == mod.name);
      if (entryInConfig && isPresetModEnabled(entryInConfig)) {
        mod.isEnabled = true;
      }
      if (state.newMergedPacks.some((mergedPack) => mergedPack.path == mod.path)) {
        mod.isEnabled = true;
      }
      if (state.alwaysEnabledModNames.includes(mod.name)) {
        mod.isEnabled = true;
      }

      checkImportedSteamCollections(state);
      if (mod.isEnabled) sanitizeEnabledModLoadOrders(state.currentPreset.mods);
    },
    removeMod: (state: AppState, action: PayloadAction<string>) => {
      const modPath = action.payload;

      const removedMod = state.currentPreset.mods.find((iterMod) => iterMod.path == modPath);
      if (!removedMod) {
        // in case we deleted a content mod check if there is a symbolic link in data of that mod
        // if there is remove the symbolic link in data as well, it will also be deleted as a file in the main thread
        const removedModInAll = state.allMods.find((iterMod) => iterMod.path == modPath);
        if (removedModInAll) {
          const sameModOrSymLinkInData =
            isWorkshopMod(removedModInAll) &&
            state.currentPreset.mods.find((iterMod) => iterMod.isInData && iterMod.name == removedModInAll.name);
          if (sameModOrSymLinkInData && sameModOrSymLinkInData.isSymbolicLink) {
            state.currentPreset.mods = state.currentPreset.mods.filter(
              (iterMod) => iterMod.path !== sameModOrSymLinkInData.path,
            );
            state.allMods = state.allMods.filter((iterMod) => iterMod.path !== sameModOrSymLinkInData.path);
            state.allMods = state.allMods.filter((iterMod) => iterMod.path !== removedModInAll.path);
          }
        }
        state.allMods = state.allMods.filter((iterMod) => iterMod.path !== modPath);
        return;
      }

      const fallbackMod = resolveModsBySourcePriority(
        state.allMods.filter((iterMod) => iterMod.path !== modPath && iterMod.name === removedMod.name),
        state.appFolderPaths,
        state.isFeaturesForModdersEnabled,
      )[0];

      if (fallbackMod) {
        state.currentPreset.mods.push(fallbackMod);
        if (removedMod.isEnabled) {
          fallbackMod.isEnabled = true;
        }
        fallbackMod.categories = removedMod.categories;
        fallbackMod.loadOrder = removedMod.loadOrder;
      }

      state.removedModsData.push({
        modPath: removedMod.path,
        isEnabled: removedMod.isEnabled,
        indexInMods: state.currentPreset.mods.indexOf(removedMod),
        loadOrder: removedMod.loadOrder,
        time: Date.now(),
        tags: removedMod.tags,
      });
      state.removedModsCategories[removedMod.path] = removedMod.categories ?? [];

      state.currentPreset.mods = state.currentPreset.mods.filter((iterMod) => iterMod.path !== modPath);
      state.allMods = state.allMods.filter((iterMod) => iterMod.path !== modPath);
      sanitizeEnabledModLoadOrders(state.currentPreset.mods);
    },
    setModData: (state: AppState, action: PayloadAction<ModData[]>) => {
      const datas = action.payload;

      for (const data of datas) {
        if (data.workshopInstallTimestamp != null || data.workshopState != null) {
          state.workshopInstallStatuses[data.workshopId] = {
            installedTimestamp: data.workshopInstallTimestamp,
            state: data.workshopState,
          };
          if (
            data.workshopInstallTimestamp != null &&
            data.lastChanged != null &&
            data.lastChanged <= data.workshopInstallTimestamp * 1000
          ) {
            delete state.workshopUpdateCheckResults[data.workshopId];
          }
        }
        // Propagate Workshop metadata to whichever same-named source currently wins priority.
        const contentMod = state.allMods.find((mod) => isWorkshopMod(mod) && mod.workshopId == data.workshopId);
        if (contentMod) {
          const preferredMod = state.currentPreset.mods.find((iterMod) => iterMod.name == contentMod.name);
          if (preferredMod) {
            if (data.humanName && data.humanName != "" && preferredMod.humanName != data.humanName)
              preferredMod.humanName = data.humanName ?? "";
            if (data.author && data.author != "" && preferredMod.author != data.author)
              preferredMod.author = data.author;
            if (data.lastChanged && preferredMod.lastChanged != data.lastChanged)
              preferredMod.lastChanged = data.lastChanged;
            if (
              data.reqModIdToName &&
              data.reqModIdToName.length > 0 &&
              !equal(preferredMod.reqModIdToName, data.reqModIdToName)
            )
              preferredMod.reqModIdToName = data.reqModIdToName;
            if (data.tags) {
              if (preferredMod.tags.length != data.tags.length) {
                preferredMod.tags = data.tags;
              }
              if (contentMod.tags.length != data.tags.length) {
                // console.log("tags changed:", contentMod.name, contentMod.tags, "->", data.tags);
                contentMod.tags = data.tags;
              }
            }
          }
        }

        const mod = state.currentPreset.mods.find((mod) => mod.workshopId == data.workshopId);
        if (!mod) continue;
        if (data.isDeleted) {
          mod.isDeleted = data.isDeleted;
        } else {
          if (data.humanName && data.humanName != "" && mod.humanName != data.humanName)
            mod.humanName = data.humanName ?? "";
          if (data.author && data.author != "" && mod.author != data.author) mod.author = data.author;
          if (data.reqModIdToName && data.reqModIdToName.length > 0 && !equal(mod.reqModIdToName, data.reqModIdToName))
            mod.reqModIdToName = data.reqModIdToName;
        }

        if (data.lastChanged && mod.lastChanged != data.lastChanged) mod.lastChanged = data.lastChanged;
        if (data.tags && mod.tags.length != data.tags.length) {
          // console.log("tags changed:", mod.name, mod.tags, "->", data.tags);
          mod.tags = data.tags;
        }

        // timeAddedToUserList we get from Steam is always 0, not sure what it's for but it's not actually time of subbing
        // if (data.subscriptionTime && mod.subbedTime != data.subscriptionTime) {
        //   console.log("subbedTime:", mod.subbedTime, "->", data.subscriptionTime);
        //   mod.subbedTime = data.subscriptionTime;
        // }
      }
    },
    setWorkshopUpdateCheckMessage: (state: AppState, action: PayloadAction<WorkshopUpdateCheckMessage>) => {
      for (const item of action.payload.items) {
        state.workshopUpdateCheckResults[item.workshopId] = item;
        const installedTimestamp = item.installTimestampAfter ?? item.installTimestampBefore;
        state.workshopInstallStatuses[item.workshopId] = {
          installedTimestamp: installedTimestamp ?? state.workshopInstallStatuses[item.workshopId]?.installedTimestamp,
          state: item.finalState,
        };
      }
    },
    setPackHeaderData: (state: AppState, action: PayloadAction<PackHeaderData | PackHeaderData[]>) => {
      const headers = (Array.isArray(action.payload) && action.payload) || [action.payload];
      for (const header of headers) {
        const matchingMods = [
          state.currentPreset.mods.find((mod) => mod.path == header.path),
          state.allMods.find((mod) => mod.path == header.path),
        ].filter((mod): mod is Mod => mod != null);
        for (const mod of matchingMods) {
          mod.isMovie = header.isMovie;
          mod.hasStartpos = header.hasStartpos;
          mod.dependencyPacks = header.dependencyPacks;
        }

        if (header.isMovie) console.log(`${header.path} is movie!`);
      }
    },
    setSkillsData: (state: AppState, action: PayloadAction<SkillsData>) => {
      state.skillsData = action.payload;
      state.skillNodesToLevel = {};
      state.currentRank = 1;
    },
    clearSkillsData: (state: AppState) => {
      state.skillsData = undefined;
      state.skillNodesToLevel = {};
      state.currentRank = 1;
    },
    setPacksData: (state: AppState, action: PayloadAction<PackViewData[]>) => {
      const packsData = action.payload;

      for (const packData of packsData) {
        if (!state.packsData[packData.packPath]) {
          state.packsData[packData.packPath] = packData;
        } else if (packData.packedFiles) {
          state.packsData[packData.packPath].tables = Array.from(
            new Set([...(state.packsData[packData.packPath].tables || []), ...(packData.tables || [])]),
          );
          state.packsData[packData.packPath].packedFiles = state.packsData[packData.packPath].packedFiles || {};
          for (const [packedFilePath, packedFile] of Object.entries(packData.packedFiles))
            state.packsData[packData.packPath].packedFiles[packedFilePath] = packedFile;
        }
      }

      console.log(
        "APPSLICE setPacksData:",
        window.location.pathname,
        packsData.map((pd) => pd.packName),
      );
    },
    setUnsavedPacksData: (state: AppState, action: PayloadAction<SetUnsavedPacksDataPayload>) => {
      const { packPath, unsavedFileData } = action.payload;
      // The main process sends the complete authoritative list. Replacing it also lets a successful
      // physical pack save clear files that would otherwise remain as stale renderer overrides.
      if (unsavedFileData.length === 0) delete state.unsavedPacksData[packPath];
      else state.unsavedPacksData[packPath] = unsavedFileData;

      console.log(
        "APPSLICE setUnsavedPacksData:",
        window.location.pathname,
        unsavedFileData.map((pd) => pd.name),
      );
    },
    setPacksDataRead: (state: AppState, action: PayloadAction<string[]>) => {
      const packPaths = action.payload;

      for (const path of packPaths) {
        if (!state.pathsOfReadPacks.some((iterPath) => iterPath == path)) {
          state.pathsOfReadPacks.push(path);
        }
      }
    },
    // setPackCollisions: (
    //   state: AppState,
    //   action: PayloadAction<[PackFileCollision[], PackTableCollision[]]>
    // ) => {
    //   const [packFileCollisions, packTableCollisions] = action.payload;
    //   state.packCollisions = { packFileCollisions, packTableCollisions };
    // },
    setPackCollisions: (state: AppState, action: PayloadAction<PackCollisions>) => {
      state.packCollisions = action.payload;
    },
    setPackCollisionsCheckProgress: (state: AppState, action: PayloadAction<PackCollisionsCheckProgressData>) => {
      state.packCollisionsCheckProgress = action.payload;
    },
    setPackSearchResults: (state: AppState, action: PayloadAction<string[] | undefined>) => {
      state.packSearchResults = action.payload;
    },
    setAppFolderPaths: (state: AppState, action: PayloadAction<GameFolderPaths>) => {
      state.appFolderPaths = action.payload;
      reconcileCurrentPresetModSources(state);
      state.isSetAppFolderPathsDone = true;
    },
    requestGameFolderPaths: (state: AppState, action: PayloadAction<SupportedGames | undefined>) => {
      state.requestFolderPathsForGame = action.payload;
    },
    setFromConfig: (state: AppState, action: PayloadAction<ConfigForRenderer>) => {
      const fromConfigAppState = action.payload;

      state.hasConfigBeenRead = true;
      state.dataFromConfig = fromConfigAppState;

      applyModUserData(state.currentPreset.mods, fromConfigAppState.modUserData);
      applyPresetEntriesToMods(state.currentPreset.mods, fromConfigAppState.currentPreset.mods);
      state.currentPreset.version = 2;

      fromConfigAppState.presets.forEach((preset) => {
        if (!state.presets.find((existingPreset) => existingPreset.name === preset.name)) {
          state.presets.push(preset);
        }
      });

      state.areThumbnailsEnabled = fromConfigAppState.areThumbnailsEnabled;
      state.isClosedOnPlay = fromConfigAppState.isClosedOnPlay;
      state.isUsingEnglishLocalizations = !!fromConfigAppState.isUsingEnglishLocalizations;
      state.isCompatCheckingVanillaPacks =
        !!fromConfigAppState.isFeaturesForModdersEnabled && !!fromConfigAppState.isCompatCheckingVanillaPacks;
      state.isAuthorEnabled = fromConfigAppState.isAuthorEnabled;
      state.isDualModListLayoutEnabled = !!fromConfigAppState.isDualModListLayoutEnabled;
      state.modListDensity = fromConfigAppState.modListDensity ?? state.modListDensity;
      state.isShowingDisabledModsLoadOrder =
        fromConfigAppState.isShowingDisabledModsLoadOrder ?? state.isShowingDisabledModsLoadOrder;
      state.isPresetAuthorEnabled = !!fromConfigAppState.isPresetAuthorEnabled;
      state.arePresetThumbnailsEnabled = !!fromConfigAppState.arePresetThumbnailsEnabled;
      state.isCategoryAuthorEnabled = !!fromConfigAppState.isCategoryAuthorEnabled;
      state.areCategoryThumbnailsEnabled = !!fromConfigAppState.areCategoryThumbnailsEnabled;
      state.hiddenModNames = fromConfigAppState.hiddenModNames;
      state.alwaysEnabledModNames = fromConfigAppState.alwaysEnabledModNames;
      state.isMakeUnitsGeneralsEnabled = fromConfigAppState.isMakeUnitsGeneralsEnabled;
      state.isSkipIntroMoviesEnabled = fromConfigAppState.isSkipIntroMoviesEnabled;
      state.isScriptLoggingEnabled = fromConfigAppState.isScriptLoggingEnabled;
      state.isAutoStartCustomBattleEnabled = fromConfigAppState.isAutoStartCustomBattleEnabled;
      state.isChangingGameProcessPriority = fromConfigAppState.isChangingGameProcessPriority;
      state.isFeaturesForModdersEnabled = fromConfigAppState.isFeaturesForModdersEnabled;
      state.moddersPrefix = fromConfigAppState.moddersPrefix || "";
      state.nodeEditorFavorites = fromConfigAppState.nodeEditorFavorites || [];
      state.modRowsSortingType = fromConfigAppState.modRowsSortingType || state.modRowsSortingType;
      // state.currentLanguage = fromConfigAppState.currentLanguage || "en"; // handled elsewhere
      state.packDataOverwrites = fromConfigAppState.packDataOverwrites || {};
      state.currentGame = fromConfigAppState.currentGame || "wh3";
      state.userFlowOptions = fromConfigAppState.userFlowOptions || {};
      state.isShowingSkillNodeSetNames =
        fromConfigAppState.isShowingSkillNodeSetNames ?? state.isShowingSkillNodeSetNames;
      state.isShowingHiddenSkills = fromConfigAppState.isShowingHiddenSkills ?? state.isShowingHiddenSkills;
      state.isShowingHiddenModifiersInsideSkills =
        fromConfigAppState.isShowingHiddenModifiersInsideSkills ?? state.isShowingHiddenModifiersInsideSkills;
      state.isCheckingSkillRequirements =
        fromConfigAppState.isCheckingSkillRequirements ?? state.isCheckingSkillRequirements;
      state.skillTreesDisplayMode = fromConfigAppState.skillTreesDisplayMode ?? state.skillTreesDisplayMode;
      state.technologyTreesDisplayMode =
        fromConfigAppState.technologyTreesDisplayMode ?? state.technologyTreesDisplayMode;

      const categoriesFromMods = new Set(state.currentPreset.mods.map((mod) => mod.categories ?? []).flat());
      if (fromConfigAppState.categories) {
        fromConfigAppState.categories.forEach((category) => categoriesFromMods.add(category));
      }
      state.categories = Array.from(categoriesFromMods);
      state.categoryColors = fromConfigAppState.categoryColors || {};

      findAlwaysEnabledMods(state.currentPreset.mods, fromConfigAppState.alwaysEnabledModNames).forEach(
        (mod) => (mod.isEnabled = true),
      );
      sanitizeEnabledModLoadOrders(state.currentPreset.mods);

      state.wasOnboardingEverRun = fromConfigAppState.wasOnboardingEverRun;
      if (!fromConfigAppState.wasOnboardingEverRun) state.isOnboardingToRun = true;

      if (fromConfigAppState.appFolderPaths) {
        if (fromConfigAppState.appFolderPaths.gamePath)
          state.appFolderPaths.gamePath = fromConfigAppState.appFolderPaths.gamePath;
        if (fromConfigAppState.appFolderPaths.contentFolder)
          state.appFolderPaths.gamePath = fromConfigAppState.appFolderPaths.contentFolder;
      }

      ensureValidCurrentTab(state);
    },
    addPreset: (state: AppState, action: PayloadAction<SavedPreset>) => {
      const newPreset = action.payload;
      if (state.presets.find((preset) => preset.name === newPreset.name)) return;

      addPresetInternal(state, newPreset);
    },
    createOnGameStartPreset: (state: AppState) => {
      const appStartIndex = state.presets.findIndex((preset) => preset.name === "On Last Game Launch");
      const newPreset: SavedPreset = {
        name: "On Last Game Launch",
        mods: toSnapshotEntries(state.currentPreset.mods),
        version: state.currentPreset.version,
      };
      if (appStartIndex != -1) {
        state.presets.splice(appStartIndex, 1, newPreset);
      } else {
        state.presets.push(newPreset);
      }
    },
    selectPreset: (state: AppState, action: PayloadAction<[string, SelectOperation]>) => {
      const [name, presetSelection] = action.payload;

      const newPreset = state.presets.find((preset) => preset.name === name);
      if (!newPreset) return;

      selectPresetInternal(state, presetSelection, newPreset);
    },
    deletePreset: (state: AppState, action: PayloadAction<string>) => {
      const name = action.payload;
      state.presets = state.presets.filter((preset) => preset.name !== name);
      if (state.lastSelectedPreset && state.lastSelectedPreset.name == name) state.lastSelectedPreset = null;
    },
    replacePreset: (state: AppState, action: PayloadAction<string>) => {
      const name = action.payload;
      const preset = state.presets.find((preset) => preset.name === name);
      if (!preset) return;

      preset.mods = toSnapshotEntries(state.currentPreset.mods);
      preset.version = 2;
    },
    updatePresetMods: (state: AppState, action: PayloadAction<{ name: string; mods: PresetModEntry[] }>) => {
      const { name, mods } = action.payload;
      const preset = state.presets.find((iterPreset) => iterPreset.name === name);
      if (!preset) return;

      preset.mods = sortByNameAndLoadOrder(withoutDuplicateEntries(mods.filter(isPresetModEnabled)));
      preset.version = 2;

      if (state.lastSelectedPreset?.name === name) {
        state.lastSelectedPreset = preset;
      }
    },
    applyPresetDraftMods: (
      state: AppState,
      action: PayloadAction<{ mods: PresetModEntry[]; sourcePresetName?: string }>,
    ) => {
      const { mods, sourcePresetName } = action.payload;
      applyPresetModsUnaryInternal(state, mods);

      if (sourcePresetName) {
        const sourcePreset = state.presets.find((preset) => preset.name === sourcePresetName);
        if (sourcePreset) state.lastSelectedPreset = sourcePreset;
      }
    },
    setFilter: (state: AppState, action: PayloadAction<string>) => {
      const filter = action.payload;
      state.filter = filter;
    },
    setModLoadOrderRelativeTo: (state: AppState, action: PayloadAction<ModLoadOrderRelativeTo>) => {
      const payload = action.payload;
      const { modNameToChange, modNameRelativeTo, visualModList } = payload;
      const orderedVisualMods = [...visualModList];
      const modToChange = orderedVisualMods.find((mod) => mod.name === modNameToChange);
      const modRelativeTo = orderedVisualMods.find((mod) => mod.name === modNameRelativeTo);

      console.log("modToChange:", modToChange);
      console.log("modRelativeTo:", modRelativeTo);
      if (!modToChange || !modRelativeTo) return;

      console.log("mod to change:", modToChange.name);
      console.log("mod relative to:", modRelativeTo.name);
      console.log("setAfterMod:", payload.setAfterMod);

      let newIndex = orderedVisualMods.indexOf(modToChange);
      if (modToChange != modRelativeTo) {
        orderedVisualMods.splice(orderedVisualMods.indexOf(modToChange), 1);
        newIndex = orderedVisualMods.indexOf(modRelativeTo);
        orderedVisualMods.splice(payload.setAfterMod ? newIndex + 1 : newIndex, 0, modToChange);
      }

      console.log("new load order for:", modToChange.name, newIndex);
      // modToChange.loadOrder = newIndex;

      const loadOrderByModName = getSparseLoadOrderByModName(orderedVisualMods, modNameToChange);
      state.currentPreset.mods.forEach((mod) => {
        const loadOrder = loadOrderByModName.get(mod.name);
        if (loadOrder != null) mod.loadOrder = loadOrder;
      });
    },
    resetModLoadOrderAll: (state: AppState) => {
      state.currentPreset.mods.forEach((mod) => {
        mod.loadOrder = undefined;
      });
      state.currentPreset.mods = sortByNameAndLoadOrder(state.currentPreset.mods);
    },
    resetModLoadOrder: (state: AppState, action: PayloadAction<Mod[]>) => {
      const mods = action.payload;
      mods.forEach((mod) => {
        const stateMod = state.currentPreset.mods.find((stateMod) => stateMod.name === mod.name);
        if (stateMod) stateMod.loadOrder = undefined;
      });

      if (state.currentPreset.version != undefined) {
        for (const mod of mods) {
          const modToChange = state.currentPreset.mods.find((iterMod) => mod.name === iterMod.name);
          if (!modToChange) continue;

          const siblingMod = state.currentPreset.mods.find(
            (iterMod) =>
              iterMod.path != mod.path &&
              iterMod.loadOrder == undefined &&
              compareModNames(iterMod.name, mod.name) >= 0,
          );
          if (!siblingMod) continue;

          state.currentPreset.mods.splice(state.currentPreset.mods.indexOf(modToChange), 1);
          state.currentPreset.mods.splice(state.currentPreset.mods.indexOf(siblingMod), 0, modToChange);
        }
      }
    },
    toggleAlwaysEnabledMods: (state: AppState, action: PayloadAction<string[]>) => {
      state.alwaysEnabledModNames = toggleModNames(state.alwaysEnabledModNames, action.payload);

      const modsToEnable = findAlwaysEnabledMods(state.currentPreset.mods, state.alwaysEnabledModNames);
      modsToEnable.forEach((mod) => (mod.isEnabled = true));
      if (modsToEnable.length > 0) sanitizeEnabledModLoadOrders(state.currentPreset.mods);
    },
    toggleAlwaysHiddenMods: (state: AppState, action: PayloadAction<string[]>) => {
      state.hiddenModNames = toggleModNames(state.hiddenModNames, action.payload);

      // disable mods we just hid that aren't set to always enabled
      const alwaysEnabledNames = new Set(state.alwaysEnabledModNames);
      const hiddenNames = new Set(state.hiddenModNames);
      state.currentPreset.mods
        .filter((mod) => hiddenNames.has(mod.name) && !alwaysEnabledNames.has(mod.name))
        .forEach((mod) => (mod.isEnabled = false));
    },
    setSaves: (state: AppState, action: PayloadAction<GameSave[]>) => {
      const saves = action.payload;
      state.saves = saves;
    },
    setCurrentLanguage: (state: AppState, action: PayloadAction<string>) => {
      const language = action.payload;
      console.log("appslice setCurrentLanguage:", language);
      if (!isSupportedLanguage(language)) {
        console.log("setCurrentLanguage: language", language, "not supported");
        return;
      }
      if (language != state.currentLanguage) {
        state.currentLanguage = language;
      }
    },
    setCurrentGame: (state: AppState, action: PayloadAction<SetCurrentGamePayload>) => {
      const { game, currentPreset, presets, modUserData } = action.payload;

      state.currentGame = game;
      // always swap presets, even to an empty list: keeping the previous game's presets here used to
      // leak them into the new game's slot the next time the config was written
      state.presets = presets ?? [];

      if (currentPreset) {
        if (state.dataFromConfig) {
          state.dataFromConfig.currentPreset = currentPreset;
          state.dataFromConfig.presets = state.presets;
          state.dataFromConfig.modUserData = modUserData ?? {};
        }
        state.currentPreset = { name: currentPreset.name, mods: [], version: currentPreset.version };
        setCurrentPresetToMods(state, state.allMods);
        state.currentPreset.name = currentPreset.name;
        state.currentPreset.version = currentPreset.version;
      }
    },
    setCurrentGameNaive: (state: AppState, action: PayloadAction<SupportedGames>) => {
      state.currentGame = action.payload;
    },
    setCurrentlyReadingMod: (state: AppState, action: PayloadAction<string>) => {
      state.currentlyReadingMod = { name: action.payload, time: Date.now() };

      // send toast when starting to read a pack
      const existingToast = state.toasts.find((toast) => toast.staticToastId == "modReadingInfo");
      if (existingToast) state.toasts.splice(state.toasts.indexOf(existingToast), 1);

      state.toasts.push({
        type: "info",
        messages: ["loc:readingPack", action.payload],
        startTime: Date.now(),
        staticToastId: "modReadingInfo",
      } as Toast);
    },
    setLastModThatWasRead: (state: AppState, action: PayloadAction<string>) => {
      state.lastModThatWasRead = { name: action.payload, time: Date.now() };

      // send toast when finished reading a pack
      const existingToast = state.toasts.find((toast) => toast.staticToastId == "modReadingInfo");
      if (existingToast) state.toasts.splice(state.toasts.indexOf(existingToast), 1);

      state.toasts.push({
        type: "info",
        messages: ["loc:finishedReadingPack", action.payload],
        startTime: Date.now(),
        staticToastId: "modReadingInfo",
      } as Toast);
    },
    setIsOnboardingToRun: (state: AppState, action: PayloadAction<boolean>) => {
      state.isOnboardingToRun = action.payload;
    },
    setHasConfigBeenRead: (state: AppState, action: PayloadAction<boolean>) => {
      state.hasConfigBeenRead = action.payload;
    },
    setWasOnboardingEverRun: (state: AppState, action: PayloadAction<boolean>) => {
      state.wasOnboardingEverRun = action.payload;
    },
    toggleAreThumbnailsEnabled: (state: AppState) => {
      state.areThumbnailsEnabled = !state.areThumbnailsEnabled;
    },
    toggleIsClosedOnPlay: (state: AppState) => {
      state.isClosedOnPlay = !state.isClosedOnPlay;
    },
    toggleIsUsingEnglishLocalizations: (state: AppState) => {
      state.isUsingEnglishLocalizations = !state.isUsingEnglishLocalizations;
    },
    toggleIsCompatCheckingVanillaPacks: (state: AppState) => {
      if (!state.isFeaturesForModdersEnabled) {
        state.isCompatCheckingVanillaPacks = false;
        return;
      }
      state.isCompatCheckingVanillaPacks = !state.isCompatCheckingVanillaPacks;
    },
    toggleIsAuthorEnabled: (state: AppState) => {
      state.isAuthorEnabled = !state.isAuthorEnabled;
    },
    toggleIsDualModListLayoutEnabled: (state: AppState) => {
      state.isDualModListLayoutEnabled = !state.isDualModListLayoutEnabled;
    },
    setModListDensity: (state: AppState, action: PayloadAction<ModListDensity>) => {
      state.modListDensity = action.payload;
    },
    toggleIsShowingDisabledModsLoadOrder: (state: AppState) => {
      state.isShowingDisabledModsLoadOrder = !state.isShowingDisabledModsLoadOrder;
    },
    toggleIsPresetAuthorEnabled: (state: AppState) => {
      state.isPresetAuthorEnabled = !state.isPresetAuthorEnabled;
    },
    toggleArePresetThumbnailsEnabled: (state: AppState) => {
      state.arePresetThumbnailsEnabled = !state.arePresetThumbnailsEnabled;
    },
    toggleIsCategoryAuthorEnabled: (state: AppState) => {
      state.isCategoryAuthorEnabled = !state.isCategoryAuthorEnabled;
    },
    toggleAreCategoryThumbnailsEnabled: (state: AppState) => {
      state.areCategoryThumbnailsEnabled = !state.areCategoryThumbnailsEnabled;
    },
    toggleMakeUnitsGenerals: (state: AppState) => {
      state.isMakeUnitsGeneralsEnabled = !state.isMakeUnitsGeneralsEnabled;
    },
    toggleIsScriptLoggingEnabled: (state: AppState) => {
      state.isScriptLoggingEnabled = !state.isScriptLoggingEnabled;
    },
    toggleIsSkipIntroMoviesEnabled: (state: AppState) => {
      state.isSkipIntroMoviesEnabled = !state.isSkipIntroMoviesEnabled;
    },
    toggleIsAutoStartCustomBattleEnabled: (state: AppState) => {
      state.isAutoStartCustomBattleEnabled = !state.isAutoStartCustomBattleEnabled;
    },
    toggleIsChangingGameProcessPriority: (state: AppState) => {
      state.isChangingGameProcessPriority = !state.isChangingGameProcessPriority;
    },
    toggleIsFeaturesForModdersEnabled: (state: AppState) => {
      state.isFeaturesForModdersEnabled = !state.isFeaturesForModdersEnabled;
      if (!state.isFeaturesForModdersEnabled) state.isCompatCheckingVanillaPacks = false;
      reconcileCurrentPresetModSources(state);
    },
    setIsFeaturesForModdersEnabled: (state: AppState, action: PayloadAction<boolean>) => {
      state.isFeaturesForModdersEnabled = action.payload;
      if (!state.isFeaturesForModdersEnabled) state.isCompatCheckingVanillaPacks = false;
      reconcileCurrentPresetModSources(state);
    },
    /** Replaces the whole list, since both toggling and reordering rewrite the order. */
    setNodeEditorFavorites: (state: AppState, action: PayloadAction<FlowNodeType[]>) => {
      state.nodeEditorFavorites = action.payload;
    },
    setModdersPrefix: (state: AppState, action: PayloadAction<string>) => {
      state.moddersPrefix = action.payload;
    },
    setIsDev: (state: AppState, action: PayloadAction<boolean>) => {
      state.isDev = action.payload;
    },
    setIsAdmin: (state: AppState, action: PayloadAction<boolean>) => {
      state.isAdmin = action.payload;
    },
    setIsWH3Running: (state: AppState, action: PayloadAction<boolean>) => {
      if (state.isWH3Running == action.payload) return;

      state.isWH3Running = action.payload;
    },
    setStartArgs: (state: AppState, action: PayloadAction<string[]>) => {
      state.startArgs = action.payload;
    },
    createdMergedPack: (state: AppState, action: PayloadAction<string>) => {
      const path = action.payload;
      state.newMergedPacks.push({ path, creationTime: Date.now() });

      const existingMod = state.currentPreset.mods.find((mod) => mod.path == path);
      if (existingMod) {
        existingMod.isEnabled = true;
        sanitizeEnabledModLoadOrders(state.currentPreset.mods);
      }

      state.toasts.push({
        type: "info",
        messages: ["Created merged pack:", path.split("\\").pop()?.split("/").pop()],
        startTime: Date.now(),
      } as Toast);
    },
    importSteamCollection: (state: AppState, action: PayloadAction<ImportSteamCollection>) => {
      const importSteamCollection = action.payload;
      const steamCollectionsToImport = state.steamCollectionsToImport;
      const modsIds = importSteamCollection.modIds;

      console.log("to import mods from collection:", modsIds);

      if (modsIds.every((modId) => state.allMods.some((modInAllMods) => modInAllMods.workshopId == modId))) {
        handleImportSteamCollection(state, importSteamCollection);
      } else {
        const missingModIds = modsIds.filter((modId) =>
          state.allMods.every((modInAllMods) => modInAllMods.workshopId != modId),
        );
        steamCollectionsToImport[importSteamCollection.name] = importSteamCollection;
        window.api?.subscribeToMods(missingModIds);
      }
    },
    setToastDismissed: (state: AppState, action: PayloadAction<Toast>) => {
      const targetToast = action.payload;
      const toast = state.toasts.find((curToast) => curToast === targetToast);
      if (toast) toast.isDismissed = true;
    },
    setContentFolder: (state: AppState, action: PayloadAction<string>) => {
      state.appFolderPaths.contentFolder = action.payload;
    },
    setWarhammer3Folder: (state: AppState, action: PayloadAction<string>) => {
      state.appFolderPaths.gamePath = action.payload;
    },
    setOverwrittenDataPackedFiles: (state: AppState, action: PayloadAction<Record<string, string[]>>) => {
      state.overwrittenDataPackedFiles = action.payload;
    },
    setOutdatedPackFiles: (state: AppState, action: PayloadAction<Record<string, string[]>>) => {
      state.outdatedPackFiles = action.payload;
    },
    setDataModLastChangedLocal: (state: AppState, action: PayloadAction<number>) => {
      state.dataModLastChangedLocal = action.payload;
    },
    setAvailableLanguages: (state: AppState, action: PayloadAction<string[]>) => {
      state.availableLanguages = action.payload;
    },
    setPackDataOverwrites: (state: AppState, action: PayloadAction<PackDataOverwritePayload>) => {
      const overwrite = action.payload;
      state.packDataOverwrites[overwrite.packName] = state.packDataOverwrites[overwrite.packName] || [];
      state.packDataOverwrites[overwrite.packName] = state.packDataOverwrites[overwrite.packName].filter(
        (iterOverwrite) =>
          iterOverwrite.packFilePath != overwrite.packFilePath || iterOverwrite.columnsId != overwrite.columnsId,
      );
      state.packDataOverwrites[overwrite.packName].push({
        packFilePath: overwrite.packFilePath,
        columnsId: overwrite.columnsId,
        operation: overwrite.operation,
        overwriteData: overwrite.overwriteData,
        overwriteIndex: overwrite.overwriteIndex,
        columnIndices: overwrite.columnIndices,
        columnValues: overwrite.columnValues,
      });
    },
    removePackDataOverwrite: (state: AppState, action: PayloadAction<PackDataOverwritePayload>) => {
      const overwrite = action.payload;
      state.packDataOverwrites[overwrite.packName] = state.packDataOverwrites[overwrite.packName] || [];
      state.packDataOverwrites[overwrite.packName] = state.packDataOverwrites[overwrite.packName].filter(
        (iterOverwrite) =>
          iterOverwrite.packFilePath != overwrite.packFilePath || iterOverwrite.columnsId != overwrite.columnsId,
      );
      if (state.packDataOverwrites[overwrite.packName].length == 0) delete state.packDataOverwrites[overwrite.packName];
    },
    removeAllPackDataOverwrites: (state: AppState, action: PayloadAction<string>) => {
      const packName = action.payload;
      delete state.packDataOverwrites[packName];
    },
    selectDBTable: (state: AppState, action: PayloadAction<DBTableSelection>) => {
      const currentSelection = state.currentDBTableSelection;
      const nextSelection = action.payload;
      if (
        currentSelection &&
        currentSelection.packPath === nextSelection.packPath &&
        currentSelection.dbName === nextSelection.dbName &&
        currentSelection.dbSubname === nextSelection.dbSubname
      ) {
        console.log("selectDBTable for same selection, not updating app state");
        return;
      }
      console.log("APPSLICE selectDBTable:", action.payload);
      state.currentDBTableSelection = action.payload;
    },
    selectFlowFile: (
      state: AppState,
      action: PayloadAction<{ flowFile: string | undefined; packPath?: string } | undefined>,
    ) => {
      const payload = action.payload;
      console.log("APPSLICE flow file:", payload?.flowFile, "pack:", payload?.packPath);
      state.currentFlowFileSelection = payload?.flowFile;
      state.currentFlowFilePackPath = payload?.packPath;
    },
    /**
     * Re-open the flow that is already selected. Picking it again cannot say this through the
     * selection, which does not change, so the editor watches this counter instead.
     */
    requestFlowFileReload: (state: AppState) => {
      state.currentFlowFileReloadNonce++;
    },
    setCurrentTab: (state: AppState, action: PayloadAction<MainWindowTab>) => {
      const tabType = action.payload;
      state.currentTab = isMainWindowTabAvailable(state, tabType) ? tabType : "mods";
    },
    setMapCampaignName: (state: AppState, action: PayloadAction<string>) => {
      state.mapCampaignName = action.payload;
      state.mapSelectedRegion = undefined;
    },
    selectMapRegion: (state: AppState, action: PayloadAction<MapRegionSelection>) => {
      state.mapCampaignName = action.payload.campaign;
      state.mapSelectedRegion = action.payload;
    },
    clearMapRegionSelection: (state: AppState) => {
      state.mapSelectedRegion = undefined;
    },
    openMapForRegion: (state: AppState, action: PayloadAction<MapRegionSelection>) => {
      state.mapCampaignName = action.payload.campaign;
      state.mapSelectedRegion = action.payload;
      state.currentTab = isMainWindowTabAvailable(state, "map") ? "map" : "mods";
    },
    setDataModsToEnableByName: (state: AppState, action: PayloadAction<string[]>) => {
      state.dataModsToEnableByName = action.payload;
    },
    setIsCreateSteamCollectionOpen: (state: AppState, action: PayloadAction<boolean>) => {
      state.isCreateSteamCollectionOpen = action.payload;
    },
    setIsImportSteamCollectionOpen: (state: AppState, action: PayloadAction<boolean>) => {
      state.isImportSteamCollectionOpen = action.payload;
    },
    setIsPackSearcherOpen: (state: AppState, action: PayloadAction<boolean>) => {
      state.isPackSearcherOpen = action.payload;
    },
    setIsHelpOpen: (state: AppState, action: PayloadAction<boolean>) => {
      state.isHelpOpen = action.payload;
    },
    addToast: (state: AppState, action: PayloadAction<Toast>) => {
      const newToast = action.payload;
      if (newToast.staticToastId) {
        const existingToast = state.toasts.find((toast) => toast.staticToastId == newToast.staticToastId);
        if (existingToast) state.toasts.splice(state.toasts.indexOf(existingToast), 1);
      }

      state.toasts.push(newToast);
    },
    setModBeingCustomized: (state: AppState, action: PayloadAction<Mod | undefined>) => {
      state.modBeingCustomized = action.payload;
    },
    setCustomizableMods: (state: AppState, action: PayloadAction<Record<string, string[]>>) => {
      if (hash(state.customizableMods) == hash(action.payload)) {
        console.log("setCustomizableMods for same mods, not updating app state");
        console.log("customizable:", Object.keys(state.customizableMods));
        return;
      }
      state.customizableMods = action.payload;
      console.log("setCustomizableMods:", state.customizableMods);
    },
    createBisectedModListPresets: (state: AppState, action: PayloadAction<CreateBisectedModListPresetsPayload>) => {
      createBisectedModListPresetsInternal(state, action.payload);
    },
    setIsModTagPickerOpen: (state: AppState, action: PayloadAction<boolean>) => {
      state.isModTagPickerOpen = action.payload;
    },
    setCurrentModToUpload: (state: AppState, action: PayloadAction<Mod | undefined>) => {
      state.currentModToUpload = action.payload;
    },
    setTagForMod: (state: AppState, action: PayloadAction<{ mod: Mod; tag: string }>) => {
      const payloadMod = action.payload.mod;
      const payloadTag = action.payload.tag;
      const mod = state.currentPreset.mods.find((mod) => mod.path == payloadMod.path);
      if (!mod) return;

      mod.tags = ["mod", payloadTag];
    },
    selectCategory: (state: AppState, action: PayloadAction<CategorySelectionPayload>) => {
      const { mods, category, selectOperation } = action.payload;

      console.log("selectOperation is", selectOperation);
      if (selectOperation == "addition") {
        return addCategoryByPayload(state, { mods, category });
      }

      if (selectOperation == "subtraction") {
        return removeCategoryByPayload(state, { mods, category });

        return;
      } else if (selectOperation == "unary") {
        for (const payloadMod of mods) {
          const mod = state.currentPreset.mods.find((iterMod) => iterMod.path == payloadMod.path);
          if (mod) mod.categories = [category];
        }

        return;
      }
    },
    setIsLocalizingSubtypes: (state: AppState, action: PayloadAction<boolean>) => {
      state.isLocalizingSubtypes = action.payload;
    },
    setIsShowingSkillNodeSetNames: (state: AppState, action: PayloadAction<boolean>) => {
      state.isShowingSkillNodeSetNames = action.payload;
    },
    setIsShowingHiddenSkills: (state: AppState, action: PayloadAction<boolean>) => {
      state.isShowingHiddenSkills = action.payload;
    },
    setIsShowingHiddenModifiersInsideSkills: (state: AppState, action: PayloadAction<boolean>) => {
      state.isShowingHiddenModifiersInsideSkills = action.payload;
    },
    setIsCheckingSkillRequirements: (state: AppState, action: PayloadAction<boolean>) => {
      state.isCheckingSkillRequirements = action.payload;
    },
    setSkillsViewOptions: (state: AppState, action: PayloadAction<SkillsViewOptions>) => {
      state.isShowingSkillNodeSetNames = action.payload.isShowingSkillNodeSetNames;
      state.isShowingHiddenSkills = action.payload.isShowingHiddenSkills;
      state.isShowingHiddenModifiersInsideSkills = action.payload.isShowingHiddenModifiersInsideSkills;
      state.isCheckingSkillRequirements = action.payload.isCheckingSkillRequirements;
    },
    setSkillTreesDisplayMode: (state: AppState, action: PayloadAction<TreeDisplayMode>) => {
      state.skillTreesDisplayMode = action.payload;
      if (action.payload !== "tab") {
        state.skillsData = undefined;
        state.skillNodesToLevel = {};
        state.currentRank = 1;
      }
      ensureValidCurrentTab(state);
    },
    setTechnologyTreesDisplayMode: (state: AppState, action: PayloadAction<TreeDisplayMode>) => {
      state.technologyTreesDisplayMode = action.payload;
      ensureValidCurrentTab(state);
    },
    setSkillNodeLevel: (state: AppState, action: PayloadAction<{ skillNodeId: string; level: number }>) => {
      state.skillNodesToLevel[action.payload.skillNodeId] = action.payload.level;

      state.currentRank = Object.values(state.skillNodesToLevel).reduce((acc, curr) => {
        return acc + curr;
      }, 1);
    },
    setDeepCloneTarget: (state: AppState, action: PayloadAction<DeepCloneTarget | undefined>) => {
      state.deepCloneTarget = action.payload;
    },
    setReferencesHash: (state: AppState, action: PayloadAction<string>) => {
      state.referencesHash = action.payload;
    },
    setPackDataStore: (state: AppState, action: PayloadAction<SetPackDataStorePayload>) => {
      packDataStore[action.payload.packPath] = action.payload.pack;
    },
    setUserFlowOptions: (
      state: AppState,
      action: PayloadAction<{ packName: string; flowFileName: string; values: UserFlowOptionValues }>,
    ) => {
      const { packName, flowFileName, values } = action.payload;
      if (!state.userFlowOptions[packName]) {
        state.userFlowOptions[packName] = {};
      }
      state.userFlowOptions[packName][flowFileName] = values;
    },
  },
});

export const {
  toggleMod,
  selectCategory,
  setMods,
  addToast,
  setModData,
  setWorkshopUpdateCheckMessage,
  setFromConfig,
  enableAll,
  setImportedMods,
  disableAllMods,
  addPreset,
  selectPreset,
  createOnGameStartPreset,
  replacePreset,
  updatePresetMods,
  applyPresetDraftMods,
  deletePreset,
  setFilter,
  setModLoadOrderRelativeTo,
  setCurrentLanguage,
  setCurrentGame,
  setCurrentGameNaive,
  resetModLoadOrder,
  resetModLoadOrderAll,
  toggleAlwaysEnabledMods,
  toggleAlwaysHiddenMods,
  setSaves,
  setIsOnboardingToRun,
  setWasOnboardingEverRun,
  toggleIsAuthorEnabled,
  toggleAreThumbnailsEnabled,
  toggleIsDualModListLayoutEnabled,
  toggleIsShowingDisabledModsLoadOrder,
  setModListDensity,
  toggleIsPresetAuthorEnabled,
  toggleArePresetThumbnailsEnabled,
  toggleIsCategoryAuthorEnabled,
  toggleAreCategoryThumbnailsEnabled,
  toggleIsClosedOnPlay,
  toggleIsUsingEnglishLocalizations,
  setIsDev,
  setIsAdmin,
  setIsWH3Running,
  setStartArgs,
  setPackHeaderData,
  toggleMakeUnitsGenerals,
  toggleIsScriptLoggingEnabled,
  toggleIsSkipIntroMoviesEnabled,
  toggleIsAutoStartCustomBattleEnabled,
  toggleIsChangingGameProcessPriority,
  toggleIsFeaturesForModdersEnabled,
  setIsFeaturesForModdersEnabled,
  setModdersPrefix,
  setNodeEditorFavorites,
  orderImportedMods,
  addMod,
  removeMod,
  createdMergedPack,
  importSteamCollection,
  enableModsByName,
  importModsFromUsedMods,
  resolveUsedModsImport,
  setPacksData,
  setUnsavedPacksData,
  setPacksDataRead,
  setPackCollisions,
  setPackCollisionsCheckProgress,
  setAppFolderPaths,
  setHasConfigBeenRead,
  setWarhammer3Folder,
  setContentFolder,
  setOverwrittenDataPackedFiles,
  setOutdatedPackFiles,
  setDataModLastChangedLocal,
  setIsModEnabled,
  setCurrentlyReadingMod,
  setLastModThatWasRead,
  selectDBTable,
  selectFlowFile,
  requestFlowFileReload,
  setCurrentTab,
  setMapCampaignName,
  selectMapRegion,
  clearMapRegionSelection,
  openMapForRegion,
  setAreModsEnabled,
  setIsCreateSteamCollectionOpen,
  setIsImportSteamCollectionOpen,
  setIsPackSearcherOpen,
  setIsHelpOpen,
  setToastDismissed,
  toggleIsCompatCheckingVanillaPacks,
  setDataModsToEnableByName,
  addCategory,
  removeCategory,
  renameCategory,
  setCategoryColor,
  setModRowsSortingType,
  setAvailableLanguages,
  setPackDataOverwrites,
  removePackDataOverwrite,
  removeAllPackDataOverwrites,
  setModBeingCustomized,
  setCustomizableMods,
  createBisectedModListPresets,
  requestGameFolderPaths,
  setCurrentModToUpload,
  setIsModTagPickerOpen,
  setTagForMod,
  setSkillsData,
  clearSkillsData,
  setPackSearchResults,
  setIsLocalizingSubtypes,
  setIsShowingSkillNodeSetNames,
  setIsShowingHiddenSkills,
  setIsShowingHiddenModifiersInsideSkills,
  setIsCheckingSkillRequirements,
  setSkillsViewOptions,
  setSkillTreesDisplayMode,
  setTechnologyTreesDisplayMode,
  setUserFlowOptions,

  // for DB viewer
  setDeepCloneTarget,
  setPackDataStore,
  setReferencesHash,

  // for skills
  setSkillNodeLevel,
} = appSlice.actions;

export default appSlice.reducer;
