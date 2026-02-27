import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Select, { SingleValue } from "react-select";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { BsArrowDownUp } from "react-icons/bs";
import { useAppDispatch, useAppSelector } from "../hooks";
import {
  addToast,
  addPreset,
  applyPresetDraftMods,
  deletePreset,
  setModRowsSortingType,
  updatePresetMods,
} from "../appSlice";
import selectStyle from "../styles/selectStyle";
import localizationContext from "../localizationContext";
import { getModsSortedByHumanNameAndName, sortByNameAndLoadOrder } from "../modSortingHelpers";
import { isModAlwaysEnabled, withoutDataAndContentDuplicates } from "../modsHelpers";
import { SortingType } from "../utility/modRowSorting";

type PresetOption = {
  value: string;
  label: string;
};

type PlaceMode =
  | {
      kind: "reorder" | "insert";
      modName: string;
    }
  | undefined;

type MissingDependency = {
  reqId: string;
  reqName: string;
  installedModName?: string;
};

const createFallbackMod = (name: string): Mod => ({
  name,
  humanName: name.replace(".pack", ""),
  path: name,
  imgPath: "",
  workshopId: "",
  isEnabled: true,
  modDirectory: "",
  isInData: false,
  loadOrder: undefined,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 0,
  isSymbolicLink: false,
  tags: [],
  reqModIdToName: [],
});

const areSetsEqual = (first: Set<string>, second: Set<string>) => {
  if (first.size !== second.size) return false;
  for (const value of first) {
    if (!second.has(value)) return false;
  }
  return true;
};

const isSameOptionalNumber = (first: number | undefined, second: number | undefined) =>
  (first == null && second == null) || first === second;

const stripPackExtension = (name: string) => name.replace(/\.pack$/i, "");

