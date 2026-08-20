import React, { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { useLocalizations } from "../../localizationContext";
import { openMapForRegion } from "../../appSlice";
import { sortByNameAndLoadOrder } from "../../modSortingHelpers";
import { useDeferredWhileInactive } from "../useDeferredWhileInactive";
import BuildingsFilters from "./BuildingsFilters";
import BuildingsBoard from "./BuildingsBoard";
import BuildingTooltip from "./BuildingTooltip";
import BuildingContextMenu from "./BuildingContextMenu";
import { useBuildingsDeepClone, type BuildingsCloneTarget } from "./useBuildingsDeepClone";
import { Modal } from "../../flowbite";
import DBDuplication from "../viewer/DBDuplication";
import AddBuildingModal from "./AddBuildingModal";
import BuildingsSaveModal from "./BuildingsSaveModal";
import BuildingsTablesTab from "./BuildingsTablesTab";
import BuildingEditModal from "./BuildingEditModal";
import BuildingCultureVariantsModal from "./BuildingCultureVariantsModal";
import AddChainModal from "./AddChainModal";
import { buildingsEditReducer, emptyBuildingsEditState } from "../../buildingsData/edits";
import { dbClonePackedFilesToBuildingsRows, filterDuplicateBuildingsCloneRows } from "../../buildingsData/dbCloneRows";
import {
  addBuildingLevelRows,
  canAddBuildingBelow,
  canMoveBuilding,
  canMoveBuildingChain,
  disableBuildingRows,
  excludeFromSetRows,
  levelsToShiftForBuildingBelow,
  moveBuildingChainRows,
  moveBuildingRows,
  type AddBuildingLevelInput,
  type BuildingLevelShift,
  type NewRowDraft,
} from "../../buildingsData/editActions";
import type { BuildingsRowIssue } from "../../buildingsData/validate";
import type {
  BuildingsCatalog,
  BuildingsRegionQuery,
  BuildingsRegionView,
  BuildingsTile,
} from "../../buildingsData/types";
import type { DBVersion, PackedFile } from "../../packFileTypes";

type BuildingsTabProps = {
  /** False while the tab is mounted but hidden, so rebuilds wait for the user to come back. */
  isActive?: boolean;
};

const DEFAULT_QUERY: BuildingsRegionQuery = {
  campaign: "wh3_main_combi",
  region: "wh3_main_combi_region_altdorf",
  culture: "wh_main_emp_empire",
};

const BuildingsTab = memo(({ isActive = true }: BuildingsTabProps) => {
  const dispatch = useAppDispatch();
  const localized = useLocalizations();
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const mapSelectedRegion = useAppSelector((state) => state.app.mapSelectedRegion);
  const enabledMods = useMemo(() => mods.filter((mod) => mod.isEnabled), [mods]);
  const enabledModsSignature = useMemo(
    () =>
      `${currentGame}|${sortByNameAndLoadOrder(enabledMods)
        .map((mod) => `${mod.path}:${mod.loadOrder ?? ""}:${mod.lastChangedLocal ?? ""}`)
        .join("|")}`,
    [currentGame, enabledMods],
  );
  // While hidden this stays at the signature the tab last saw, so enabling a mod elsewhere queues
  // the rebuild instead of running it; switching back releases it and rebuilds once.
  const signatureToRequest = useDeferredWhileInactive(isActive, enabledModsSignature);
  const enabledModsRef = useRef(enabledMods);
  enabledModsRef.current = enabledMods;

  const [catalog, setCatalog] = useState<BuildingsCatalog | undefined>();
  const [view, setView] = useState<BuildingsRegionView | undefined>();
  const [rowIssues, setRowIssues] = useState<BuildingsRowIssue[] | undefined>();
  const [query, setQuery] = useState<BuildingsRegionQuery>(DEFAULT_QUERY);
  const [subTab, setSubTab] = useState<"board" | "tables">("board");
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [isRebuildingData, setIsRebuildingData] = useState(false);

  const onQueryChange = useCallback((patch: Partial<BuildingsRegionQuery>) => {
    setQuery((previous) => ({ ...previous, ...patch }));
  }, []);

  const openMapForCurrentRegion = useCallback(() => {
    dispatch(openMapForRegion({ campaign: query.campaign, region: query.region }));
  }, [dispatch, query.campaign, query.region]);

  // The tooltip lives outside the board so its `overflow: auto` cannot clip it or contain its z-index.
  const [hoveredTile, setHoveredTile] = useState<BuildingsTile | undefined>();
  const { refs, floatingStyles } = useFloating({
    placement: "right-start",
    middleware: [offset(12), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const onTileHover = useCallback(
    (tile: BuildingsTile | undefined, element: HTMLElement | undefined) => {
      setHoveredTile(tile);
      refs.setReference(element ?? null);
    },
    [refs],
  );

  // A new view replaces every tile, so anything still hovered is a tile that no longer exists.
  useEffect(() => {
    setHoveredTile(undefined);
    refs.setReference(null);
  }, [refs, view]);

  const deepClone = useBuildingsDeepClone(catalog?.dbPackPath);
  const closeDeepClone = deepClone.close;
  const [contextMenu, setContextMenu] = useState<
    | {
        x: number;
        y: number;
        heading: string;
        items: Array<{ label: string; target: BuildingsCloneTarget }>;
        tile?: BuildingsTile;
        band?: { setKey: string; setName: string };
      }
    | undefined
  >();
  const closeContextMenu = useCallback(() => setContextMenu(undefined), []);

  const onTileContextMenu = useCallback(
    (tile: BuildingsTile, event: React.MouseEvent) => {
      if (!isFeaturesForModdersEnabled) return;
      setHoveredTile(undefined);
      const items: Array<{ label: string; target: BuildingsCloneTarget }> = [
        {
          label: localized.buildingsCloneBuildingVariant || "Deep clone this building (culture variant)",
          target: {
            tableName: "building_culture_variants_tables",
            keyColumn: "building",
            keyValue: tile.levelKey,
            label: tile.title,
            sourcePackPath: tile.cloneSourcePackPath,
          },
        },
      ];
      setContextMenu({ x: event.clientX, y: event.clientY, heading: tile.title, items, tile });
    },
    [isFeaturesForModdersEnabled, localized.buildingsCloneBuildingVariant],
  );

  const onBandContextMenu = useCallback(
    (setKey: string, setName: string, event: React.MouseEvent) => {
      if (!isFeaturesForModdersEnabled) return;
      setHoveredTile(undefined);
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        heading: setName,
        items: [
          {
            label: localized.buildingsCloneBuildingSet || "Deep clone this building set",
            target: {
              tableName: "building_sets_tables",
              keyColumn: "key",
              keyValue: setKey,
              label: setName,
              sourcePackPath: view?.bands.find((band) => band.setKey === setKey)?.cloneSourcePackPath,
            },
          },
        ],
        band: { setKey, setName },
      });
    },
    [isFeaturesForModdersEnabled, localized.buildingsCloneBuildingSet, view],
  );

  const moddersPrefix = useAppSelector((state) => state.app.moddersPrefix);
  const [edits, dispatchEdit] = useReducer(buildingsEditReducer, undefined, () => emptyBuildingsEditState());
  const [cloneTableSchemas, setCloneTableSchemas] = useState<Record<string, DBVersion>>({});
  const [addFrom, setAddFrom] = useState<
    { tile: BuildingsTile; direction: "above" | "below"; shiftedLevelRows?: BuildingLevelShift[] } | undefined
  >();
  const [editTile, setEditTile] = useState<BuildingsTile | undefined>();
  const [editCultureVariantsTile, setEditCultureVariantsTile] = useState<BuildingsTile | undefined>();
  const [addChainTo, setAddChainTo] = useState<{ setKey: string; setName: string } | undefined>();
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  // Bumped after a save so the catalog is re-read: the rows are in a pack now, and should come back
  // as ordinary data rather than stay pending. They only reappear if that pack is enabled.
  const [reloadNonce, setReloadNonce] = useState(0);
  const keyPrefix = useMemo(() => moddersPrefix.trim().replace(/_+$/, "") || "custom", [moddersPrefix]);

  // Numeric-keyed junctions must start after the highest effective game/mod row. Seeding only while
  // there are no pending edits avoids changing allocation underneath a row the user is still editing.
  useEffect(() => {
    if (!catalog) return;
    dispatchEdit({ type: "seedNumericIdCursors", numericIdCursors: catalog.nextNumericIds });
  }, [catalog, edits.order.length]);

  const addBuilding = useCallback(
    (input: AddBuildingLevelInput) => {
      if (!isFeaturesForModdersEnabled) return;
      setAddFrom(undefined);
      // The cursors are carried on the edit state, so ids stay unique across several additions.
      const cursors = { ...edits.numericIdCursors };
      dispatchEdit({ type: "addRows", rows: addBuildingLevelRows(input, cursors), numericIdCursors: cursors });
    },
    [edits.numericIdCursors, isFeaturesForModdersEnabled],
  );

  const addEditRows = useCallback(
    (rows: NewRowDraft[], numericIdCursors: Record<string, number>) => {
      if (!isFeaturesForModdersEnabled) return;
      dispatchEdit({ type: "addRows", rows, numericIdCursors });
    },
    [isFeaturesForModdersEnabled],
  );

  const tableSchemas = useMemo(
    () => ({ ...(catalog?.tableSchemas ?? {}), ...cloneTableSchemas }),
    [catalog?.tableSchemas, cloneTableSchemas],
  );

  const saveCloneToBuildings = useCallback(
    (packedFiles: PackedFile[]) => {
      if (!isFeaturesForModdersEnabled) {
        closeDeepClone();
        return;
      }
      const cloneOutput = dbClonePackedFilesToBuildingsRows(packedFiles);
      if (cloneOutput.rows.length === 0) {
        setError(localized.buildingsCloneNoRows || "DB Clone did not generate any rows.");
        return;
      }
      const rows = filterDuplicateBuildingsCloneRows(
        cloneOutput.rows,
        edits.order.map((id) => edits.rowsById[id]).filter((row): row is NonNullable<typeof row> => !!row),
        { ...tableSchemas, ...cloneOutput.tableSchemas },
      );
      if (rows.length === 0) {
        setError(undefined);
        closeDeepClone();
        return;
      }
      dispatchEdit({ type: "addRows", rows });
      setCloneTableSchemas((current) => ({ ...current, ...cloneOutput.tableSchemas }));
      setError(undefined);
      setSubTab("tables");
      closeDeepClone();
    },
    [closeDeepClone, edits, isFeaturesForModdersEnabled, localized.buildingsCloneNoRows, tableSchemas],
  );

  const clearPendingEdits = useCallback(() => {
    dispatchEdit({ type: "reset" });
    setCloneTableSchemas({});
    setRowIssues(undefined);
    setError(undefined);
    // Pending rows may have added filter/catalog options. Reload the base catalog so those options
    // disappear at the same time as the Board rows.
    setReloadNonce((previous) => previous + 1);
  }, []);

  /**
   * Effect rows we have already written for the building being edited, keyed by effect.
   *
   * Last one wins, matching the composite-key dedupe: if two rows name the same effect the later is
   * the one the board is showing, so that is the one to edit or drop.
   */
  const pendingEffectsForTile = useMemo(() => {
    const byEffect: Record<string, { id: string; value: number }> = {};
    if (!editTile) return byEffect;
    for (const id of edits.order) {
      const row = edits.rowsById[id];
      if (row?.table !== "building_effects_junction_tables") continue;
      if (row.values.building !== editTile.levelKey) continue;
      byEffect[row.values.effect] = { id, value: Number(row.values.value) || 0 };
    }
    return byEffect;
  }, [edits, editTile]);

  // Pending rows replace the view's tile objects. Keep an open editor on the live tile so its
  // recruitment, garrison and effect counts update immediately after each action.
  const liveEditTile = useMemo(() => {
    if (!editTile || !view) return editTile;
    return (
      view.bands
        .flatMap((band) => band.columns.flatMap((column) => column.tiles))
        .find((tile) => tile.levelKey === editTile.levelKey && tile.setKey === editTile.setKey) ?? editTile
    );
  }, [editTile, view]);

  const fetchCaiRows = useCallback(
    (chainKey: string) => {
      if (!isFeaturesForModdersEnabled)
        return Promise.resolve({ success: false, error: localized.buildingsUnavailable || "Unavailable." });
      return (
        window.api?.getBuildingsCaiRows(enabledModsRef.current, chainKey, edits) ??
        Promise.resolve({ success: false, error: localized.buildingsUnavailable || "Unavailable." })
      );
    },
    [edits, isFeaturesForModdersEnabled, localized.buildingsUnavailable],
  );

  const pickCloneTarget = useCallback(
    (target: BuildingsCloneTarget) => {
      if (!isFeaturesForModdersEnabled) return;
      closeContextMenu();
      deepClone.openDeepCloneFor(target);
    },
    [closeContextMenu, deepClone, isFeaturesForModdersEnabled],
  );

  const movementActionsForTile = useCallback(
    (tile: BuildingsTile): Array<{ label: string; run: () => void }> => {
      const actions: Array<{ label: string; run: () => void }> = [];
      const addMove = (label: string, rows: NewRowDraft[]) => {
        if (rows.length === 0) return;
        actions.push({
          label,
          run: () => dispatchEdit({ type: "addRows", rows }),
        });
      };

      if (canMoveBuilding(tile, view, "lower")) {
        addMove(localized.buildingsMoveBuildingLower || "Move this building lower", moveBuildingRows(tile, "lower"));
      }
      if (canMoveBuilding(tile, view, "higher")) {
        addMove(localized.buildingsMoveBuildingHigher || "Move this building higher", moveBuildingRows(tile, "higher"));
      }
      if (canMoveBuildingChain(tile, view, "lower")) {
        addMove(
          localized.buildingsMoveChainLower || "Move the whole chain lower",
          moveBuildingChainRows(tile, view, "lower"),
        );
      }
      if (canMoveBuildingChain(tile, view, "higher")) {
        addMove(
          localized.buildingsMoveChainHigher || "Move the whole chain higher",
          moveBuildingChainRows(tile, view, "higher"),
        );
      }
      return actions;
    },
    [
      dispatchEdit,
      localized.buildingsMoveBuildingHigher,
      localized.buildingsMoveBuildingLower,
      localized.buildingsMoveChainHigher,
      localized.buildingsMoveChainLower,
      view,
    ],
  );

  // Editing dialogs and the context menu must not remain usable after the option is switched off.
  // Pending rows stay in memory so enabling the option again does not silently discard the user's
  // work, but they cannot be changed or saved while the option is disabled. The deep-clone hook
  // shares its Redux target with the main database viewer, so its UI is hidden here rather than
  // clearing that shared target from another feature.
  useEffect(() => {
    if (isFeaturesForModdersEnabled) return;
    setContextMenu(undefined);
    setAddFrom(undefined);
    setEditTile(undefined);
    setEditCultureVariantsTile(undefined);
    setAddChainTo(undefined);
    setIsSaveOpen(false);
  }, [isFeaturesForModdersEnabled]);

  useEffect(() => {
    return window.api?.onBuildingsDataRebuild?.((_event, rebuilding) => setIsRebuildingData(rebuilding));
  }, []);

  useEffect(() => {
    if (currentGame !== "wh3") return;
    let isCurrent = true;
    setIsLoading(true);
    window.api
      ?.getBuildingsCatalog(enabledModsRef.current)
      .then((response) => {
        if (!isCurrent) return;
        if (!response.success || !response.catalog) {
          setError(response.error || localized.buildingsLoadFailed || "Could not read the game's building tables.");
          return;
        }
        setError(undefined);
        setCatalog(response.catalog);
        // A default that does not exist in this install would leave the board permanently empty, so
        // fall back to whatever the catalog does have.
        setQuery((previous) => {
          const campaign = response.catalog!.campaigns.some((option) => option.key === previous.campaign)
            ? previous.campaign
            : (response.catalog!.campaigns[0]?.key ?? previous.campaign);
          const regionsForCampaign = response.catalog!.regions.filter(
            (region) => region.campaigns.length === 0 || region.campaigns.includes(campaign),
          );
          const region = regionsForCampaign.some((option) => option.key === previous.region)
            ? previous.region
            : (regionsForCampaign[0]?.key ?? previous.region);
          return { ...previous, campaign, region };
        });
      })
      .catch((reason) => {
        if (isCurrent) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [currentGame, localized.buildingsLoadFailed, reloadNonce, signatureToRequest]);

  useEffect(() => {
    if (!catalog || !mapSelectedRegion) return;
    const campaignIsAvailable = catalog.campaigns.some((campaign) => campaign.key === mapSelectedRegion.campaign);
    const regionIsAvailable = catalog.regions.some(
      (region) =>
        region.key === mapSelectedRegion.region &&
        (region.campaigns.length === 0 || region.campaigns.includes(mapSelectedRegion.campaign)),
    );
    if (!campaignIsAvailable || !regionIsAvailable) return;
    setQuery((previous) => {
      if (previous.campaign === mapSelectedRegion.campaign && previous.region === mapSelectedRegion.region) {
        return previous;
      }
      return {
        ...previous,
        campaign: mapSelectedRegion.campaign,
        region: mapSelectedRegion.region,
        settlementType: undefined,
      };
    });
  }, [catalog, mapSelectedRegion]);

  useEffect(() => {
    if (currentGame !== "wh3" || !catalog?.dbPackPath || !query.campaign || !query.region) return;
    let isCurrent = true;
    setIsLoading(true);
    window.api
      ?.getBuildingsRegionView(enabledModsRef.current, query, edits)
      .then((response) => {
        if (!isCurrent) return;
        if (!response.success || !response.view) {
          setError(response.error || localized.buildingsViewFailed || "Could not build the buildings view.");
          return;
        }
        setError(undefined);
        // With no pending rows the catalog-loading effect already owns this state. Updating it here
        // would repeatedly reseed the empty edit state and request the same view again.
        if (response.catalog && edits.order.length > 0) setCatalog(response.catalog);
        setView(response.view);
        setRowIssues(response.rowIssues);
      })
      .catch((reason) => {
        if (isCurrent) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [catalog?.dbPackPath, currentGame, edits, localized.buildingsViewFailed, query]);

  if (currentGame !== "wh3") {
    return (
      <div className="px-6 py-4 text-gray-300">
        {localized.buildingsNotAvailableForGame || "Buildings are unavailable for this game."}
      </div>
    );
  }

  // Everything that writes rows is modder-only. When the option is off, the board remains a
  // read-only browser regardless of whichever sub-tab was selected before it was disabled.
  const activeSubTab = isFeaturesForModdersEnabled ? subTab : "board";

  return (
    <div className="relative flex h-[86vh] flex-col text-gray-200">
      {isRebuildingData && (
        <Modal show popup size="sm" position="center">
          <Modal.Body>
            <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
              <div className="dots-loader" />
              <p>{localized.buildingsRebuildingData || "Rebuilding Buildings data. This may take a moment..."}</p>
            </div>
          </Modal.Body>
        </Modal>
      )}

      {isFeaturesForModdersEnabled && (
        <div className="flex items-center gap-1 border-b border-gray-700 px-4">
          {(["board", "tables"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSubTab(tab)}
              className={`px-3 py-1.5 text-sm ${
                activeSubTab === tab ? "border-b-2 border-blue-500 text-gray-100" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab === "board"
                ? localized.buildingsBoardTab || "Board"
                : `${localized.buildingsNewRowsTab || "New rows"}${edits.order.length > 0 ? ` (${edits.order.length})` : ""}`}
              {tab === "tables" && rowIssues && rowIssues.length > 0 && <span className="ml-1 text-amber-400">!</span>}
            </button>
          ))}
        </div>
      )}

      {catalog && activeSubTab === "board" && (
        <BuildingsFilters
          catalog={catalog}
          query={query}
          settlementTypeOptions={view?.settlementTypeOptions ?? []}
          settlementTypeDisabled={view?.settlementTypeDisabled ?? true}
          zoom={zoom}
          onQueryChange={onQueryChange}
          onZoomChange={setZoom}
          onOpenMap={openMapForCurrentRegion}
        />
      )}

      {error && <div className="px-4 py-2 text-sm text-red-400">{error}</div>}

      {/* `z-0` keeps the tiles' own z-indices contained here rather than competing with the filters. */}
      <div className="relative z-0 min-h-0 flex-1 content-center">
        {activeSubTab === "tables" && catalog && (
          <BuildingsTablesTab
            state={edits}
            dispatch={dispatchEdit}
            onClearAll={clearPendingEdits}
            tableSchemas={tableSchemas}
            rowIssues={rowIssues}
          />
        )}
        {activeSubTab === "board" && isLoading && !view && (
          <div className="flex h-full items-center justify-center">
            <div className="dots-loader" />
          </div>
        )}
        {activeSubTab === "board" && view && (
          <BuildingsBoard
            view={view}
            zoom={zoom}
            onTileHover={onTileHover}
            onTileContextMenu={isFeaturesForModdersEnabled ? onTileContextMenu : undefined}
            onBandContextMenu={isFeaturesForModdersEnabled ? onBandContextMenu : undefined}
          />
        )}
      </div>

      {/* Keep the tooltip outside the board's z-0 stacking context so it can clear the filter dropdowns. */}
      {activeSubTab === "board" && hoveredTile && (
        <div
          ref={refs.setFloating}
          style={{ ...floatingStyles, zIndex: 60 }}
          className="pointer-events-none"
          role="tooltip"
        >
          <BuildingTooltip tile={hoveredTile} />
        </div>
      )}

      {(view || edits.order.length > 0) && (
        <div className="border-t border-gray-700 px-4 py-1 text-[0.7rem] text-gray-500">
          {view && activeSubTab === "board" && (
            <>
              {(localized.buildingsStatusSummary || "{{sets}} sets · {{chains}} chains · {{slots}} slot templates")
                .replace("{{sets}}", `${view.bands.length}`)
                .replace("{{chains}}", `${view.bands.reduce((total, band) => total + band.columns.length, 0)}`)
                .replace("{{slots}}", `${view.slotTemplates.length}`)}
              {view.existingBuildings.length > 0 &&
                (localized.buildingsStatusPlaced || " · {{count}} placed in this region").replace(
                  "{{count}}",
                  `${view.existingBuildings.length}`,
                )}
              {isLoading && (localized.buildingsRefreshing || " · refreshing...")}
            </>
          )}
          {isFeaturesForModdersEnabled && edits.order.length > 0 && (
            <span className="ml-3 text-emerald-400">
              {(localized.buildingsNewRowCount || "{{count}} new row(s)")
                .replace("{{count}}", `${edits.order.length}`)
                .replace("row(s)", edits.order.length === 1 ? "row" : "rows")}
              <button
                type="button"
                onClick={() => setIsSaveOpen(true)}
                className="ml-2 rounded bg-blue-700 px-2 py-0.5 text-[0.7rem] text-white hover:bg-blue-600"
              >
                {localized.buildingsSaveToPack || "Save to pack"}
              </button>
              <button
                type="button"
                onClick={() => dispatchEdit({ type: "reset" })}
                className="ml-1 rounded bg-gray-700 px-2 py-0.5 text-[0.7rem] text-gray-200 hover:bg-gray-600"
              >
                {localized.buildingsDiscard || "Discard"}
              </button>
            </span>
          )}
        </div>
      )}

      {contextMenu && isFeaturesForModdersEnabled && (
        <BuildingContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          heading={contextMenu.heading}
          items={contextMenu.items}
          onPick={pickCloneTarget}
          onClose={closeContextMenu}
          editActions={
            contextMenu.band
              ? [
                  {
                    label: localized.buildingsAddChainToSet || "Add a new chain to this set",
                    run: () => setAddChainTo(contextMenu.band),
                  },
                ]
              : contextMenu.tile
                ? [
                    ...movementActionsForTile(contextMenu.tile),
                    {
                      label: localized.buildingsAddAbove || "Add a building above this",
                      run: () => setAddFrom({ tile: contextMenu.tile!, direction: "above" }),
                    },
                    ...(canAddBuildingBelow(contextMenu.tile, view)
                      ? [
                          {
                            label: localized.buildingsAddBelow || "Add a building below this",
                            run: () =>
                              setAddFrom({
                                tile: contextMenu.tile!,
                                direction: "below",
                                shiftedLevelRows: levelsToShiftForBuildingBelow(contextMenu.tile!, view),
                              }),
                          },
                        ]
                      : []),
                    {
                      label: localized.buildingsEditBuilding || "Edit Building...",
                      run: () => setEditTile(contextMenu.tile),
                    },
                    {
                      label: localized.buildingsEditCultureVariants || "Edit culture variants...",
                      run: () => setEditCultureVariantsTile(contextMenu.tile),
                    },
                    {
                      label: localized.buildingsDisableCulture || "Disable for this culture",
                      run: () =>
                        dispatchEdit({
                          type: "addRows",
                          rows: disableBuildingRows({
                            levelKey: contextMenu.tile!.levelKey,
                            culture: query.culture ?? "",
                            subculture: query.subculture ?? "",
                            faction: query.faction ?? "",
                          }),
                        }),
                    },
                    {
                      label: localized.buildingsRemoveChainFromSet || "Remove this chain from its set",
                      run: () =>
                        dispatchEdit({
                          type: "addRows",
                          rows: excludeFromSetRows({
                            chainKey: contextMenu.tile!.chainKey,
                            setKey: contextMenu.tile!.setKey,
                          }),
                        }),
                    },
                  ]
                : undefined
          }
        />
      )}

      {addFrom && isFeaturesForModdersEnabled && (
        <AddBuildingModal
          from={addFrom.tile}
          direction={addFrom.direction}
          shiftedLevelRows={addFrom.shiftedLevelRows}
          query={query}
          keyPrefix={keyPrefix}
          onCancel={() => setAddFrom(undefined)}
          onAdd={addBuilding}
        />
      )}

      {addChainTo && view && isFeaturesForModdersEnabled && (
        <AddChainModal
          setKey={addChainTo.setKey}
          setName={addChainTo.setName}
          query={query}
          view={view}
          keyPrefix={keyPrefix}
          numericIdCursors={edits.numericIdCursors}
          onCancel={() => setAddChainTo(undefined)}
          onAdd={(rows, cursors) => {
            setAddChainTo(undefined);
            addEditRows(rows, cursors);
          }}
        />
      )}

      {liveEditTile && catalog && isFeaturesForModdersEnabled && (
        <BuildingEditModal
          tile={liveEditTile}
          catalog={catalog}
          numericIdCursors={edits.numericIdCursors}
          fetchCaiRows={fetchCaiRows}
          pendingEffects={pendingEffectsForTile}
          onClose={() => setEditTile(undefined)}
          dispatch={dispatchEdit}
        />
      )}

      {editCultureVariantsTile && catalog && isFeaturesForModdersEnabled && (
        <BuildingCultureVariantsModal
          tile={editCultureVariantsTile}
          catalog={catalog}
          edits={edits}
          onClose={() => setEditCultureVariantsTile(undefined)}
          dispatch={dispatchEdit}
        />
      )}

      {isSaveOpen && catalog && isFeaturesForModdersEnabled && (
        <BuildingsSaveModal
          state={edits}
          tableSchemas={tableSchemas}
          moddersPrefix={moddersPrefix}
          onClose={() => setIsSaveOpen(false)}
          onSaved={() => {
            dispatchEdit({ type: "reset" });
            setReloadNonce((previous) => previous + 1);
            setIsSaveOpen(false);
          }}
        />
      )}

      {isFeaturesForModdersEnabled && deepClone.isResolving && (
        <div className="fixed bottom-4 right-4 z-[80] rounded bg-gray-800 px-3 py-2 text-xs text-gray-200 shadow-lg">
          {localized.buildingsReadTableFor || "Reading the table for"} {deepClone.resolvingLabel}...
        </div>
      )}

      {isFeaturesForModdersEnabled && deepClone.error && (
        <Modal onClose={deepClone.dismissError} show size="md" position="center">
          <Modal.Header>{localized.buildingsDeepClone || "Deep clone"}</Modal.Header>
          <Modal.Body>
            <p className="text-sm text-gray-300">{deepClone.error}</p>
          </Modal.Body>
        </Modal>
      )}

      {isFeaturesForModdersEnabled && deepClone.isDialogOpen && (
        <Modal
          onClose={deepClone.close}
          show
          size="6xl"
          position="top-center"
          explicitClasses={["mt-8", "!max-w-7xl", "md:!h-full", "overflow-hidden", "modalDontOverflowWindowHeight"]}
        >
          <Modal.Header>{localized.buildingsDeepCloning || "Deep Cloning..."}</Modal.Header>
          <Modal.Body>
            <div className="mt-8 text-center">
              <DBDuplication launchSource="buildings" onSaveToBuildings={saveCloneToBuildings} />
            </div>
          </Modal.Body>
        </Modal>
      )}
    </div>
  );
});

export default BuildingsTab;
