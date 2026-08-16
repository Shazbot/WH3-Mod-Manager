import React, { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { openMapForRegion } from "../../appSlice";
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
import AddChainModal from "./AddChainModal";
import { buildingsEditReducer, emptyBuildingsEditState } from "../../buildingsData/edits";
import { dbClonePackedFilesToBuildingsRows } from "../../buildingsData/dbCloneRows";
import {
  addBuildingLevelRows,
  disableBuildingRows,
  excludeFromSetRows,
  type AddBuildingLevelInput,
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
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const mapSelectedRegion = useAppSelector((state) => state.app.mapSelectedRegion);
  const enabledMods = useMemo(() => mods.filter((mod) => mod.isEnabled), [mods]);
  const enabledModsSignature = useMemo(
    () =>
      `${currentGame}|${enabledMods
        .map((mod) => `${mod.path}:${mod.loadOrder ?? ""}:${mod.lastChangedLocal ?? ""}:${mod.lastChanged ?? ""}`)
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

  const onQueryChange = useCallback((patch: Partial<BuildingsRegionQuery>) => {
    setQuery((previous) => ({ ...previous, ...patch }));
  }, []);

  const openMapForCurrentRegion = useCallback(() => {
    dispatch(openMapForRegion({ campaign: query.campaign, region: query.region }));
  }, [dispatch, query.campaign, query.region]);

  // The tooltip is portalled out of the board so the board's own `overflow: auto` cannot clip it.
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

  const onTileContextMenu = useCallback((tile: BuildingsTile, event: React.MouseEvent) => {
    setHoveredTile(undefined);
    const items: Array<{ label: string; target: BuildingsCloneTarget }> = [
      {
        label: "Deep clone this building (culture variant)",
        target: {
          tableName: "building_culture_variants_tables",
          keyColumn: "building",
          keyValue: tile.levelKey,
          label: tile.title,
        },
      },
      {
        label: "Deep clone the building level",
        target: {
          tableName: "building_levels_tables",
          keyColumn: "level_name",
          keyValue: tile.levelKey,
          label: tile.levelKey,
        },
      },
      {
        label: "Deep clone the whole chain",
        target: {
          tableName: "building_chains_tables",
          keyColumn: "key",
          keyValue: tile.chainKey,
          label: tile.chainKey,
        },
      },
    ];
    if (tile.instanceKey) {
      items.splice(2, 0, {
        label: "Deep clone the building instance",
        target: {
          tableName: "building_instances_tables",
          keyColumn: "key",
          keyValue: tile.instanceKey,
          label: tile.instanceKey,
        },
      });
    }
    setContextMenu({ x: event.clientX, y: event.clientY, heading: tile.title, items, tile });
  }, []);

  const onBandContextMenu = useCallback((setKey: string, setName: string, event: React.MouseEvent) => {
    setHoveredTile(undefined);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      heading: setName,
      items: [
        {
          label: "Deep clone this building set",
          target: { tableName: "building_sets_tables", keyColumn: "key", keyValue: setKey, label: setName },
        },
      ],
      band: { setKey, setName },
    });
  }, []);

  const moddersPrefix = useAppSelector((state) => state.app.moddersPrefix);
  const [edits, dispatchEdit] = useReducer(buildingsEditReducer, undefined, () => emptyBuildingsEditState());
  const [cloneTableSchemas, setCloneTableSchemas] = useState<Record<string, DBVersion>>({});
  const [addFrom, setAddFrom] = useState<BuildingsTile | undefined>();
  const [editTile, setEditTile] = useState<BuildingsTile | undefined>();
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
      setAddFrom(undefined);
      // The cursors are carried on the edit state, so ids stay unique across several additions.
      const cursors = { ...edits.numericIdCursors };
      dispatchEdit({ type: "addRows", rows: addBuildingLevelRows(input, cursors), numericIdCursors: cursors });
    },
    [edits.numericIdCursors],
  );

  const addEditRows = useCallback((rows: NewRowDraft[], numericIdCursors: Record<string, number>) => {
    dispatchEdit({ type: "addRows", rows, numericIdCursors });
  }, []);

  const tableSchemas = useMemo(
    () => ({ ...(catalog?.tableSchemas ?? {}), ...cloneTableSchemas }),
    [catalog?.tableSchemas, cloneTableSchemas],
  );

  const saveCloneToBuildings = useCallback(
    (packedFiles: PackedFile[]) => {
      const cloneOutput = dbClonePackedFilesToBuildingsRows(packedFiles);
      if (cloneOutput.rows.length === 0) {
        setError("DB Clone did not generate any rows.");
        return;
      }
      dispatchEdit({ type: "addRows", rows: cloneOutput.rows });
      setCloneTableSchemas((current) => ({ ...current, ...cloneOutput.tableSchemas }));
      setError(undefined);
      setSubTab("tables");
      closeDeepClone();
    },
    [closeDeepClone],
  );

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
    (chainKey: string) =>
      window.api?.getBuildingsCaiRows(enabledModsRef.current, chainKey, edits) ??
      Promise.resolve({ success: false, error: "Unavailable." }),
    [edits],
  );

  const pickCloneTarget = useCallback(
    (target: BuildingsCloneTarget) => {
      closeContextMenu();
      deepClone.openDeepCloneFor(target);
    },
    [closeContextMenu, deepClone],
  );

  useEffect(() => {
    if (currentGame !== "wh3") return;
    let isCurrent = true;
    setIsLoading(true);
    window.api
      ?.getBuildingsCatalog(enabledModsRef.current)
      .then((response) => {
        if (!isCurrent) return;
        if (!response.success || !response.catalog) {
          setError(response.error || "Could not read the game's building tables.");
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
  }, [currentGame, reloadNonce, signatureToRequest]);

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
          setError(response.error || "Could not build the buildings view.");
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
  }, [catalog?.dbPackPath, currentGame, edits, query]);

  if (currentGame !== "wh3") {
    return <div className="px-6 py-4 text-gray-300">Buildings are unavailable for this game.</div>;
  }

  return (
    <div className="flex h-[86vh] flex-col text-gray-200">
      <div className="flex items-center gap-1 border-b border-gray-700 px-4">
        {(["board", "tables"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSubTab(tab)}
            className={`px-3 py-1.5 text-sm ${
              subTab === tab ? "border-b-2 border-blue-500 text-gray-100" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab === "board" ? "Board" : `New rows${edits.order.length > 0 ? ` (${edits.order.length})` : ""}`}
            {tab === "tables" && rowIssues && rowIssues.length > 0 && <span className="ml-1 text-amber-400">!</span>}
          </button>
        ))}
      </div>

      {catalog && subTab === "board" && (
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
        {subTab === "tables" && catalog && (
          <BuildingsTablesTab state={edits} dispatch={dispatchEdit} tableSchemas={tableSchemas} rowIssues={rowIssues} />
        )}
        {subTab === "board" && isLoading && !view && (
          <div className="flex h-full items-center justify-center">
            <div className="dots-loader" />
          </div>
        )}
        {subTab === "board" && view && (
          <BuildingsBoard
            view={view}
            zoom={zoom}
            onTileHover={onTileHover}
            onTileContextMenu={onTileContextMenu}
            onBandContextMenu={onBandContextMenu}
          />
        )}
        {subTab === "board" && hoveredTile && (
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, zIndex: 60 }}
            className="pointer-events-none"
            role="tooltip"
          >
            <BuildingTooltip tile={hoveredTile} />
          </div>
        )}
      </div>

      {(view || edits.order.length > 0) && (
        <div className="border-t border-gray-700 px-4 py-1 text-[0.7rem] text-gray-500">
          {view && subTab === "board" && (
            <>
              {view.bands.length} sets · {view.bands.reduce((total, band) => total + band.columns.length, 0)} chains ·{" "}
              {view.slotTemplates.length} slot templates
              {view.existingBuildings.length > 0 && ` · ${view.existingBuildings.length} placed in this region`}
              {isLoading && " · refreshing..."}
            </>
          )}
          {edits.order.length > 0 && (
            <span className="ml-3 text-emerald-400">
              {edits.order.length} new row{edits.order.length === 1 ? "" : "s"}
              <button
                type="button"
                onClick={() => setIsSaveOpen(true)}
                className="ml-2 rounded bg-blue-700 px-2 py-0.5 text-[0.7rem] text-white hover:bg-blue-600"
              >
                Save to pack
              </button>
              <button
                type="button"
                onClick={() => dispatchEdit({ type: "reset" })}
                className="ml-1 rounded bg-gray-700 px-2 py-0.5 text-[0.7rem] text-gray-200 hover:bg-gray-600"
              >
                Discard
              </button>
            </span>
          )}
        </div>
      )}

      {contextMenu && (
        <BuildingContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          heading={contextMenu.heading}
          items={contextMenu.items}
          onPick={pickCloneTarget}
          onClose={closeContextMenu}
          editActions={
            contextMenu.band
              ? [{ label: "Add a new chain to this band", run: () => setAddChainTo(contextMenu.band) }]
              : contextMenu.tile
                ? [
                    { label: "Add a building above this", run: () => setAddFrom(contextMenu.tile) },
                    { label: "Recruitment, garrison, AI scoring...", run: () => setEditTile(contextMenu.tile) },
                    {
                      label: "Disable for this culture",
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
                      label: "Remove this chain from its band",
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

      {addFrom && (
        <AddBuildingModal
          from={addFrom}
          query={query}
          keyPrefix={keyPrefix}
          onCancel={() => setAddFrom(undefined)}
          onAdd={addBuilding}
        />
      )}

      {addChainTo && view && (
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

      {liveEditTile && catalog && (
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

      {isSaveOpen && catalog && (
        <BuildingsSaveModal
          state={edits}
          tableSchemas={tableSchemas}
          moddersPrefix={moddersPrefix}
          onClose={() => setIsSaveOpen(false)}
          onSaved={() => {
            dispatchEdit({ type: "reset" });
            setReloadNonce((previous) => previous + 1);
          }}
        />
      )}

      {deepClone.isResolving && (
        <div className="fixed bottom-4 right-4 z-[80] rounded bg-gray-800 px-3 py-2 text-xs text-gray-200 shadow-lg">
          Reading the table for {deepClone.resolvingLabel}...
        </div>
      )}

      {deepClone.error && (
        <Modal onClose={deepClone.dismissError} show size="md" position="center">
          <Modal.Header>Deep clone</Modal.Header>
          <Modal.Body>
            <p className="text-sm text-gray-300">{deepClone.error}</p>
          </Modal.Body>
        </Modal>
      )}

      {deepClone.isDialogOpen && (
        <Modal
          onClose={deepClone.close}
          show
          size="6xl"
          position="top-center"
          explicitClasses={["mt-8", "!max-w-7xl", "md:!h-full", "overflow-hidden", "modalDontOverflowWindowHeight"]}
        >
          <Modal.Header>Deep Cloning...</Modal.Header>
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