const PresetsTab = memo(() => {
  const dispatch = useAppDispatch();
  const localized: Record<string, string> = useContext(localizationContext);

  const presets = useAppSelector((state) => state.app.presets);
  const allMods = useAppSelector((state) => state.app.allMods);
  const currentPresetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);

  const [selectedPresetName, setSelectedPresetName] = useState<string | undefined>(undefined);
  const [pendingPresetName, setPendingPresetName] = useState<string | undefined>(undefined);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSaveAsOpen, setIsSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsError, setSaveAsError] = useState<string | undefined>(undefined);

  const [draftEnabledNames, setDraftEnabledNames] = useState<Set<string>>(new Set());
  const [draftLoadOrderByName, setDraftLoadOrderByName] = useState<Map<string, number>>(new Map());
  const [selectedInPresetNames, setSelectedInPresetNames] = useState<Set<string>>(new Set());
  const [selectedNotInPresetNames, setSelectedNotInPresetNames] = useState<Set<string>>(new Set());
  const [searchInPreset, setSearchInPreset] = useState("");
  const [searchNotInPreset, setSearchNotInPreset] = useState("");
  const [placeMode, setPlaceMode] = useState<PlaceMode>(undefined);
  const [activePlaceholderIndex, setActivePlaceholderIndex] = useState(0);

  const [baselineEnabledNames, setBaselineEnabledNames] = useState<Set<string>>(new Set());
  const [baselineLoadOrderByName, setBaselineLoadOrderByName] = useState<Map<string, number>>(new Map());
  const didInitializeFromCurrentPresetRef = useRef(false);

  const installedMods = useMemo(() => {
    const mods = withoutDataAndContentDuplicates(currentPresetMods);
    const dataModsThatAreInModding = mods.filter(
      (iterMod) =>
        iterMod.isInData &&
        !iterMod.isInModding &&
        mods.some(
          (secondMod) => secondMod.isInModding && secondMod !== iterMod && secondMod.name === iterMod.name,
        ),
    );
    return mods.filter((mod) => !dataModsThatAreInModding.includes(mod));
  }, [currentPresetMods]);

  const alwaysEnabledNames = useMemo(
    () => new Set(alwaysEnabledMods.map((mod) => mod.name)),
    [alwaysEnabledMods],
  );

  const presetsOptions = useMemo<PresetOption[]>(
    () =>
      [...presets]
        .sort((firstPreset, secondPreset) => firstPreset.name.localeCompare(secondPreset.name))
        .map((preset) => ({
          value: preset.name,
          label: preset.name,
        })),
    [presets],
  );

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.name === selectedPresetName),
    [presets, selectedPresetName],
  );

  const bestModByName = useMemo(() => {
    const modsByName = new Map<string, Mod>();
    for (const mod of allMods) {
      const existingMod = modsByName.get(mod.name);
      if (!existingMod) {
        modsByName.set(mod.name, { ...mod, reqModIdToName: [...(mod.reqModIdToName ?? [])] });
        continue;
      }

      // Keep the same data-vs-content preference as the main mod lists, but preserve dependency metadata from both.
      const preferredMod = existingMod.isInData || !mod.isInData ? existingMod : mod;
      const mergedReqsById = new Map<string, [string, string]>();
      (existingMod.reqModIdToName ?? []).forEach(([reqId, reqName]) =>
        mergedReqsById.set(reqId, [reqId, reqName]),
      );
      (mod.reqModIdToName ?? []).forEach(([reqId, reqName]) => mergedReqsById.set(reqId, [reqId, reqName]));

      modsByName.set(mod.name, {
        ...preferredMod,
        reqModIdToName: [...mergedReqsById.values()],
      });
    }
    return modsByName;
  }, [allMods]);

  const knownModsByName = useMemo(() => {
    const modsByName = new Map<string, Mod>();
    bestModByName.forEach((mod, name) => modsByName.set(name, mod));
    selectedPreset?.mods.forEach((mod) => {
      const existingMod = modsByName.get(mod.name);
      if (!existingMod) {
        modsByName.set(mod.name, { ...mod });
        return;
      }

      const mergedReqsById = new Map<string, [string, string]>();
      (existingMod.reqModIdToName ?? []).forEach(([reqId, reqName]) =>
        mergedReqsById.set(reqId, [reqId, reqName]),
      );
      (mod.reqModIdToName ?? []).forEach(([reqId, reqName]) => mergedReqsById.set(reqId, [reqId, reqName]));

      modsByName.set(mod.name, {
        ...existingMod,
        humanName: existingMod.humanName || mod.humanName,
        workshopId: existingMod.workshopId || mod.workshopId,
        reqModIdToName: [...mergedReqsById.values()],
      });
    });
    return modsByName;
  }, [bestModByName, selectedPreset]);

  const installedByName = useMemo(() => {
    const modsByName = new Map<string, Mod>();
    installedMods.forEach((mod) => modsByName.set(mod.name, mod));
    return modsByName;
  }, [installedMods]);

  const reqsByNameFromCurrentPreset = useMemo(() => {
    const reqsByName = new Map<string, [string, string][]>();
    currentPresetMods.forEach((mod) => {
      if (!mod.reqModIdToName || mod.reqModIdToName.length < 1) return;
      const mergedReqsById = new Map<string, [string, string]>();
      (reqsByName.get(mod.name) ?? []).forEach(([reqId, reqName]) =>
        mergedReqsById.set(reqId, [reqId, reqName]),
      );
      mod.reqModIdToName.forEach(([reqId, reqName]) => mergedReqsById.set(reqId, [reqId, reqName]));
      reqsByName.set(mod.name, [...mergedReqsById.values()]);
    });
    return reqsByName;
  }, [currentPresetMods]);

  const computeEnabledPresetMods = useCallback((preset: Preset) => {
    const hasAnyDisabled = preset.mods.some((mod) => !mod.isEnabled);
    const enabledPresetMods = hasAnyDisabled ? preset.mods.filter((mod) => mod.isEnabled) : preset.mods;
    return enabledPresetMods;
  }, []);

  const loadPresetDraft = useCallback(
    (presetName: string) => {
      const preset = presets.find((iterPreset) => iterPreset.name === presetName);
      if (!preset) return;

      const enabledPresetMods = computeEnabledPresetMods(preset);
      const nextEnabledNames = new Set<string>(enabledPresetMods.map((mod) => mod.name));
      alwaysEnabledNames.forEach((name) => nextEnabledNames.add(name));

      const nextLoadOrderByName = new Map<string, number>();
      enabledPresetMods.forEach((mod) => {
        if (mod.loadOrder != null) nextLoadOrderByName.set(mod.name, mod.loadOrder);
      });

      setSelectedPresetName(presetName);
      setDraftEnabledNames(nextEnabledNames);
      setDraftLoadOrderByName(nextLoadOrderByName);
      setBaselineEnabledNames(new Set(nextEnabledNames));
      setBaselineLoadOrderByName(new Map(nextLoadOrderByName));
      setSelectedInPresetNames(new Set());
      setSelectedNotInPresetNames(new Set());
      setPlaceMode(undefined);
      setPendingPresetName(undefined);
      setIsDiscardConfirmOpen(false);
      setIsDeleteConfirmOpen(false);
    },
    [alwaysEnabledNames, computeEnabledPresetMods, presets],
  );

  const loadCurrentEnabledDraft = useCallback(() => {
    const enabledCurrentMods = currentPresetMods.filter(
      (mod) => mod.isEnabled || alwaysEnabledNames.has(mod.name),
    );
    const nextEnabledNames = new Set<string>(enabledCurrentMods.map((mod) => mod.name));
    alwaysEnabledNames.forEach((name) => nextEnabledNames.add(name));

    const nextLoadOrderByName = new Map<string, number>();
    enabledCurrentMods.forEach((mod) => {
      if (mod.loadOrder != null) nextLoadOrderByName.set(mod.name, mod.loadOrder);
    });

    setSelectedPresetName(undefined);
    setDraftEnabledNames(nextEnabledNames);
    setDraftLoadOrderByName(nextLoadOrderByName);
    setBaselineEnabledNames(new Set(nextEnabledNames));
    setBaselineLoadOrderByName(new Map(nextLoadOrderByName));
    setSelectedInPresetNames(new Set());
    setSelectedNotInPresetNames(new Set());
    setPlaceMode(undefined);
    setPendingPresetName(undefined);
    setIsDiscardConfirmOpen(false);
    setIsDeleteConfirmOpen(false);
  }, [alwaysEnabledNames, currentPresetMods]);

  useEffect(() => {
    const selectedPresetStillExists = !!(
      selectedPresetName && presets.some((preset) => preset.name === selectedPresetName)
    );
    if (selectedPresetStillExists) {
      didInitializeFromCurrentPresetRef.current = true;
      setIsDeleteConfirmOpen(false);
      return;
    }

    if (selectedPresetName && !selectedPresetStillExists) {
      loadCurrentEnabledDraft();
      return;
    }

    if (!didInitializeFromCurrentPresetRef.current) {
      loadCurrentEnabledDraft();
      didInitializeFromCurrentPresetRef.current = true;
    }
  }, [loadCurrentEnabledDraft, presets, selectedPresetName]);

  const effectiveEnabledNames = useMemo(() => {
    const effective = new Set(draftEnabledNames);
    alwaysEnabledNames.forEach((name) => effective.add(name));
    return effective;
  }, [alwaysEnabledNames, draftEnabledNames]);

  const enabledDraftMods = useMemo(() => {
    const mods: Mod[] = [];
    effectiveEnabledNames.forEach((name) => {
      const sourceMod = knownModsByName.get(name) ?? createFallbackMod(name);
      mods.push({
        ...sourceMod,
        isEnabled: true,
        loadOrder: draftLoadOrderByName.get(name),
      });
    });
    return sortByNameAndLoadOrder(mods);
  }, [draftLoadOrderByName, effectiveEnabledNames, knownModsByName]);

  const notInPresetInstalledMods = useMemo(() => {
    const mods = installedMods.filter((mod) => !effectiveEnabledNames.has(mod.name));
    return getModsSortedByHumanNameAndName(mods);
  }, [effectiveEnabledNames, installedMods]);

  const visibleEnabledDraftMods = useMemo(() => {
    if (placeMode) return enabledDraftMods;
    if (!searchInPreset.trim()) return enabledDraftMods;
    const query = searchInPreset.trim().toLowerCase();
    return enabledDraftMods.filter((mod) => `${mod.humanName} ${mod.name}`.toLowerCase().includes(query));
  }, [enabledDraftMods, placeMode, searchInPreset]);

  const visibleNotInPresetMods = useMemo(() => {
    if (!searchNotInPreset.trim()) return notInPresetInstalledMods;
    const query = searchNotInPreset.trim().toLowerCase();
    return notInPresetInstalledMods.filter((mod) =>
      `${mod.humanName} ${mod.name}`.toLowerCase().includes(query),
    );
  }, [notInPresetInstalledMods, searchNotInPreset]);

  const missingDependenciesByModName = useMemo(() => {
    const isDependencyEnabledByWorkshopId = (reqId: string): boolean => {
      const modInAllById = allMods.find((iterMod) => iterMod.workshopId == reqId);
      if (!modInAllById) return false;
      return enabledDraftMods.some((enabledMod) => enabledMod.name == modInAllById.name);
    };

    const missingMap = new Map<string, MissingDependency[]>();
    for (const mod of enabledDraftMods) {
      const reqs =
        (mod.reqModIdToName && mod.reqModIdToName.length > 0 ? mod.reqModIdToName : undefined) ??
        reqsByNameFromCurrentPreset.get(mod.name) ??
        knownModsByName.get(mod.name)?.reqModIdToName ??
        [];
      if (reqs.length === 0) continue;

      const missingDeps: MissingDependency[] = [];
      for (const [reqId, reqName] of reqs) {
        const enabledByDependencyName = isDependencyEnabledByWorkshopId(reqId);
        const enabledByWorkshopId = enabledDraftMods.some((enabledMod) => enabledMod.workshopId == reqId);
        if (enabledByDependencyName || enabledByWorkshopId) continue;

        const requiredMod = allMods.find((iterMod) => iterMod.workshopId == reqId);
        missingDeps.push({ reqId, reqName, installedModName: requiredMod?.name });
      }

      if (missingDeps.length > 0) {
        missingMap.set(mod.name, missingDeps);
      }
    }
    return missingMap;
  }, [allMods, enabledDraftMods, knownModsByName, reqsByNameFromCurrentPreset]);

  const getModDisplayName = useCallback((mod: Mod) => {
    const shortName = stripPackExtension(mod.name);
    const humanName = mod.humanName?.trim();
    if (humanName && humanName !== mod.name && humanName !== shortName) {
      return `${humanName} (${shortName})`;
    }
    return shortName;
  }, []);

  const missingDependencyIds = useMemo(() => {
    const ids = new Set<string>();
    missingDependenciesByModName.forEach((dependencies) =>
      dependencies.forEach((dependency) => ids.add(dependency.reqId)),
    );
    return ids;
  }, [missingDependenciesByModName]);

  const isDirty = useMemo(() => {
    if (!areSetsEqual(effectiveEnabledNames, baselineEnabledNames)) return true;

    const candidateNames = new Set<string>();
    effectiveEnabledNames.forEach((name) => candidateNames.add(name));
    baselineEnabledNames.forEach((name) => candidateNames.add(name));

    for (const name of candidateNames) {
      const baselineLoadOrder = baselineLoadOrderByName.get(name);
      const draftLoadOrder = draftLoadOrderByName.get(name);
      if (!isSameOptionalNumber(baselineLoadOrder, draftLoadOrder)) return true;
    }

    return false;
  }, [baselineEnabledNames, baselineLoadOrderByName, draftLoadOrderByName, effectiveEnabledNames]);

  const summary = useMemo(() => {
    const added = [...effectiveEnabledNames].filter((name) => !baselineEnabledNames.has(name)).length;
    const removed = [...baselineEnabledNames].filter((name) => !effectiveEnabledNames.has(name)).length;

    let reordered = 0;
    const commonNames = [...effectiveEnabledNames].filter((name) => baselineEnabledNames.has(name));
    commonNames.forEach((name) => {
      const baselineLoadOrder = baselineLoadOrderByName.get(name);
      const draftLoadOrder = draftLoadOrderByName.get(name);
      if (!isSameOptionalNumber(baselineLoadOrder, draftLoadOrder)) reordered += 1;
    });

    let pinned = 0;
    effectiveEnabledNames.forEach((name) => {
      if (draftLoadOrderByName.get(name) != null) pinned += 1;
    });

    return {
      added,
      removed,
      reordered,
      pinned,
      missingDependencies: missingDependencyIds.size,
    };
  }, [
    baselineEnabledNames,
    baselineLoadOrderByName,
    draftLoadOrderByName,
    effectiveEnabledNames,
    missingDependencyIds.size,
  ]);

  const requestPresetChange = useCallback(
    (presetName: string) => {
      if (presetName === selectedPresetName) return;
      if (isDirty) {
        setPendingPresetName(presetName);
        setIsDiscardConfirmOpen(true);
        return;
      }
      loadPresetDraft(presetName);
    },
    [isDirty, loadPresetDraft, selectedPresetName],
  );

  const onPresetSelectionChanged = useCallback(
    (selectedOption: SingleValue<PresetOption>) => {
      if (!selectedOption) return;
      requestPresetChange(selectedOption.value);
    },
    [requestPresetChange],
  );

  const applyDiscardAndSwitch = useCallback(() => {
    if (pendingPresetName) {
      loadPresetDraft(pendingPresetName);
    } else {
      setIsDiscardConfirmOpen(false);
    }
  }, [loadPresetDraft, pendingPresetName]);

  const setLoadOrderMode = useCallback(
    (kind: "reorder" | "insert", modName: string) => {
      if (placeMode && placeMode.modName === modName && placeMode.kind === kind) {
        setPlaceMode(undefined);
        return;
      }

      const currentIndex = Math.max(
        0,
        enabledDraftMods.findIndex((mod) => mod.name === modName),
      );
      setActivePlaceholderIndex(currentIndex);
      setPlaceMode({ kind, modName });
    },
    [enabledDraftMods, placeMode],
  );

  const addModNamesToPreset = useCallback((modNames: string[]) => {
    if (modNames.length < 1) return;
    setDraftEnabledNames((previousEnabledNames) => {
      const nextEnabledNames = new Set(previousEnabledNames);
      modNames.forEach((name) => nextEnabledNames.add(name));
      return nextEnabledNames;
    });
  }, []);

  const removeModNamesFromPreset = useCallback(
    (modNames: string[]) => {
      if (modNames.length < 1) return;
      setDraftEnabledNames((previousEnabledNames) => {
        const nextEnabledNames = new Set(previousEnabledNames);
        modNames.forEach((name) => {
          if (alwaysEnabledNames.has(name)) return;
          nextEnabledNames.delete(name);
        });
        return nextEnabledNames;
      });
      setDraftLoadOrderByName((previousLoadOrderByName) => {
        const nextLoadOrderByName = new Map(previousLoadOrderByName);
        modNames.forEach((name) => {
          if (alwaysEnabledNames.has(name)) return;
          nextLoadOrderByName.delete(name);
        });
        return nextLoadOrderByName;
      });
    },
    [alwaysEnabledNames],
  );

  const applyPlacement = useCallback(
    (placeholderIndex: number) => {
      if (!placeMode) return;

      const placeModName = placeMode.modName;
      const nextEnabledNames = new Set(draftEnabledNames);
      if (placeMode.kind === "insert") {
        nextEnabledNames.add(placeModName);
      }

      const workingMods = [...enabledDraftMods];
      let modToPlace = workingMods.find((mod) => mod.name === placeModName);
      if (!modToPlace) {
        const sourceMod = knownModsByName.get(placeModName) ?? createFallbackMod(placeModName);
        modToPlace = {
          ...sourceMod,
          isEnabled: true,
          loadOrder: draftLoadOrderByName.get(placeModName),
        };
      } else {
        workingMods.splice(
          workingMods.findIndex((mod) => mod.name === placeModName),
          1,
        );
      }

      const boundedIndex = Math.max(0, Math.min(placeholderIndex, workingMods.length));
      workingMods.splice(boundedIndex, 0, modToPlace);

      const nextLoadOrders = new Map<string, number>();
      workingMods.forEach((mod, index) => {
        if (draftLoadOrderByName.get(mod.name) != null || mod.name === placeModName) {
          nextLoadOrders.set(mod.name, index);
        }
      });

      setDraftEnabledNames(nextEnabledNames);
      setDraftLoadOrderByName(nextLoadOrders);
      setPlaceMode(undefined);
      setSelectedInPresetNames(new Set());
      setSelectedNotInPresetNames(new Set());
    },
    [draftEnabledNames, draftLoadOrderByName, enabledDraftMods, knownModsByName, placeMode],
  );

  useEffect(() => {
    if (!placeMode) return;
    const maxIndex = enabledDraftMods.length;
    if (activePlaceholderIndex > maxIndex) {
      setActivePlaceholderIndex(maxIndex);
    }
  }, [activePlaceholderIndex, enabledDraftMods.length, placeMode]);

  useEffect(() => {
    if (!placeMode) return;
    const element = document.getElementById(`preset-placeholder-${activePlaceholderIndex}`);
    element?.scrollIntoView({ block: "nearest" });
  }, [activePlaceholderIndex, placeMode]);

  useEffect(() => {
    if (!placeMode) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPlaceMode(undefined);
        return;
      }

      const placeholderCount = enabledDraftMods.length + 1;
      if (placeholderCount < 1) return;

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActivePlaceholderIndex((prev) => Math.max(0, prev - 1));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActivePlaceholderIndex((prev) => Math.min(placeholderCount - 1, prev + 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        applyPlacement(activePlaceholderIndex);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activePlaceholderIndex, applyPlacement, enabledDraftMods.length, placeMode]);

  useEffect(() => {
    if (!isDiscardConfirmOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !Number.isNaN(parseInt(event.key, 10))) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isDiscardConfirmOpen]);

  const onToggleInPresetSelection = useCallback((name: string) => {
    setSelectedInPresetNames((previousSelectedNames) => {
      const nextSelectedNames = new Set(previousSelectedNames);
      if (nextSelectedNames.has(name)) nextSelectedNames.delete(name);
      else nextSelectedNames.add(name);
      return nextSelectedNames;
    });
  }, []);

  const onToggleNotInPresetSelection = useCallback((name: string) => {
    setSelectedNotInPresetNames((previousSelectedNames) => {
      const nextSelectedNames = new Set(previousSelectedNames);
      if (nextSelectedNames.has(name)) nextSelectedNames.delete(name);
      else nextSelectedNames.add(name);
      return nextSelectedNames;
    });
  }, []);

  const onAddSelectedToPreset = useCallback(() => {
    if (selectedNotInPresetNames.size < 1) return;
    addModNamesToPreset([...selectedNotInPresetNames]);
    setSelectedNotInPresetNames(new Set());
  }, [addModNamesToPreset, selectedNotInPresetNames]);

  const onRemoveSelectedFromPreset = useCallback(() => {
    if (selectedInPresetNames.size < 1) return;
    const shouldExitPlaceMode = !!(placeMode && selectedInPresetNames.has(placeMode.modName));
    removeModNamesFromPreset([...selectedInPresetNames]);
    setSelectedInPresetNames(new Set());
    if (shouldExitPlaceMode) {
      setPlaceMode(undefined);
    }
  }, [placeMode, removeModNamesFromPreset, selectedInPresetNames]);

  const enableMissingDependencies = useCallback(
    (targetModName?: string) => {
      const modNamesToEnable = new Set<string>();
      const sources = targetModName
        ? [[targetModName, missingDependenciesByModName.get(targetModName) ?? []] as const]
        : [...missingDependenciesByModName.entries()];

      sources.forEach(([, dependencies]) => {
        dependencies.forEach((dependency) => {
          if (dependency.installedModName) modNamesToEnable.add(dependency.installedModName);
        });
      });

      if (modNamesToEnable.size < 1) return;

      setDraftEnabledNames((previousEnabledNames) => {
        const nextEnabledNames = new Set(previousEnabledNames);
        modNamesToEnable.forEach((name) => nextEnabledNames.add(name));
        return nextEnabledNames;
      });

      dispatch(
        addToast({
          type: "info",
          messages: [
            localized.enabledRequiredModsToast || "Enabled required mods:",
            Array.from(modNamesToEnable).join(", "),
          ],
          startTime: Date.now(),
        }),
      );
    },
    [dispatch, localized.enabledRequiredModsToast, missingDependenciesByModName],
  );

  const onClearLoadOrder = useCallback((modName: string) => {
    setDraftLoadOrderByName((previousLoadOrderByName) => {
      const nextLoadOrderByName = new Map(previousLoadOrderByName);
      nextLoadOrderByName.delete(modName);
      return nextLoadOrderByName;
    });
  }, []);

  const onResetAllLoadOrder = useCallback(() => {
    setDraftLoadOrderByName(new Map());
  }, []);

  const onResetSelectedLoadOrder = useCallback(() => {
    if (selectedInPresetNames.size < 1) return;
    setDraftLoadOrderByName((previousLoadOrderByName) => {
      const nextLoadOrderByName = new Map(previousLoadOrderByName);
      selectedInPresetNames.forEach((name) => nextLoadOrderByName.delete(name));
      return nextLoadOrderByName;
    });
  }, [selectedInPresetNames]);

  const hasAnyCustomLoadOrder = useMemo(
    () => enabledDraftMods.some((mod) => mod.loadOrder != null),
    [enabledDraftMods],
  );

  const hasSelectedCustomLoadOrder = useMemo(() => {
    for (const name of selectedInPresetNames) {
      if (draftLoadOrderByName.get(name) != null) return true;
    }
    return false;
  }, [draftLoadOrderByName, selectedInPresetNames]);

  const buildDraftPresetMods = useCallback(() => {
    const previousPresetModsByName = new Map<string, Mod>();
    currentPresetMods.forEach((mod) => previousPresetModsByName.set(mod.name, mod));
    selectedPreset?.mods.forEach((mod) => previousPresetModsByName.set(mod.name, mod));

    const modsToPersist = [...effectiveEnabledNames].map((name) => {
      const sourceMod =
        installedByName.get(name) ?? previousPresetModsByName.get(name) ?? createFallbackMod(name);
      const draftLoadOrder = draftLoadOrderByName.get(name);
      return {
        ...sourceMod,
        isEnabled: true,
        loadOrder: draftLoadOrder,
      };
    });

    return sortByNameAndLoadOrder(withoutDataAndContentDuplicates(modsToPersist));
  }, [currentPresetMods, draftLoadOrderByName, effectiveEnabledNames, installedByName, selectedPreset]);

  const onSavePreset = useCallback(() => {
    if (!selectedPresetName) return;
    const draftPresetMods = buildDraftPresetMods();
    dispatch(updatePresetMods({ name: selectedPresetName, mods: draftPresetMods }));

    setBaselineEnabledNames(new Set(effectiveEnabledNames));
    setBaselineLoadOrderByName(new Map(draftLoadOrderByName));

    dispatch(
      addToast({
        type: "success",
        messages: [localized.savedPresetToast || "Saved preset", selectedPresetName],
        startTime: Date.now(),
      }),
    );
  }, [
    buildDraftPresetMods,
    dispatch,
    draftLoadOrderByName,
    effectiveEnabledNames,
    localized.savedPresetToast,
    selectedPresetName,
  ]);

  const onSavePresetAs = useCallback(() => {
    const defaultName = selectedPresetName ? `${selectedPresetName} Copy` : "New Preset";
    setSaveAsName(defaultName);
    setSaveAsError(undefined);
    setIsSaveAsOpen(true);
  }, [selectedPresetName]);

  const onConfirmSavePresetAs = useCallback(() => {
    const newPresetName = saveAsName.trim();
    if (!newPresetName) {
      setSaveAsError(localized.saveAsPresetEmpty || "Preset name is required.");
      return;
    }

    if (presets.some((preset) => preset.name === newPresetName)) {
      setSaveAsError(localized.saveAsPresetExists || `Preset "${newPresetName}" already exists.`);
      return;
    }

    const draftPresetMods = buildDraftPresetMods();
    dispatch(addPreset({ name: newPresetName, mods: draftPresetMods }));

    setSelectedPresetName(newPresetName);
    setBaselineEnabledNames(new Set(effectiveEnabledNames));
    setBaselineLoadOrderByName(new Map(draftLoadOrderByName));
    setSelectedInPresetNames(new Set());
    setSelectedNotInPresetNames(new Set());
    setPlaceMode(undefined);
    setIsSaveAsOpen(false);
    setSaveAsError(undefined);
  }, [
    buildDraftPresetMods,
    dispatch,
    draftLoadOrderByName,
    effectiveEnabledNames,
    localized.saveAsPresetEmpty,
    localized.saveAsPresetExists,
    presets,
    saveAsName,
  ]);

  const onUsePreset = useCallback(() => {
    const draftPresetMods = buildDraftPresetMods();
    dispatch(setModRowsSortingType(SortingType.Ordered));
    dispatch(applyPresetDraftMods({ mods: draftPresetMods, sourcePresetName: selectedPresetName }));
  }, [buildDraftPresetMods, dispatch, selectedPresetName]);

  const onDeletePreset = useCallback(() => {
    if (!selectedPresetName) return;
    setIsDeleteConfirmOpen(true);
  }, [selectedPresetName]);

  const onConfirmDeletePreset = useCallback(() => {
    if (!selectedPresetName) return;
    dispatch(deletePreset(selectedPresetName));
    setIsDeleteConfirmOpen(false);
  }, [dispatch, selectedPresetName]);

  const selectedPresetOption = selectedPresetName
    ? {
        value: selectedPresetName,
        label: selectedPresetName,
      }
    : null;

  return (
    <div className="max-w-[100rem] mx-auto px-4 py-4 text-slate-100">
      <div className="grid grid-cols-12 gap-4 items-end">
        <div className="col-span-4">
          <div className="flex items-center gap-2">
            <div className="text-sm whitespace-nowrap">{localized.presetToEdit || "Preset to edit:"}</div>
            <div className="flex-1 min-w-0">
              <Select
                options={presetsOptions}
                styles={selectStyle}
                value={selectedPresetOption}
                onChange={onPresetSelectionChanged}
                isDisabled={isDiscardConfirmOpen || isSaveAsOpen || isDeleteConfirmOpen}
              ></Select>
            </div>
          </div>
        </div>
        <div className="col-span-5 text-sm">
          <span className="mr-3">{`+${summary.added}`}</span>
          <span className="mr-3">{`-${summary.removed}`}</span>
          <span className="mr-3">{`${summary.reordered} ${localized.reordered || "reordered"}`}</span>
          <span className="mr-3">{`${summary.pinned} ${localized.pinned || "pinned"}`}</span>
          <span>{`${summary.missingDependencies} ${
            localized.missingDependenciesShort || "missing deps"
          }`}</span>
        </div>
        <div className="col-span-3 flex justify-end gap-2 flex-wrap">
          <button
            className="bg-blue-700 hover:bg-blue-800 text-white text-sm px-3 py-2 rounded disabled:opacity-40"
            disabled={!isDirty || !selectedPresetName}
            onClick={() => onSavePreset()}
          >
            {localized.save || "Save"}
          </button>
          <button
            className="bg-blue-700 hover:bg-blue-800 text-white text-sm px-3 py-2 rounded disabled:opacity-40"
            onClick={() => onSavePresetAs()}
          >
            {localized.saveAs || "Save As"}
          </button>
          <button
            className="bg-blue-700 hover:bg-blue-800 text-white text-sm px-3 py-2 rounded disabled:opacity-40"
            onClick={() => onUsePreset()}
          >
            {localized.use || "Use"}
          </button>
          <button
            className="bg-red-700 hover:bg-red-800 text-white text-sm px-3 py-2 rounded disabled:opacity-40"
            disabled={!selectedPresetName}
            onClick={() => onDeletePreset()}
          >
            {localized.delete || "Delete"}
          </button>
        </div>
      </div>

      {summary.missingDependencies > 0 && (
        <div className="mt-3 p-2 rounded bg-amber-900/40 border border-amber-700 flex items-center justify-between">
          <span>
            {localized.missingRequiredMods || "Missing Required Mods"}: {summary.missingDependencies}
          </span>
          <button
            className="bg-amber-700 hover:bg-amber-800 text-white text-sm px-3 py-1 rounded disabled:opacity-40"
            onClick={() => enableMissingDependencies()}
            disabled={!!placeMode}
          >
            {localized.enableRequiredMods || "Enable required mods"}
          </button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-12 gap-4">
        <div className="col-span-5">
          <div className="mb-2 flex items-center justify-between">
            <span>{localized.inPreset || "In preset"}</span>
            <div className="flex gap-2">
              <button
                className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
                onClick={() => onResetAllLoadOrder()}
                disabled={!hasAnyCustomLoadOrder || !!placeMode}
              >
                {localized.resetAllOrder || "Reset all order"}
              </button>
            </div>
          </div>
          <div className="text-xs opacity-80 mb-2">
            {localized.loadOrderLegendPinned || "Blue number = pinned load order."}
            <span className="ml-2">
              <span className="text-orange-500 font-semibold">D</span>{" "}
              {localized.dataModLegend || "= mod is in data folder."}
            </span>
          </div>
          <input
            value={searchInPreset}
            onChange={(event) => setSearchInPreset(event.target.value)}
            placeholder={localized.searchMods || "Search mods..."}
            className="mb-2 w-full rounded bg-gray-700 px-3 py-2 text-sm disabled:opacity-40"
            disabled={!!placeMode}
          />
          <div
            className="h-[70vh] overflow-y-auto rounded border border-slate-700 bg-slate-900/40"
            onContextMenu={(event) => {
              event.preventDefault();
              setSelectedInPresetNames(new Set());
              setPlaceMode(undefined);
            }}
          >
            {visibleEnabledDraftMods.map((mod, index) => {
              const isAlwaysEnabled = !!isModAlwaysEnabled(mod, alwaysEnabledMods);
              const isSelected = selectedInPresetNames.has(mod.name);
              const modMissingDependencies = missingDependenciesByModName.get(mod.name) ?? [];
              const isMissing = !installedByName.has(mod.name);
              const visualOrder = enabledDraftMods.findIndex((iterMod) => iterMod.name === mod.name);
              const missingDependenciesTooltip = modMissingDependencies
                .map((dependency) => dependency.reqName?.trim() || dependency.reqId)
                .filter((value) => value !== "")
                .join("\n");

              return (
                <React.Fragment key={mod.name}>
                  {placeMode && (
                    <div
                      id={`preset-placeholder-${index}`}
                      className={
                        "drop-ghost h-8 cursor-pointer " +
                        (activePlaceholderIndex === index ? "bg-blue-700/40" : "opacity-70")
                      }
                      onClick={() => applyPlacement(index)}
                    ></div>
                  )}
                  <div
                    className={
                      "grid grid-cols-[2.2rem_3rem_2.2rem_1fr_auto] gap-2 px-2 py-1 border-b border-slate-800 items-center " +
                      (isSelected ? "bg-blue-900/40" : "")
                    }
                    onClick={() => onToggleInPresetSelection(mod.name)}
                    onDoubleClick={() => {
                      if (placeMode) return;
                      if (!isAlwaysEnabled) removeModNamesFromPreset([mod.name]);
                    }}
                  >
                    <button
                      className="text-slate-300 hover:text-white disabled:opacity-40"
                      onClick={(event) => {
                        event.stopPropagation();
                        setLoadOrderMode("reorder", mod.name);
                      }}
                      disabled={!effectiveEnabledNames.has(mod.name)}
                      title={localized.setLoadOrderMode || "Set load order"}
                    >
                      <BsArrowDownUp />
                    </button>
                    <span className={mod.loadOrder != null ? "text-blue-400 font-semibold" : ""}>
                      {(mod.loadOrder != null ? mod.loadOrder : visualOrder) + 1}
                    </span>
                    <button
                      className="text-slate-300 hover:text-white disabled:opacity-40"
                      onClick={(event) => {
                        event.stopPropagation();
                        onClearLoadOrder(mod.name);
                      }}
                      disabled={mod.loadOrder == null || !!placeMode}
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                    <div className="truncate cursor-pointer">
                      <span className={isMissing ? "text-amber-400" : ""}>{getModDisplayName(mod)}</span>
                      {mod.isInData && (
                        <span className="ml-1 text-orange-500 font-semibold opacity-80">D</span>
                      )}
                      {isMissing && <span className="ml-2 text-xs text-amber-400">(missing)</span>}
                      {isAlwaysEnabled && (
                        <span className="ml-2 text-xs text-violet-300">
                          <FontAwesomeIcon icon={faLock} /> always
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeModNamesFromPreset([mod.name]);
                          if (placeMode?.modName === mod.name) setPlaceMode(undefined);
                        }}
                        disabled={isAlwaysEnabled || !!placeMode}
                      >
                        {localized.remove || "Remove"}
                      </button>
                      {modMissingDependencies.length > 0 && (
                        <>
                          <span
                            className="text-amber-400"
                            title={`${localized.missingRequiredMods || "Missing Required Mods"}${
                              missingDependenciesTooltip ? `:\n${missingDependenciesTooltip}` : ""
                            }`}
                          >
                            <FontAwesomeIcon icon={faTriangleExclamation} />
                          </span>
                          <button
                            className="text-xs px-2 py-1 rounded bg-amber-700 hover:bg-amber-800 disabled:opacity-40"
                            onClick={(event) => {
                              event.stopPropagation();
                              enableMissingDependencies(mod.name);
                            }}
                            disabled={!!placeMode}
                          >
                            {localized.enableRequiredForMod || "Enable required"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
            {placeMode && (
              <div
                id={`preset-placeholder-${visibleEnabledDraftMods.length}`}
                className={
                  "drop-ghost h-8 cursor-pointer " +
                  (activePlaceholderIndex === visibleEnabledDraftMods.length
                    ? "bg-blue-700/40"
                    : "opacity-70")
                }
                onClick={() => applyPlacement(visibleEnabledDraftMods.length)}
              ></div>
            )}
          </div>
        </div>

        <div className="col-span-2 flex flex-col justify-center items-center gap-2">
          <button
            className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm disabled:opacity-40"
            onClick={() => onAddSelectedToPreset()}
            disabled={selectedNotInPresetNames.size < 1 || !!placeMode}
          >
            {localized.addToPreset || "<- Add"}
          </button>
          <button
            className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm disabled:opacity-40"
            onClick={() => onRemoveSelectedFromPreset()}
            disabled={selectedInPresetNames.size < 1 || !!placeMode}
          >
            {localized.removeFromPreset || "Remove ->"}
          </button>
          <button
            className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm disabled:opacity-40"
            onClick={() => onResetSelectedLoadOrder()}
            disabled={!hasSelectedCustomLoadOrder || !!placeMode}
          >
            {localized.resetSelectedOrder || "Reset selected order"}
          </button>
        </div>

        <div className="col-span-5">
          <div className="mb-2 flex items-center justify-between">
            <span>{localized.notInPreset || "Not in preset"}</span>
            <span className="text-xs opacity-80">
              {`${selectedNotInPresetNames.size} ${localized.selected || "selected"}`}
            </span>
          </div>
          <input
            value={searchNotInPreset}
            onChange={(event) => setSearchNotInPreset(event.target.value)}
            placeholder={localized.searchMods || "Search mods..."}
            className="mb-2 w-full rounded bg-gray-700 px-3 py-2 text-sm disabled:opacity-40"
            disabled={!!placeMode}
          />
          <div
            className="h-[70vh] overflow-y-auto rounded border border-slate-700 bg-slate-900/40"
            onContextMenu={(event) => {
              event.preventDefault();
              setSelectedNotInPresetNames(new Set());
              setPlaceMode(undefined);
            }}
          >
            {visibleNotInPresetMods.map((mod) => {
              const isSelected = selectedNotInPresetNames.has(mod.name);
              return (
                <div
                  key={mod.name}
                  className={
                    "grid grid-cols-[2.2rem_1fr_auto] gap-2 px-2 py-1 border-b border-slate-800 items-center " +
                    (isSelected ? "bg-blue-900/40" : "")
                  }
                  onClick={() => onToggleNotInPresetSelection(mod.name)}
                  onDoubleClick={() => {
                    if (placeMode) return;
                    addModNamesToPreset([mod.name]);
                  }}
                >
                  <button
                    className="text-slate-300 hover:text-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      setLoadOrderMode("insert", mod.name);
                    }}
                    title={localized.setLoadOrderMode || "Set load order"}
                  >
                    <BsArrowDownUp />
                  </button>
                  <div className="truncate cursor-pointer">
                    {getModDisplayName(mod)}
                    {mod.isInData && <span className="ml-1 text-orange-500 font-semibold">D</span>}
                  </div>
                  <button
                    className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                    onClick={(event) => {
                      event.stopPropagation();
                      addModNamesToPreset([mod.name]);
                    }}
                    disabled={!!placeMode}
                  >
                    {localized.add || "Add"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {isDiscardConfirmOpen && (
        <div className="fixed inset-0 z-[500] bg-black/70 flex items-center justify-center">
          <div className="bg-slate-800 border border-slate-600 rounded p-4 min-w-[24rem]">
            <div className="text-slate-100">
              {localized.discardUnsavedChanges || "Discard unsaved changes?"}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600"
                onClick={() => {
                  setIsDiscardConfirmOpen(false);
                  setPendingPresetName(undefined);
                }}
              >
                {localized.cancel || "Cancel"}
              </button>
              <button
                className="px-3 py-1 rounded bg-red-700 hover:bg-red-800"
                onClick={() => applyDiscardAndSwitch()}
              >
                {localized.discard || "Discard"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-[500] bg-black/70 flex items-center justify-center">
          <div className="bg-slate-800 border border-slate-600 rounded p-4 min-w-[24rem]">
            <div className="text-slate-100">
              {localized.deletePresetConfirm || `Delete preset "${selectedPresetName}"?`}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600"
                onClick={() => setIsDeleteConfirmOpen(false)}
              >
                {localized.cancel || "Cancel"}
              </button>
              <button
                className="px-3 py-1 rounded bg-red-700 hover:bg-red-800"
                onClick={() => onConfirmDeletePreset()}
              >
                {localized.delete || "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isSaveAsOpen && (
        <div className="fixed inset-0 z-[500] bg-black/70 flex items-center justify-center">
          <div className="bg-slate-800 border border-slate-600 rounded p-4 min-w-[24rem]">
            <div className="text-slate-100">{localized.saveAs || "Save As"}</div>
            <div className="mt-2 text-sm text-slate-300">
              {localized.saveAsPresetPrompt || "Name for new preset:"}
            </div>
            <input
              autoFocus
              value={saveAsName}
              onChange={(event) => {
                setSaveAsName(event.target.value);
                if (saveAsError) setSaveAsError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onConfirmSavePresetAs();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setIsSaveAsOpen(false);
                }
              }}
              className="mt-2 w-full rounded bg-gray-700 px-3 py-2 text-sm"
            />
            {saveAsError && <div className="mt-2 text-xs text-rose-400">{saveAsError}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600"
                onClick={() => {
                  setIsSaveAsOpen(false);
                  setSaveAsError(undefined);
                }}
              >
                {localized.cancel || "Cancel"}
              </button>
              <button
                className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-800"
                onClick={() => onConfirmSavePresetAs()}
              >
                {localized.save || "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default PresetsTab;
