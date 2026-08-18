import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { clearMapRegionSelection, selectMapRegion, setMapCampaignName } from "../appSlice";
import { useDeferredWhileInactive } from "./useDeferredWhileInactive";
import type { EsfMapArea, EsfMapCampaignOption, EsfMapMarker, EsfMapPayload } from "../esfMap/types";

type EsfMapTabProps = {
  isActive?: boolean;
};

const MAP_AREA_OPACITY = 0.36;
const FACTION_FLAG_SIZE = 20;

type MapView = "regions" | "factions";

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

const EsfMapTab = memo(({ isActive = true }: EsfMapTabProps) => {
  const dispatch = useAppDispatch();
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
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const mapImagesRef = useRef(new Map<string, HTMLImageElement>());
  const mapDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  }>();
  const suppressMapClickRef = useRef(false);
  const [map, setMap] = useState<EsfMapPayload>();
  const [campaignOptions, setCampaignOptions] = useState<EsfMapCampaignOption[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<number>();
  const [selectedSettlementType, setSelectedSettlementType] = useState("");
  const [mapView, setMapView] = useState<MapView>("regions");
  const [filter, setFilter] = useState("");
  const [zoom, setZoom] = useState(1);
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

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
          setMap(undefined);
          setError(response.error);
          return;
        }
        setMap(response.map);
        setCampaignOptions(response.map.availableCampaigns);
        setSelectedSettlementType("");
        if (response.map.campaignKey !== mapCampaignName) dispatch(setMapCampaignName(response.map.campaignKey));
      })
      .catch((reason) => {
        if (current) {
          setMap(undefined);
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

  const factionsByKey = useMemo(
    () => new Map((map?.factions ?? []).map((faction) => [faction.key.toLowerCase(), faction])),
    [map],
  );

  const filteredFactions = useMemo(() => {
    if (!map) return [];
    const query = filter.trim().toLowerCase();
    if (!query) return map.factions;
    return map.factions.filter((faction) =>
      [faction.key, faction.label].some((value) => value.toLowerCase().includes(query)),
    );
  }, [filter, map]);

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
  }, [map, mapSelectedRegion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.width = map.width;
    canvas.height = map.height;
    canvas.style.width = `${Math.max(320, Math.round(map.width * zoom))}px`;
    canvas.style.height = `${Math.max(240, Math.round(map.height * zoom))}px`;

    const selected =
      selectedMarkerId === undefined ? undefined : map.markers.find((marker) => marker.id === selectedMarkerId);
    const selectedFactionKey = factionKey(selected?.ownerFaction);

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

      if (mapView === "factions" && selectedFactionKey) {
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
      } else if (mapView === "regions" && selected && regionMatchesSettlementType(selected.key)) {
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
    const flagSources =
      mapView === "factions"
        ? map.factions.map((faction) => faction.flagUrl).filter((src): src is string => !!src)
        : [];
    const imageSources = Array.from(
      new Set([backgroundSrc, backgroundTextSrc, ...flagSources].filter(Boolean)),
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
    drawMap(cachedImages.get(backgroundSrc ?? ""), cachedImages.get(backgroundTextSrc ?? ""), flagImages);

    const missingSources = imageSources.filter((src) => !cachedImages.has(src));
    if (missingSources.length === 0) return;

    let cancelled = false;
    void Promise.all(missingSources.map((src) => loadMapImage(src))).then((images) => {
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
  }, [factionsByKey, map, mapView, selectedMarkerId, selectedSettlementType, zoom]);

  const changeZoom = (nextZoom: number) => setZoom(Math.max(0.5, Math.min(6, nextZoom)));

  const selectMapMarker = (marker: EsfMapMarker | undefined) => {
    setSelectedMarkerId(marker?.id);
    if (marker && map) {
      dispatch(selectMapRegion({ campaign: map.campaignKey, region: marker.key }));
    } else {
      dispatch(clearMapRegionSelection());
    }
  };

  const selectMapFaction = (factionKeyToSelect: string) => {
    const marker = map?.markers.find((candidate) => factionKey(candidate.ownerFaction) === factionKeyToSelect);
    selectMapMarker(marker);
  };

  const beginMapDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
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
    const drag = mapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    mapDragRef.current = undefined;
    setIsDraggingMap(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const selectAtCanvasPoint = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressMapClickRef.current) {
      suppressMapClickRef.current = false;
      return;
    }
    if (!map) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
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
    selectMapMarker(areaMarker);
  };

  if (currentGame !== "wh3") {
    return <div className="px-6 py-4 text-gray-300">The campaign map is unavailable for this game.</div>;
  }

  return (
    <div className="flex h-[92vh] min-h-0 flex-col text-gray-200">
      <div className="flex items-center gap-3 border-b border-gray-700 px-4 py-2 text-sm">
        <span className="font-medium text-gray-100">Campaign map</span>
        <div className="flex rounded border border-gray-700 bg-gray-900 p-0.5" role="tablist" aria-label="Map view">
          {(["regions", "factions"] as const).map((view) => (
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
              {view === "regions" ? "Regions" : "Factions"}
            </button>
          ))}
        </div>
        {map && campaignOptions.length > 0 && (
          <select
            value={mapCampaignName}
            onChange={(event) => dispatch(setMapCampaignName(event.target.value))}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
            aria-label="Campaign map"
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
            aria-label="Settlement type"
          >
            <option value="">(none)</option>
            {map.settlementTypes.map((settlementType) => (
              <option key={settlementType.key} value={settlementType.key}>
                {settlementType.label}
              </option>
            ))}
          </select>
        )}
        {map && (
          <span className="text-xs text-gray-500">
            {map.width}×{map.height} · {map.regionCount} regions · {map.ownedRegionCount} owned
          </span>
        )}
        {isLoading && <span className="text-xs text-blue-300">Reading ESF data…</span>}
      </div>

      {error && <div className="px-4 py-2 text-sm text-red-400">{error}</div>}

      {map && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-3 p-3">
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
                Reset
              </button>
              <button
                type="button"
                onClick={() => changeZoom(zoom * 1.2)}
                className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700"
              >
                +
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <span className="ml-auto truncate" title={map.mapDataPath}>
                {map.mapDataPath}
              </span>
            </div>
            <div
              ref={canvasWrapRef}
              className="min-h-0 flex-1 overflow-auto p-3"
              onWheel={(event) => {
                if (!event.ctrlKey) return;
                event.preventDefault();
                changeZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
              }}
            >
              <canvas
                ref={canvasRef}
                onPointerDown={beginMapDrag}
                onPointerMove={moveMapDrag}
                onPointerUp={endMapDrag}
                onPointerCancel={endMapDrag}
                onClick={selectAtCanvasPoint}
                className={`block ${isDraggingMap ? "cursor-grabbing" : "cursor-grab"} touch-none select-none rounded border border-gray-700 bg-slate-950`}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded border border-gray-700 bg-gray-900">
            <div className="border-b border-gray-800 px-3 py-2 text-xs text-gray-400">
              {mapView === "factions"
                ? `${map.factions.length} factions · flags at settlements`
                : map.startposWasCompressed
                  ? "Compressed startpos decoded"
                  : "Startpos loaded"}
              <div className="mt-1 truncate text-[0.65rem] text-gray-600" title={map.startposPath}>
                {map.startposPath}
              </div>
            </div>
            {selectedMarker && (
              <div className="border-b border-gray-800 px-3 py-2 text-xs">
                <div className="font-medium text-gray-100">{selectedMarker.key}</div>
                <div className="mt-1 text-gray-400">
                  {selectedMarker.ownerFaction ?? "Unowned"}
                  {selectedMarker.subculture ? ` · ${selectedMarker.subculture}` : ""}
                </div>
                {selectedMarker.settlementKey && <div className="text-gray-500">{selectedMarker.settlementKey}</div>}
              </div>
            )}
            <div className="border-b border-gray-800 p-2">
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={mapView === "factions" ? "Filter factions…" : "Filter regions…"}
                className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {mapView === "regions"
                ? filteredMarkers.map((marker) => (
                    <button
                      key={`${marker.id}-${marker.key}`}
                      type="button"
                      onClick={() => selectMapMarker(marker)}
                      className={`mb-1 block w-full rounded border px-2 py-1.5 text-left text-xs ${
                        selectedMarkerId === marker.id
                          ? "border-blue-500 bg-blue-950/60 text-gray-100"
                          : "border-transparent bg-gray-950/60 text-gray-300 hover:border-gray-600"
                      }`}
                    >
                      <span className="block truncate">{marker.key}</span>
                      <span className="block truncate text-[0.65rem] text-gray-500">
                        {marker.ownerFaction ?? "Unowned"}
                      </span>
                    </button>
                  ))
                : filteredFactions.map((faction) => {
                    const isSelected = factionKey(selectedMarker?.ownerFaction) === faction.key.toLowerCase();
                    return (
                      <button
                        key={faction.key}
                        type="button"
                        onClick={() => selectMapFaction(faction.key.toLowerCase())}
                        className={`mb-1 flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs ${
                          isSelected
                            ? "border-blue-500 bg-blue-950/60 text-gray-100"
                            : "border-transparent bg-gray-950/60 text-gray-300 hover:border-gray-600"
                        }`}
                      >
                        {faction.flagUrl ? (
                          <img src={faction.flagUrl} alt="" className="h-6 w-6 shrink-0 object-contain" />
                        ) : (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-gray-500" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate">{faction.label}</span>
                          <span className="block truncate text-[0.65rem] text-gray-500">
                            {faction.regionCount} {faction.regionCount === 1 ? "region" : "regions"} · {faction.key}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              {(mapView === "regions" ? filteredMarkers.length : filteredFactions.length) === 0 && (
                <div className="px-2 py-3 text-xs text-gray-500">
                  {mapView === "factions" ? "No matching factions." : "No matching regions."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!map && isLoading && (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-500">Loading campaign map…</div>
      )}
    </div>
  );
});

export default EsfMapTab;
