import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { Modal } from "../flowbite";
import { addToast, clearMapRegionSelection, selectMapRegion, setMapCampaignName } from "../appSlice";
import { unitAssetUrl } from "../assetUrls";
import { useLocalizations } from "../localizationContext";
import { useDeferredWhileInactive } from "./useDeferredWhileInactive";
import {
  applyOwnershipEdits,
  formatRegionOwnershipJson,
  ownershipEditsFromImport,
  regionOwnership,
} from "../esfMap/ownership";
import type { OwnershipEdits } from "../esfMap/ownership";
import type { EsfMapArea, EsfMapCampaignOption, EsfMapMarker, EsfMapPayload } from "../esfMap/types";
import { computeRegionGeometricCenters } from "../esfMap/geometry";
import { nextFactionRegionMarker } from "../esfMap/navigation";
import { mapPointToCharacterCoordinate, projectCharacterCoordinateToMap } from "../esfMap/coordinates";
import {
  CHARACTER_TERRAIN_COLOURS,
  drawCharacterTerrainAreas,
  snapCharacterPointToUsable,
} from "../esfMap/pathfinding";
import {
  applyExtendedMapEdit,
  buildExtendedMapExport,
  buildExtendedMapDelta,
  cloneExtendedMap,
  cloneExtendedMapEditState,
  createExtendedMapEditState,
  fillExtendedBuildingSlots,
  formatExtendedMapExportJson,
  groupExtendedUnitOptionsByCaste,
  parseMapFile,
  resolveExtendedUnitOptions,
  type ExtendedMapCharacter,
  type ExtendedMapDeltaAction,
  type ExtendedMapDiplomacyField,
  type ExtendedMapEditAction,
  type ExtendedMapEditState,
} from "../esfMap/extended";
import type { BuildingsRegionView } from "../buildingsData/types";
import type {
  UnitViewerCatalogUnit,
  UnitViewerCharacterExperienceData,
  UnitViewerLordOption,
} from "../unitViewer/types";

type EsfMapTabProps = {
  isActive?: boolean;
};

const MAP_AREA_OPACITY = 0.36;
const OWNERSHIP_EDIT_TERRAIN_OPACITY = 0.3;
const OWNERSHIP_EDIT_CHARACTER_OPACITY = 0.45;
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

type MapEditPanel = "ownership" | "extended";

type OwnershipEditEntry = {
  region: string;
  before: string | null;
  after: string | null;
};

type ExtendedMapImportUndo = {
  ownershipBaseline: OwnershipEdits;
  ownershipEdits: OwnershipEdits;
  editHistory: OwnershipEdits[];
  extendedState?: ExtendedMapEditState;
  extendedHistory: ExtendedMapEditState[];
  showCharacters: boolean;
  selectedCharacterKey?: { faction: string; id: number };
  selectedFactionKey?: string;
};

type DiplomacyRelationship = ExtendedMapDiplomacyField;

type MapContextMenu = {
  left: number;
  top: number;
  source: "map" | "faction";
  targetFaction?: string;
  region?: EsfMapMarker;
  mapPoint?: { x: number; y: number };
};

type NewForceDraft = {
  faction: string;
  subtype: string;
  x: number;
  y: number;
  units: string[];
};

const DIPLOMACY_RELATIONSHIPS: readonly DiplomacyRelationship[] = [
  "mil_ally",
  "non_aggression",
  "trade",
  "war",
  "vassals",
  "mil_access",
  "def_ally",
];

const diplomacyRelationshipLabelKey = (relationship: DiplomacyRelationship) => `mapDiplomacy_${relationship}`;

const diplomacyRelationshipFallback = (relationship: DiplomacyRelationship) => {
  const labels: Record<DiplomacyRelationship, string> = {
    mil_ally: "Military alliance",
    non_aggression: "Non-aggression pact",
    trade: "Trade agreement",
    war: "At war",
    vassals: "Vassals",
    mil_access: "Military access",
    def_ally: "Defensive alliance",
  };
  return labels[relationship];
};

const extendedEditActionKey = (action: ExtendedMapDeltaAction, index: number) => {
  const target =
    "region" in action
      ? action.region
      : "targetFaction" in action
        ? `${action.faction}:${action.targetFaction}`
        : `${action.faction}:${action.type === "add_character" ? action.character.id : action.characterId}`;
  const detail =
    "unitId" in action
      ? action.unitId
      : "slotIndex" in action
        ? action.slotIndex
        : "index" in action
          ? action.index
          : action.type;
  return `${index}:${action.type}:${target}:${detail}`;
};

const cloneExtendedCharacter = (character: ExtendedMapCharacter): ExtendedMapCharacter => ({
  ...character,
  ...(character.units ? { units: character.units.map((unit) => ({ ...unit })) } : {}),
});

/** Applies the inverse of one baseline delta action while preserving every other current edit. */
const revertExtendedDeltaAction = (
  state: ExtendedMapEditState,
  action: ExtendedMapDeltaAction,
): ExtendedMapEditState | undefined => {
  const next = cloneExtendedMapEditState(state);
  const document = next.document;

  if (action.type === "set_building" || action.type === "add_building_slot") {
    const region = document.regions.find((candidate) => candidate.region.toLowerCase() === action.region.toLowerCase());
    if (!region?.buildings) return undefined;
    if (action.type === "set_building") {
      if (!region.buildings[action.slotIndex]) return undefined;
      region.buildings[action.slotIndex] = { ...action.before };
    } else {
      const current = region.buildings[action.slotIndex];
      if (!current || JSON.stringify(current) !== JSON.stringify(action.building)) return undefined;
      region.buildings.splice(action.slotIndex, 1);
    }
    return next;
  }

  const group = next.document.faction_to_chars.find(
    (candidate) => candidate.faction.toLowerCase() === action.faction.toLowerCase(),
  );
  const character =
    "characterId" in action ? group?.chars.find((candidate) => candidate.id === action.characterId) : undefined;

  if (action.type === "set_diplomacy") {
    const source = next.document.faction_to_chars.find(
      (candidate) => candidate.faction.toLowerCase() === action.faction.toLowerCase(),
    );
    const target = next.document.faction_to_chars.find(
      (candidate) => candidate.faction.toLowerCase() === action.targetFaction.toLowerCase(),
    );
    if (!source || !target) return undefined;
    const fields = new Set<ExtendedMapDiplomacyField>([...action.before, ...action.after]);
    for (const field of fields) {
      source.diplo[field] = source.diplo[field].filter((entry) => entry.toLowerCase() !== target.faction.toLowerCase());
      target.diplo[field] = target.diplo[field].filter((entry) => entry.toLowerCase() !== source.faction.toLowerCase());
    }
    for (const field of action.before) {
      source.diplo[field].push(target.faction);
      if (field !== "vassals") target.diplo[field].push(source.faction);
    }
    return next;
  }

  if (action.type === "confederate") {
    const pendingIndex = next.pendingConfederations.findIndex(
      (entry) =>
        entry.faction.toLowerCase() === action.faction.toLowerCase() &&
        entry.targetFaction.toLowerCase() === action.targetFaction.toLowerCase(),
    );
    if (pendingIndex < 0) return undefined;
    next.pendingConfederations.splice(pendingIndex, 1);
    return next;
  }

  if (action.type === "add_character") {
    const addedCharacter = group?.chars.find((candidate) => candidate.id === action.character.id);
    if (!group || !addedCharacter) return undefined;
    group.chars.splice(
      group.chars.findIndex((candidate) => candidate.id === action.character.id),
      1,
    );
    return next;
  }

  if (action.type === "remove_character") {
    if (!group || character) return undefined;
    group.chars.splice(
      Math.min(Math.max(action.index, 0), group.chars.length),
      0,
      cloneExtendedCharacter(action.character),
    );
    return next;
  }

  if (!character) return undefined;
  if (action.type === "update_character") {
    for (const field of ["x", "y", "rank", "subtype"] as const) {
      const change = action.changes[field];
      if (!change) continue;
      if (field === "subtype") character.subtype = String(change.before);
      else character[field] = Number(change.before);
    }
    return next;
  }

  if (!character.units) character.units = [];
  if (action.type === "add_unit") {
    const unitIndex = character.units.findIndex((unit) => unit.id === action.unit.id);
    if (unitIndex < 0) return undefined;
    character.units.splice(unitIndex, 1);
    return next;
  }
  if (action.type === "remove_unit") {
    if (character.units.some((unit) => unit.id === action.unit.id)) return undefined;
    character.units.splice(Math.min(Math.max(action.index, 0), character.units.length), 0, { ...action.unit });
    return next;
  }

  const unit = character.units.find((candidate) => candidate.id === action.unitId);
  if (!unit) return undefined;
  for (const field of ["unit_key", "xp", "health"] as const) {
    const change = action.changes[field];
    if (!change) continue;
    if (field === "unit_key") unit.unit_key = String(change.before);
    else unit[field] = Number(change.before);
  }
  return next;
};

