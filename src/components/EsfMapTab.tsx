import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { addToast, clearMapRegionSelection, selectMapRegion, setMapCampaignName } from "../appSlice";
import { unitAssetUrl } from "../assetUrls";
import { useLocalizations } from "../localizationContext";
import { useDeferredWhileInactive } from "./useDeferredWhileInactive";
import { applyOwnershipEdits, formatRegionOwnershipJson, ownershipEditsFromImport } from "../esfMap/ownership";
import type { OwnershipEdits } from "../esfMap/ownership";
import type { EsfMapArea, EsfMapCampaignOption, EsfMapMarker, EsfMapPayload } from "../esfMap/types";
import { mapPointToCharacterCoordinate, projectCharacterCoordinateToMap } from "../esfMap/coordinates";
import {
  CHARACTER_TERRAIN_COLOURS,
  drawCharacterTerrainAreas,
  snapCharacterPointToUsable,
} from "../esfMap/pathfinding";
import {
  applyExtendedMapEdit,
  buildExtendedMapDelta,
  cloneExtendedMap,
  createExtendedMapEditState,
  fillExtendedBuildingSlots,
  parseMapFile,
  resolveExtendedUnitOptions,
  type ExtendedMapCharacter,
  type ExtendedMapDocument,
  type ExtendedMapEditAction,
  type ExtendedMapEditState,
} from "../esfMap/extended";
import type { BuildingsRegionView } from "../buildingsData/types";
import type { UnitViewerCatalogUnit, UnitViewerLordOption } from "../unitViewer/types";

type EsfMapTabProps = {
  isActive?: boolean;
};

const MAP_AREA_OPACITY = 0.36;
const FACTION_FLAG_SIZE = 20;
const CHARACTER_DRAG_THRESHOLD = 3;
const CHARACTER_MARKER_RADIUS = 10;
const CHARACTER_MAX_SCREEN_RADIUS = 24;
/** Deep enough to walk back a mis-click run, shallow enough that the snapshots stay cheap. */
const OWNERSHIP_HISTORY_LIMIT = 200;
/** How many factions the brush list renders at once. The faction table runs to thousands of rows. */
const LISTED_FACTION_LIMIT = 200;

type MapView = "regions" | "factions" | "climate";

type CharacterMapEntry = {
  faction: string;
  character: ExtendedMapCharacter;
  point: { x: number; y: number };
};

type CharacterMapMarker = {
  key: string;
  faction: string;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  borderWidth: number;
  selected: boolean;
  thumbnailSource?: string;
};

const displayYFromVertex = (height: number, y: number, displayFlipY: boolean) => (displayFlipY ? height - y : y);
const displayYFromCell = (height: number, y: number, displayFlipY: boolean) => (displayFlipY ? height - 1 - y : y);

const loadMapImage = (src: string | undefined): Promise<HTMLImageElement | undefined> => {
  if (!src) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = src;
  });
};

const drawAreaPath = (context: CanvasRenderingContext2D, area: EsfMapArea, height: number, displayFlipY: boolean) => {
  context.beginPath();
  for (const loop of area.loops) {
    if (loop.length < 6) continue;
    context.moveTo(loop[0], displayYFromVertex(height, loop[1], displayFlipY));
    for (let index = 2; index < loop.length; index += 2) {
      context.lineTo(loop[index], displayYFromVertex(height, loop[index + 1], displayFlipY));
    }
    context.closePath();
  }
};

const getMarkerForArea = (map: EsfMapPayload, area: EsfMapArea): EsfMapMarker | undefined =>
  area.regionKey ? map.markers.find((marker) => marker.key === area.regionKey) : undefined;

const factionKey = (value: string | null | undefined) => value?.trim().toLowerCase();

const factionColour = (key: string) => {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `hsla(${Math.abs(hash) % 360}, 72%, 48%, 0.46)`;
};

const interpolateMapText = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

const findCharacterForUi = (
  characters: Array<{ faction: string; character: ExtendedMapCharacter }>,
  faction: string,
  id: number,
) =>
  characters.find((entry) => entry.faction.toLowerCase() === faction.toLowerCase() && entry.character.id === id)
    ?.character;

const associatedUnitForSubculture = (option: UnitViewerLordOption, subculture: string | undefined) => {
  if (subculture) {
    const override = Object.entries(option.associatedUnitBySubculture ?? {}).find(
      ([key]) => key.toLowerCase() === subculture.toLowerCase(),
    );
    if (override) return override[1];
  }
  return option.associatedUnit;
};

const formatSubtypeOption = (option: UnitViewerLordOption) => `${option.subtype} — ${option.name}`;

const characterUiKey = (faction: string, id: number) => `${faction.toLowerCase()}:${id}`;

