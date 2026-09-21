import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  getUnitPainterBrushSpacing,
  sampleUnitPainterStrokeSegment,
  type UnitPainterBrushSettings,
  type UnitPainterSelectionScope,
  type UnitPainterSession,
  type UnitPainterTexturePaintResult,
} from "../visuals/unitPainter";

type UnitPainterTextureEditorProps = {
  session: UnitPainterSession;
  historyVersion: number;
  selectionKey: string;
  selectedTextureId?: string;
  onSelectedTextureIdChange: (textureId: string) => void;
  brushSettings: UnitPainterBrushSettings;
  scope: UnitPainterSelectionScope;
  eyedropperActive: boolean;
  onEyedropperComplete: (color: { r: number; g: number; b: number }) => void;
  onStrokeComplete: (changed: boolean) => void;
};

type ViewTransform = {
  scale: number;
  x: number;
  y: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const UnitPainterTextureEditor = ({
  session,
  historyVersion,
  selectionKey,
  selectedTextureId,
  onSelectedTextureIdChange,
  brushSettings,
  scope,
  eyedropperActive,
  onEyedropperComplete,
  onStrokeComplete,
}: UnitPainterTextureEditorProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const textureCanvasRef = useRef<HTMLCanvasElement>(null);
  const uvCanvasRef = useRef<HTMLCanvasElement>(null);
  const activePaintPointerRef = useRef<number>();
  const activePanPointerRef = useRef<number>();
  const lastPaintPointRef = useRef<{ x: number; y: number }>();
  const lastPanPointRef = useRef<{ x: number; y: number }>();
  const distanceSinceLastStampRef = useRef(0);
  const strokeChangedRef = useRef(false);
  const [showUvs, setShowUvs] = useState(true);
  const [transform, setTransform] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });

  const views = useMemo(
    () => session.textureViews,
    [session, historyVersion, selectionKey],
  );
  const view = views.find((candidate) => candidate.id === selectedTextureId) ?? views[0];

  useEffect(() => {
    if (view && view.id !== selectedTextureId) onSelectedTextureIdChange(view.id);
  }, [onSelectedTextureIdChange, selectedTextureId, view]);

  const fitTexture = () => {
    const viewport = viewportRef.current;
    if (!viewport || !view) return;
    const rect = viewport.getBoundingClientRect();
    const availableWidth = Math.max(1, rect.width - 32);
    const availableHeight = Math.max(1, rect.height - 32);
    const scale = clamp(Math.min(availableWidth / view.width, availableHeight / view.height), 0.02, 16);
    setTransform({
      scale,
      x: (rect.width - view.width * scale) / 2,
      y: (rect.height - view.height * scale) / 2,
    });
  };

  useEffect(() => {
    fitTexture();
    // Fit only when switching textures/dimensions, not after each paint-history update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, view?.width, view?.height]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => fitTexture());
    observer.observe(viewport);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, view?.width, view?.height]);

  const getImageData = () => {
    if (!view) return undefined;
    return new ImageData(
      new Uint8ClampedArray(view.data.buffer, view.data.byteOffset, view.data.byteLength),
      view.width,
      view.height,
    );
  };

  const redrawTexture = (dirty?: UnitPainterTexturePaintResult) => {
    const canvas = textureCanvasRef.current;
    const imageData = getImageData();
    if (!canvas || !view || !imageData) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    if (canvas.width !== view.width) canvas.width = view.width;
    if (canvas.height !== view.height) canvas.height = view.height;

    if (dirty?.changed) {
      const x = Math.max(0, dirty.minX);
      const y = Math.max(0, dirty.minY);
      const width = Math.max(1, Math.min(view.width - x, dirty.maxX - x + 1));
      const height = Math.max(1, Math.min(view.height - y, dirty.maxY - y + 1));
      context.putImageData(imageData, 0, 0, x, y, width, height);
    } else {
      context.putImageData(imageData, 0, 0);
    }
  };

  useEffect(() => {
    redrawTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, historyVersion]);

  useEffect(() => {
    const canvas = uvCanvasRef.current;
    if (!canvas || !view) return;
    if (canvas.width !== view.width) canvas.width = view.width;
    if (canvas.height !== view.height) canvas.height = view.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!showUvs) return;

    const drawSegments = (segments: Float32Array, strokeStyle: string, lineWidth: number) => {
      if (segments.length === 0) return;
      context.beginPath();
      for (let index = 0; index + 3 < segments.length; index += 4) {
        context.moveTo(segments[index] * view.width, segments[index + 1] * view.height);
        context.lineTo(segments[index + 2] * view.width, segments[index + 3] * view.height);
      }
      context.strokeStyle = strokeStyle;
      context.lineWidth = Math.max(0.5, lineWidth / Math.max(transform.scale, 0.001));
      context.stroke();
    };

    drawSegments(view.uvSegments, "rgba(255,255,255,0.65)", 1);
    drawSegments(view.selectedUvSegments, "rgba(250,204,21,0.95)", 2);
  }, [showUvs, transform.scale, view]);

  if (!view) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950 text-sm text-gray-400">
        No editable BaseColour texture is available.
      </div>
    );
  }

  const pointerToTexture = (clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - transform.x) / transform.scale,
      y: (clientY - rect.top - transform.y) / transform.scale,
    };
  };

  const paintAt = (clientX: number, clientY: number) => {
    const point = pointerToTexture(clientX, clientY);
    if (!point || point.x < 0 || point.y < 0 || point.x >= view.width || point.y >= view.height) return false;
    const result = session.paintTexturePoint(
      view.id,
      point.x,
      point.y,
      brushSettings.radiusPx / Math.max(transform.scale, 0.001),
      brushSettings,
      scope,
    );
    if (!result?.changed) return false;
    strokeChangedRef.current = true;
    redrawTexture(result);
    return true;
  };

  const paintToPointer = (clientX: number, clientY: number, flushTail = false) => {
    const last = lastPaintPointRef.current;
    if (!last) {
      paintAt(clientX, clientY);
      lastPaintPointRef.current = { x: clientX, y: clientY };
      distanceSinceLastStampRef.current = 0;
      return;
    }

    const sampled = sampleUnitPainterStrokeSegment(
      last.x,
      last.y,
      clientX,
      clientY,
      getUnitPainterBrushSpacing(brushSettings.radiusPx),
      distanceSinceLastStampRef.current,
    );
    for (const sample of sampled.samples) paintAt(sample.x, sample.y);
    distanceSinceLastStampRef.current = sampled.distanceSinceLastStamp;
    lastPaintPointRef.current = { x: clientX, y: clientY };
    if (flushTail && distanceSinceLastStampRef.current > 0.5) {
      paintAt(clientX, clientY);
      distanceSinceLastStampRef.current = 0;
    }
  };

  const finishStroke = (pointerId?: number) => {
    if (activePaintPointerRef.current == null) return;
    const viewport = viewportRef.current;
    if (pointerId != null && viewport?.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    activePaintPointerRef.current = undefined;
    lastPaintPointRef.current = undefined;
    distanceSinceLastStampRef.current = 0;
    const changed = session.endStroke() || strokeChangedRef.current;
    strokeChangedRef.current = false;
    onStrokeComplete(changed);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    setCursor({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY, visible: true });

    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      activePanPointerRef.current = event.pointerId;
      lastPanPointRef.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;

    const point = pointerToTexture(event.clientX, event.clientY);
    if (!point || point.x < 0 || point.y < 0 || point.x >= view.width || point.y >= view.height) return;
    event.preventDefault();

    if (eyedropperActive || event.altKey) {
      const sampled = session.sampleTexturePoint(view.id, point.x, point.y);
      if (sampled) onEyedropperComplete(sampled);
      return;
    }

    activePaintPointerRef.current = event.pointerId;
    strokeChangedRef.current = false;
    lastPaintPointRef.current = undefined;
    distanceSinceLastStampRef.current = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    session.beginStroke();
    paintToPointer(event.clientX, event.clientY);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top, visible: true });

    if (event.pointerId === activePanPointerRef.current) {
      const last = lastPanPointRef.current;
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      lastPanPointRef.current = { x: event.clientX, y: event.clientY };
      setTransform((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      return;
    }

    if (event.pointerId !== activePaintPointerRef.current) return;
    event.preventDefault();
    paintToPointer(event.clientX, event.clientY);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId === activePanPointerRef.current) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      activePanPointerRef.current = undefined;
      lastPanPointRef.current = undefined;
      return;
    }
    if (event.pointerId !== activePaintPointerRef.current) return;
    paintToPointer(event.clientX, event.clientY, true);
    finishStroke(event.pointerId);
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    setTransform((current) => {
      const textureX = (mouseX - current.x) / current.scale;
      const textureY = (mouseY - current.y) / current.scale;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const scale = clamp(current.scale * factor, 0.02, 32);
      return {
        scale,
        x: mouseX - textureX * scale,
        y: mouseY - textureY * scale,
      };
    });
  };

  return (
    <div className="absolute inset-0 z-10 bg-gray-950">
      <div className="absolute right-2 top-2 z-20 flex max-w-[60%] items-center gap-1 rounded border border-gray-700 bg-gray-900/95 p-1 text-[11px] text-gray-200 shadow-lg">
        <select
          value={view.id}
          onChange={(event) => onSelectedTextureIdChange(event.target.value)}
          className="max-w-72 rounded border border-gray-600 bg-gray-800 px-1 py-1 text-gray-100"
          title={view.label}
        >
          {views.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowUvs((value) => !value)}
          className={`rounded border px-2 py-1 ${
            showUvs ? "border-cyan-500 bg-cyan-950/60 text-cyan-100" : "border-gray-600 bg-gray-800"
          }`}
          title="Toggle UV wireframe"
        >
          UV
        </button>
        <button
          type="button"
          onClick={fitTexture}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-blue-400"
          title="Fit texture to view"
        >
          Fit
        </button>
        <span className="min-w-12 text-right tabular-nums text-gray-400">
          {Math.round(transform.scale * 100)}%
        </span>
      </div>

      <div
        ref={viewportRef}
        className="absolute inset-0 cursor-crosshair overflow-hidden bg-[linear-gradient(45deg,#111827_25%,transparent_25%),linear-gradient(-45deg,#111827_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#111827_75%),linear-gradient(-45deg,transparent_75%,#111827_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px]"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(event) => {
          if (event.pointerId === activePanPointerRef.current) {
            activePanPointerRef.current = undefined;
            lastPanPointRef.current = undefined;
          }
          if (event.pointerId === activePaintPointerRef.current) finishStroke(event.pointerId);
        }}
        onPointerLeave={() => setCursor((current) => ({ ...current, visible: false }))}
        onWheel={onWheel}
      >
        <canvas
          ref={textureCanvasRef}
          className="pointer-events-none absolute left-0 top-0 shadow-2xl [image-rendering:pixelated]"
          style={{
            transformOrigin: "0 0",
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        />
        <canvas
          ref={uvCanvasRef}
          className="pointer-events-none absolute left-0 top-0"
          style={{
            transformOrigin: "0 0",
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        />
        {cursor.visible && activePanPointerRef.current == null && (
          <>
            <div
              className="pointer-events-none absolute rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
              style={{
                left: cursor.x - brushSettings.radiusPx,
                top: cursor.y - brushSettings.radiusPx,
                width: brushSettings.radiusPx * 2,
                height: brushSettings.radiusPx * 2,
              }}
            />
            <div
              className="pointer-events-none absolute rounded-full border border-dashed border-white/70"
              style={{
                left: cursor.x - brushSettings.radiusPx * brushSettings.hardness,
                top: cursor.y - brushSettings.radiusPx * brushSettings.hardness,
                width: brushSettings.radiusPx * brushSettings.hardness * 2,
                height: brushSettings.radiusPx * brushSettings.hardness * 2,
              }}
            />
          </>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-2 left-2 z-20 rounded bg-gray-900/90 px-2 py-1 text-[11px] text-gray-400">
        LMB paint · Alt+click sample · RMB/MMB pan · Wheel zoom
        {scope !== "all" ? " · painting clipped to the current 3D selection" : ""}
      </div>
    </div>
  );
};

export default UnitPainterTextureEditor;