const extendedEditActionTitle = (action: ExtendedMapDeltaAction) => {
  if (action.type === "set_building" || action.type === "add_building_slot") return `Building · ${action.region}`;
  if (action.type === "set_diplomacy") return `Diplomacy · ${action.faction} → ${action.targetFaction}`;
  if (action.type === "confederate") return `Confederation · ${action.faction} → ${action.targetFaction}`;
  if (action.type === "update_character" || action.type === "remove_character" || action.type === "add_character")
    return `Character · ${action.faction} · ID ${action.type === "add_character" ? action.character.id : action.characterId}`;
  return `Unit · ${action.faction} · character ID ${action.characterId}`;
};

const formatChangeList = (
  fields: readonly string[],
  changes: Partial<Record<string, { before: number | string; after: number | string }>>,
) =>
  fields
    .flatMap((field) => {
      const change = changes[field];
      return change ? [`${field}: ${String(change.before)} → ${String(change.after)}`] : [];
    })
    .join(" · ");

const extendedEditActionDescription = (action: ExtendedMapDeltaAction) => {
  if (action.type === "set_building")
    return `Slot ${action.slotIndex + 1}: ${action.before.building || "(empty)"} → ${action.after.building || "(empty)"}`;
  if (action.type === "add_building_slot")
    return `Added slot ${action.slotIndex + 1}: ${action.building.building || "(empty)"}`;
  if (action.type === "update_character") return formatChangeList(["x", "y", "rank", "subtype"], action.changes);
  if (action.type === "add_character") return `Added ${action.character.subtype}`;
  if (action.type === "remove_character") return `Removed ${action.character.subtype}`;
  if (action.type === "set_diplomacy") {
    const before = action.before.length > 0 ? action.before.join(", ") : "none";
    const after = action.after.length > 0 ? action.after.join(", ") : "none";
    return `${before} → ${after}`;
  }
  if (action.type === "confederate") return `Queued ${action.targetFaction} to join ${action.faction}`;
  if (action.type === "add_unit") return `Added unit: ${action.unit.unit_key}`;
  if (action.type === "remove_unit") return `Removed unit: ${action.unit.unit_key}`;
  if (action.type === "update_unit") return formatChangeList(["unit_key", "xp", "health"], action.changes);
  return "";
};

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
  const mapListItemRefs = useRef(new Map<string, HTMLElement>());
  const mapImagesRef = useRef(new Map<string, HTMLImageElement>());
  const mapImageLoadsRef = useRef(new Map<string, Promise<HTMLImageElement | undefined>>());
  const characterThumbnailSourcesRef = useRef(new Set<string>());
  const characterThumbnailPathsRef = useRef<string[]>([]);
  const characterThumbnailSessionRef = useRef<string>();
  /** Keeps click cycling tied to one pointer gesture, even if React replays an event. */
  const characterClickGestureRef = useRef<{
    pointerId: number;
    selectionBeforePointerDown?: { faction: string; id: number };
    clickHandled: boolean;
  }>();
  const factionRegionCycleRef = useRef<{ factionKey: string; markerId: number }>();
  const factionFlagClickTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mapContextMenuRef = useRef<HTMLDivElement>(null);
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
  /** Explicit diplomacy source selection; unlike the map marker this can represent a landless faction. */
  const [selectedFactionKey, setSelectedFactionKey] = useState<string>();
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
  /** Ownership imported with an extended map is the clean baseline for subsequent ownership edits. */
  const [ownershipBaseline, setOwnershipBaseline] = useState<OwnershipEdits>({});
  const [ownershipEdits, setOwnershipEdits] = useState<OwnershipEdits>({});
  const [editHistory, setEditHistory] = useState<OwnershipEdits[]>([]);
  const [isTransferringOwnership, setIsTransferringOwnership] = useState(false);
  /** Extended map data is kept separate from ESF ownership so legacy map.json remains unchanged. */
  const [extendedState, setExtendedState] = useState<ExtendedMapEditState>();
  const [extendedHistory, setExtendedHistory] = useState<ExtendedMapEditState[]>([]);
  const [extendedImportUndo, setExtendedImportUndo] = useState<ExtendedMapImportUndo>();
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
  const [characterExperience, setCharacterExperience] = useState<UnitViewerCharacterExperienceData>();
  const [unitViewerSessionId, setUnitViewerSessionId] = useState<string>();
  const [resolvedCharacterThumbnailPaths, setResolvedCharacterThumbnailPaths] = useState<string[]>([]);
  const [extendedLoading, setExtendedLoading] = useState(false);
  const [openEditPanel, setOpenEditPanel] = useState<MapEditPanel>();
  const [mapContextMenu, setMapContextMenu] = useState<MapContextMenu>();
  const [newForceDraft, setNewForceDraft] = useState<NewForceDraft>();

  const mapText = (key: string, fallback: string) => localized[key] || fallback;
  const mapMessage = (key: string, fallback: string, values: Record<string, string | number>) =>
    interpolateMapText(mapText(key, fallback), values);

  const factionsByKey = useMemo(
    () => new Map((baseMap?.factions ?? []).map((faction) => [faction.key.toLowerCase(), faction])),
    [baseMap],
  );
  const mapWithoutPendingOwnershipEdits = useMemo(
    () => (baseMap ? applyOwnershipEdits(baseMap, ownershipBaseline, factionsByKey) : undefined),
    [baseMap, factionsByKey, ownershipBaseline],
  );
  // Everything below reads the edited map, so the canvas, the sidebar and the counts all agree.
  const map = useMemo(
    () =>
      mapWithoutPendingOwnershipEdits
        ? applyOwnershipEdits(mapWithoutPendingOwnershipEdits, ownershipEdits, factionsByKey)
        : undefined,
    [factionsByKey, mapWithoutPendingOwnershipEdits, ownershipEdits],
  );
  const baseOwnerByRegion = useMemo(
    () =>
      new Map(
        (mapWithoutPendingOwnershipEdits?.markers ?? []).map(
          (marker) => [marker.key, marker.ownerFaction ?? null] as const,
        ),
      ),
    [mapWithoutPendingOwnershipEdits],
  );
  const editedRegionCount = Object.keys(ownershipEdits).length;
  const isEditingFactions = mapView === "factions" && isEditingOwnership;
  const brushFactionKey = factionKey(brushFaction);
  const brushFactionDetails = brushFactionKey ? factionsByKey.get(brushFactionKey) : undefined;
  const extendedCharacters = useMemo(
    () =>
      extendedState?.document.faction_to_chars.flatMap((group) =>
        group.chars.map((character) => ({ faction: group.faction, character })),
      ) ?? [],
    [extendedState],
  );
  const selectedCharacter = useMemo(
    () =>
      selectedCharacterKey && !mapSelectedRegion && !isEditingFactions
        ? extendedCharacters.find(
            ({ faction, character }) =>
              faction.toLowerCase() === selectedCharacterKey.faction.toLowerCase() &&
              character.id === selectedCharacterKey.id,
          )
        : undefined,
    [extendedCharacters, isEditingFactions, mapSelectedRegion, selectedCharacterKey],
  );
  const extendedDelta = useMemo(
    () =>
      extendedState
        ? buildExtendedMapDelta(extendedState.baseline, extendedState.document, {
            pendingConfederations: extendedState.pendingConfederations,
          })
        : undefined,
    [extendedState],
  );
  const ownershipEditEntries = useMemo<OwnershipEditEntry[]>(
    () =>
      Object.entries(ownershipEdits)
        .map(([region, after]) => ({ region, before: baseOwnerByRegion.get(region) ?? null, after }))
        .sort((first, second) => first.region.localeCompare(second.region)),
    [baseOwnerByRegion, ownershipEdits],
  );
  const extendedEditActions = extendedDelta?.actions ?? [];
  const isExtendedFormat = !!extendedState;
  const characterMapOverlayActive = isActive && !!map && showCharacters && !!extendedState;
  const mapDisplayWidthPx = map ? Math.max(320, Math.round(map.width * zoom)) : 0;
  const mapDisplayHeightPx = map ? Math.max(240, Math.round(map.height * zoom)) : 0;
  const mapDisplayWidth = map ? `${mapDisplayWidthPx}px` : undefined;
  const mapDisplayHeight = map ? `${mapDisplayHeightPx}px` : undefined;
  const mapScaleX = map && map.width > 0 ? mapDisplayWidthPx / map.width : 1;
  const mapScaleY = map && map.height > 0 ? mapDisplayHeightPx / map.height : 1;

  const regionGeometricCenters = useMemo(() => (map ? computeRegionGeometricCenters(map.areas) : new Map()), [map]);

  useEffect(() => {
    if (!isEditingFactions) return;
    setSelectedCharacterKey(undefined);
    setCharacterDragPreview(undefined);
    characterDragRef.current = undefined;
    characterClickGestureRef.current = undefined;
  }, [isEditingFactions]);
  const factionFlagMarkers = useMemo(
    () =>
      mapView === "factions" && map
        ? map.markers.flatMap((marker) => {
            const ownerKey = factionKey(marker.ownerFaction);
            const flagUrl = ownerKey ? factionsByKey.get(ownerKey)?.flagUrl : undefined;
            if (!flagUrl) return [];

            const width = FACTION_FLAG_SIZE * mapScaleX;
            const height = FACTION_FLAG_SIZE * mapScaleY;
            const regionCenter = regionGeometricCenters.get(marker.key.trim().toLowerCase());
            const x = regionCenter?.x ?? marker.gx;
            const y =
              (regionCenter
                ? displayYFromVertex(map.height, regionCenter.y, map.displayFlipY)
                : displayYFromCell(map.height, marker.gy, map.displayFlipY)) * mapScaleY;
            return [
              {
                key: `${marker.id}:${flagUrl}`,
                src: flagUrl,
                left: x * mapScaleX - width / 2,
                top: y - height / 2,
                width,
                height,
              },
            ];
          })
        : [],
    [factionsByKey, map, mapScaleX, mapScaleY, mapView, regionGeometricCenters],
  );
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
    () => (selectedCharacterKey ? undefined : map?.markers.find((marker) => marker.id === selectedMarkerId)),
    [map, selectedCharacterKey, selectedMarkerId],
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
      isEditingFactions && query
        ? map.factions
        : map.factions.filter(
            (faction) =>
              faction.regionCount > 0 ||
              extendedState?.document.faction_to_chars.some(
                (group) =>
                  group.faction.toLowerCase() === faction.key.toLowerCase() &&
                  DIPLOMACY_RELATIONSHIPS.some((relationship) => group.diplo[relationship].length > 0),
              ),
          );
    if (!query) return factions;
    return factions.filter((faction) =>
      [faction.key, faction.label].some((value) => value.toLowerCase().includes(query)),
    );
  }, [extendedState, filter, isEditingFactions, map]);

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
    setOwnershipBaseline({});
    setEditHistory([]);
    setBrushFaction(undefined);
    setSelectedFactionKey(undefined);
    setExtendedState(undefined);
    setExtendedHistory([]);
    setExtendedImportUndo(undefined);
    setSelectedCharacterKey(undefined);
    setCharacterDragPreview(undefined);
    factionRegionCycleRef.current = undefined;
    setBuildingsView(undefined);
    setCharacterExperience(undefined);
    setOpenEditPanel(undefined);
    setMapContextMenu(undefined);
    setNewForceDraft(undefined);
  }, [campaignKey, currentGame]);

  useEffect(() => {
    const timers = factionFlagClickTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!mapContextMenu) return;
    /**
     * A click outside the open context menu dismisses it, and does nothing else.
     *
     * Capture the click before React delivers it to the map underneath. Otherwise the menu
     * closes, but the same click still selects a character/region or paints ownership.
     */
    const dismiss = (event?: MouseEvent) => {
      if (event) {
        if (mapContextMenuRef.current?.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
      }
      setMapContextMenu(undefined);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("click", dismiss, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", dismiss, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mapContextMenu]);

  const pushEditHistory = useCallback(
    () => setEditHistory((history) => [...history, ownershipEdits].slice(-OWNERSHIP_HISTORY_LIMIT)),
    [ownershipEdits],
  );

  const captureExtendedMapImportUndo = useCallback(
    (): ExtendedMapImportUndo => ({
      ownershipBaseline: { ...ownershipBaseline },
      ownershipEdits: { ...ownershipEdits },
      editHistory: editHistory.map((edits) => ({ ...edits })),
      extendedState: extendedState
        ? {
            ...extendedState,
            baseline: cloneExtendedMap(extendedState.baseline),
            document: cloneExtendedMap(extendedState.document),
            pendingConfederations: extendedState.pendingConfederations.map((entry) => ({ ...entry })),
          }
        : undefined,
      extendedHistory: extendedHistory.map(cloneExtendedMapEditState),
      showCharacters,
      selectedCharacterKey: selectedCharacterKey ? { ...selectedCharacterKey } : undefined,
      selectedFactionKey,
    }),
    [
      editHistory,
      extendedHistory,
      extendedState,
      ownershipBaseline,
      ownershipEdits,
      selectedCharacterKey,
      selectedFactionKey,
      showCharacters,
    ],
  );

  /** Records an owner for a region, dropping the edit again when it lands back on the clean baseline owner. */
  const paintRegion = (regionKey: string, owner: string | null) => {
    const baselineOwner = baseOwnerByRegion.get(regionKey) ?? null;
    const currentOwner = regionKey in ownershipEdits ? ownershipEdits[regionKey] : baselineOwner;
    if (factionKey(currentOwner) === factionKey(owner)) return;

    pushEditHistory();
    setOwnershipEdits((edits) => {
      const next = { ...edits };
      if (factionKey(baselineOwner) === factionKey(owner)) delete next[regionKey];
      else next[regionKey] = owner;
      return next;
    });
  };

  const revertOwnershipEdit = useCallback(
    (regionKey: string) => {
      if (!(regionKey in ownershipEdits)) return;
      pushEditHistory();
      setOwnershipEdits((edits) => {
        const next = { ...edits };
        delete next[regionKey];
        return next;
      });
    },
    [ownershipEdits, pushEditHistory],
  );

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
        if (JSON.stringify(nextState) === JSON.stringify(extendedState)) return true;
        setExtendedHistory((history) =>
          [...history, cloneExtendedMapEditState(extendedState)].slice(-OWNERSHIP_HISTORY_LIMIT),
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

  const revertExtendedEdit = useCallback(
    (action: ExtendedMapDeltaAction) => {
      if (!extendedState) return;
      const state = revertExtendedDeltaAction(extendedState, action);
      if (!state || JSON.stringify(state) === JSON.stringify(extendedState)) return;
      setExtendedHistory((history) =>
        [...history, cloneExtendedMapEditState(extendedState)].slice(-OWNERSHIP_HISTORY_LIMIT),
      );
      setExtendedState(state);
    },
    [extendedState],
  );

  const undoExtendedEdit = useCallback(() => {
    if (!extendedState || extendedHistory.length === 0) return;
    const state = extendedHistory[extendedHistory.length - 1];
    setExtendedState(cloneExtendedMapEditState(state));
    setExtendedHistory((history) => history.slice(0, -1));
  }, [extendedHistory, extendedState]);

  const undoExtendedImport = useCallback(() => {
    if (!extendedImportUndo) return;
    setOwnershipBaseline({ ...extendedImportUndo.ownershipBaseline });
    setOwnershipEdits({ ...extendedImportUndo.ownershipEdits });
    setEditHistory(extendedImportUndo.editHistory.map((edits) => ({ ...edits })));
    setExtendedState(
      extendedImportUndo.extendedState
        ? {
            ...extendedImportUndo.extendedState,
            baseline: cloneExtendedMap(extendedImportUndo.extendedState.baseline),
            document: cloneExtendedMap(extendedImportUndo.extendedState.document),
            pendingConfederations: extendedImportUndo.extendedState.pendingConfederations.map((entry) => ({
              ...entry,
            })),
          }
        : undefined,
    );
    setExtendedHistory(extendedImportUndo.extendedHistory.map(cloneExtendedMapEditState));
    setShowCharacters(extendedImportUndo.showCharacters);
    setSelectedCharacterKey(
      extendedImportUndo.selectedCharacterKey ? { ...extendedImportUndo.selectedCharacterKey } : undefined,
    );
    setSelectedFactionKey(extendedImportUndo.selectedFactionKey);
    setCharacterDragPreview(undefined);
    setOpenEditPanel(undefined);
    setExtendedImportUndo(undefined);
  }, [extendedImportUndo]);

  const revertExtendedEdits = () => {
    if (!extendedState || !extendedDelta || extendedDelta.actions.length === 0) return;
    setExtendedHistory((history) =>
      [...history, cloneExtendedMapEditState(extendedState)].slice(-OWNERSHIP_HISTORY_LIMIT),
    );
    setExtendedState(createExtendedMapEditState(extendedState.baseline));
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
      let extendedExport;
      try {
        if (
          extendedState &&
          extendedDelta?.actions.some((action) => action.type === "update_character") &&
          !characterExperience
        ) {
          throw new Error("Character experience data is still loading; try exporting again in a moment.");
        }
        const exportDelta =
          extendedState && characterExperience
            ? buildExtendedMapDelta(extendedState.baseline, extendedState.document, {
                campaign: map.campaignKey,
                characterExperience,
                pendingConfederations: extendedState.pendingConfederations,
              })
            : extendedDelta;
        extendedExport =
          extendedState && exportDelta ? buildExtendedMapExport(regionOwnership(map), exportDelta) : undefined;
      } catch (reason) {
        showOwnershipToast("warning", [reason instanceof Error ? reason.message : String(reason)]);
        return;
      }
      const result = await window.api?.exportRegionOwnership(
        extendedExport ? formatExtendedMapExportJson(extendedExport) : formatRegionOwnershipJson(map),
        extendedExport ? "map_extended_out.json" : "map.json",
      );
      if (!result || result.canceled) return;
      if (result.success) {
        showOwnershipToast("success", [
          mapMessage(
            extendedExport ? "mapExtendedExported" : "mapOwnershipExported",
            extendedExport ? "Extended map changes written to {{path}}" : "Region ownership written to {{path}}",
            { path: result.savedPath ?? "" },
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
      if (detected.format === "extended") {
        const importedMap = applyOwnershipEdits(baseMap, edits, factionsByKey);
        setExtendedImportUndo(captureExtendedMapImportUndo());
        setOwnershipBaseline(regionOwnership(importedMap));
        setOwnershipEdits({});
        setEditHistory([]);
        setExtendedState(createExtendedMapEditState(detected.document));
        setExtendedHistory([]);
        setSelectedCharacterKey(undefined);
        setSelectedFactionKey(undefined);
        setShowCharacters(true);
      } else {
        pushEditHistory();
        setOwnershipBaseline({});
        setOwnershipEdits(edits);
        setExtendedImportUndo(undefined);
        setExtendedState(undefined);
        setExtendedHistory([]);
        setSelectedCharacterKey(undefined);
        setSelectedFactionKey(undefined);
        setShowCharacters(false);
      }

      const messages = [
        mapMessage(
          "mapOwnershipImported",
          detected.format === "extended"
            ? "Imported extended map data and ownership for {{count}} region(s)."
            : detected.format === "extended-export"
              ? "Imported ownership and {{count}} extended action(s); action data is applied by the campaign importer."
              : "Imported ownership for {{count}} region(s).",
          {
            count: detected.format === "extended-export" ? detected.document.actions.length : Object.keys(edits).length,
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
      setCharacterExperience(undefined);
      setUnitViewerSessionId(undefined);
      setResolvedCharacterThumbnailPaths([]);
      return;
    }
    let current = true;
    setUnitCatalog([]);
    setLordOptions([]);
    setCharacterExperience(undefined);
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
          setCharacterExperience(undefined);
          return;
        }
        const byKey = new Map<string, UnitViewerCatalogUnit>();
        for (const group of response.groups ?? []) for (const unit of group.units) byKey.set(unit.key, unit);
        setUnitViewerSessionId(response.sessionId);
        setUnitCatalog([...byKey.values()]);
        setLordOptions(response.lordOptions ?? []);
        setCharacterExperience(response.characterExperience);
      })
      .catch((reason) => {
        if (current) {
          setUnitCatalog([]);
          setLordOptions([]);
          setCharacterExperience(undefined);
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
    // A region handed off from the Buildings tab is authoritative. Do not leave a character
    // panel visible beside that region's building panel, including when the handoff happens
    // while this map tab is kept mounted in the background.
    if (mapSelectedRegion) {
      setSelectedCharacterKey(undefined);
      setCharacterDragPreview(undefined);
    }
    const handedOffMarker =
      selectedRegion === undefined
        ? undefined
        : map.markers.find((marker) => marker.key.toLowerCase() === selectedRegion);
    setSelectedMarkerId(handedOffMarker?.id);
    if (handedOffMarker?.ownerFaction) setSelectedFactionKey(factionKey(handedOffMarker.ownerFaction));
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
    const selectedFactionForMap = selectedFactionKey ?? factionKey(selected?.ownerFaction);
    const selectedRegionClimateKey = selected ? map.climatesByRegion[selected.key]?.toLowerCase() : undefined;
    const climateFilterKey =
      climateSelectionKey === null
        ? undefined
        : (climateSelectionKey?.toLowerCase() ?? (selected ? (selectedRegionClimateKey ?? null) : undefined));

    const drawMap = (backgroundImage: HTMLImageElement | undefined) => {
      context.clearRect(0, 0, map.width, map.height);
      if (backgroundImage) context.drawImage(backgroundImage, 0, 0, map.width, map.height);

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
      } else if (mapView === "factions" && selectedFactionForMap) {
        for (const area of map.areas) {
          if (!regionMatchesSettlementType(area.regionKey) || factionKey(area.ownerFaction) !== selectedFactionForMap)
            continue;
          drawAreaPath(context, area, map.height, map.displayFlipY);
          context.fillStyle = factionColour(selectedFactionForMap);
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

      if (characterMapOverlayActive) {
        context.save();
        context.globalAlpha = isEditingOwnership ? OWNERSHIP_EDIT_TERRAIN_OPACITY : 1;
        drawCharacterTerrainAreas(context, map);
        context.restore();
      }

      for (const marker of map.markers) {
        const y = displayYFromCell(map.height, marker.gy, map.displayFlipY);
        const markerFaction = marker.ownerFaction
          ? factionsByKey.get(factionKey(marker.ownerFaction) ?? "")
          : undefined;
        // Faction flags are rendered in a separate image overlay so zooming can use the original
        // asset instead of enlarging a 20px copy that was already rasterised into this canvas.
        if (!(mapView === "factions" && markerFaction?.flagUrl)) {
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
    const imageSources = Array.from(new Set([backgroundSrc, ...characterThumbnailSources].filter(Boolean))) as string[];
    const cachedImages = new Map(
      imageSources
        .map((src) => [src, mapImagesRef.current.get(src)] as const)
        .filter((entry): entry is readonly [string, HTMLImageElement] => !!entry[1]),
    );
    const loadImageOnce = (source: string) => {
      const pending = mapImageLoadsRef.current.get(source);
      if (pending) return pending;
      const load = loadMapImage(source).finally(() => mapImageLoadsRef.current.delete(source));
      mapImageLoadsRef.current.set(source, load);
      return load;
    };
    drawMap(cachedImages.get(backgroundSrc ?? ""));

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
      drawMap(cachedImages.get(backgroundSrc ?? ""));
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
    selectedFactionKey,
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
    if (marker?.ownerFaction) setSelectedFactionKey(factionKey(marker.ownerFaction));
    if (marker && map) {
      dispatch(selectMapRegion({ campaign: map.campaignKey, region: marker.key }));
      if (center) centerMapOnMarker(marker);
    } else {
      dispatch(clearMapRegionSelection());
    }
  };

  const selectMapCharacter = (faction: string, character: ExtendedMapCharacter) => {
    // Character and region selection are mutually exclusive. Clearing both the local marker and
    // the app-level handoff is important: the latter is what drives the Buildings tab.
    setSelectedMarkerId(undefined);
    setSelectedFactionKey(faction.toLowerCase());
    setClimateSelectionKey(undefined);
    setSelectedCharacterKey({ faction, id: character.id });
    setCharacterDragPreview(undefined);
    dispatch(clearMapRegionSelection());
  };

  const selectBrushFactionForRegion = (marker: EsfMapMarker) => {
    const owner = marker.ownerFaction?.trim();
    if (!owner) return;

    // Keep the brush aligned with the faction roster's canonical spelling when possible.
    setBrushFaction(factionsByKey.get(owner.toLowerCase())?.key ?? owner);
  };

  const selectMapFaction = (factionKeyToSelect: string) => {
    const canonicalKey = factionsByKey.get(factionKeyToSelect.toLowerCase())?.key ?? factionKeyToSelect;
    setSelectedFactionKey(canonicalKey.toLowerCase());
    const factionMarkers =
      map?.markers.filter((candidate) => factionKey(candidate.ownerFaction) === factionKeyToSelect.toLowerCase()) ?? [];
    if (factionMarkers.length > 0) {
      selectMapMarker(factionMarkers[0]);
      centerMapOnMarkers(factionMarkers);
    } else {
      setSelectedMarkerId(undefined);
      setSelectedCharacterKey(undefined);
      setClimateSelectionKey(undefined);
      dispatch(clearMapRegionSelection());
    }
  };

  const focusNextFactionRegion = (factionKeyToFocus: string, select = true) => {
    if (!map) return;
    const normalizedKey = factionKeyToFocus.toLowerCase();
    const previousMarkerId =
      factionRegionCycleRef.current?.factionKey === normalizedKey ? factionRegionCycleRef.current.markerId : undefined;
    const marker = nextFactionRegionMarker(map.markers, normalizedKey, previousMarkerId);
    if (!marker) return;

    factionRegionCycleRef.current = { factionKey: normalizedKey, markerId: marker.id };
    if (select) {
      setSelectedFactionKey((factionsByKey.get(normalizedKey)?.key ?? factionKeyToFocus).toLowerCase());
      selectMapMarker(marker);
    }
    if (zoom < 2) {
      setZoom(2);
      // Wait for the scaled surface to commit before calculating the scroll offset.
      requestAnimationFrame(() => requestAnimationFrame(() => centerMapOnMarker(marker)));
    } else centerMapOnMarker(marker);
  };

  const extendedFactionGroup = (key: string | undefined) =>
    key
      ? extendedState?.document.faction_to_chars.find((group) => group.faction.toLowerCase() === key.toLowerCase())
      : undefined;

  const diplomacyHasRelation = (
    sourceKey: string | undefined,
    targetKey: string | undefined,
    relation: DiplomacyRelationship,
  ) => {
    if (!sourceKey || !targetKey) return false;
    return !!extendedFactionGroup(sourceKey)?.diplo[relation].some(
      (entry) => entry.toLowerCase() === targetKey.toLowerCase(),
    );
  };

  const diplomacySourceFaction = selectedFactionKey ?? selectedMarkerFactionKey;

  const factionLordOptions = (faction: string) => {
    const factionDetails = factionsByKey.get(faction.toLowerCase());
    const subculture = factionDetails?.subculture?.toLowerCase();
    return lordOptions.filter(
      (option) =>
        (!subculture || option.subcultureKeys.some((key) => key.toLowerCase() === subculture)) &&
        !!associatedUnitForSubculture(option, factionDetails?.subculture),
    );
  };

  const nextAvailableCharacterId = (state: ExtendedMapEditState) => {
    const used = new Set(
      state.document.faction_to_chars.flatMap((group) => group.chars.map((character) => character.id)),
    );
    let candidate = state.nextCharacterId;
    while (used.has(candidate)) candidate += 1;
    return candidate;
  };

  const openNewForce = (factionToUse: string, point?: { x: number; y: number }) => {
    if (!extendedState || !map) return;
    const group = extendedFactionGroup(factionToUse);
    if (!group) {
      showOwnershipToast("warning", [
        mapText("mapDiplomacyFactionUnavailable", "That faction is not available in the extended map."),
      ]);
      return;
    }
    const mapPoint =
      point ??
      (selectedMarker
        ? { x: selectedMarker.gx, y: displayYFromCell(map.height, selectedMarker.gy, map.displayFlipY) }
        : { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) });
    const convertedPoint = mapPointToCharacterCoordinate(map, mapPoint);
    if (!convertedPoint) return;
    const characterPoint = snapCharacterPointToUsable(map, convertedPoint);
    const options = factionLordOptions(factionToUse);
    const leader = options[0];
    const leaderUnit = leader
      ? associatedUnitForSubculture(leader, factionsByKey.get(factionToUse.toLowerCase())?.subculture)
      : undefined;
    setMapContextMenu(undefined);
    setNewForceDraft({
      faction: group.faction,
      subtype: leader?.subtype ?? "",
      x: characterPoint.x,
      y: characterPoint.y,
      units: leaderUnit ? [leaderUnit] : [],
    });
  };

  const addNewForceUnit = (unitKey: string) => {
    if (!unitKey) return;
    setNewForceDraft((draft) =>
      draft && draft.units.length < 20 ? { ...draft, units: [...draft.units, unitKey] } : draft,
    );
  };

  const submitNewForce = () => {
    if (!extendedState || !newForceDraft || !newForceDraft.subtype || newForceDraft.units.length === 0) return;
    const characterId = nextAvailableCharacterId(extendedState);
    const applied = updateExtendedDocument({
      type: "add_character",
      faction: newForceDraft.faction,
      character: {
        x: newForceDraft.x,
        y: newForceDraft.y,
        subtype: newForceDraft.subtype,
        rank: 1,
        units: newForceDraft.units.map((unit_key) => ({ unit_key, xp: 0, health: 100 })),
      },
    });
    if (!applied) return;
    setSelectedFactionKey(newForceDraft.faction.toLowerCase());
    setSelectedCharacterKey({ faction: newForceDraft.faction, id: characterId });
    setSelectedMarkerId(undefined);
    dispatch(clearMapRegionSelection());
    setShowCharacters(true);
    setNewForceDraft(undefined);
  };

  const openDiplomacyContextMenu = (
    event: React.MouseEvent,
    source: "map" | "faction",
    targetFaction?: string,
    region?: EsfMapMarker,
    mapPoint?: { x: number; y: number },
  ) => {
    if (!extendedState) return;
    event.preventDefault();
    event.stopPropagation();
    setMapContextMenu({ left: event.clientX, top: event.clientY, source, targetFaction, region, mapPoint });
  };

  const applyDiplomacyContextAction = (action: ExtendedMapEditAction) => {
    const applied = updateExtendedDocument(action);
    if (applied) setMapContextMenu(undefined);
  };

  const handleDiplomacyFlagClick = (event: React.MouseEvent, targetFaction: string, double = false) => {
    event.preventDefault();
    event.stopPropagation();
    const key = targetFaction.toLowerCase();
    const pending = factionFlagClickTimersRef.current.get(key);
    if (pending) {
      clearTimeout(pending);
      factionFlagClickTimersRef.current.delete(key);
    }
    if (double) {
      focusNextFactionRegion(targetFaction, true);
      if (!map?.markers.some((marker) => factionKey(marker.ownerFaction) === key)) selectMapFaction(targetFaction);
      return;
    }
    const timer = setTimeout(() => {
      factionFlagClickTimersRef.current.delete(key);
      focusNextFactionRegion(targetFaction, false);
    }, 280);
    factionFlagClickTimersRef.current.set(key, timer);
  };

  const beginMapDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    if (mapContextMenuRef.current) {
      // The menu owns the first left click outside itself. Do not let the canvas interpret it as
      // a region selection, character selection, ownership paint, or drag gesture.
      setMapContextMenu(undefined);
      suppressMapClickRef.current = true;
      characterClickGestureRef.current = undefined;
      return;
    }
    let hasCharacterClickTarget = false;
    if (!isEditingFactions && showCharacters && extendedState) {
      const characters = charactersAtCanvasPoint(event);
      const selectedCharacterAtPoint = selectedCharacterKey
        ? characters.find(
            ({ faction, character }) =>
              character.id === selectedCharacterKey.id &&
              faction.toLowerCase() === selectedCharacterKey.faction.toLowerCase(),
          )
        : undefined;
      if (characters.length > 0) {
        hasCharacterClickTarget = true;
        const currentGesture = characterClickGestureRef.current;
        if (!currentGesture || currentGesture.pointerId !== event.pointerId || currentGesture.clickHandled) {
          characterClickGestureRef.current = {
            pointerId: event.pointerId,
            selectionBeforePointerDown: selectedCharacterKey,
            clickHandled: false,
          };
        }
      }
      // Selecting and moving are separate gestures. This prevents a pan that starts over an
      // unselected marker from unexpectedly picking up and relocating that character.
      if (selectedCharacterAtPoint) {
        suppressMapClickRef.current = false;
        characterDragRef.current = {
          pointerId: event.pointerId,
          faction: selectedCharacterAtPoint.faction,
          characterId: selectedCharacterAtPoint.character.id,
          startX: event.clientX,
          startY: event.clientY,
          hasMoved: false,
        };
        setCharacterDragPreview({
          faction: selectedCharacterAtPoint.faction,
          id: selectedCharacterAtPoint.character.id,
          x: selectedCharacterAtPoint.character.x,
          y: selectedCharacterAtPoint.character.y,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    if (!hasCharacterClickTarget) characterClickGestureRef.current = undefined;
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
      if (event.type === "pointercancel") characterClickGestureRef.current = undefined;
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

  const charactersAtCanvasPoint = (event: { clientX: number; clientY: number }) => {
    const point = mapCoordinatesAtClientPoint(event);
    if (!map || !point) return [];

    // Character markers are rendered in document order, so later entries are visually on top of
    // earlier entries. Keep that same order for hit-testing and return topmost first.
    return characterMapIndex.entries
      .filter(({ point: characterPoint }) => {
        const distance = (characterPoint.x - point.x) ** 2 + (characterPoint.y - point.y) ** 2;
        return distance <= 400;
      })
      .reverse();
  };

  const handleMapClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const characterClickGesture = characterClickGestureRef.current;
    if (characterClickGesture?.clickHandled) return;
    if (suppressMapClickRef.current) {
      suppressMapClickRef.current = false;
      if (characterClickGesture) characterClickGesture.clickHandled = true;
      return;
    }
    if (!isEditingFactions && showCharacters && extendedState) {
      const characters = charactersAtCanvasPoint(event);
      const selectionBeforePointerDown = characterClickGesture
        ? characterClickGesture.selectionBeforePointerDown
        : selectedCharacterKey;
      if (characterClickGesture) characterClickGesture.clickHandled = true;
      const topCharacter = characters[0];
      if (topCharacter) {
        const selectedCharacterIndex = selectionBeforePointerDown
          ? characters.findIndex(
              ({ faction, character }) =>
                character.id === selectionBeforePointerDown.id &&
                faction.toLowerCase() === selectionBeforePointerDown.faction.toLowerCase(),
            )
          : -1;
        const nextCharacter = selectedCharacterIndex >= 0 ? characters[selectedCharacterIndex + 1] : undefined;
        if (nextCharacter) {
          selectMapCharacter(nextCharacter.faction, nextCharacter.character);
          return;
        }
        if (selectedCharacterIndex === -1) {
          selectMapCharacter(topCharacter.faction, topCharacter.character);
          return;
        }
        // Clicking the last selected character in the overlap falls through to the region
        // hit-test, which opens the building edit panel for that region.
      }
    }
    const marker = markerAtCanvasPoint(event);
    if (marker && isEditingFactions) {
      if (event.ctrlKey || !brushFaction) selectBrushFactionForRegion(marker);
      else paintRegion(marker.key, brushFaction);
    }
    selectMapMarker(marker);
  };

  const handleMapContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const marker = markerAtCanvasPoint(event);
    if (extendedState) {
      openDiplomacyContextMenu(
        event,
        "map",
        marker?.ownerFaction ?? undefined,
        marker,
        mapCoordinatesAtClientPoint(event),
      );
      return;
    }
    if (!marker) return;
    if (!isEditingFactions) return;
    event.preventDefault();
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
        {extendedState && (
          <label
            className="flex items-center gap-1 text-xs text-gray-400"
            title={mapText("mapCharactersHint", "Show and edit characters and armies")}
          >
            <input
              type="checkbox"
              checked={showCharacters}
              onChange={(event) => {
                const shouldShowCharacters = event.target.checked;
                setShowCharacters(shouldShowCharacters);
                if (!shouldShowCharacters) {
                  setSelectedCharacterKey(undefined);
                  setCharacterDragPreview(undefined);
                }
              }}
              className="accent-blue-600"
            />
            {mapText("mapCharacters", "Characters")}
          </label>
        )}
        {extendedState && (
          <div className="flex items-center gap-2">
            <span className="rounded border border-emerald-700 bg-emerald-950/50 px-2 py-1 text-xs text-emerald-300">
              {mapText("mapExtendedFormat", "Extended map")}
            </span>
            {extendedImportUndo && (
              <button
                type="button"
                onClick={undoExtendedImport}
                disabled={isTransferringOwnership}
                title={mapText("mapUndoImportHint", "Undo extended map import")}
                className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-gray-900"
              >
                {mapText("mapUndoImport", "Undo import")}
              </button>
            )}
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
            {extendedEditActions.length > 0 && (
              <button
                type="button"
                onClick={() => setOpenEditPanel("extended")}
                title={mapText("mapOpenEditsHint", "Open the list of edits")}
                className="rounded border border-amber-700 bg-amber-950/40 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/60"
              >
                {mapMessage("mapExtendedEdits", "{{count}} edited", { count: extendedEditActions.length })}
              </button>
            )}
          </div>
        )}
        {map && mapView === "regions" && map.settlementTypes.length > 0 && (
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
              onClick={() => {
                if (!isEditingOwnership) {
                  setSelectedCharacterKey(undefined);
                  setCharacterDragPreview(undefined);
                }
                setIsEditingOwnership((isEditing) => !isEditing);
              }}
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
              </>
            )}
            {editedRegionCount > 0 && (
              <button
                type="button"
                onClick={() => setOpenEditPanel("ownership")}
                title={mapText("mapOpenEditsHint", "Open the list of edits")}
                className="rounded border border-amber-700 bg-amber-950/40 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/60"
              >
                {mapMessage("mapEditedRegions", "{{count}} edited", { count: editedRegionCount })}
              </button>
            )}
            <div className="ml-2 flex items-center gap-2 border-l border-gray-700 pl-2">
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
            <div className="relative min-h-0 flex-1 overflow-hidden" style={{ position: "relative" }}>
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
                  {map.backgroundTextImage && (
                    <img
                      aria-hidden="true"
                      src={map.backgroundTextImage.src}
                      alt=""
                      draggable={false}
                      className="pointer-events-none absolute left-0 top-0 z-10 block select-none"
                      style={{
                        width: mapDisplayWidthPx,
                        height: mapDisplayHeightPx,
                      }}
                    />
                  )}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 top-0 z-10"
                    style={{
                      width: mapDisplayWidthPx,
                      height: mapDisplayHeightPx,
                      display: mapView === "factions" ? "block" : "none",
                    }}
                  >
                    {factionFlagMarkers.map((marker) => (
                      <img
                        key={marker.key}
                        src={marker.src}
                        alt=""
                        draggable={false}
                        className="absolute object-contain"
                        style={{
                          left: marker.left,
                          top: marker.top,
                          width: marker.width,
                          height: marker.height,
                          filter: "drop-shadow(0 0 2px rgba(0, 0, 0, 0.8))",
                        }}
                      />
                    ))}
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
                          opacity: isEditingOwnership ? OWNERSHIP_EDIT_CHARACTER_OPACITY : 1,
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
              {isEditingOwnership && (
                <div className="pointer-events-none absolute inset-0 z-20">
                  <div
                    className="pointer-events-none absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded border border-blue-400/70 bg-gray-950/90 px-3 py-2 text-center text-xs text-gray-200 shadow-lg backdrop-blur-sm"
                    role="status"
                  >
                    {brushFactionDetails?.flagUrl && (
                      <img src={brushFactionDetails.flagUrl} alt="" className="h-5 w-5 shrink-0 object-contain" />
                    )}
                    <span>
                      {brushFaction
                        ? mapMessage("mapPaintingAs", "Painting as {{faction}}", {
                            faction: brushFactionDetails?.label ?? brushFaction,
                          })
                        : mapText("mapOwnershipNoFactionSelected", "No faction selected")}
                    </span>
                  </div>
                  <div className="pointer-events-none absolute bottom-3 left-3 z-20 max-w-[calc(100%-1.5rem)] rounded border border-gray-600/80 bg-gray-950/90 px-3 py-2 text-xs text-gray-300 shadow-lg backdrop-blur-sm">
                    <div className="mb-1 font-medium text-gray-100">
                      {mapText("mapOwnershipMouseActions", "Mouse actions")}
                    </div>
                    <div className="flex flex-col gap-1 text-[0.7rem]">
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        <kbd className="rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-[0.65rem] text-gray-200">
                          Ctrl + left click
                        </kbd>
                        {mapText("mapOwnershipSelectFaction", "Select faction")}
                      </span>
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        <kbd className="rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-[0.65rem] text-gray-200">
                          Left click
                        </kbd>
                        {mapText("mapOwnershipAssignFaction", "Give region")}
                      </span>
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        <kbd className="rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-[0.65rem] text-gray-200">
                          Right click
                        </kbd>
                        {mapText("mapOwnershipClearRegion", "Clear ownership")}
                      </span>
                    </div>
                  </div>
                </div>
              )}
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
                            building: (() => {
                              const { level: _previousLevel, ...withoutLevel } = slot;
                              const selectedTile = allTiles.find((tile) => tile.levelKey === building);
                              return building
                                ? {
                                    ...withoutLevel,
                                    building,
                                    ...(selectedTile ? { level: selectedTile.level } : {}),
                                  }
                                : { ...withoutLevel, building: "" };
                            })(),
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
                    onClick={() => {
                      const removed = updateExtendedDocument({
                        type: "remove_character",
                        faction: selectedCharacter.faction,
                        characterId: selectedCharacter.character.id,
                      });
                      if (removed) setSelectedCharacterKey(undefined);
                    }}
                    className="rounded border border-red-900 px-1.5 py-0.5 text-xs text-red-300 hover:bg-red-950"
                    aria-label={mapText("mapDeleteCharacter", "Delete character")}
                  >
                    {mapText("mapDeleteCharacter", "Delete character")}
                  </button>
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
                      const selectableUnitOptionGroups = groupExtendedUnitOptionsByCaste(selectableUnitOptions);
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
                                <option value={unit.unit_key} title={unit.unit_key}>
                                  {unit.unit_key}
                                </option>
                              )}
                              {selectableUnitOptionGroups.map((group) => (
                                <optgroup key={group.key} label={group.name}>
                                  {group.options.map((option) => (
                                    <option key={option.key} value={option.key} title={option.key}>
                                      {option.name}
                                    </option>
                                  ))}
                                </optgroup>
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
                        {groupExtendedUnitOptionsByCaste(
                          resolveExtendedUnitOptions(
                            unitCatalog,
                            factionsByKey.get(selectedCharacter.faction.toLowerCase())?.subculture,
                          ),
                        ).map((group) => (
                          <optgroup key={group.key} label={group.name}>
                            {group.options.map((option) => (
                              <option key={option.key} value={option.key} title={option.key}>
                                {option.name}
                              </option>
                            ))}
                          </optgroup>
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
                          disabled={isEditingFactions}
                          onClick={() => {
                            if (isEditingFactions) return;
                            selectMapCharacter(faction, character);
                            if (characterPoint) centerMapOnPoint(characterPoint.x, characterPoint.y);
                          }}
                          className={`mb-1 block w-full rounded border px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${selected ? "border-yellow-500 bg-yellow-950/40 text-gray-100" : "border-transparent bg-gray-950/60 text-gray-300 hover:border-gray-600"}`}
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
                    : selectedFactionKey === faction.key.toLowerCase() ||
                      (!selectedFactionKey && factionKey(selectedMarker?.ownerFaction) === faction.key.toLowerCase());
                  const diplomacyGroup = extendedState?.document.faction_to_chars.find(
                    (group) => group.faction.toLowerCase() === faction.key.toLowerCase(),
                  );
                  return (
                    <div
                      key={faction.key}
                      ref={(element) => {
                        const key = `faction:${faction.key.toLowerCase()}`;
                        if (element) mapListItemRefs.current.set(key, element);
                        else mapListItemRefs.current.delete(key);
                      }}
                      className="mb-1 rounded"
                      onContextMenu={(event) => openDiplomacyContextMenu(event, "faction", faction.key)}
                    >
                      <button
                        type="button"
                        aria-pressed={isEditingFactions ? isSelected : undefined}
                        onClick={() =>
                          isEditingFactions ? setBrushFaction(faction.key) : selectMapFaction(faction.key.toLowerCase())
                        }
                        onDoubleClick={() => focusNextFactionRegion(faction.key)}
                        title={mapText(
                          "mapFactionDoubleClickHint",
                          "Double click to cycle through this faction's regions",
                        )}
                        className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm ${
                          isSelected
                            ? "border-blue-500 bg-blue-950/60 text-gray-100"
                            : "border-transparent bg-gray-950/60 text-gray-300 hover:border-gray-600"
                        }`}
                      >
                        {faction.flagUrl ? (
                          <img
                            src={faction.flagUrl}
                            alt=""
                            loading="lazy"
                            className="h-6 w-6 shrink-0 object-contain"
                          />
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
                      {extendedState &&
                        diplomacyGroup &&
                        DIPLOMACY_RELATIONSHIPS.map((relationship) => {
                          const targets = diplomacyGroup.diplo[relationship];
                          if (!targets || targets.length === 0) return null;
                          const icon = map.diplomacyIconUrls?.[relationship];
                          const label = mapText(
                            diplomacyRelationshipLabelKey(relationship),
                            diplomacyRelationshipFallback(relationship),
                          );
                          return (
                            <div
                              key={`${faction.key}:${relationship}`}
                              className="flex items-center gap-1 border-x border-b border-gray-800 bg-gray-950/40 px-2 py-1"
                              title={label}
                            >
                              {icon ? (
                                <img src={icon} alt="" className="h-4 w-4 shrink-0 object-contain" />
                              ) : (
                                <span className="h-4 w-4 shrink-0 rounded-sm border border-gray-600 text-center text-[0.6rem] text-gray-500">
                                  ·
                                </span>
                              )}
                              <span className="mr-1 w-20 shrink-0 truncate text-[0.65rem] text-gray-400">{label}</span>
                              <span className="flex min-w-0 flex-wrap gap-1">
                                {targets.map((targetKey) => {
                                  const target = factionsByKey.get(targetKey.toLowerCase());
                                  const targetLabel = target?.label ?? targetKey;
                                  return (
                                    <button
                                      key={`${relationship}:${targetKey}`}
                                      type="button"
                                      title={`${targetLabel} (${targetKey})`}
                                      aria-label={`${label}: ${targetLabel} (${targetKey})`}
                                      onClick={(event) => handleDiplomacyFlagClick(event, targetKey)}
                                      onDoubleClick={(event) => handleDiplomacyFlagClick(event, targetKey, true)}
                                      className="flex h-6 w-6 items-center justify-center rounded border border-gray-700 bg-gray-900 hover:border-blue-400 focus:border-blue-400 focus:outline-none"
                                    >
                                      {target?.flagUrl ? (
                                        <img src={target.flagUrl} alt="" className="h-5 w-5 object-contain" />
                                      ) : (
                                        <span className="text-[0.58rem] font-medium text-gray-400">?</span>
                                      )}
                                    </button>
                                  );
                                })}
                              </span>
                            </div>
                          );
                        })}
                    </div>
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

      {map && mapContextMenu && extendedState && (
        <div
          ref={mapContextMenuRef}
          className="fixed z-50 min-w-64 max-w-[calc(100vw-1rem)] rounded border border-gray-600 bg-gray-950 p-1 text-sm shadow-2xl"
          style={{ left: Math.max(8, mapContextMenu.left), top: Math.max(8, mapContextMenu.top) }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {(() => {
            const source = diplomacySourceFaction;
            const target = mapContextMenu.targetFaction;
            const sourceGroup = extendedFactionGroup(source);
            const targetGroup = extendedFactionGroup(target);
            const validPair = !!sourceGroup && !!targetGroup && source!.toLowerCase() !== target!.toLowerCase();
            const atWar = diplomacyHasRelation(source, target, "war") || diplomacyHasRelation(target, source, "war");
            const sourceLabel = source
              ? (factionsByKey.get(source.toLowerCase())?.label ?? source)
              : mapText("mapNoFactionSelected", "No faction selected");
            const targetLabel = target
              ? (factionsByKey.get(target.toLowerCase())?.label ?? target)
              : mapText("mapNoTargetFaction", "No target faction");
            const mapPoint =
              mapContextMenu.mapPoint ??
              (mapContextMenu.region
                ? {
                    x: mapContextMenu.region.gx,
                    y: displayYFromCell(map.height, mapContextMenu.region.gy, map.displayFlipY),
                  }
                : undefined);
            return (
              <>
                <div className="border-b border-gray-800 px-2 py-1 text-xs text-gray-400">
                  <div>
                    {mapText("mapDiplomacySource", "Source")}: <span className="text-gray-200">{sourceLabel}</span>
                  </div>
                  <div>
                    {mapText("mapDiplomacyTarget", "Target")}: <span className="text-gray-200">{targetLabel}</span>
                  </div>
                </div>
                {mapContextMenu.source === "map" && (
                  <>
                    <button
                      type="button"
                      disabled={!sourceGroup}
                      onClick={() => source && openNewForce(source, mapPoint)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="w-5 text-center">＋</span>
                      {mapText("mapCreateForceSelected", "Create force for source faction")}
                    </button>
                    {target && (
                      <button
                        type="button"
                        disabled={!targetGroup}
                        onClick={() => openNewForce(target, mapPoint)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="w-5 text-center">＋</span>
                        {mapText("mapCreateForceTarget", "Create force for region owner")}
                      </button>
                    )}
                    {isEditingFactions && mapContextMenu.region && (
                      <button
                        type="button"
                        onClick={() => {
                          paintRegion(mapContextMenu.region!.key, null);
                          selectMapMarker(mapContextMenu.region);
                          setMapContextMenu(undefined);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-gray-200 hover:bg-gray-800"
                      >
                        <span className="w-5 text-center">×</span>
                        {mapText("mapClearRegionOwnership", "Clear region ownership")}
                      </button>
                    )}
                  </>
                )}
                <div className="my-1 border-t border-gray-800" />
                <div className="px-2 py-1 text-[0.65rem] uppercase tracking-wide text-gray-500">
                  {mapText("mapDiplomacyOptions", "Diplomacy")}
                </div>
                {DIPLOMACY_RELATIONSHIPS.map((relationship) => {
                  const icon = map.diplomacyIconUrls?.[relationship];
                  return (
                    <button
                      key={relationship}
                      type="button"
                      disabled={!validPair}
                      onClick={() =>
                        source &&
                        target &&
                        applyDiplomacyContextAction({
                          type: "set_diplomacy",
                          faction: source,
                          targetFaction: target,
                          relationship,
                        })
                      }
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {icon ? (
                        <img src={icon} alt="" className="h-5 w-5 object-contain" />
                      ) : (
                        <span className="w-5 text-center">◆</span>
                      )}
                      {mapText(
                        diplomacyRelationshipLabelKey(relationship),
                        diplomacyRelationshipFallback(relationship),
                      )}
                    </button>
                  );
                })}
                {atWar && (
                  <button
                    type="button"
                    disabled={!validPair}
                    onClick={() =>
                      source &&
                      target &&
                      applyDiplomacyContextAction({ type: "make_peace", faction: source, targetFaction: target })
                    }
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {map.diplomacyIconUrls?.peace ? (
                      <img src={map.diplomacyIconUrls.peace} alt="" className="h-5 w-5 object-contain" />
                    ) : (
                      <span className="w-5 text-center">☮</span>
                    )}
                    {mapText("mapDiplomacyPeace", "Make peace")}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!validPair}
                  onClick={() =>
                    source &&
                    target &&
                    applyDiplomacyContextAction({ type: "confederate", faction: source, targetFaction: target })
                  }
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {map.diplomacyIconUrls?.confederate ? (
                    <img src={map.diplomacyIconUrls.confederate} alt="" className="h-5 w-5 object-contain" />
                  ) : (
                    <span className="w-5 text-center">⇄</span>
                  )}
                  {mapText("mapDiplomacyConfederate", "Confederate target")}
                </button>
              </>
            );
          })()}
        </div>
      )}

      {newForceDraft && extendedState && (
        <Modal show onClose={() => setNewForceDraft(undefined)} size="2xl" position="center">
          <Modal.Header>{mapText("mapNewForceTitle", "Create new force")}</Modal.Header>
          <Modal.Body>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-400">{mapText("mapFaction", "Faction")}</span>
                <select
                  value={newForceDraft.faction}
                  onChange={(event) => {
                    const faction = event.target.value;
                    const option = factionLordOptions(faction)[0];
                    const leaderUnit = option
                      ? associatedUnitForSubculture(option, factionsByKey.get(faction.toLowerCase())?.subculture)
                      : undefined;
                    setNewForceDraft((draft) =>
                      draft
                        ? { ...draft, faction, subtype: option?.subtype ?? "", units: leaderUnit ? [leaderUnit] : [] }
                        : draft,
                    );
                  }}
                  className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-200"
                >
                  {extendedState.document.faction_to_chars.map((group) => (
                    <option key={group.faction} value={group.faction}>
                      {factionsByKey.get(group.faction.toLowerCase())?.label ?? group.faction}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-gray-400">{mapText("mapSubtype", "Lord subtype")}</span>
                <select
                  value={newForceDraft.subtype}
                  onChange={(event) => {
                    const subtype = event.target.value;
                    const option = factionLordOptions(newForceDraft.faction).find(
                      (candidate) => candidate.subtype === subtype,
                    );
                    const leaderUnit = option
                      ? associatedUnitForSubculture(
                          option,
                          factionsByKey.get(newForceDraft.faction.toLowerCase())?.subculture,
                        )
                      : undefined;
                    setNewForceDraft((draft) =>
                      draft
                        ? { ...draft, subtype, units: leaderUnit ? [leaderUnit, ...draft.units.slice(1)] : [] }
                        : draft,
                    );
                  }}
                  disabled={factionLordOptions(newForceDraft.faction).length === 0}
                  className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-200 disabled:opacity-50"
                >
                  {factionLordOptions(newForceDraft.faction).map((option) => (
                    <option key={option.subtype} value={option.subtype}>
                      {formatSubtypeOption(option)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                <label className="flex items-center gap-2">
                  X
                  <input
                    type="number"
                    value={newForceDraft.x}
                    onChange={(event) =>
                      setNewForceDraft((draft) => (draft ? { ...draft, x: Number(event.target.value) } : draft))
                    }
                    className="w-full rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-gray-200"
                  />
                </label>
                <label className="flex items-center gap-2">
                  Y
                  <input
                    type="number"
                    value={newForceDraft.y}
                    onChange={(event) =>
                      setNewForceDraft((draft) => (draft ? { ...draft, y: Number(event.target.value) } : draft))
                    }
                    className="w-full rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-gray-200"
                  />
                </label>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
                  <span>
                    {mapMessage("mapNewForceUnits", "Units ({{count}}/20)", { count: newForceDraft.units.length })}
                  </span>
                  <span>{mapText("mapNewForceLeaderNote", "Leader is in slot 1")}</span>
                </div>
                <div className="space-y-1">
                  {newForceDraft.units.map((unitKey, index) => (
                    <div
                      key={`${unitKey}:${index}`}
                      className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/50 px-2 py-1 text-xs text-gray-300"
                    >
                      <span className="w-5 text-gray-500">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate" title={unitKey}>
                        {unitKey}
                      </span>
                      {index > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setNewForceDraft((draft) =>
                              draft
                                ? { ...draft, units: draft.units.filter((_, unitIndex) => unitIndex !== index) }
                                : draft,
                            )
                          }
                          className="text-red-300 hover:text-red-200"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {newForceDraft.units.length < 20 && (
                  <select
                    value=""
                    onChange={(event) => {
                      addNewForceUnit(event.target.value);
                      event.currentTarget.value = "";
                    }}
                    className="mt-2 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-300"
                  >
                    <option value="">{mapText("mapAddUnit", "Add unit…")}</option>
                    {groupExtendedUnitOptionsByCaste(
                      resolveExtendedUnitOptions(
                        unitCatalog,
                        factionsByKey.get(newForceDraft.faction.toLowerCase())?.subculture,
                      ),
                    ).map((group) => (
                      <optgroup key={group.key} label={group.name}>
                        {group.options.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button
              type="button"
              onClick={() => setNewForceDraft(undefined)}
              className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
            >
              {mapText("mapCancel", "Cancel")}
            </button>
            <button
              type="button"
              disabled={!newForceDraft.subtype || newForceDraft.units.length === 0}
              onClick={submitNewForce}
              className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {mapText("mapCreateForce", "Create force")}
            </button>
          </Modal.Footer>
        </Modal>
      )}

      {openEditPanel && (
        <Modal show onClose={() => setOpenEditPanel(undefined)} size="3xl" position="center">
          <Modal.Header>
            {openEditPanel === "ownership"
              ? mapText("mapOwnershipEditsTitle", "Ownership edits")
              : mapText("mapExtendedEditsTitle", "Character and map edits")}
          </Modal.Header>
          <Modal.Body>
            <div className="max-h-[65vh] space-y-2 overflow-y-auto">
              {openEditPanel === "ownership" ? (
                ownershipEditEntries.length > 0 ? (
                  ownershipEditEntries.map((edit) => {
                    const beforeLabel = edit.before
                      ? (factionsByKey.get(edit.before.toLowerCase())?.label ?? edit.before)
                      : mapText("mapUnowned", "Unowned");
                    const afterLabel = edit.after
                      ? (factionsByKey.get(edit.after.toLowerCase())?.label ?? edit.after)
                      : mapText("mapUnowned", "Unowned");
                    return (
                      <div
                        key={edit.region}
                        className="flex items-center gap-3 rounded border border-gray-700 bg-gray-950/60 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-gray-200" title={edit.region}>
                            {edit.region}
                          </div>
                          <div className="truncate text-xs text-gray-400" title={`${beforeLabel} → ${afterLabel}`}>
                            {beforeLabel} <span className="px-1 text-gray-600">→</span> {afterLabel}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => revertOwnershipEdit(edit.region)}
                          className="shrink-0 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
                          aria-label={`${mapText("mapRevertEdit", "Revert")} ${edit.region}`}
                        >
                          {mapText("mapRevertEdit", "Revert")}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-2 py-4 text-center text-sm text-gray-400">
                    {mapText("mapNoPendingEdits", "No pending edits.")}
                  </div>
                )
              ) : extendedEditActions.length > 0 ? (
                extendedEditActions.map((action, index) => {
                  const title = extendedEditActionTitle(action);
                  return (
                    <div
                      key={extendedEditActionKey(action, index)}
                      className="flex items-center gap-3 rounded border border-gray-700 bg-gray-950/60 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-gray-200" title={title}>
                          {title}
                        </div>
                        <div className="truncate text-xs text-gray-400" title={extendedEditActionDescription(action)}>
                          {extendedEditActionDescription(action)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => revertExtendedEdit(action)}
                        className="shrink-0 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
                        aria-label={`${mapText("mapRevertEdit", "Revert")} ${title}`}
                      >
                        {mapText("mapRevertEdit", "Revert")}
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="px-2 py-4 text-center text-sm text-gray-400">
                  {mapText("mapNoPendingEdits", "No pending edits.")}
                </div>
              )}
            </div>
          </Modal.Body>
        </Modal>
      )}
    </div>
  );
});

export default EsfMapTab;