const EsfMapTab = memo(({ isActive = true }: EsfMapTabProps) => {
  const dispatch = useAppDispatch();
  const localized: Record<string, string> = useLocalizations();
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const mapCampaignName = useAppSelector((state) => state.app.mapCampaignName);
  const mapSelectedRegion = useAppSelector((state) => state.app.mapSelectedRegion);
  const enabledMods = useMemo(() => mods.filter((mod) => mod.isEnabled), [mods]);
  const enabledModsSignature = useMemo(
    () =>
      `${currentGame}|${enabledMods
        .map((mod) => `${mod.path}:${mod.loadOrder ?? ""}:${mod.lastChangedLocal ?? ""}`)
        .join("|")}`,
    [currentGame, enabledMods],
  );
  const signatureToRequest = useDeferredWhileInactive(isActive, enabledModsSignature);
  const enabledModsRef = useRef(enabledMods);
  enabledModsRef.current = enabledMods;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapSurfaceRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const mapListItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const mapImagesRef = useRef(new Map<string, HTMLImageElement>());
  const mapImageLoadsRef = useRef(new Map<string, Promise<HTMLImageElement | undefined>>());
  const characterThumbnailSourcesRef = useRef(new Set<string>());
  const characterThumbnailPathsRef = useRef<string[]>([]);
  const characterThumbnailSessionRef = useRef<string>();
  const mapDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  }>();
  const mapZoomAnchorRef = useRef<{
    mapX: number;
    mapY: number;
    scaleX: number;
    scaleY: number;
    scrollLeft: number;
    scrollTop: number;
  }>();
  const suppressMapClickRef = useRef(false);
  const characterDragRef = useRef<{
    pointerId: number;
    faction: string;
    characterId: number;
    startX: number;
    startY: number;
    hasMoved: boolean;
  }>();
  /** The map as the startpos has it. Ownership edits are overlaid onto it below, never into it. */
  const [baseMap, setBaseMap] = useState<EsfMapPayload>();
  const [campaignOptions, setCampaignOptions] = useState<EsfMapCampaignOption[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<number>();
  const [selectedSettlementType, setSelectedSettlementType] = useState("");
  const [mapView, setMapView] = useState<MapView>("regions");
  /** undefined follows region selection, null explicitly shows every climate, and a string filters to one climate. */
  const [climateSelectionKey, setClimateSelectionKey] = useState<string | null>();
  const [filter, setFilter] = useState("");
  const [zoom, setZoom] = useState(1);
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [isEditingOwnership, setIsEditingOwnership] = useState(false);
  /** The faction a left click paints, held as its canonical key. Independent of the region selection. */
  const [brushFaction, setBrushFaction] = useState<string>();
  const [ownershipEdits, setOwnershipEdits] = useState<OwnershipEdits>({});
  const [editHistory, setEditHistory] = useState<OwnershipEdits[]>([]);
  const [isTransferringOwnership, setIsTransferringOwnership] = useState(false);
  /** Extended map data is kept separate from ESF ownership so legacy map.json remains unchanged. */
  const [extendedState, setExtendedState] = useState<ExtendedMapEditState>();
  const [extendedHistory, setExtendedHistory] = useState<ExtendedMapDocument[]>([]);
  const [showCharacters, setShowCharacters] = useState(false);
  const [selectedCharacterKey, setSelectedCharacterKey] = useState<{ faction: string; id: number }>();
  const [characterDragPreview, setCharacterDragPreview] = useState<{
    faction: string;
    id: number;
    x: number;
    y: number;
  }>();
  const [buildingsView, setBuildingsView] = useState<BuildingsRegionView>();
  const [unitCatalog, setUnitCatalog] = useState<UnitViewerCatalogUnit[]>([]);
  const [lordOptions, setLordOptions] = useState<UnitViewerLordOption[]>([]);
  const [unitViewerSessionId, setUnitViewerSessionId] = useState<string>();
  const [resolvedCharacterThumbnailPaths, setResolvedCharacterThumbnailPaths] = useState<string[]>([]);
  const [extendedLoading, setExtendedLoading] = useState(false);

  const mapText = (key: string, fallback: string) => localized[key] || fallback;
  const mapMessage = (key: string, fallback: string, values: Record<string, string | number>) =>
    interpolateMapText(mapText(key, fallback), values);

  const factionsByKey = useMemo(
    () => new Map((baseMap?.factions ?? []).map((faction) => [faction.key.toLowerCase(), faction])),
    [baseMap],
  );
  // Everything below reads the edited map, so the canvas, the sidebar and the counts all agree.
  const map = useMemo(
    () => (baseMap ? applyOwnershipEdits(baseMap, ownershipEdits, factionsByKey) : undefined),
    [baseMap, factionsByKey, ownershipEdits],
  );
  const baseOwnerByRegion = useMemo(
    () => new Map((baseMap?.markers ?? []).map((marker) => [marker.key, marker.ownerFaction ?? null] as const)),
    [baseMap],
  );
  const editedRegionCount = Object.keys(ownershipEdits).length;
  const isEditingFactions = mapView === "factions" && isEditingOwnership;
  const brushFactionKey = factionKey(brushFaction);
  const extendedCharacters = useMemo(
    () =>
      extendedState?.document.faction_to_chars.flatMap((group) =>
        group.chars.map((character) => ({ faction: group.faction, character })),
      ) ?? [],
    [extendedState],
  );
  const selectedCharacter = useMemo(
    () =>
      selectedCharacterKey
        ? extendedCharacters.find(
            ({ faction, character }) =>
              faction.toLowerCase() === selectedCharacterKey.faction.toLowerCase() &&
              character.id === selectedCharacterKey.id,
          )
        : undefined,
    [extendedCharacters, selectedCharacterKey],
  );
  const extendedDelta = useMemo(
    () => (extendedState ? buildExtendedMapDelta(extendedState.baseline, extendedState.document) : undefined),
    [extendedState],
  );
  const isExtendedFormat = !!extendedState;
  const characterMapOverlayActive = isActive && !!map && showCharacters && !!extendedState;
  const mapDisplayWidthPx = map ? Math.max(320, Math.round(map.width * zoom)) : 0;
  const mapDisplayHeightPx = map ? Math.max(240, Math.round(map.height * zoom)) : 0;
  const mapDisplayWidth = map ? `${mapDisplayWidthPx}px` : undefined;
  const mapDisplayHeight = map ? `${mapDisplayHeightPx}px` : undefined;
  const mapScaleX = map && map.width > 0 ? mapDisplayWidthPx / map.width : 1;
  const mapScaleY = map && map.height > 0 ? mapDisplayHeightPx / map.height : 1;
  const characterThumbnailPathByKey = useMemo(() => {
    const cardPathByUnitKey = new Map(
      unitCatalog
        .filter((unit) => !!unit.unitCardPath)
        .map((unit) => [unit.key.toLowerCase(), unit.unitCardPath!] as const),
    );
    const lordOptionBySubtype = new Map(lordOptions.map((option) => [option.subtype.toLowerCase(), option] as const));
    const result = new Map<string, string>();
    if (!map) return result;
    for (const { faction, character } of extendedCharacters) {
      if (!projectCharacterCoordinateToMap(map, character.x, character.y)) continue;
      const mapFaction = factionsByKey.get(faction.toLowerCase());
      const lordOption = lordOptionBySubtype.get(character.subtype.toLowerCase());
      const candidateUnitKeys = [
        character.units?.[0]?.unit_key,
        lordOption ? associatedUnitForSubculture(lordOption, mapFaction?.subculture) : undefined,
        character.subtype,
      ];
      const cardPath = candidateUnitKeys
        .filter((key): key is string => !!key)
        .map((key) => cardPathByUnitKey.get(key.toLowerCase()))
        .find((path): path is string => !!path);
      if (cardPath) result.set(characterUiKey(faction, character.id), cardPath);
    }
    return result;
  }, [extendedCharacters, factionsByKey, lordOptions, map, unitCatalog]);
  const characterThumbnailPaths = useMemo(
    () => (showCharacters ? Array.from(new Set(characterThumbnailPathByKey.values())) : []),
    [characterThumbnailPathByKey, showCharacters],
  );
  // Character coordinates are part of the extended document, but do not change which card assets
  // are needed. Keep the prewarm effect keyed to the actual path set so moving one character does
  // not briefly remove every other character's thumbnail.
  const characterThumbnailPathsKey = useMemo(
    () => JSON.stringify([...characterThumbnailPaths].sort()),
    [characterThumbnailPaths],
  );
  characterThumbnailPathsRef.current = characterThumbnailPaths;
  const resolvedCharacterThumbnailPathSet = useMemo(
    () => new Set(resolvedCharacterThumbnailPaths),
    [resolvedCharacterThumbnailPaths],
  );
  const characterThumbnailUrls = useMemo(() => {
    if (!showCharacters || !unitViewerSessionId) return new Map<string, string>();
    return new Map(
      Array.from(characterThumbnailPathByKey.entries())
        .filter(([, path]) => resolvedCharacterThumbnailPathSet.has(path))
        .map(([key, path]) => [key, unitAssetUrl(unitViewerSessionId, path)] as const),
    );
  }, [characterThumbnailPathByKey, resolvedCharacterThumbnailPathSet, showCharacters, unitViewerSessionId]);
  const characterThumbnailSources = useMemo(
    () => Array.from(new Set(characterThumbnailUrls.values())),
    [characterThumbnailUrls],
  );
  const characterMapIndex = useMemo<{
    entries: CharacterMapEntry[];
  }>(() => {
    const entries: CharacterMapEntry[] = [];
    if (!map) return { entries };

    for (const { faction, character } of extendedCharacters) {
      const point = projectCharacterCoordinateToMap(map, character.x, character.y);
      if (!point) continue;
      const entry = { faction, character, point };
      entries.push(entry);
    }
    return { entries };
  }, [extendedCharacters, map]);

  useEffect(() => {
    if (currentGame !== "wh3") return;
    let current = true;
    setIsLoading(true);
    setError(undefined);
    window.api
      ?.getEsfMap(enabledModsRef.current, mapCampaignName)
      .then((response) => {
        if (!current) return;
        if (!response.success) {
          setBaseMap(undefined);
          setError(response.error);
          return;
        }
        setBaseMap(response.map);
        setCampaignOptions(response.map.availableCampaigns);
        setSelectedSettlementType("");
        setClimateSelectionKey(undefined);
        if (response.map.campaignKey !== mapCampaignName) dispatch(setMapCampaignName(response.map.campaignKey));
      })
      .catch((reason) => {
        if (current) {
          setBaseMap(undefined);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (current) setIsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [currentGame, dispatch, mapCampaignName, signatureToRequest]);

  const filteredMarkers = useMemo(() => {
    if (!map) return [];
    const query = filter.trim().toLowerCase();
    if (!query) return map.markers;
    return map.markers.filter((marker) =>
      [marker.key, marker.ownerFaction, marker.subculture, marker.settlementKey]
        .filter((value): value is string => !!value)
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [filter, map]);

  const selectedMarker = useMemo(
    () => map?.markers.find((marker) => marker.id === selectedMarkerId),
    [map, selectedMarkerId],
  );
  const selectedExtendedRegion = useMemo(
    () =>
      selectedMarker && extendedState
        ? extendedState.document.regions.find(
            (region) => region.region.toLowerCase() === selectedMarker.key.toLowerCase(),
          )
        : undefined,
    [extendedState, selectedMarker],
  );
  const selectedPrimaryBuilding = useMemo(
    () =>
      selectedExtendedRegion?.buildings?.find((slot) => slot.type.toLowerCase() === "primary")?.building || undefined,
    [selectedExtendedRegion],
  );
  const selectedExtendedBuildingSlots = useMemo(
    () =>
      selectedExtendedRegion?.buildings
        ? fillExtendedBuildingSlots(
            selectedExtendedRegion.buildings,
            buildingsView?.slotTemplates ?? [],
            buildingsView?.maxSlotCount,
          )
        : undefined,
    [buildingsView, selectedExtendedRegion],
  );
  const selectedMarkerFactionKey = factionKey(selectedMarker?.ownerFaction);
  const selectedMarkerClimateKey = selectedMarker
    ? map?.climatesByRegion[selectedMarker.key]?.toLowerCase()
    : undefined;
  const selectedClimateForSidebar =
    climateSelectionKey === undefined ? selectedMarkerClimateKey : climateSelectionKey?.toLowerCase();
  const isAllClimateSelected =
    climateSelectionKey === null || (climateSelectionKey === undefined && !selectedMarkerClimateKey);

  // The roster carries thousands of factions so any of them can be handed land, but only landholders
  // belong in the list: the rest are reachable by filtering for them, and are capped so that neither
  // the render nor the flag requests scale with the whole faction table.
  const factionMatches = useMemo(() => {
    if (!map) return [];
    const query = filter.trim().toLowerCase();
    const factions =
      isEditingFactions && query ? map.factions : map.factions.filter((faction) => faction.regionCount > 0);
    if (!query) return factions;
    return factions.filter((faction) =>
      [faction.key, faction.label].some((value) => value.toLowerCase().includes(query)),
    );
  }, [filter, isEditingFactions, map]);

  const filteredFactions = useMemo(
    () => (isEditingFactions ? factionMatches.slice(0, LISTED_FACTION_LIMIT) : factionMatches),
    [factionMatches, isEditingFactions],
  );
  const hiddenFactionCount = factionMatches.length - filteredFactions.length;

  const landholdingFactionCount = useMemo(
    () => (map?.factions ?? []).filter((faction) => faction.regionCount > 0).length,
    [map],
  );

  const climateByKey = useMemo(
    () => new Map((map?.climates ?? []).map((climate) => [climate.key.toLowerCase(), climate] as const)),
    [map],
  );

  const filteredClimates = useMemo(() => {
    if (!map) return [];
    const query = filter.trim().toLowerCase();
    if (!query) return map.climates;
    return map.climates.filter((climate) =>
      [climate.key, climate.label].some((value) => value.toLowerCase().includes(query)),
    );
  }, [filter, map]);

  const centerMapOnPoint = useCallback(
    (mapX: number, mapY: number) => {
      const surface = mapSurfaceRef.current;
      const canvasWrap = canvasWrapRef.current;
      if (!surface || !canvasWrap || !map) return;

      const surfaceRect = surface.getBoundingClientRect();
      const canvasWrapRect = canvasWrap.getBoundingClientRect();
      const scaleX = surfaceRect.width / map.width;
      const scaleY = surfaceRect.height / map.height;
      if (!scaleX || !scaleY) return;

      const targetLeft =
        canvasWrap.scrollLeft + surfaceRect.left - canvasWrapRect.left + mapX * scaleX - canvasWrap.clientWidth / 2;
      const targetTop =
        canvasWrap.scrollTop + surfaceRect.top - canvasWrapRect.top + mapY * scaleY - canvasWrap.clientHeight / 2;
      const maxScrollLeft = Math.max(0, canvasWrap.scrollWidth - canvasWrap.clientWidth);
      const maxScrollTop = Math.max(0, canvasWrap.scrollHeight - canvasWrap.clientHeight);
      canvasWrap.scrollLeft = Math.max(0, Math.min(maxScrollLeft, targetLeft));
      canvasWrap.scrollTop = Math.max(0, Math.min(maxScrollTop, targetTop));
    },
    [map],
  );

  const centerMapOnMarker = useCallback(
    (marker: EsfMapMarker) => {
      if (!map) return;
      centerMapOnPoint(marker.gx, displayYFromCell(map.height, marker.gy, map.displayFlipY));
    },
    [centerMapOnPoint, map],
  );

  const centerMapOnMarkers = useCallback(
    (markers: EsfMapMarker[]) => {
      if (!map || markers.length === 0) return;

      const points = markers.map((marker) => ({
        x: marker.gx,
        y: displayYFromCell(map.height, marker.gy, map.displayFlipY),
      }));
      const minX = Math.min(...points.map((point) => point.x));
      const maxX = Math.max(...points.map((point) => point.x));
      const minY = Math.min(...points.map((point) => point.y));
      const maxY = Math.max(...points.map((point) => point.y));
      centerMapOnPoint((minX + maxX) / 2, (minY + maxY) / 2);
    },
    [centerMapOnPoint, map],
  );

  // Edits are keyed by region key, so they survive a mod toggle reloading the same campaign. Another
  // campaign has other regions entirely, so carrying them over would paint the wrong places.
  const campaignKey = baseMap?.campaignKey;
  useEffect(() => {
    setOwnershipEdits({});
    setEditHistory([]);
    setBrushFaction(undefined);
    setExtendedState(undefined);
    setExtendedHistory([]);
    setSelectedCharacterKey(undefined);
    setCharacterDragPreview(undefined);
    setBuildingsView(undefined);
  }, [campaignKey, currentGame]);

  const pushEditHistory = useCallback(
    () => setEditHistory((history) => [...history, ownershipEdits].slice(-OWNERSHIP_HISTORY_LIMIT)),
    [ownershipEdits],
  );

  /** Records an owner for a region, dropping the edit again when it lands back on the startpos owner. */
  const paintRegion = (regionKey: string, owner: string | null) => {
    const startposOwner = baseOwnerByRegion.get(regionKey) ?? null;
    const currentOwner = regionKey in ownershipEdits ? ownershipEdits[regionKey] : startposOwner;
    if (factionKey(currentOwner) === factionKey(owner)) return;

    pushEditHistory();
    setOwnershipEdits((edits) => {
      const next = { ...edits };
      if (factionKey(startposOwner) === factionKey(owner)) delete next[regionKey];
      else next[regionKey] = owner;
      return next;
    });
  };

  const undoOwnershipEdit = useCallback(() => {
    if (editHistory.length === 0) return;
    setOwnershipEdits(editHistory[editHistory.length - 1]);
    setEditHistory((history) => history.slice(0, -1));
  }, [editHistory]);

  const revertOwnershipEdits = () => {
    if (editedRegionCount === 0) return;
    pushEditHistory();
    setOwnershipEdits({});
  };

  const showOwnershipToast = useCallback(
    (type: ToastType, messages: string[]) => dispatch(addToast({ type, messages, startTime: Date.now() })),
    [dispatch],
  );

  const updateExtendedDocuments = useCallback(
    (actions: ExtendedMapEditAction[]) => {
      if (!extendedState || actions.length === 0) return false;
      try {
        const correctedActions = actions.map((action) => {
          if (action.type !== "update_character" || !map || (!("x" in action.changes) && !("y" in action.changes)))
            return action;
          const group = extendedState.document.faction_to_chars.find(
            (candidate) => candidate.faction.toLowerCase() === action.faction.toLowerCase(),
          );
          const character = group?.chars.find((candidate) => candidate.id === action.characterId);
          if (!character) return action;
          const candidatePoint = {
            x: action.changes.x ?? character.x,
            y: action.changes.y ?? character.y,
          };
          const correctedPoint = snapCharacterPointToUsable(map, candidatePoint);
          if (correctedPoint.x === candidatePoint.x && correctedPoint.y === candidatePoint.y) return action;
          return { ...action, changes: { ...action.changes, ...correctedPoint } };
        });
        const nextState = correctedActions.reduce(
          (current, action) => applyExtendedMapEdit(current, action),
          extendedState,
        );
        if (JSON.stringify(nextState.document) === JSON.stringify(extendedState.document)) return true;
        setExtendedHistory((history) =>
          [...history, cloneExtendedMap(extendedState.document)].slice(-OWNERSHIP_HISTORY_LIMIT),
        );
        setExtendedState(nextState);
        return true;
      } catch (reason) {
        showOwnershipToast("warning", [reason instanceof Error ? reason.message : String(reason)]);
        return false;
      }
    },
    [extendedState, map, showOwnershipToast],
  );

  const updateExtendedDocument = useCallback(
    (action: ExtendedMapEditAction) => updateExtendedDocuments([action]),
    [updateExtendedDocuments],
  );

  const undoExtendedEdit = useCallback(() => {
    if (!extendedState || extendedHistory.length === 0) return;
    const document = extendedHistory[extendedHistory.length - 1];
    setExtendedState((current) => (current ? { ...current, document: cloneExtendedMap(document) } : current));
    setExtendedHistory((history) => history.slice(0, -1));
  }, [extendedHistory, extendedState]);

  const revertExtendedEdits = () => {
    if (!extendedState || !extendedDelta || extendedDelta.actions.length === 0) return;
    setExtendedHistory((history) =>
      [...history, cloneExtendedMap(extendedState.document)].slice(-OWNERSHIP_HISTORY_LIMIT),
    );
    setExtendedState((current) => (current ? { ...current, document: cloneExtendedMap(current.baseline) } : current));
  };

  useEffect(() => {
    if (!isActive || (!isEditingFactions && !extendedState)) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z")
        return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      if (extendedState && extendedHistory.length > 0) undoExtendedEdit();
      else undoOwnershipEdit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [extendedHistory.length, extendedState, isActive, isEditingFactions, undoExtendedEdit, undoOwnershipEdit]);

  const exportOwnership = async () => {
    if (!map || isTransferringOwnership) return;
    setIsTransferringOwnership(true);
    try {
      const result = await window.api?.exportRegionOwnership(
        formatRegionOwnershipJson(map),
        "map.json",
        extendedDelta && extendedDelta.actions.length > 0
          ? `${JSON.stringify(extendedDelta, undefined, 2)}\n`
          : undefined,
      );
      if (!result || result.canceled) return;
      if (result.success) {
        showOwnershipToast("success", [
          mapMessage(
            "mapOwnershipExported",
            extendedDelta && extendedDelta.actions.length > 0
              ? "Region ownership written to {{path}}; extended changes written to {{changesPath}}"
              : "Region ownership written to {{path}}",
            { path: result.savedPath ?? "", changesPath: result.changesPath ?? "" },
          ),
        ]);
      } else {
        showOwnershipToast("warning", [
          mapMessage("mapOwnershipExportFailed", "Could not write the region ownership file: {{error}}", {
            error: result.error ?? "",
          }),
        ]);
      }
    } finally {
      setIsTransferringOwnership(false);
    }
  };

  const importOwnership = async () => {
    if (!baseMap || isTransferringOwnership) return;
    setIsTransferringOwnership(true);
    try {
      const result = await window.api?.importRegionOwnership();
      if (!result || result.canceled) return;

      const importFailed = (reason: string) =>
        showOwnershipToast("warning", [
          mapMessage("mapOwnershipImportFailed", "Could not read the region ownership file: {{error}}", {
            error: reason,
          }),
        ]);
      if (!result.success || result.text === undefined) {
        importFailed(result.error ?? mapText("mapOwnershipImportUnknownError", "Unknown error"));
        return;
      }
      const detected = parseMapFile(result.text);
      if ("error" in detected) {
        importFailed(detected.error);
        return;
      }
      const ownership =
        detected.format === "legacy"
          ? detected.ownership
          : Object.fromEntries(detected.document.regions.map((region) => [region.region, region.faction]));
      const { edits, unknownRegions, unknownFactions } = ownershipEditsFromImport(baseMap, ownership, baseMap.factions);
      pushEditHistory();
      setOwnershipEdits(edits);
      if (detected.format === "extended") {
        setExtendedState(createExtendedMapEditState(detected.document));
        setExtendedHistory([]);
        setSelectedCharacterKey(undefined);
        setShowCharacters(true);
      } else {
        setExtendedState(undefined);
        setExtendedHistory([]);
        setSelectedCharacterKey(undefined);
        setShowCharacters(false);
      }

      const messages = [
        mapMessage(
          "mapOwnershipImported",
          detected.format === "extended"
            ? "Imported extended map data and ownership for {{count}} region(s)."
            : "Imported ownership for {{count}} region(s).",
          {
            count: Object.keys(edits).length,
          },
        ),
      ];
      if (unknownRegions.length > 0) {
        messages.push(
          mapMessage("mapOwnershipUnknownRegions", "{{count}} region(s) skipped, not in this campaign: {{keys}}", {
            count: unknownRegions.length,
            keys: unknownRegions.slice(0, 5).join(", "),
          }),
        );
      }
      if (unknownFactions.length > 0) {
        messages.push(
          mapMessage("mapOwnershipUnknownFactions", "{{count}} unknown faction key(s) kept as written: {{keys}}", {
            count: unknownFactions.length,
            keys: unknownFactions.slice(0, 5).join(", "),
          }),
        );
      }
      showOwnershipToast(unknownRegions.length + unknownFactions.length > 0 ? "warning" : "success", messages);
    } finally {
      setIsTransferringOwnership(false);
    }
  };

  useEffect(() => {
    if (!isExtendedFormat || !window.api) {
      setUnitCatalog([]);
      setLordOptions([]);
      setUnitViewerSessionId(undefined);
      setResolvedCharacterThumbnailPaths([]);
      return;
    }
    let current = true;
    setUnitCatalog([]);
    setLordOptions([]);
    setUnitViewerSessionId(undefined);
    setResolvedCharacterThumbnailPaths([]);
    setExtendedLoading(true);
    window.api
      .getUnitViewerCatalog(enabledModsRef.current)
      .then((response) => {
        if (!current) return;
        if (!response.success) {
          showOwnershipToast("warning", [response.error ?? "Could not load the unit roster."]);
          setUnitCatalog([]);
          setLordOptions([]);
          return;
        }
        const byKey = new Map<string, UnitViewerCatalogUnit>();
        for (const group of response.groups ?? []) for (const unit of group.units) byKey.set(unit.key, unit);
        setUnitViewerSessionId(response.sessionId);
        setUnitCatalog([...byKey.values()]);
        setLordOptions(response.lordOptions ?? []);
      })
      .catch((reason) => {
        if (current) {
          setUnitCatalog([]);
          setLordOptions([]);
          setUnitViewerSessionId(undefined);
          setResolvedCharacterThumbnailPaths([]);
          showOwnershipToast("warning", [reason instanceof Error ? reason.message : String(reason)]);
        }
      })
      .finally(() => {
        if (current) setExtendedLoading(false);
      });
    return () => {
      current = false;
    };
  }, [enabledModsSignature, isExtendedFormat, showOwnershipToast]);

  useEffect(() => {
    const requestedPaths = characterThumbnailPathsRef.current;
    if (!isActive) return;
    if (!showCharacters || !unitViewerSessionId || requestedPaths.length === 0 || !window.api) {
      setResolvedCharacterThumbnailPaths((paths) => (paths.length === 0 ? paths : []));
      return;
    }
    const requestedSessionId = unitViewerSessionId;
    const previousSessionId = characterThumbnailSessionRef.current;
    characterThumbnailSessionRef.current = requestedSessionId;
    let current = true;
    const requested = new Set(requestedPaths);
    setResolvedCharacterThumbnailPaths((paths) => {
      if (previousSessionId !== requestedSessionId) return paths.length === 0 ? paths : [];
      const retained = paths.filter((path) => requested.has(path));
      return retained.length === paths.length ? paths : retained;
    });
    window.api
      .prewarmUnitViewerAssets(requestedSessionId, [...requestedPaths])
      .then((response) => {
        if (!current || unitViewerSessionId !== requestedSessionId || !response?.success) return;
        setResolvedCharacterThumbnailPaths((paths) =>
          Array.from(new Set([...paths.filter((path) => requested.has(path)), ...(response.resolved ?? [])])).filter(
            (path) => requested.has(path),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [characterThumbnailPathsKey, isActive, showCharacters, unitViewerSessionId]);

  // Drop decoded character-card copies when the map no longer references them, while leaving the
  // background/flag cache untouched.
  useEffect(() => {
    const activeSources = new Set(characterThumbnailSources);
    for (const source of characterThumbnailSourcesRef.current) {
      if (activeSources.has(source)) continue;
      mapImagesRef.current.delete(source);
      characterThumbnailSourcesRef.current.delete(source);
    }
    for (const source of activeSources) characterThumbnailSourcesRef.current.add(source);
  }, [characterThumbnailSources]);

  useEffect(() => {
    if (!isExtendedFormat || !selectedMarker || !window.api) {
      setBuildingsView(undefined);
      return;
    }
    let current = true;
    setBuildingsView(undefined);
    const owner = selectedMarker.ownerFaction ?? undefined;
    const ownerFaction = owner ? factionsByKey.get(owner.toLowerCase()) : undefined;
    window.api
      .getBuildingsRegionView(enabledModsRef.current, {
        campaign: map?.campaignKey ?? mapCampaignName,
        region: selectedMarker.key,
        faction: owner,
        culture: ownerFaction?.culture,
        subculture: ownerFaction?.subculture ?? selectedMarker.subculture ?? undefined,
        includeLevelsWithoutVariant: true,
        includeRuinLevels: true,
        includeUnbandedLevels: true,
        primaryBuilding: selectedPrimaryBuilding,
      })
      .then((response) => {
        if (!current) return;
        if (response.success) {
          setBuildingsView(response.view);
        } else setBuildingsView(undefined);
      })
      .catch(() => {
        if (current) setBuildingsView(undefined);
      });
    return () => {
      current = false;
    };
  }, [
    enabledModsSignature,
    factionsByKey,
    isExtendedFormat,
    map?.campaignKey,
    mapCampaignName,
    selectedMarker,
    selectedPrimaryBuilding,
  ]);

  useEffect(() => {
    if (!map) return;
    const selectedRegion =
      mapSelectedRegion?.campaign.toLowerCase() === map.campaignKey.toLowerCase()
        ? mapSelectedRegion.region.toLowerCase()
        : undefined;
    setSelectedMarkerId(
      selectedRegion === undefined
        ? undefined
        : map.markers.find((marker) => marker.key.toLowerCase() === selectedRegion)?.id,
    );
    setClimateSelectionKey(undefined);
  }, [map, mapSelectedRegion]);

  useEffect(() => {
    // While painting the list follows the brush, not whatever region was clicked last.
    const listedFactionKey = isEditingFactions ? brushFactionKey : selectedMarkerFactionKey;
    const itemKey =
      mapView === "regions"
        ? selectedMarkerId === undefined
          ? undefined
          : `region:${selectedMarkerId}`
        : mapView === "factions" && listedFactionKey
          ? `faction:${listedFactionKey}`
          : undefined;
    if (!itemKey) return;

    const listItem = mapListItemRefs.current.get(itemKey);
    if (listItem?.scrollIntoView) listItem.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [brushFactionKey, filter, isEditingFactions, map, mapView, selectedMarkerFactionKey, selectedMarkerId]);

  useEffect(() => {
    if (!isActive) return;
    const canvas = canvasRef.current;
    if (!canvas || !map) return;

    if (canvas.width !== map.width) canvas.width = map.width;
    if (canvas.height !== map.height) canvas.height = map.height;
    const context = canvas.getContext("2d");
    if (!context) return;

    const selected =
      selectedMarkerId === undefined ? undefined : map.markers.find((marker) => marker.id === selectedMarkerId);
    const selectedFactionKey = factionKey(selected?.ownerFaction);
    const selectedRegionClimateKey = selected ? map.climatesByRegion[selected.key]?.toLowerCase() : undefined;
    const climateFilterKey =
      climateSelectionKey === null
        ? undefined
        : (climateSelectionKey?.toLowerCase() ?? (selected ? (selectedRegionClimateKey ?? null) : undefined));

    const drawMap = (
      backgroundImage: HTMLImageElement | undefined,
      backgroundTextImage: HTMLImageElement | undefined,
      flagImages: Map<string, HTMLImageElement>,
    ) => {
      context.clearRect(0, 0, map.width, map.height);
      if (backgroundImage) context.drawImage(backgroundImage, 0, 0, map.width, map.height);
      if (backgroundTextImage) context.drawImage(backgroundTextImage, 0, 0, map.width, map.height);

      const regionMatchesSettlementType = (regionKey: string | undefined) =>
        !selectedSettlementType ||
        (!!regionKey && map.settlementTypesByRegion[regionKey]?.includes(selectedSettlementType));

      if (mapView === "regions") {
        for (const area of map.areas) {
          if (!regionMatchesSettlementType(area.regionKey)) continue;
          drawAreaPath(context, area, map.height, map.displayFlipY);
          context.fillStyle = `rgba(${area.colour[0]}, ${area.colour[1]}, ${area.colour[2]}, ${MAP_AREA_OPACITY})`;
          context.fill("evenodd");
        }
      }

      if (mapView === "climate") {
        for (const area of map.areas) {
          if (!regionMatchesSettlementType(area.regionKey)) continue;
          const climateKey = area.regionKey ? map.climatesByRegion[area.regionKey]?.toLowerCase() : undefined;
          if (
            !climateKey ||
            climateFilterKey === null ||
            (climateFilterKey !== undefined && climateKey !== climateFilterKey)
          )
            continue;
          const climate = climateByKey.get(climateKey);
          if (!climate) continue;
          drawAreaPath(context, area, map.height, map.displayFlipY);
          context.fillStyle = `rgba(${climate.colour[0]}, ${climate.colour[1]}, ${climate.colour[2]}, ${MAP_AREA_OPACITY})`;
          context.fill("evenodd");
        }
      }

      if (mapView === "factions" && isEditingOwnership) {
        // Painting needs the whole board visible, not just one faction's holdings.
        for (const area of map.areas) {
          const ownerKey = factionKey(area.ownerFaction);
          if (!ownerKey || !regionMatchesSettlementType(area.regionKey)) continue;
          drawAreaPath(context, area, map.height, map.displayFlipY);
          context.fillStyle = factionColour(ownerKey);
          context.fill("evenodd");
        }
        for (const area of brushFactionKey ? map.areas : []) {
          if (!regionMatchesSettlementType(area.regionKey) || factionKey(area.ownerFaction) !== brushFactionKey)
            continue;
          drawAreaPath(context, area, map.height, map.displayFlipY);
          context.strokeStyle = "rgba(255, 255, 255, 0.9)";
          context.lineWidth = 1.2;
          context.stroke();
        }
      } else if (mapView === "factions" && selectedFactionKey) {
        for (const area of map.areas) {
          if (!regionMatchesSettlementType(area.regionKey) || factionKey(area.ownerFaction) !== selectedFactionKey)
            continue;
          drawAreaPath(context, area, map.height, map.displayFlipY);
          context.fillStyle = factionColour(selectedFactionKey);
          context.strokeStyle = "rgba(255, 255, 255, 0.9)";
          context.lineWidth = 1.2;
          context.fill("evenodd");
          context.stroke();
        }
      } else if (
        (mapView === "regions" || mapView === "climate") &&
        selected &&
        regionMatchesSettlementType(selected.key)
      ) {
        const selectedAreaIds = new Set(
          map.areas.filter((area) => area.regionKey === selected.key).map((area) => area.componentId),
        );
        for (const area of map.areas) {
          if (!selectedAreaIds.has(area.componentId)) continue;
          drawAreaPath(context, area, map.height, map.displayFlipY);
          context.fillStyle = "rgba(255, 255, 255, 0.18)";
          context.strokeStyle = "rgba(255, 255, 255, 0.95)";
          context.lineWidth = 1.2;
          context.fill("evenodd");
          context.stroke();
        }
      }

      if (characterMapOverlayActive) drawCharacterTerrainAreas(context, map);

      for (const marker of map.markers) {
        const y = displayYFromCell(map.height, marker.gy, map.displayFlipY);
        const markerFaction = marker.ownerFaction
          ? factionsByKey.get(factionKey(marker.ownerFaction) ?? "")
          : undefined;
        const flagImage =
          mapView === "factions" && markerFaction?.flagUrl ? flagImages.get(markerFaction.flagUrl) : undefined;
        if (flagImage) {
          context.save();
          context.shadowColor = "rgba(0, 0, 0, 0.8)";
          context.shadowBlur = 2;
          context.drawImage(
            flagImage,
            marker.gx - FACTION_FLAG_SIZE / 2,
            y - FACTION_FLAG_SIZE / 2,
            FACTION_FLAG_SIZE,
            FACTION_FLAG_SIZE,
          );
          context.restore();
        } else {
          context.fillStyle = "rgba(255, 255, 255, 0.92)";
          context.fillRect(marker.gx - 1, y - 1, 2, 2);
        }
      }

      if (selected) {
        const y = displayYFromCell(map.height, selected.gy, map.displayFlipY);
        context.strokeStyle = "#ffffff";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(selected.gx, y, 5, 0, Math.PI * 2);
        context.stroke();
      }
    };

    const backgroundSrc = map.backgroundImage?.src;
    const backgroundTextSrc = map.backgroundTextImage?.src;
    // Only landholders put a flag on the map, and the roster is mostly factions that hold nothing.
    const flagSources =
      mapView === "factions"
        ? map.factions
            .filter((faction) => faction.regionCount > 0)
            .map((faction) => faction.flagUrl)
            .filter((src): src is string => !!src)
        : [];
    const imageSources = Array.from(
      new Set([backgroundSrc, backgroundTextSrc, ...flagSources, ...characterThumbnailSources].filter(Boolean)),
    ) as string[];
    const cachedImages = new Map(
      imageSources
        .map((src) => [src, mapImagesRef.current.get(src)] as const)
        .filter((entry): entry is readonly [string, HTMLImageElement] => !!entry[1]),
    );
    const flagImages = new Map(
      flagSources
        .map((src) => [src, cachedImages.get(src)] as const)
        .filter((entry): entry is readonly [string, HTMLImageElement] => !!entry[1]),
    );
    const loadImageOnce = (source: string) => {
      const pending = mapImageLoadsRef.current.get(source);
      if (pending) return pending;
      const load = loadMapImage(source).finally(() => mapImageLoadsRef.current.delete(source));
      mapImageLoadsRef.current.set(source, load);
      return load;
    };
    drawMap(cachedImages.get(backgroundSrc ?? ""), cachedImages.get(backgroundTextSrc ?? ""), flagImages);

    const missingSources = imageSources.filter((src) => !cachedImages.has(src));
    if (missingSources.length === 0) return;

    let cancelled = false;
    void Promise.all(missingSources.map((src) => loadImageOnce(src))).then((images) => {
      if (cancelled) return;
      for (const [index, image] of images.entries()) {
        const src = missingSources[index];
        if (image) {
          mapImagesRef.current.set(src, image);
          cachedImages.set(src, image);
        }
      }
      const loadedFlagImages = new Map(
        flagSources
          .map((src) => [src, cachedImages.get(src)] as const)
          .filter((entry): entry is readonly [string, HTMLImageElement] => !!entry[1]),
      );
      drawMap(cachedImages.get(backgroundSrc ?? ""), cachedImages.get(backgroundTextSrc ?? ""), loadedFlagImages);
    });
    return () => {
      cancelled = true;
    };
  }, [
    brushFactionKey,
    climateByKey,
    climateSelectionKey,
    characterMapOverlayActive,
    characterThumbnailSources,
    factionsByKey,
    isEditingOwnership,
    isActive,
    map,
    mapView,
    selectedMarkerId,
    selectedSettlementType,
  ]);

  const characterMapMarkers = useMemo<CharacterMapMarker[]>(() => {
    if (!characterMapOverlayActive || !map) return [];

    const markers: CharacterMapMarker[] = [];
    for (const { faction, character, point: characterPoint } of characterMapIndex.entries) {
      const isPreview =
        characterDragPreview?.faction.toLowerCase() === faction.toLowerCase() &&
        characterDragPreview.id === character.id;
      const drawPoint = isPreview
        ? projectCharacterCoordinateToMap(map, characterDragPreview.x, characterDragPreview.y)
        : characterPoint;
      if (!drawPoint) continue;

      markers.push({
        key: characterUiKey(faction, character.id),
        faction,
        x: drawPoint.x * mapScaleX,
        y: drawPoint.y * mapScaleY,
        radiusX: Math.min(CHARACTER_MARKER_RADIUS * mapScaleX, CHARACTER_MAX_SCREEN_RADIUS),
        radiusY: Math.min(CHARACTER_MARKER_RADIUS * mapScaleY, CHARACTER_MAX_SCREEN_RADIUS),
        borderWidth: 0.75,
        selected:
          selectedCharacterKey?.faction.toLowerCase() === faction.toLowerCase() &&
          selectedCharacterKey.id === character.id,
        thumbnailSource: characterThumbnailUrls.get(characterUiKey(faction, character.id)),
      });
    }
    return markers;
  }, [
    characterDragPreview,
    characterMapIndex,
    characterMapOverlayActive,
    characterThumbnailUrls,
    map,
    mapScaleX,
    mapScaleY,
    selectedCharacterKey,
  ]);

  useLayoutEffect(() => {
    const anchor = mapZoomAnchorRef.current;
    const surface = mapSurfaceRef.current;
    const canvasWrap = canvasWrapRef.current;
    if (!anchor || !surface || !canvasWrap || !map) return;

    mapZoomAnchorRef.current = undefined;
    const surfaceRect = surface.getBoundingClientRect();
    const scaleX = surfaceRect.width / map.width;
    const scaleY = surfaceRect.height / map.height;
    if (!scaleX || !scaleY) return;

    canvasWrap.scrollLeft = anchor.scrollLeft + anchor.mapX * (scaleX - anchor.scaleX);
    canvasWrap.scrollTop = anchor.scrollTop + anchor.mapY * (scaleY - anchor.scaleY);
  }, [map, zoom]);

  const changeZoom = useCallback((nextZoom: number) => setZoom(Math.max(0.5, Math.min(6, nextZoom))), []);

  const zoomAtPointer = useCallback(
    (event: WheelEvent) => {
      if (!map) return;
      const surface = mapSurfaceRef.current;
      const canvasWrap = canvasWrapRef.current;
      if (!surface || !canvasWrap) return;

      const surfaceRect = surface.getBoundingClientRect();
      const scaleX = surfaceRect.width / map.width;
      const scaleY = surfaceRect.height / map.height;
      if (!scaleX || !scaleY) return;

      const nextZoom = Math.max(0.5, Math.min(6, zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      if (nextZoom === zoom) return;

      mapZoomAnchorRef.current = {
        mapX: (event.clientX - surfaceRect.left) / scaleX,
        mapY: (event.clientY - surfaceRect.top) / scaleY,
        scaleX,
        scaleY,
        scrollLeft: canvasWrap.scrollLeft,
        scrollTop: canvasWrap.scrollTop,
      };
      changeZoom(nextZoom);
    },
    [changeZoom, map, zoom],
  );

  useEffect(() => {
    const canvasWrap = canvasWrapRef.current;
    if (!canvasWrap) return;

    const handleWheel = (event: WheelEvent) => {
      if (!map) return;
      event.preventDefault();
      zoomAtPointer(event);
    };
    canvasWrap.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvasWrap.removeEventListener("wheel", handleWheel);
  }, [map, zoomAtPointer]);

  const selectMapMarker = (marker: EsfMapMarker | undefined, center = false) => {
    setClimateSelectionKey(undefined);
    setSelectedCharacterKey(undefined);
    setCharacterDragPreview(undefined);
    setSelectedMarkerId(marker?.id);
    if (marker && map) {
      dispatch(selectMapRegion({ campaign: map.campaignKey, region: marker.key }));
      if (center) centerMapOnMarker(marker);
    } else {
      dispatch(clearMapRegionSelection());
    }
  };

  const selectMapFaction = (factionKeyToSelect: string) => {
    const factionMarkers =
      map?.markers.filter((candidate) => factionKey(candidate.ownerFaction) === factionKeyToSelect) ?? [];
    selectMapMarker(factionMarkers[0]);
    centerMapOnMarkers(factionMarkers);
  };

  const beginMapDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    if (showCharacters && extendedState) {
      const character = characterAtCanvasPoint(event);
      if (character) {
        suppressMapClickRef.current = false;
        characterDragRef.current = {
          pointerId: event.pointerId,
          faction: character.faction,
          characterId: character.character.id,
          startX: event.clientX,
          startY: event.clientY,
          hasMoved: false,
        };
        setSelectedCharacterKey({ faction: character.faction, id: character.character.id });
        setCharacterDragPreview({
          faction: character.faction,
          id: character.character.id,
          x: character.character.x,
          y: character.character.y,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    const canvasWrap = canvasWrapRef.current;
    if (!canvasWrap) return;

    mapDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: canvasWrap.scrollLeft,
      startScrollTop: canvasWrap.scrollTop,
    };
    suppressMapClickRef.current = false;
    setIsDraggingMap(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveMapDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const characterDrag = characterDragRef.current;
    if (characterDrag && characterDrag.pointerId === event.pointerId) {
      if (
        Math.abs(event.clientX - characterDrag.startX) > CHARACTER_DRAG_THRESHOLD ||
        Math.abs(event.clientY - characterDrag.startY) > CHARACTER_DRAG_THRESHOLD
      ) {
        characterDrag.hasMoved = true;
      }
      if (characterDrag.hasMoved && event.type !== "pointercancel") {
        const mapPoint = mapCoordinatesAtClientPoint(event);
        const point = map && mapPoint ? mapPointToCharacterCoordinate(map, mapPoint) : undefined;
        if (point) setCharacterDragPreview({ faction: characterDrag.faction, id: characterDrag.characterId, ...point });
      }
      event.preventDefault();
      return;
    }
    const drag = mapDragRef.current;
    const canvasWrap = canvasWrapRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvasWrap) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) suppressMapClickRef.current = true;
    canvasWrap.scrollLeft = drag.startScrollLeft - deltaX;
    canvasWrap.scrollTop = drag.startScrollTop - deltaY;
    event.preventDefault();
  };

  const endMapDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const characterDrag = characterDragRef.current;
    if (characterDrag && characterDrag.pointerId === event.pointerId) {
      // A cancelled pointer stream has no committed destination. The preview may have received a
      // final move event, but pointercancel means the gesture was interrupted (touch scrolling,
      // window loss, etc.) and must not turn that transient position into an edit.
      const hasMoved =
        characterDrag.hasMoved ||
        Math.abs(event.clientX - characterDrag.startX) > CHARACTER_DRAG_THRESHOLD ||
        Math.abs(event.clientY - characterDrag.startY) > CHARACTER_DRAG_THRESHOLD;
      const mapPoint = event.type === "pointercancel" || !hasMoved ? undefined : mapCoordinatesAtClientPoint(event);
      const point = map && mapPoint ? mapPointToCharacterCoordinate(map, mapPoint) : undefined;
      const usablePoint = map && point ? snapCharacterPointToUsable(map, point) : point;
      if (hasMoved) suppressMapClickRef.current = true;
      characterDragRef.current = undefined;
      const currentCharacter = findCharacterForUi(extendedCharacters, characterDrag.faction, characterDrag.characterId);
      if (
        usablePoint &&
        currentCharacter &&
        (currentCharacter.x !== usablePoint.x || currentCharacter.y !== usablePoint.y)
      )
        updateExtendedDocument({
          type: "update_character",
          faction: characterDrag.faction,
          characterId: characterDrag.characterId,
          changes: usablePoint,
        });
      setCharacterDragPreview(undefined);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const drag = mapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    mapDragRef.current = undefined;
    setIsDraggingMap(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const markerAtCanvasPoint = (event: React.MouseEvent<HTMLCanvasElement>): EsfMapMarker | undefined => {
    if (!map) return undefined;
    const canvas = canvasRef.current;
    const surface = mapSurfaceRef.current;
    if (!canvas || !surface) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    const rect = surface.getBoundingClientRect();
    const x = Math.max(0, Math.min(map.width - 1, ((event.clientX - rect.left) / rect.width) * map.width));
    const rawY = Math.max(0, Math.min(map.height - 1, ((event.clientY - rect.top) / rect.height) * map.height));
    const y = map.displayFlipY ? map.height - rawY : rawY;

    let areaMarker: EsfMapMarker | undefined;
    for (const area of map.areas) {
      drawAreaPath(context, area, map.height, map.displayFlipY);
      if (context.isPointInPath(x, y, "evenodd")) {
        areaMarker = getMarkerForArea(map, area);
        if (areaMarker) break;
      }
    }

    if (!areaMarker) {
      let closest: EsfMapMarker | undefined;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const marker of map.markers) {
        const markerY = displayYFromCell(map.height, marker.gy, map.displayFlipY);
        const distance = (marker.gx - x) ** 2 + (markerY - y) ** 2;
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = marker;
        }
      }
      if (closestDistance <= 256) areaMarker = closest;
    }
    return areaMarker;
  };

  const mapCoordinatesAtClientPoint = (event: { clientX: number; clientY: number }) => {
    if (!map || !mapSurfaceRef.current) return undefined;
    const rect = mapSurfaceRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return undefined;
    const displayX = Math.max(0, Math.min(map.width - 1, ((event.clientX - rect.left) / rect.width) * map.width));
    const displayY = Math.max(0, Math.min(map.height - 1, ((event.clientY - rect.top) / rect.height) * map.height));
    return { x: Math.round(displayX), y: Math.round(displayY) };
  };

  const characterAtCanvasPoint = (event: { clientX: number; clientY: number }) => {
    const point = mapCoordinatesAtClientPoint(event);
    if (!map || !point) return undefined;
    let closest: { faction: string; character: ExtendedMapCharacter } | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of extendedCharacters) {
      const characterPoint = projectCharacterCoordinateToMap(map, candidate.character.x, candidate.character.y);
      if (!characterPoint) continue;
      const distance = (characterPoint.x - point.x) ** 2 + (characterPoint.y - point.y) ** 2;
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = candidate;
      }
    }
    return closestDistance <= 400 ? closest : undefined;
  };

  const handleMapClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressMapClickRef.current) {
      suppressMapClickRef.current = false;
      return;
    }
    if (showCharacters && extendedState) {
      const character = characterAtCanvasPoint(event);
      if (character) {
        setSelectedCharacterKey({ faction: character.faction, id: character.character.id });
        return;
      }
    }
    const marker = markerAtCanvasPoint(event);
    if (marker && isEditingFactions && brushFaction) paintRegion(marker.key, brushFaction);
    selectMapMarker(marker);
  };

  const handleMapContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditingFactions) return;
    event.preventDefault();
    const marker = markerAtCanvasPoint(event);
    if (!marker) return;
    paintRegion(marker.key, null);
    selectMapMarker(marker);
  };

  if (currentGame !== "wh3") {
    return (
      <div className="px-6 py-4 text-gray-300">
        {mapText("mapUnavailableForGame", "The campaign map is unavailable for this game.")}
      </div>
    );
  }

  return (
    <div className="flex h-[92vh] min-h-0 flex-col text-gray-200">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-700 px-4 py-2 text-sm">
        <span className="font-medium text-gray-100">{mapText("mapTitle", "Campaign map")}</span>
        <div
          className="flex rounded border border-gray-700 bg-gray-900 p-0.5"
          role="tablist"
          aria-label={mapText("mapView", "Map view")}
        >
          {(["regions", "factions", "climate"] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={mapView === view}
              onClick={() => setMapView(view)}
              className={`rounded px-2 py-1 text-xs ${
                mapView === view ? "bg-blue-800 text-gray-100" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
            >
              {view === "regions"
                ? mapText("mapRegions", "Regions")
                : view === "factions"
                  ? mapText("mapFactions", "Factions")
                  : mapText("mapClimate", "Climate")}
            </button>
          ))}
        </div>
        <label
          className="flex items-center gap-1 text-xs text-gray-400"
          title={mapText("mapCharactersHint", "Show and edit characters and armies")}
        >
          <input
            type="checkbox"
            checked={showCharacters}
            disabled={!extendedState}
            onChange={(event) => setShowCharacters(event.target.checked)}
            className="accent-blue-600"
          />
          {mapText("mapCharacters", "Characters")}
        </label>
        {extendedState && (
          <div className="flex items-center gap-2">
            <span className="rounded border border-emerald-700 bg-emerald-950/50 px-2 py-1 text-xs text-emerald-300">
              {mapText("mapExtendedFormat", "Extended map")}
            </span>
            <button
              type="button"
              onClick={undoExtendedEdit}
              disabled={extendedHistory.length === 0}
              className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40"
            >
              {mapText("mapUndo", "Undo")}
            </button>
            <button
              type="button"
              onClick={revertExtendedEdits}
              disabled={!extendedDelta || extendedDelta.actions.length === 0}
              className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40"
            >
              {mapText("mapRevertExtendedEdits", "Revert extended")}
            </button>
            {!!extendedDelta?.actions.length && (
              <span className="text-xs text-amber-300">{extendedDelta.actions.length} changed</span>
            )}
          </div>
        )}
        {map && campaignOptions.length > 0 && (
          <select
            value={mapCampaignName}
            onChange={(event) => {
              // The edits below are keyed by region, and another campaign has none of these regions.
              if (editedRegionCount > 0) {
                showOwnershipToast("info", [
                  mapMessage(
                    "mapOwnershipEditsCleared",
                    "{{count}} region ownership edit(s) dropped: campaign changed.",
                    {
                      count: editedRegionCount,
                    },
                  ),
                ]);
              }
              dispatch(setMapCampaignName(event.target.value));
            }}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
            aria-label={mapText("mapTitle", "Campaign map")}
          >
            {campaignOptions.map((campaign) => (
              <option key={campaign.key} value={campaign.key}>
                {campaign.label}
              </option>
            ))}
          </select>
        )}
        {map && map.settlementTypes.length > 0 && (
          <select
            value={selectedSettlementType}
            onChange={(event) => setSelectedSettlementType(event.target.value)}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
            aria-label={mapText("mapSettlementType", "Settlement type")}
          >
            <option value="">{mapText("mapNone", "(none)")}</option>
            {map.settlementTypes.map((settlementType) => (
              <option key={settlementType.key} value={settlementType.key}>
                {settlementType.label}
              </option>
            ))}
          </select>
        )}
        {map && mapView === "factions" && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={isEditingOwnership}
              onClick={() => setIsEditingOwnership((isEditing) => !isEditing)}
              title={mapText(
                "mapEditOwnershipHint",
                "Left click gives a region to the selected faction, right click empties it.",
              )}
              className={`rounded border px-2 py-1 text-xs ${
                isEditingOwnership
                  ? "border-blue-500 bg-blue-800 text-gray-100"
                  : "border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
            >
              {mapText("mapEditOwnership", "Edit ownership")}
            </button>
            {isEditingOwnership && (
              <>
                <button
                  type="button"
                  onClick={undoOwnershipEdit}
                  disabled={editHistory.length === 0}
                  title={mapText("mapUndoHint", "Undo (Ctrl+Z)")}
                  className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-gray-900"
                >
                  {mapText("mapUndo", "Undo")}
                </button>
                <button
                  type="button"
                  onClick={revertOwnershipEdits}
                  disabled={editedRegionCount === 0}
                  className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-gray-900"
                >
                  {mapText("mapRevertEdits", "Revert edits")}
                </button>
                {editedRegionCount > 0 && (
                  <span className="text-xs text-amber-300">
                    {mapMessage("mapEditedRegions", "{{count}} edited", { count: editedRegionCount })}
                  </span>
                )}
              </>
            )}
            <button
              type="button"
              onClick={importOwnership}
              disabled={isTransferringOwnership}
              className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-gray-900"
            >
              {mapText("mapImportOwnership", "Import…")}
            </button>
            <button
              type="button"
              onClick={exportOwnership}
              disabled={isTransferringOwnership}
              className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-gray-900"
            >
              {mapText("mapExportOwnership", "Export…")}
            </button>
          </div>
        )}
        {map && (
          <span className="text-xs text-gray-500">
            {mapMessage(
              "mapRegionSummary",
              "{{width}}×{{height}} · {{regionCount}} regions · {{ownedRegionCount}} owned",
              {
                width: map.width,
                height: map.height,
                regionCount: map.regionCount,
                ownedRegionCount: map.ownedRegionCount,
              },
            )}
          </span>
        )}
        {isLoading && (
          <span className="text-xs text-blue-300">{mapText("mapReadingEsfData", "Reading ESF data…")}</span>
        )}
        {extendedLoading && extendedState && (
          <span className="text-xs text-blue-300">{mapText("mapReadingExtendedData", "Reading unit roster…")}</span>
        )}
      </div>

      {error && <div className="px-4 py-2 text-sm text-red-400">{error}</div>}

      {map && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem] gap-3 p-3">
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-gray-700 bg-gray-950">
            <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-2 text-xs text-gray-400">
              <button
                type="button"
                onClick={() => changeZoom(zoom / 1.2)}
                className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => changeZoom(1)}
                className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700"
              >
                {mapText("mapReset", "Reset")}
              </button>
              <button
                type="button"
                onClick={() => changeZoom(zoom * 1.2)}
                className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700"
              >
                +
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              {characterMapOverlayActive && (
                <div className="flex shrink-0 items-center gap-2 text-[0.7rem] text-gray-300" aria-label="Map terrain">
                  {(
                    [
                      ["unusable", mapText("mapTerrainUnusable", "Unusable")],
                      ["sea", mapText("mapTerrainSea", "Sea")],
                      ["river", mapText("mapTerrainRiver", "River")],
                      ["beach", mapText("mapTerrainBeach", "Beach")],
                    ] as const
                  ).map(([terrain, label]) => (
                    <span key={terrain} className="flex items-center gap-1" title={label}>
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm border border-black/60"
                        style={{ backgroundColor: CHARACTER_TERRAIN_COLOURS[terrain] }}
                      />
                      {label}
                    </span>
                  ))}
                </div>
              )}
              <span className="ml-auto truncate" title={map.mapDataPath}>
                {map.mapDataPath}
              </span>
            </div>
            <div className="relative min-h-0 flex-1">
              <div ref={canvasWrapRef} className="h-full overflow-auto p-3">
                <div
                  className="relative inline-block align-top"
                  style={{ width: mapDisplayWidth, height: mapDisplayHeight }}
                >
                  <div
                    ref={mapSurfaceRef}
                    className="relative"
                    style={{
                      width: map ? `${map.width}px` : undefined,
                      height: map ? `${map.height}px` : undefined,
                      transform: `scale(${mapScaleX}, ${mapScaleY})`,
                      transformOrigin: "top left",
                      willChange: "transform",
                    }}
                  >
                    <canvas
                      ref={canvasRef}
                      onPointerDown={beginMapDrag}
                      onPointerMove={moveMapDrag}
                      onPointerUp={endMapDrag}
                      onPointerCancel={endMapDrag}
                      onClick={handleMapClick}
                      onContextMenu={handleMapContextMenu}
                      style={{
                        width: map ? `${map.width}px` : undefined,
                        height: map ? `${map.height}px` : undefined,
                      }}
                      className={`block ${isDraggingMap ? "cursor-grabbing" : isEditingFactions ? "cursor-crosshair" : "cursor-grab"} touch-none select-none rounded border border-gray-700 bg-slate-950`}
                    />
                  </div>
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 top-0 z-10"
                    style={{
                      width: mapDisplayWidthPx,
                      height: mapDisplayHeightPx,
                      display: characterMapOverlayActive ? "block" : "none",
                    }}
                  >
                    {characterMapMarkers.map((marker) => (
                      <div
                        key={marker.key}
                        className="absolute overflow-hidden rounded-full"
                        style={{
                          left: marker.x - marker.radiusX,
                          top: marker.y - marker.radiusY,
                          width: marker.radiusX * 2,
                          height: marker.radiusY * 2,
                          border: `${marker.borderWidth}px solid rgba(0, 0, 0, 0.95)`,
                          backgroundColor: factionColour(marker.faction.toLowerCase()),
                          boxShadow: marker.selected ? "0 0 0 3px #facc15" : undefined,
                          boxSizing: "border-box",
                        }}
                      >
                        {marker.thumbnailSource && (
                          <img
                            src={marker.thumbnailSource}
                            alt=""
                            draggable={false}
                            className="block h-full w-full rounded-full object-cover"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded border border-gray-700 bg-gray-900">
            <div className="border-b border-gray-800 px-3 py-2 text-sm text-gray-300">
              {mapView === "factions"
                ? isEditingOwnership
                  ? brushFaction
                    ? mapMessage("mapPaintingAs", "Painting as {{faction}}", {
                        faction: factionsByKey.get(brushFactionKey ?? "")?.label ?? brushFaction,
                      })
                    : mapText("mapPickFactionToPaint", "Pick a faction to paint with")
                  : mapMessage("mapFactionSummary", "{{count}} factions · flags at settlements", {
                      count: landholdingFactionCount,
                    })
                : mapView === "climate"
                  ? mapMessage("mapClimateSummary", "{{count}} climates · colours at settlements", {
                      count: map.climates.length,
                    })
                  : map.startposWasCompressed
                    ? mapText("mapCompressedStartpos", "Compressed startpos decoded")
                    : mapText("mapStartposLoaded", "Startpos loaded")}
              <div className="mt-1 truncate text-[0.75rem] text-gray-400" title={map.startposPath}>
                {map.startposPath}
              </div>
            </div>
            {selectedMarker && (
              <div className="border-b border-gray-800 px-3 py-2 text-sm">
                <div className="font-medium text-gray-100">{selectedMarker.key}</div>
                <div className="mt-1 text-gray-300">
                  {selectedMarker.ownerFaction ?? mapText("mapUnowned", "Unowned")}
                  {selectedMarker.subculture ? ` · ${selectedMarker.subculture}` : ""}
                </div>
                {selectedMarker.settlementKey && (
                  <div className="text-[0.8125rem] text-gray-400">{selectedMarker.settlementKey}</div>
                )}
                {map.climatesByRegion[selectedMarker.key] && (
                  <div className="text-[0.8125rem] text-gray-400">
                    {mapText("mapClimate", "Climate")}:{" "}
                    {climateByKey.get(map.climatesByRegion[selectedMarker.key]!.toLowerCase())?.label ??
                      map.climatesByRegion[selectedMarker.key]}
                  </div>
                )}
              </div>
            )}
            {extendedState && selectedExtendedBuildingSlots && (
              <div className="border-b border-gray-800 px-3 py-2 text-sm">
                <div className="mb-1 flex items-center gap-2 font-medium text-gray-200">
                  <span>{mapText("mapBuildings", "Settlement buildings")}</span>
                  {buildingsView?.maxSlotCount !== undefined && (
                    <span className="text-xs font-normal text-gray-500">{buildingsView.maxSlotCount} slots</span>
                  )}
                </div>
                {selectedExtendedBuildingSlots.map((slot, slotIndex) => {
                  const allTiles =
                    buildingsView?.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles)) ?? [];
                  const currentTile = allTiles.find((tile) => tile.levelKey === slot.building);
                  const currentChainKey = currentTile?.chainKey;
                  const tiles = allTiles.filter(
                    (tile) =>
                      (!tile.slotTypes ||
                        tile.slotTypes.length === 0 ||
                        tile.slotTypes.some((slotType) => slotType.toLowerCase() === slot.type.toLowerCase())) &&
                      (!tile.slotTemplates ||
                        tile.slotTemplates.length === 0 ||
                        tile.slotTemplates.some(
                          (slotTemplate) => slotTemplate.toLowerCase() === slot.template.toLowerCase(),
                        )) &&
                      (!slot.building || tile.levelKey === slot.building || tile.chainKey === currentChainKey),
                  );
                  const selectableTiles = tiles.filter((tile) => !tile.hasNoVariant || tile.levelKey === slot.building);
                  const options = new Map<string, string>();
                  options.set("", mapText("mapEmptyBuilding", "(empty)"));
                  if (slot.building && !options.has(slot.building)) options.set(slot.building, slot.building);
                  for (const tile of selectableTiles) {
                    const title = tile.title || tile.levelKey;
                    const level = tile.romanNumeral || tile.level;
                    options.set(tile.levelKey, `${title} (${level})`);
                  }
                  return (
                    <label
                      key={`${slot.template}-${slot.type}-${slotIndex}`}
                      className="mb-1 flex items-center gap-1 text-xs text-gray-400"
                    >
                      <span className="w-16 shrink-0 truncate" title={`${slot.type} · ${slot.template}`}>
                        {slot.type}
                      </span>
                      <select
                        value={slot.building}
                        disabled={!buildingsView}
                        onChange={(event) => {
                          const building = event.target.value;
                          const region = selectedExtendedRegion;
                          if (!region?.buildings) return;
                          const actions: ExtendedMapEditAction[] = [];
                          for (let index = region.buildings.length; index <= slotIndex; index += 1) {
                            const slotToAdd = selectedExtendedBuildingSlots[index];
                            if (!slotToAdd) return;
                            actions.push({
                              type: "add_building_slot",
                              region: region.region,
                              slotIndex: index,
                              building: slotToAdd,
                            });
                          }
                          actions.push({
                            type: "set_building",
                            region: region.region,
                            slotIndex,
                            building: { ...slot, building },
                          });
                          updateExtendedDocuments(actions);
                        }}
                        className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-1 py-1 text-xs text-gray-200 disabled:opacity-50"
                        aria-label={`${mapText("mapBuildingSlot", "Building slot")} ${slotIndex + 1}`}
                      >
                        {[...options.entries()].map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                      {currentTile && <span className="text-[0.65rem] text-gray-500">{currentTile.romanNumeral}</span>}
                    </label>
                  );
                })}
                {!buildingsView && (
                  <div className="mt-1 text-xs text-gray-500">
                    {mapText("mapLoadingBuildings", "Loading building choices…")}
                  </div>
                )}
              </div>
            )}
            {extendedState && selectedCharacter && (
              <div className="min-h-0 overflow-y-auto border-b border-gray-800 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate font-medium text-yellow-200">
                    {selectedCharacter.character.subtype}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCharacterKey(undefined)}
                    className="rounded border border-gray-700 px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-800"
                    aria-label={mapText("mapCloseCharacter", "Close character")}
                  >
                    ×
                  </button>
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {selectedCharacter.faction} · ID {selectedCharacter.character.id}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-1">
                    {mapText("mapRank", "Rank")}
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={selectedCharacter.character.rank}
                      onChange={(event) =>
                        updateExtendedDocument({
                          type: "update_character",
                          faction: selectedCharacter.faction,
                          characterId: selectedCharacter.character.id,
                          changes: { rank: Number(event.target.value) },
                        })
                      }
                      className="w-16 rounded border border-gray-700 bg-gray-950 px-1 py-0.5 text-gray-200"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    {mapText("mapSubtype", "Subtype")}
                    {selectedCharacter.character.units?.[0] ? (
                      <select
                        value={selectedCharacter.character.subtype}
                        onChange={(event) => {
                          const option = lordOptions.find((candidate) => candidate.subtype === event.target.value);
                          if (!option) return;
                          const faction = factionsByKey.get(selectedCharacter.faction.toLowerCase());
                          updateExtendedDocuments([
                            {
                              type: "update_character",
                              faction: selectedCharacter.faction,
                              characterId: selectedCharacter.character.id,
                              changes: { subtype: option.subtype },
                            },
                            {
                              type: "update_unit",
                              faction: selectedCharacter.faction,
                              characterId: selectedCharacter.character.id,
                              unitId: selectedCharacter.character.units![0].id,
                              changes: { unit_key: associatedUnitForSubculture(option, faction?.subculture) },
                            },
                          ]);
                        }}
                        className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-1 py-0.5 text-gray-200"
                      >
                        {!lordOptions.some((option) => option.subtype === selectedCharacter.character.subtype) && (
                          <option value={selectedCharacter.character.subtype}>
                            {selectedCharacter.character.subtype}
                          </option>
                        )}
                        {lordOptions
                          .filter(
                            (option) =>
                              !factionsByKey.get(selectedCharacter.faction.toLowerCase())?.subculture ||
                              option.subcultureKeys.some(
                                (key) =>
                                  key.toLowerCase() ===
                                  factionsByKey.get(selectedCharacter.faction.toLowerCase())?.subculture?.toLowerCase(),
                              ),
                          )
                          .map((option) => (
                            <option key={option.subtype} value={option.subtype}>
                              {formatSubtypeOption(option)}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-mono text-gray-300">
                        {selectedCharacter.character.subtype}
                      </span>
                    )}
                  </label>
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {mapText("mapCoordinates", "Coordinates")}: {selectedCharacter.character.x},{" "}
                  {selectedCharacter.character.y}
                  {selectedCharacter.character.x === 65535 || selectedCharacter.character.y === 65535
                    ? ` · ${mapText("mapOffMap", "off map")}`
                    : ""}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                  {(["x", "y"] as const).map((coordinate) => (
                    <label key={coordinate} className="flex items-center gap-1">
                      {coordinate.toUpperCase()}
                      <input
                        type="number"
                        min={0}
                        max={65535}
                        value={selectedCharacter.character[coordinate]}
                        onChange={(event) =>
                          updateExtendedDocument({
                            type: "update_character",
                            faction: selectedCharacter.faction,
                            characterId: selectedCharacter.character.id,
                            changes: { [coordinate]: Number(event.target.value) },
                          })
                        }
                        className="w-20 rounded border border-gray-700 bg-gray-950 px-1 py-0.5 text-gray-200"
                        aria-label={`${mapText("mapCoordinate", "Coordinate")} ${coordinate.toUpperCase()}`}
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateExtendedDocument({
                        type: "update_character",
                        faction: selectedCharacter.faction,
                        characterId: selectedCharacter.character.id,
                        changes: { x: 65535, y: 65535 },
                      })
                    }
                    className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
                  >
                    {mapText("mapMoveOffMap", "Move off map")}
                  </button>
                </div>
                {selectedCharacter.character.units && (
                  <div className="mt-3">
                    <div className="mb-1 text-xs font-medium text-gray-300">
                      {mapMessage("mapArmySummary", "Army ({{count}}/20)", {
                        count: selectedCharacter.character.units.length,
                      })}
                    </div>
                    {selectedCharacter.character.units.map((unit, index) => {
                      const mapFaction = factionsByKey.get(selectedCharacter.faction.toLowerCase());
                      const factionSubculture = mapFaction?.subculture?.toLowerCase();
                      const unitOptions = resolveExtendedUnitOptions(unitCatalog, mapFaction?.subculture, index === 0);
                      const leaderUnitKeys =
                        index === 0
                          ? new Set(
                              lordOptions
                                .filter(
                                  (option) =>
                                    !factionSubculture ||
                                    option.subcultureKeys.some((key) => key.toLowerCase() === factionSubculture),
                                )
                                .map((option) => associatedUnitForSubculture(option, mapFaction?.subculture)),
                            )
                          : undefined;
                      const selectableUnitOptions = leaderUnitKeys
                        ? unitOptions.filter((option) => leaderUnitKeys.has(option.key))
                        : unitOptions;
                      return (
                        <div key={unit.id} className="mb-1 rounded border border-gray-800 bg-gray-950/60 p-1.5">
                          <div className="flex items-center gap-1">
                            <select
                              value={unit.unit_key}
                              onChange={(event) => {
                                const nextKey = event.target.value;
                                const faction = factionsByKey.get(selectedCharacter.faction.toLowerCase());
                                const factionSubculture = faction?.subculture?.toLowerCase();
                                const leaderOption =
                                  index === 0
                                    ? lordOptions.find(
                                        (option) =>
                                          associatedUnitForSubculture(option, faction?.subculture) === nextKey &&
                                          (!factionSubculture ||
                                            option.subcultureKeys.some(
                                              (key) => key.toLowerCase() === factionSubculture,
                                            )),
                                      )
                                    : undefined;
                                updateExtendedDocuments([
                                  ...(leaderOption
                                    ? [
                                        {
                                          type: "update_character" as const,
                                          faction: selectedCharacter.faction,
                                          characterId: selectedCharacter.character.id,
                                          changes: { subtype: leaderOption.subtype },
                                        },
                                      ]
                                    : []),
                                  {
                                    type: "update_unit",
                                    faction: selectedCharacter.faction,
                                    characterId: selectedCharacter.character.id,
                                    unitId: unit.id,
                                    changes: { unit_key: nextKey },
                                  },
                                ]);
                              }}
                              className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-1 py-0.5 text-xs text-gray-200"
                              aria-label={mapText("mapUnit", "Unit")}
                            >
                              {!selectableUnitOptions.some((option) => option.key === unit.unit_key) && (
                                <option value={unit.unit_key}>{unit.unit_key}</option>
                              )}
                              {selectableUnitOptions.map((option) => (
                                <option key={option.key} value={option.key}>
                                  {option.name}
                                </option>
                              ))}
                            </select>
                            {index > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateExtendedDocument({
                                    type: "remove_unit",
                                    faction: selectedCharacter.faction,
                                    characterId: selectedCharacter.character.id,
                                    unitId: unit.id,
                                  })
                                }
                                className="rounded px-1 text-red-300 hover:bg-red-950"
                                aria-label={mapText("mapRemoveUnit", "Remove unit")}
                              >
                                ×
                              </button>
                            )}
                          </div>
                          <div className="mt-1 grid grid-cols-2 gap-1 text-[0.7rem] text-gray-400">
                            <label className="flex items-center gap-1">
                              XP
                              <input
                                type="number"
                                min={0}
                                max={9}
                                value={unit.xp}
                                onChange={(event) =>
                                  updateExtendedDocument({
                                    type: "update_unit",
                                    faction: selectedCharacter.faction,
                                    characterId: selectedCharacter.character.id,
                                    unitId: unit.id,
                                    changes: { xp: Number(event.target.value) },
                                  })
                                }
                                className="w-12 rounded border border-gray-700 bg-gray-900 px-1 py-0.5 text-gray-200"
                              />
                            </label>
                            <label className="flex items-center gap-1">
                              {mapText("mapHealth", "Health")}
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={unit.health}
                                onChange={(event) =>
                                  updateExtendedDocument({
                                    type: "update_unit",
                                    faction: selectedCharacter.faction,
                                    characterId: selectedCharacter.character.id,
                                    unitId: unit.id,
                                    changes: { health: Number(event.target.value) },
                                  })
                                }
                                className="w-14 rounded border border-gray-700 bg-gray-900 px-1 py-0.5 text-gray-200"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                    {selectedCharacter.character.units.length > 0 && selectedCharacter.character.units.length < 20 && (
                      <select
                        value=""
                        onChange={(event) => {
                          if (!event.target.value) return;
                          updateExtendedDocument({
                            type: "add_unit",
                            faction: selectedCharacter.faction,
                            characterId: selectedCharacter.character.id,
                            unit: { unit_key: event.target.value },
                          });
                          event.currentTarget.value = "";
                        }}
                        className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-xs text-gray-300"
                        aria-label={mapText("mapAddUnit", "Add unit")}
                      >
                        <option value="">{mapText("mapAddUnit", "Add unit…")}</option>
                        {resolveExtendedUnitOptions(
                          unitCatalog,
                          factionsByKey.get(selectedCharacter.faction.toLowerCase())?.subculture,
                        ).map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                {selectedCharacter.character.units !== undefined && selectedCharacter.character.units.length === 0 && (
                  <select
                    value=""
                    onChange={(event) => {
                      const option = lordOptions.find((candidate) => candidate.subtype === event.target.value);
                      if (!option) return;
                      updateExtendedDocuments([
                        {
                          type: "update_character",
                          faction: selectedCharacter.faction,
                          characterId: selectedCharacter.character.id,
                          changes: { subtype: option.subtype },
                        },
                        {
                          type: "add_unit",
                          faction: selectedCharacter.faction,
                          characterId: selectedCharacter.character.id,
                          unit: {
                            unit_key: associatedUnitForSubculture(
                              option,
                              factionsByKey.get(selectedCharacter.faction.toLowerCase())?.subculture,
                            ),
                          },
                        },
                      ]);
                      event.currentTarget.value = "";
                    }}
                    className="mt-2 w-full rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-xs text-gray-300"
                    aria-label={mapText("mapAddLeader", "Add army leader")}
                  >
                    <option value="">{mapText("mapAddLeader", "Add army leader…")}</option>
                    {lordOptions
                      .filter(
                        (option) =>
                          !factionsByKey.get(selectedCharacter.faction.toLowerCase())?.subculture ||
                          option.subcultureKeys.some(
                            (key) =>
                              key.toLowerCase() ===
                              factionsByKey.get(selectedCharacter.faction.toLowerCase())?.subculture?.toLowerCase(),
                          ),
                      )
                      .map((option) => (
                        <option key={option.subtype} value={option.subtype}>
                          {formatSubtypeOption(option)}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            )}
            <div className="border-b border-gray-800 p-2">
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={
                  mapView === "factions"
                    ? mapText("mapFilterFactions", "Filter factions…")
                    : mapView === "climate"
                      ? mapText("mapFilterClimates", "Filter climates…")
                      : mapText("mapFilterRegions", "Filter regions…")
                }
                className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {extendedState && showCharacters && (
                <div className="mb-3 border-b border-gray-800 pb-2">
                  <div className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                    {mapText("mapCharacters", "Characters")}
                  </div>
                  {extendedCharacters
                    .filter(
                      ({ faction, character }) =>
                        !filter.trim() ||
                        `${faction} ${character.subtype} ${character.id}`
                          .toLowerCase()
                          .includes(filter.trim().toLowerCase()),
                    )
                    .map(({ faction, character }) => {
                      const selected =
                        selectedCharacterKey?.faction.toLowerCase() === faction.toLowerCase() &&
                        selectedCharacterKey.id === character.id;
                      const characterPoint = map
                        ? projectCharacterCoordinateToMap(map, character.x, character.y)
                        : undefined;
                      const inBounds = !!characterPoint;
                      return (
                        <button
                          key={`${faction}:${character.id}`}
                          type="button"
                          onClick={() => {
                            setSelectedCharacterKey({ faction, id: character.id });
                            if (characterPoint) centerMapOnPoint(characterPoint.x, characterPoint.y);
                          }}
                          className={`mb-1 block w-full rounded border px-2 py-1.5 text-left text-xs ${selected ? "border-yellow-500 bg-yellow-950/40 text-gray-100" : "border-transparent bg-gray-950/60 text-gray-300 hover:border-gray-600"}`}
                        >
                          <span className="block truncate">{character.subtype}</span>
                          <span className="block truncate text-[0.7rem] text-gray-500">
                            {faction} · ID {character.id}
                            {character.units ? ` · ${character.units.length}/20` : " · hero"}
                            {!inBounds ? ` · ${mapText("mapOffMap", "off map")}` : ""}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
              {mapView === "regions" ? (
                filteredMarkers.map((marker) => (
                  <button
                    key={`${marker.id}-${marker.key}`}
                    type="button"
                    ref={(element) => {
                      const key = `region:${marker.id}`;
                      if (element) mapListItemRefs.current.set(key, element);
                      else mapListItemRefs.current.delete(key);
                    }}
                    onClick={() => selectMapMarker(marker, true)}
                    className={`mb-1 block w-full rounded border px-2 py-1.5 text-left text-sm ${
                      selectedMarkerId === marker.id
                        ? "border-blue-500 bg-blue-950/60 text-gray-100"
                        : "border-transparent bg-gray-950/60 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    <span className="block truncate">{marker.key}</span>
                    <span className="block truncate text-[0.8125rem] text-gray-400">
                      {marker.ownerFaction ?? mapText("mapUnowned", "Unowned")}
                    </span>
                  </button>
                ))
              ) : mapView === "climate" ? (
                <>
                  <button
                    type="button"
                    aria-pressed={isAllClimateSelected}
                    ref={(element) => {
                      const key = "climate:all";
                      if (element) mapListItemRefs.current.set(key, element);
                      else mapListItemRefs.current.delete(key);
                    }}
                    onClick={() => setClimateSelectionKey(null)}
                    className={`mb-1 flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm ${
                      isAllClimateSelected
                        ? "border-blue-500 bg-blue-950/60 text-gray-100"
                        : "border-transparent bg-gray-950/60 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm border border-white/40"
                      style={{
                        background: "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{mapText("mapAllClimates", "All climates")}</span>
                      <span className="block truncate text-[0.8125rem] text-gray-400">
                        {mapMessage("mapAllClimateSummary", "{{count}} climates", {
                          count: map.climates.length,
                        })}
                      </span>
                    </span>
                  </button>
                  {filteredClimates.map((climate) => {
                    const isSelected = !isAllClimateSelected && selectedClimateForSidebar === climate.key.toLowerCase();
                    return (
                      <button
                        key={climate.key}
                        type="button"
                        aria-pressed={isSelected}
                        ref={(element) => {
                          const key = `climate:${climate.key.toLowerCase()}`;
                          if (element) mapListItemRefs.current.set(key, element);
                          else mapListItemRefs.current.delete(key);
                        }}
                        onClick={() => setClimateSelectionKey(climate.key)}
                        className={`mb-1 flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm ${
                          isSelected
                            ? "border-blue-500 bg-blue-950/60 text-gray-100"
                            : "border-transparent bg-gray-950/60 text-gray-300 hover:border-gray-600"
                        }`}
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm border border-white/40"
                          style={{
                            backgroundColor: `rgb(${climate.colour[0]}, ${climate.colour[1]}, ${climate.colour[2]})`,
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block truncate">{climate.label}</span>
                          <span className="block truncate text-[0.8125rem] text-gray-400">
                            {mapMessage(
                              climate.regionCount === 1 ? "mapClimateRegionOne" : "mapClimateRegionOther",
                              climate.regionCount === 1 ? "{{count}} region · {{key}}" : "{{count}} regions · {{key}}",
                              { count: climate.regionCount, key: climate.key },
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </>
              ) : (
                filteredFactions.map((faction) => {
                  const isSelected = isEditingFactions
                    ? brushFactionKey === faction.key.toLowerCase()
                    : factionKey(selectedMarker?.ownerFaction) === faction.key.toLowerCase();
                  return (
                    <button
                      key={faction.key}
                      type="button"
                      ref={(element) => {
                        const key = `faction:${faction.key.toLowerCase()}`;
                        if (element) mapListItemRefs.current.set(key, element);
                        else mapListItemRefs.current.delete(key);
                      }}
                      aria-pressed={isEditingFactions ? isSelected : undefined}
                      onClick={() =>
                        isEditingFactions ? setBrushFaction(faction.key) : selectMapFaction(faction.key.toLowerCase())
                      }
                      className={`mb-1 flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm ${
                        isSelected
                          ? "border-blue-500 bg-blue-950/60 text-gray-100"
                          : "border-transparent bg-gray-950/60 text-gray-300 hover:border-gray-600"
                      }`}
                    >
                      {faction.flagUrl ? (
                        <img src={faction.flagUrl} alt="" loading="lazy" className="h-6 w-6 shrink-0 object-contain" />
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-gray-500" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate">{faction.label}</span>
                        <span className="block truncate text-[0.8125rem] text-gray-400">
                          {mapMessage(
                            faction.regionCount === 1 ? "mapFactionRegionOne" : "mapFactionRegionOther",
                            faction.regionCount === 1 ? "{{count}} region · {{key}}" : "{{count}} regions · {{key}}",
                            { count: faction.regionCount, key: faction.key },
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
              {(mapView === "regions"
                ? filteredMarkers.length
                : mapView === "climate"
                  ? filteredClimates.length
                  : filteredFactions.length) === 0 && (
                <div className="px-2 py-3 text-sm text-gray-400">
                  {mapView === "factions"
                    ? mapText("mapNoMatchingFactions", "No matching factions.")
                    : mapView === "climate"
                      ? mapText("mapNoMatchingClimates", "No matching climates.")
                      : mapText("mapNoMatchingRegions", "No matching regions.")}
                </div>
              )}
              {mapView === "factions" && isEditingOwnership && (
                <div className="px-2 py-3 text-[0.8125rem] text-gray-500">
                  {hiddenFactionCount > 0
                    ? mapMessage("mapMoreFactionsMatch", "{{count}} more match. Narrow the filter to reach them.", {
                        count: hiddenFactionCount,
                      })
                    : mapText("mapFilterForLandlessFactions", "Filter by name to reach factions that hold no land.")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!map && isLoading && (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
          {mapText("mapLoading", "Loading campaign map…")}
        </div>
      )}
    </div>
  );
});

export default EsfMapTab;
