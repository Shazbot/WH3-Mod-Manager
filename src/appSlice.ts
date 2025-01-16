import { GameFolderPaths } from "./appData";
import { PackCollisions } from "./packFileTypes";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import hash from "object-hash";
import {
  adjustDuplicates,
  findAlwaysEnabledMods,
  findMod,
  withoutDataAndContentDuplicates,
} from "./modsHelpers";
import { SortingType } from "./utility/modRowSorting";
import { compareModNames, sortAsInPreset, sortByNameAndLoadOrder } from "./modSortingHelpers";
import initialState from "./initialAppState";
import equal from "fast-deep-equal";
import { format } from "date-fns";
import { SupportedGames } from "./supportedGames";

const addCategoryByPayload = (state: AppState, payload: AddCategoryPayload) => {
  const { mods, category } = payload;
  let wasCategoryAddedToAnyMod = false;

  for (const mod of mods) {
    const modInPreset = state.currentPreset.mods.find((iterMod) => iterMod.path === mod.path);
    if (modInPreset) {
      modInPreset.categories = modInPreset.categories || [];
      if (!modInPreset.categories.includes(category)) {
        modInPreset.categories.push(category);
        wasCategoryAddedToAnyMod = true;
      }
    }
  }

  if (wasCategoryAddedToAnyMod) {
    if (!state.categories.includes(category)) state.categories.push(category);
  }
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

const setCurrentPresetToMods = (state: AppState, mods: Mod[]) => {
  state.currentPreset.mods = mods;
  state.allMods = mods;

  state.currentPreset.mods = state.currentPreset.mods.filter(
    (mod) =>
      mod.isInData ||
      (!mod.isInData && !mods.find((modOther) => modOther.name == mod.name && modOther.isInData))
  );

  if (state.dataFromConfig && state.dataFromConfig.currentPreset.version != undefined) {
    state.currentPreset.version = state.dataFromConfig.currentPreset.version;
    console.log("sorting as in preset from config in setMods");
    state.currentPreset.mods = sortAsInPreset(
      state.currentPreset.mods,
      state.dataFromConfig.currentPreset.mods
    );
  }

  if (state.dataFromConfig) {
    state.currentPreset.mods
      .filter((iterMod) => state.dataFromConfig?.alwaysEnabledMods.some((mod) => mod.name == iterMod.name))
      .forEach((mod) => (mod.isEnabled = true));

    state.dataFromConfig.currentPreset.mods
      .filter((mod) => mod !== undefined)
      .forEach((mod) => {
        const existingMod = state.currentPreset.mods.find((statelyMod) => statelyMod.name == mod.name);
        if (existingMod) {
          existingMod.isEnabled = mod.isEnabled;
          existingMod.categories = mod.categories;
          if (mod.humanName !== "") existingMod.humanName = mod.humanName;
          if (mod.loadOrder != null) existingMod.loadOrder = mod.loadOrder;
        }
      });
  }

  const appStartIndex = state.presets.findIndex((preset) => preset.name === "On App Start");
  const newPreset = {
    name: "On App Start",
    mods: [...state.currentPreset.mods],
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
  originalLoadOrder?: number
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

const addPresetInternal = (state: AppState, newPreset: Preset, showAsLastSelected = true) => {
  console.log("current preset version is ", state.currentPreset.version);
  newPreset.mods =
    (state.currentPreset.version != undefined && newPreset.mods) || sortByNameAndLoadOrder(newPreset.mods);
  newPreset.version = 2;
  state.presets.push(newPreset);
  if (showAsLastSelected) state.lastSelectedPreset = newPreset;

  state.toasts.push({
    type: "success",
    messages: ["loc:createdPreset", newPreset.name],
    startTime: Date.now(),
  } as Toast);
};

const selectPresetInternal = (state: AppState, presetSelection: SelectOperation, newPreset: Preset) => {
  state.lastSelectedPreset = newPreset;

  if (presetSelection === "unary") {
    state.currentPreset.mods.forEach((mod) => {
      mod.isEnabled = false;
    });

    const newPresetMods = withoutDataAndContentDuplicates(newPreset.mods);
    if (newPreset.version == undefined) newPreset.mods = sortByNameAndLoadOrder(newPreset.mods);

    state.currentPreset.mods.forEach((mod) => {
      const modToChange = findMod(newPresetMods, mod);
      if (modToChange) {
        mod.isEnabled = modToChange.isEnabled;
        mod.loadOrder = modToChange.loadOrder;
      }
    });

    state.currentPreset.mods = sortAsInPreset(state.currentPreset.mods, newPresetMods);
    state.currentPreset.version = 2;
  } else if (presetSelection === "addition" || presetSelection === "subtraction") {
    newPreset.mods.forEach((mod) => {
      if (mod.isEnabled) {
        const modToChange = findMod(state.currentPreset.mods, mod);
        if (modToChange) modToChange.isEnabled = presetSelection !== "subtraction";
      }
    });
  }

  findAlwaysEnabledMods(state.currentPreset.mods, state.alwaysEnabledMods).forEach(
    (mod) => (mod.isEnabled = true)
  );
};

const createPresetFromCollection = (state: AppState, importSteamCollection: ImportSteamCollection) => {
  const modsIds = importSteamCollection.modIds;

  console.log("all mods in collection are already subbed to");
  const presetMods: Mod[] = [];
  for (const modId of modsIds) {
    const currentPresetMod = state.currentPreset.mods.find(
      (currentPresetMod) => currentPresetMod.workshopId == modId
    );
    if (currentPresetMod) {
      const newMod = { ...currentPresetMod };
      newMod.isEnabled = true;
      presetMods.push(newMod);
    } else {
      const modInAllMods = state.allMods.find((modInAllMods) => modInAllMods.workshopId == modId);
      if (modInAllMods) {
        const newMod = { ...modInAllMods };
        newMod.isEnabled = true;
        presetMods.push(newMod);
      }
    }
  }

  const newPresetName =
    importSteamCollection.presetName && importSteamCollection.presetName != ""
      ? importSteamCollection.presetName
      : importSteamCollection.name;

  const newPreset = { name: newPresetName, mods: presetMods };

  const existingPreset = state.presets.find((preset) => preset.name == newPreset.name);
  if (existingPreset) {
    existingPreset.mods = presetMods;
  } else {
    addPresetInternal(state, newPreset);
  }

  const preset = existingPreset || newPreset;
  if (importSteamCollection.isPresetLoadOrdered) {
    for (let i = 0; i < importSteamCollection.modIds.length; i++) {
      const mod = preset.mods.find((mod) => mod.workshopId == importSteamCollection.modIds[i]);
      if (mod) mod.loadOrder = i;
    }
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
        state.allMods.some((modInAllMods) => modInAllMods.workshopId == modId)
      )
    ) {
      handleImportSteamCollection(state, importSteamCollection);
      delete state.steamCollectionsToImport[importSteamCollection.name];
    }
  }
};

const createBisectedModListPresetsInternal = (state: AppState, isModSelectionRandom: boolean) => {
  const enabledMods = state.currentPreset.mods.filter((mod) => mod.isEnabled);
  const isLoadOrderPreset = enabledMods.some((mod) => mod.loadOrder != undefined);

  const orderedMods = sortByNameAndLoadOrder(enabledMods);

  const presetMods: Mod[] = orderedMods.map((mod, i) => {
    const newMod = { ...mod };
    if (isLoadOrderPreset) newMod.loadOrder = i;
    return newMod;
  });

  const cutoff = Math.ceil(presetMods.length / 2);

  let firstPresetMods = [];
  let secondPresetMods = [];

  if (isModSelectionRandom) {
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

    firstPresetMods = sortByNameAndLoadOrder(firstPresetMods).map((mod, i) => {
      const newMod = { ...mod };
      if (isLoadOrderPreset) newMod.loadOrder = i;
      return newMod;
    });
    secondPresetMods = sortByNameAndLoadOrder(secondPresetMods).map((mod, i) => {
      const newMod = { ...mod };
      if (isLoadOrderPreset) newMod.loadOrder = i;
      return newMod;
    });
  } else {
    firstPresetMods = presetMods.slice(0, cutoff);
    secondPresetMods = presetMods.slice(cutoff);
  }

  const timeStamp = format(new Date(), "dd-MM-yyyy-HH.mm.ss");
  const newPresetNameFirst = `${timeStamp}_${firstPresetMods.length}_First`;
  const newPresetNameSecond = `${timeStamp}_${secondPresetMods.length}_Second`;

  const newPresetFirst = { name: newPresetNameFirst, mods: firstPresetMods };
  const newPresetSecond = { name: newPresetNameSecond, mods: secondPresetMods };

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
    toggleMod: (state: AppState, action: PayloadAction<Mod>) => {
      const inputMod = action.payload;
      const mod = state.currentPreset.mods.find((mod) => mod.workshopId == inputMod.workshopId);
      if (mod) mod.isEnabled = !mod.isEnabled;
    },
    setIsModEnabled: (state: AppState, action: PayloadAction<SetIsModEnabledPayload>) => {
      const { mod, isEnabled } = action.payload;
      const presetMod = state.currentPreset.mods.find((iterMod) => iterMod.path == mod.path);
      if (presetMod) presetMod.isEnabled = isEnabled;
    },
    setAreModsEnabled: (state: AppState, action: PayloadAction<SetIsModEnabledPayload[]>) => {
      const enablePayloads = action.payload;
      for (const { mod, isEnabled } of enablePayloads) {
        const presetMod = state.currentPreset.mods.find((iterMod) => iterMod.path == mod.path);
        if (presetMod) presetMod.isEnabled = isEnabled;
      }
    },
    setSharedMod: (state: AppState, action: PayloadAction<ModIdAndLoadOrder[]>) => {
      const payload = action.payload;
      payload.forEach((idAndLoadOrder) => {
        const mod = state.currentPreset.mods.find((mod) => mod.workshopId == idAndLoadOrder.workshopId);
        if (mod) {
          mod.isEnabled = true;
          mod.loadOrder = idAndLoadOrder.loadOrder;
        }
      });
    },
    orderImportedMods: (state: AppState) => {
      console.log("ordering imported mods");
      for (let i = 0; i < state.importedMods.length; i++) {
        const importedMod = state.importedMods[i];
        console.log("imported mod:", importedMod.workshopId, importedMod.loadOrder);

        const currentMod = state.currentPreset.mods.find(
          (mod) => mod.workshopId == state.importedMods[i].workshopId
        );
        if (!currentMod) continue;

        if (importedMod.loadOrder == undefined) {
          const currentModIndex = currentMod && state.currentPreset.mods.indexOf(currentMod);
          if (currentModIndex == -1) continue;

          if (i == 0) {
            // no previous siblings so put it at start of all mods
            state.currentPreset.mods.splice(currentModIndex, 1);
            state.currentPreset.mods.splice(0, 0, currentMod);
          } else {
            const previousSiblingModIndex = state.currentPreset.mods.findIndex(
              (mod) => mod.workshopId == state.importedMods[i - 1].workshopId
            );
            if (previousSiblingModIndex != -1) {
              // put the mod with the load order after the previous sibling
              state.currentPreset.mods.splice(currentModIndex, 1);
              state.currentPreset.mods.splice(previousSiblingModIndex, 0, currentMod);
            }
          }
        } else {
          const currentModIndex = currentMod && state.currentPreset.mods.indexOf(currentMod);
          if (currentModIndex == -1) continue;
          state.currentPreset.mods.splice(currentModIndex, 1);
          state.currentPreset.mods.splice(importedMod.loadOrder, 0, currentMod);
          currentMod.loadOrder = importedMod.loadOrder;
        }
      }

      state.importedMods = [];
    },
    enableAll: (state: AppState) => {
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = true));

      const toEnable = state.currentPreset.mods.filter((iterMod) =>
        state.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));
    },
    enableModsByName: (state: AppState, action: PayloadAction<string[]>) => {
      const modNames = action.payload;
      console.log("ENABLING ALL MODS WITH NAMES: ", modNames);
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = false));

      state.currentPreset.mods
        .filter((mod) => modNames.find((modName) => modName === mod.name))
        .forEach((mod) => (mod.isEnabled = true));
    },
    disableAllMods: (state: AppState) => {
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = false));

      const toEnable = state.currentPreset.mods.filter((iterMod) =>
        state.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));
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
      if (alreadyExists) return;

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
      } else if (mod.isInData) {
        const previousIndex = state.currentPreset.mods.indexOf(alreadyExistsByName);
        state.currentPreset.mods.splice(previousIndex, 1, mod);
        mod.isEnabled = alreadyExistsByName.isEnabled;
        mod.author = alreadyExistsByName.author;
        mod.imgPath = alreadyExistsByName.imgPath;
        mod.humanName = alreadyExistsByName.humanName;
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
      if (
        mod.isInData &&
        state.dataModsToEnableByName.find((nameOfToEnable) => nameOfToEnable === mod.name)
      ) {
        mod.isEnabled = true;

        state.dataModsToEnableByName.splice(
          state.dataModsToEnableByName.findIndex((nameOfToEnable) => nameOfToEnable === mod.name),
          1
        );
      }
      if (state.dataFromConfig?.currentPreset.mods.find((iterMod) => iterMod.path == mod.path)?.isEnabled) {
        mod.isEnabled = true;
      }
      if (state.newMergedPacks.some((mergedPack) => mergedPack.path == mod.path)) {
        mod.isEnabled = true;
      }
      if (state.alwaysEnabledMods.some((iterMod) => iterMod.name == mod.name)) {
        mod.isEnabled = true;
      }

      checkImportedSteamCollections(state);
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
            !removedModInAll.isInData &&
            state.currentPreset.mods.find(
              (iterMod) => iterMod.isInData && iterMod.name == removedModInAll.name
            );
          if (sameModOrSymLinkInData && sameModOrSymLinkInData.isSymbolicLink) {
            state.currentPreset.mods = state.currentPreset.mods.filter(
              (iterMod) => iterMod.path !== sameModOrSymLinkInData.path
            );
            state.allMods = state.allMods.filter((iterMod) => iterMod.path !== sameModOrSymLinkInData.path);
            state.allMods = state.allMods.filter((iterMod) => iterMod.path !== removedModInAll.path);
          }
        }
        return;
      }

      // if this mod is in data and the actual mod is in content just switch to the content mod
      const dataMod =
        removedMod.isInData &&
        state.allMods.find((iterMod) => !iterMod.isInData && iterMod.name == removedMod.name);

      if (dataMod) {
        state.currentPreset.mods.push(dataMod);
        if (removedMod.isEnabled) {
          dataMod.isEnabled = true;
        }
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
    },
    setModData: (state: AppState, action: PayloadAction<ModData[]>) => {
      const datas = action.payload;

      for (const data of datas) {
        // if the same mod is also in data cover it as well
        const contentMod = state.allMods.find((mod) => mod.workshopId == data.workshopId);
        if (contentMod) {
          const dataMod = state.currentPreset.mods.find(
            (iterMod) => iterMod.isInData && iterMod.name == contentMod.name
          );
          if (dataMod) {
            if (data.humanName && data.humanName != "" && dataMod.humanName != data.humanName)
              dataMod.humanName = data.humanName ?? "";
            if (data.author && data.author != "" && dataMod.author != data.author)
              dataMod.author = data.author;
            if (
              data.reqModIdToName &&
              data.reqModIdToName.length > 0 &&
              !equal(dataMod.reqModIdToName, data.reqModIdToName)
            )
              dataMod.reqModIdToName = data.reqModIdToName;
            if (data.tags) {
              if (dataMod.tags.length != data.tags.length) {
                // console.log("tags changed:", dataMod.name, dataMod.tags, "->", data.tags);
                dataMod.tags = data.tags;
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
          if (
            data.reqModIdToName &&
            data.reqModIdToName.length > 0 &&
            !equal(mod.reqModIdToName, data.reqModIdToName)
          )
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
    setPackHeaderData: (state: AppState, action: PayloadAction<PackHeaderData | PackHeaderData[]>) => {
      const headers = (Array.isArray(action.payload) && action.payload) || [action.payload];
      for (const header of headers) {
        const mod = state.currentPreset.mods.find((mod) => mod.path == header.path);
        if (mod) {
          mod.isMovie = header.isMovie;
          mod.dependencyPacks = header.dependencyPacks;
        }

        if (header.isMovie) console.log(`${header.path} is movie!`);
      }
    },
    setSkillsData: (state: AppState, action: PayloadAction<SkillsData>) => {
      state.skillsData = action.payload;
    },
    setPacksData: (state: AppState, action: PayloadAction<PackViewData[]>) => {
      const packsData = action.payload;

      for (const packData of packsData) {
        if (!state.packsData[packData.packPath]) {
          state.packsData[packData.packPath] = packData;
        } else if (packData.packedFiles) {
          state.packsData[packData.packPath].packedFiles =
            state.packsData[packData.packPath].packedFiles || {};
          for (const [packedFilePath, packedFile] of Object.entries(packData.packedFiles))
            state.packsData[packData.packPath].packedFiles[packedFilePath] = packedFile;
        }
      }

      console.log("APPSLICE set setPacksData:", packsData);
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
    setPackCollisionsCheckProgress: (
      state: AppState,
      action: PayloadAction<PackCollisionsCheckProgressData>
    ) => {
      state.packCollisionsCheckProgress = action.payload;
    },
    setPackSearchResults: (state: AppState, action: PayloadAction<string[] | undefined>) => {
      state.packSearchResults = action.payload;
    },
    setAppFolderPaths: (state: AppState, action: PayloadAction<GameFolderPaths>) => {
      state.appFolderPaths = action.payload;
      state.isSetAppFolderPathsDone = true;
    },
    requestGameFolderPaths: (state: AppState, action: PayloadAction<SupportedGames | undefined>) => {
      state.requestFolderPathsForGame = action.payload;
    },
    setFromConfig: (state: AppState, action: PayloadAction<AppStateToRead>) => {
      const fromConfigAppState = action.payload;

      state.hasConfigBeenRead = true;
      state.dataFromConfig = fromConfigAppState;

      fromConfigAppState.currentPreset.mods
        .filter((mod) => mod !== undefined)
        .map((mod) => {
          const existingMod = state.currentPreset.mods.find((statelyMod) => statelyMod.name == mod.name);
          if (existingMod) {
            existingMod.isEnabled = mod.isEnabled;
            if (mod.humanName !== "") existingMod.humanName = mod.humanName;
            if (mod.loadOrder != null) existingMod.loadOrder = mod.loadOrder;
            if (
              mod.reqModIdToName &&
              mod.reqModIdToName.length > 0 &&
              !equal(mod.reqModIdToName, existingMod.reqModIdToName)
            )
              existingMod.reqModIdToName = mod.reqModIdToName;
            if (mod.author && mod.author != "" && existingMod.author != mod.author)
              existingMod.author = mod.author;
            // if (mod.lastChanged != null) existingMod.lastChanged = mod.lastChanged;
          }
        });

      if (fromConfigAppState.currentPreset.version == 1) {
        console.log("sorting as in preset from config");
        state.currentPreset.mods = sortAsInPreset(
          state.currentPreset.mods,
          fromConfigAppState.currentPreset.mods
        );
      }
      state.currentPreset.version = 2;

      fromConfigAppState.presets.forEach((preset) => {
        if (!state.presets.find((existingPreset) => existingPreset.name === preset.name)) {
          state.presets.push(preset);
        }
      });

      state.areThumbnailsEnabled = fromConfigAppState.areThumbnailsEnabled;
      state.isClosedOnPlay = fromConfigAppState.isClosedOnPlay;
      state.isCompatCheckingVanillaPacks = fromConfigAppState.isCompatCheckingVanillaPacks;
      state.isAuthorEnabled = fromConfigAppState.isAuthorEnabled;
      state.hiddenMods = fromConfigAppState.hiddenMods;
      state.alwaysEnabledMods = fromConfigAppState.alwaysEnabledMods;
      state.isMakeUnitsGeneralsEnabled = fromConfigAppState.isMakeUnitsGeneralsEnabled;
      state.isSkipIntroMoviesEnabled = fromConfigAppState.isSkipIntroMoviesEnabled;
      state.isScriptLoggingEnabled = fromConfigAppState.isScriptLoggingEnabled;
      state.isAutoStartCustomBattleEnabled = fromConfigAppState.isAutoStartCustomBattleEnabled;
      state.modRowsSortingType = fromConfigAppState.modRowsSortingType || state.modRowsSortingType;
      state.currentLanguage = fromConfigAppState.currentLanguage || "en";
      state.packDataOverwrites = fromConfigAppState.packDataOverwrites || {};
      state.currentGame = fromConfigAppState.currentGame || "wh3";

      const categoriesFromMods = new Set(state.currentPreset.mods.map((mod) => mod.categories ?? []).flat());
      if (fromConfigAppState.categories) {
        fromConfigAppState.categories.forEach((category) => categoriesFromMods.add(category));
      }
      state.categories = Array.from(categoriesFromMods);

      const toEnable = fromConfigAppState.currentPreset.mods.filter((iterMod) =>
        fromConfigAppState.alwaysEnabledMods.some((mod) => mod.name == iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));

      state.wasOnboardingEverRun = fromConfigAppState.wasOnboardingEverRun;
      if (!fromConfigAppState.wasOnboardingEverRun) state.isOnboardingToRun = true;

      if (fromConfigAppState.appFolderPaths) {
        if (fromConfigAppState.appFolderPaths.gamePath)
          state.appFolderPaths.gamePath = fromConfigAppState.appFolderPaths.gamePath;
        if (fromConfigAppState.appFolderPaths.contentFolder)
          state.appFolderPaths.gamePath = fromConfigAppState.appFolderPaths.contentFolder;
      }
    },
    addPreset: (state: AppState, action: PayloadAction<Preset>) => {
      const newPreset = action.payload;
      if (state.presets.find((preset) => preset.name === newPreset.name)) return;

      addPresetInternal(state, newPreset);
    },
    createOnGameStartPreset: (state: AppState) => {
      const appStartIndex = state.presets.findIndex((preset) => preset.name === "On Last Game Launch");
      const newPreset = {
        name: "On Last Game Launch",
        mods: [...state.currentPreset.mods],
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

      preset.mods =
        (state.currentPreset.version != undefined && state.currentPreset.mods) ||
        sortByNameAndLoadOrder(state.currentPreset.mods);
      preset.version = 2;
    },
    setFilter: (state: AppState, action: PayloadAction<string>) => {
      const filter = action.payload;
      state.filter = filter;
    },
    setModLoadOrder: (state: AppState, action: PayloadAction<ModLoadOrderPayload>) => {
      console.log("in setModLoadOrder");
      const payload = action.payload;
      const ourMod = state.currentPreset.mods.find((mod) => mod.name === payload.modName);
      const newLoadOrder = payload.loadOrder;
      const originalLoadOrder = payload.originalOrder;

      if (!ourMod) return;
      setModLoadOrderInternal(ourMod, state, payload.modName, newLoadOrder, originalLoadOrder);

      // printLoadOrders(state.currentPreset.mods);
    },

    setModLoadOrderRelativeTo: (state: AppState, action: PayloadAction<ModLoadOrderRelativeTo>) => {
      const payload = action.payload;
      const { modNameToChange, modNameRelativeTo, visualModList } = payload;
      const modToChange = visualModList.find((mod) => mod.name === modNameToChange);
      const modRelativeTo = visualModList.find((mod) => mod.name === modNameRelativeTo);

      console.log("modToChange:", modToChange);
      console.log("modRelativeTo:", modRelativeTo);
      if (!modToChange || !modRelativeTo) return;

      console.log("mod to change:", modToChange.name);
      console.log("mod relative to:", modRelativeTo.name);
      console.log("setAfterMod:", payload.setAfterMod);

      let newIndex = visualModList.indexOf(modToChange);
      if (modToChange != modRelativeTo) {
        visualModList.splice(visualModList.indexOf(modToChange), 1);
        newIndex = visualModList.indexOf(modRelativeTo);
        visualModList.splice(payload.setAfterMod ? newIndex + 1 : newIndex, 0, modToChange);
      }

      console.log("new load order for:", modToChange.name, newIndex);
      // modToChange.loadOrder = newIndex;

      for (const mod of visualModList.filter((mod) => mod.loadOrder != undefined || mod == modToChange)) {
        const modToSetLoadOrderOf = state.currentPreset.mods.find((modIter) => mod.name === modIter.name);
        if (modToSetLoadOrderOf) modToSetLoadOrderOf.loadOrder = visualModList.indexOf(mod);
      }
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
              compareModNames(iterMod.name, mod.name) >= 0
          );
          if (!siblingMod) continue;

          state.currentPreset.mods.splice(state.currentPreset.mods.indexOf(modToChange), 1);
          state.currentPreset.mods.splice(state.currentPreset.mods.indexOf(siblingMod), 0, modToChange);
        }
      }
    },
    toggleAlwaysEnabledMods: (state: AppState, action: PayloadAction<Mod[]>) => {
      const mods = action.payload;
      const modsAlreadyInAlwaysEnabled = state.alwaysEnabledMods.filter((iterMod) =>
        mods.find((mod) => iterMod.name === mod.name)
      );

      const modsToAdd = mods.filter(
        (iterMod) => !modsAlreadyInAlwaysEnabled.find((mod) => mod.name === iterMod.name)
      );

      state.alwaysEnabledMods = state.alwaysEnabledMods.filter(
        (iterMod) => !modsAlreadyInAlwaysEnabled.find((mod) => mod.name === iterMod.name)
      );
      state.alwaysEnabledMods = state.alwaysEnabledMods.concat(modsToAdd);
      const modsToEnable = state.currentPreset.mods.filter((iterMod) =>
        state.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      modsToEnable.forEach((mod) => (mod.isEnabled = true));
    },
    toggleAlwaysHiddenMods: (state: AppState, action: PayloadAction<Mod[]>) => {
      const mods = action.payload;
      const modsAlreadyHidden = state.hiddenMods.filter((iterMod) =>
        mods.find((mod) => iterMod.name === mod.name)
      );

      const modsToAdd = mods.filter((iterMod) => !modsAlreadyHidden.find((mod) => mod.name === iterMod.name));

      state.hiddenMods = state.hiddenMods.filter(
        (iterMod) => !modsAlreadyHidden.find((mod) => mod.name === iterMod.name)
      );
      state.hiddenMods = state.hiddenMods.concat(modsToAdd);

      // disable mods we just hid that aren't set to always enabled
      state.hiddenMods
        .filter((iterMod) => !state.alwaysEnabledMods.find((mod) => iterMod.name === mod.name))
        .forEach((iterMod) => {
          const mod = state.currentPreset.mods.find((mod) => iterMod.name === mod.name);
          if (mod) mod.isEnabled = false;
        });
    },
    setSaves: (state: AppState, action: PayloadAction<GameSave[]>) => {
      const saves = action.payload;
      state.saves = saves;
    },
    setCurrentLanguage: (state: AppState, action: PayloadAction<string>) => {
      const language = action.payload;
      state.currentLanguage = language;
    },
    setCurrentGame: (state: AppState, action: PayloadAction<SetCurrentGamePayload>) => {
      const { game, currentPreset, presets } = action.payload;

      state.currentGame = game;

      if (presets) state.presets = presets;

      if (currentPreset) {
        if (state.dataFromConfig) {
          state.dataFromConfig.currentPreset = currentPreset;
          state.dataFromConfig.presets = presets;
        }
        if (currentPreset.mods) setCurrentPresetToMods(state, currentPreset.mods);
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
    toggleIsCompatCheckingVanillaPacks: (state: AppState) => {
      state.isCompatCheckingVanillaPacks = !state.isCompatCheckingVanillaPacks;
    },
    toggleIsAuthorEnabled: (state: AppState) => {
      state.isAuthorEnabled = !state.isAuthorEnabled;
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
          state.allMods.every((modInAllMods) => modInAllMods.workshopId != modId)
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
          iterOverwrite.packFilePath != overwrite.packFilePath ||
          iterOverwrite.columnsId != overwrite.columnsId
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
          iterOverwrite.packFilePath != overwrite.packFilePath ||
          iterOverwrite.columnsId != overwrite.columnsId
      );
      if (state.packDataOverwrites[overwrite.packName].length == 0)
        delete state.packDataOverwrites[overwrite.packName];
    },
    removeAllPackDataOverwrites: (state: AppState, action: PayloadAction<string>) => {
      const packName = action.payload;
      delete state.packDataOverwrites[packName];
    },
    selectDBTable: (state: AppState, action: PayloadAction<DBTableSelection>) => {
      if (state.currentDBTableSelection == action.payload) {
        console.log("selectDBTable for same selection, not updating app state");
        return;
      }
      state.currentDBTableSelection = action.payload;
    },
    setCurrentTab: (state: AppState, action: PayloadAction<MainWindowTab>) => {
      const tabType = action.payload;
      state.currentTab = tabType;
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
        return;
      }
      state.customizableMods = action.payload;
      console.log("setCustomizableMods:", state.customizableMods);
    },
    createBisectedModListPresets: (state: AppState, action: PayloadAction<boolean>) => {
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
  },
});

export const {
  toggleMod,
  selectCategory,
  setMods,
  addToast,
  setModData,
  setFromConfig,
  enableAll,
  setImportedMods,
  disableAllMods,
  addPreset,
  selectPreset,
  createOnGameStartPreset,
  replacePreset,
  deletePreset,
  setFilter,
  setModLoadOrder,
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
  toggleIsClosedOnPlay,
  setIsDev,
  setIsAdmin,
  setIsWH3Running,
  setStartArgs,
  setPackHeaderData,
  toggleMakeUnitsGenerals,
  toggleIsScriptLoggingEnabled,
  toggleIsSkipIntroMoviesEnabled,
  toggleIsAutoStartCustomBattleEnabled,
  setSharedMod,
  orderImportedMods,
  addMod,
  removeMod,
  createdMergedPack,
  importSteamCollection,
  enableModsByName,
  setPacksData,
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
  setCurrentTab,
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
  setPackSearchResults,
  setIsLocalizingSubtypes,
} = appSlice.actions;

export default appSlice.reducer;
