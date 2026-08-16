import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAppSelector } from "../hooks";
import { useDeferredWhileInactive } from "./useDeferredWhileInactive";
import type { EsfMapArea, EsfMapCampaignOption, EsfMapMarker, EsfMapPayload } from "../esfMap/types";
import { DEFAULT_ESF_CAMPAIGN } from "../esfMap/constants";

type EsfMapTabProps = {
  isActive?: boolean;
};

const DISPLAY_FLIP_Y = true;

const displayYFromVertex = (height: number, y: number) => (DISPLAY_FLIP_Y ? height - y : y);
const displayYFromCell = (height: number, y: number) => (DISPLAY_FLIP_Y ? height - 1 - y : y);

const drawAreaPath = (context: CanvasRenderingContext2D, area: EsfMapArea, height: number) => {
  context.beginPath();
  for (const loop of area.loops) {
    if (loop.length < 6) continue;
    context.moveTo(loop[0], displayYFromVertex(height, loop[1]));
    for (let index = 2; index < loop.length; index += 2) {
      context.lineTo(loop[index], displayYFromVertex(height, loop[index + 1]));
    }
    context.closePath();
  }
};

const getMarkerForArea = (map: EsfMapPayload, area: EsfMapArea): EsfMapMarker | undefined =>
  area.regionKey ? map.markers.find((marker) => marker.key === area.regionKey) : undefined;

const EsfMapTab = memo(({ isActive = true }: EsfMapTabProps) => {
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const enabledMods = useMemo(() => mods.filter((mod) => mod.isEnabled), [mods]);
  const enabledModsSignature = useMemo(
    () =>
      `${currentGame}|${enabledMods
        .map((mod) => `${mod.path}:${mod.loadOrder ?? ""}:${mod.lastChangedLocal ?? ""}:${mod.lastChanged ?? ""}`)
        .join("|")}`,
    [currentGame, enabledMods],
  );
  const signatureToRequest = useDeferredWhileInactive(isActive, enabledModsSignature);
  const enabledModsRef = useRef(enabledMods);
  enabledModsRef.current = enabledMods;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<EsfMapPayload>();
  const [campaignName, setCampaignName] = useState(DEFAULT_ESF_CAMPAIGN);
  const [campaignOptions, setCampaignOptions] = useState<EsfMapCampaignOption[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<number>();
  const [filter, setFilter] = useState("");
  const [zoom, setZoom] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (currentGame !== "wh3") return;
    let current = true;
    setIsLoading(true);
    setError(undefined);
    window.api
      ?.getEsfMap(enabledModsRef.current, campaignName)
      .then((response) => {
        if (!current) return;
        if (!response.success) {
          setMap(undefined);
          setError(response.error);
          return;
        }
        setMap(response.map);
        setCampaignOptions(response.map.availableCampaigns);
        if (response.map.campaignKey !== campaignName) setCampaignName(response.map.campaignKey);
        setSelectedMarkerId(undefined);
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
  }, [campaignName, currentGame, signatureToRequest]);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.width = map.width;
    canvas.height = map.height;
    canvas.style.width = `${Math.max(320, Math.round(map.width * zoom))}px`;
    canvas.style.height = `${Math.max(240, Math.round(map.height * zoom))}px`;
    context.clearRect(0, 0, map.width, map.height);

    for (const area of map.areas) {
      drawAreaPath(context, area, map.height);
      context.fillStyle = `rgb(${area.colour[0]}, ${area.colour[1]}, ${area.colour[2]})`;
      context.fill("evenodd");
    }

    const selected =
      selectedMarkerId === undefined ? undefined : map.markers.find((marker) => marker.id === selectedMarkerId);
    if (selected) {
      const selectedAreaIds = new Set(
        map.areas.filter((area) => area.regionKey === selected.key).map((area) => area.componentId),
      );
      for (const area of map.areas) {
        if (!selectedAreaIds.has(area.componentId)) continue;
        drawAreaPath(context, area, map.height);
        context.fillStyle = "rgba(255, 255, 255, 0.18)";
        context.strokeStyle = "rgba(255, 255, 255, 0.95)";
        context.lineWidth = 1.2;
        context.fill("evenodd");
        context.stroke();
      }
    }

    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    for (const marker of map.markers) {
      const y = displayYFromCell(map.height, marker.gy);
      context.fillRect(marker.gx - 1, y - 1, 2, 2);
    }

    if (selected) {
      const y = displayYFromCell(map.height, selected.gy);
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(selected.gx, y, 5, 0, Math.PI * 2);
      context.stroke();
    }
  }, [map, selectedMarkerId, zoom]);

  const changeZoom = (nextZoom: number) => setZoom(Math.max(0.5, Math.min(6, nextZoom)));

  const selectAtCanvasPoint = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!map) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(map.width - 1, ((event.clientX - rect.left) / rect.width) * map.width));
    const rawY = Math.max(0, Math.min(map.height - 1, ((event.clientY - rect.top) / rect.height) * map.height));
    const y = DISPLAY_FLIP_Y ? map.height - rawY : rawY;

    let areaMarker: EsfMapMarker | undefined;
    for (const area of map.areas) {
      drawAreaPath(context, area, map.height);
      if (context.isPointInPath(x, y, "evenodd")) {
        areaMarker = getMarkerForArea(map, area);
        if (areaMarker) break;
      }
    }

    if (!areaMarker) {
      let closest: EsfMapMarker | undefined;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const marker of map.markers) {
        const markerY = displayYFromCell(map.height, marker.gy);
        const distance = (marker.gx - x) ** 2 + (markerY - y) ** 2;
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = marker;
        }
      }
      if (closestDistance <= 256) areaMarker = closest;
    }
    setSelectedMarkerId(areaMarker?.id);
  };

  if (currentGame !== "wh3") {
    return <div className="px-6 py-4 text-gray-300">The campaign map is unavailable for this game.</div>;
  }

  return (
    <div className="flex h-[86vh] min-h-0 flex-col text-gray-200">
      <div className="flex items-center gap-3 border-b border-gray-700 px-4 py-2 text-sm">
        <span className="font-medium text-gray-100">Campaign map</span>
        {map && campaignOptions.length > 0 && (
          <select
            value={campaignName}
            onChange={(event) => setCampaignName(event.target.value)}
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
                onClick={selectAtCanvasPoint}
                className="block cursor-crosshair rounded border border-gray-700 bg-slate-950"
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded border border-gray-700 bg-gray-900">
            <div className="border-b border-gray-800 px-3 py-2 text-xs text-gray-400">
              {map.startposWasCompressed ? "Compressed startpos decoded" : "Startpos loaded"}
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
                placeholder="Filter regions…"
                className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {filteredMarkers.map((marker) => (
                <button
                  key={`${marker.id}-${marker.key}`}
                  type="button"
                  onClick={() => setSelectedMarkerId(marker.id)}
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
              ))}
              {filteredMarkers.length === 0 && (
                <div className="px-2 py-3 text-xs text-gray-500">No matching regions.</div>
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
