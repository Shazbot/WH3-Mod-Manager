import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getUnitPainterBrushSpacing,
  sampleUnitPainterStrokeSegment,
  type UnitPainterBrushSettings,
  type UnitPainterSelectionScope,
  type UnitPainterSelectionInfo,
  type UnitPainterSession,
  type UnitPainterTextureHover,
  type UnitPainterTexturePaintResult,
  type UnitPainterPixelMaskView,
} from "../visuals/unitPainter";

type UnitPainterTextureEditorProps = {
  session: UnitPainterSession;
  historyVersion: number;
  selectionKey: string;
  selectedTextureId?: string;
  onSelectedTextureIdChange: (textureId: string) => void;
  brushSettings: UnitPainterBrushSettings;
  scope: UnitPainterSelectionScope;
  paddingPx: number;
  onPaddingPxChange: (padding: number) => void;
  selectMode?: Exclude<UnitPainterSelectionScope, "all">;
  similarTolerance: number;
  eyedropperActive: boolean;
  onEyedropperComplete: (color: { r: number; g: number; b: number }) => void;
  onSelectionComplete: (selection: UnitPainterSelectionInfo | undefined, mode: Exclude<UnitPainterSelectionScope, "all">) => void;
  linkedHoverSinkRef: React.MutableRefObject<((hover?: UnitPainterTextureHover) => void) | undefined>;
  onTextureHover: (textureId: string, x: number, y: number) => void;
  onTextureHoverEnd: () => void;
  onStrokeComplete: (changed: boolean) => void;
};

type ViewTransform = {
  scale: number;
  x: number;
  y: number;
};

type ViewTransformMode = "fit" | "oneToOne" | "manual";

type TextureDisplayMode = "textureUv" | "uvOnly" | "selected";
type TextureBackgroundMode = "checker" | "dark" | "light";

const forEachPixelMaskRun = (
  mask: UnitPainterPixelMaskView,
  callback: (x: number, y: number, width: number) => void,
) => {
  const tilesPerRow = Math.ceil(mask.width / mask.tileSize);
  for (const [tileKey, tile] of mask.tiles) {
    const tileX = tileKey % tilesPerRow;
    const tileY = Math.floor(tileKey / tilesPerRow);
    const startX = tileX * mask.tileSize;
    const startY = tileY * mask.tileSize;
    const width = Math.min(mask.tileSize, mask.width - startX);
    const height = Math.min(mask.tileSize, mask.height - startY);

    for (let localY = 0; localY < height; localY += 1) {
      let runStart = -1;
      for (let localX = 0; localX <= width; localX += 1) {
        const selected = localX < width && (() => {
          const localIndex = localY * mask.tileSize + localX;
          const byteIndex = localIndex >> 3;
          return (tile[byteIndex] & (1 << (localIndex & 7))) !== 0;
        })();
        if (selected && runStart < 0) {
          runStart = localX;
          continue;
        }
        if (selected || runStart < 0) continue;
        callback(startX + runStart, startY + localY, localX - runStart);
        runStart = -1;
      }
    }
  }
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
  paddingPx,
  onPaddingPxChange,
  selectMode,
  similarTolerance,
  eyedropperActive,
  onEyedropperComplete,
  onSelectionComplete,
  linkedHoverSinkRef,
  onTextureHover,
  onTextureHoverEnd,
  onStrokeComplete,
}: UnitPainterTextureEditorProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const textureCanvasRef = useRef<HTMLCanvasElement>(null);
  const selectionMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const uvCanvasRef = useRef<HTMLCanvasElement>(null);
  const linkedHoverCanvasRef = useRef<HTMLCanvasElement>(null);
  const linkedHoverCursorRef = useRef<HTMLDivElement>(null);
  const linkedHoverHardnessRef = useRef<HTMLDivElement>(null);
  const activePaintPointerRef = useRef<number>();
  const activePanPointerRef = useRef<number>();
  const lastPaintPointRef = useRef<{ x: number; y: number }>();
  const lastPanPointRef = useRef<{ x: number; y: number }>();
  const distanceSinceLastStampRef = useRef(0);
  const strokeChangedRef = useRef(false);
  const transformModeRef = useRef<ViewTransformMode>("fit");
  const pendingLinkedHoverRef = useRef<UnitPainterTextureHover>();
  const [displayMode, setDisplayMode] = useState<TextureDisplayMode>("textureUv");
  const [backgroundMode, setBackgroundMode] = useState<TextureBackgroundMode>("checker");
  const [dimOutsideSelection, setDimOutsideSelection] = useState(false);
  const [transform, setTransform] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });

  const views = useMemo(
    () => session.getTextureViews(scope),
    [session, historyVersion, selectionKey, scope],
  );
  const view = views.find((candidate) => candidate.id === selectedTextureId) ?? views[0];

  useEffect(() => {
    if (view && view.id !== selectedTextureId) onSelectedTextureIdChange(view.id);
  }, [onSelectedTextureIdChange, selectedTextureId, view]);

  const fitTexture = () => {
    const viewport = viewportRef.current;
    if (!viewport || !view) return;
    transformModeRef.current = "fit";
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

  const setOneToOne = () => {
    const viewport = viewportRef.current;
    if (!viewport || !view) return;
    transformModeRef.current = "oneToOne";
    const rect = viewport.getBoundingClientRect();
    setTransform({
      scale: 1,
      x: (rect.width - view.width) / 2,
      y: (rect.height - view.height) / 2,
    });
  };

  const panTexturePointIntoView = useCallback((textureX: number, textureY: number, forceCenter = false) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const margin = 48;
    setTransform((current) => {
      const screenX = current.x + textureX * current.scale;
      const screenY = current.y + textureY * current.scale;
      const isVisible =
        screenX >= margin
        && screenY >= margin
        && screenX <= rect.width - margin
        && screenY <= rect.height - margin;
      if (!forceCenter && isVisible) return current;
      transformModeRef.current = "manual";
      return {
        ...current,
        x: rect.width / 2 - textureX * current.scale,
        y: rect.height / 2 - textureY * current.scale,
      };
    });
  }, []);

  useEffect(() => {
    if (view && pendingLinkedHoverRef.current?.textureId === view.id) {
      transformModeRef.current = "manual";
      return;
    }
    fitTexture();
    // Fit only for deliberate texture switches/dimension changes. Linked 3D hover
    // keeps the current zoom and recenters the hovered texel instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, view?.width, view?.height]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      if (transformModeRef.current === "fit") fitTexture();
      else if (transformModeRef.current === "oneToOne") setOneToOne();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, view?.width, view?.height]);

  const redrawTexture = (dirty?: UnitPainterTexturePaintResult) => {
    const canvas = textureCanvasRef.current;
    if (!canvas || !view) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    if (canvas.width !== view.width) canvas.width = view.width;
    if (canvas.height !== view.height) canvas.height = view.height;

    if (dirty?.changed) {
      const x = Math.max(0, dirty.minX);
      const y = Math.max(0, dirty.minY);
      const width = Math.max(1, Math.min(view.width - x, dirty.maxX - x + 1));
      const height = Math.max(1, Math.min(view.height - y, dirty.maxY - y + 1));
      const imageData = context.createImageData(width, height);
      const rowBytes = width * 4;
      for (let row = 0; row < height; row += 1) {
        const sourceStart = ((y + row) * view.width + x) * 4;
        imageData.data.set(
          view.data.subarray(sourceStart, sourceStart + rowBytes),
          row * rowBytes,
        );
      }
      context.putImageData(imageData, x, y);
      return;
    }

    const imageData = context.createImageData(view.width, view.height);
    imageData.data.set(view.data);
    context.putImageData(imageData, 0, 0);
  };

  useEffect(() => {
    redrawTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, historyVersion]);

  useEffect(() => {
    if (!view) return;
    return session.subscribeTextureChanges((textureId, dirty) => {
      if (textureId === view.id) redrawTexture(dirty);
    });
    // The live view points at the same mutable RGBA buffer for the life of this texture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, view?.id]);

  useEffect(() => {
    const canvas = uvCanvasRef.current;
    if (!canvas || !view) return;
    if (canvas.width !== view.width) canvas.width = view.width;
    if (canvas.height !== view.height) canvas.height = view.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

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

    if (displayMode !== "selected") {
      drawSegments(
        view.uvSegments,
        backgroundMode === "light" ? "rgba(17,24,39,0.72)" : "rgba(255,255,255,0.65)",
        1,
      );
    }
    drawSegments(view.selectedUvSegments, "rgba(250,204,21,0.98)", 2);
  }, [backgroundMode, displayMode, transform.scale, view]);

  useEffect(() => {
    if (
      displayMode === "selected"
      && view
      && view.selectedUvTriangles.length === 0
      && !view.selectedPixelMask
    ) {
      setDisplayMode("textureUv");
    }
  }, [displayMode, view]);

  useEffect(() => {
    const canvas = selectionMaskCanvasRef.current;
    if (!canvas || !view) return;
    if (canvas.width !== view.width) canvas.width = view.width;
    if (canvas.height !== view.height) canvas.height = view.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const hasGeometrySelection = view.selectedUvTriangles.length > 0;
    const hasPixelSelection = !!view.selectedPixelMask;
    const shouldDim =
      (hasGeometrySelection || hasPixelSelection)
      && (dimOutsideSelection || displayMode === "selected");

    if (shouldDim) {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = displayMode === "selected"
        ? "rgba(3,7,18,0.88)"
        : "rgba(3,7,18,0.58)";
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.globalCompositeOperation = "destination-out";
      if (view.selectedPixelMask) {
        context.fillStyle = "#000";
        forEachPixelMaskRun(view.selectedPixelMask, (x, y, width) => {
          context.fillRect(x, y, width, 1);
        });
      } else {
        context.beginPath();
        for (let index = 0; index + 5 < view.selectedUvTriangles.length; index += 6) {
          context.moveTo(
            view.selectedUvTriangles[index] * view.width,
            view.selectedUvTriangles[index + 1] * view.height,
          );
          context.lineTo(
            view.selectedUvTriangles[index + 2] * view.width,
            view.selectedUvTriangles[index + 3] * view.height,
          );
          context.lineTo(
            view.selectedUvTriangles[index + 4] * view.width,
            view.selectedUvTriangles[index + 5] * view.height,
          );
          context.closePath();
        }
        context.fill();
      }
    }

    if (view.selectedPixelMask) {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "rgba(250,204,21,0.24)";
      forEachPixelMaskRun(view.selectedPixelMask, (x, y, width) => {
        context.fillRect(x, y, width, 1);
      });
    }
    context.globalCompositeOperation = "source-over";
  }, [dimOutsideSelection, displayMode, view]);

  const drawTextureHoverOutline = useCallback((hover?: UnitPainterTextureHover) => {
    const hoverCanvas = linkedHoverCanvasRef.current;
    const context = hoverCanvas?.getContext("2d");
    if (!hoverCanvas || !context || !view || !hover || hover.textureId !== view.id) {
      if (hoverCanvas && context) context.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);
      return;
    }

    if (hoverCanvas.width !== view.width) hoverCanvas.width = view.width;
    if (hoverCanvas.height !== view.height) hoverCanvas.height = view.height;
    context.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);
    if (hover.uvSegments.length === 0) return;

    context.beginPath();
    for (let index = 0; index + 3 < hover.uvSegments.length; index += 4) {
      context.moveTo(hover.uvSegments[index] * view.width, hover.uvSegments[index + 1] * view.height);
      context.lineTo(hover.uvSegments[index + 2] * view.width, hover.uvSegments[index + 3] * view.height);
    }
    context.strokeStyle =
      hover.scope === "island"
        ? "rgba(196,181,253,0.98)"
        : hover.scope === "similar"
          ? "rgba(250,204,21,0.98)"
          : "rgba(103,232,249,0.98)";
    context.lineWidth = Math.max(1, 2 / Math.max(transform.scale, 0.001));
    context.stroke();
  }, [transform.scale, view]);

  useEffect(() => {
    linkedHoverSinkRef.current = (hover) => {
      const hoverCanvas = linkedHoverCanvasRef.current;
      const cursor = linkedHoverCursorRef.current;
      const hardnessCursor = linkedHoverHardnessRef.current;
      const context = hoverCanvas?.getContext("2d");

      if (!hover || !view) {
        pendingLinkedHoverRef.current = undefined;
        if (cursor) cursor.style.display = "none";
        if (context && hoverCanvas) context.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);
        return;
      }
      if (hover.textureId !== view.id) {
        pendingLinkedHoverRef.current = hover;
        onSelectedTextureIdChange(hover.textureId);
        if (cursor) cursor.style.display = "none";
        if (context && hoverCanvas) context.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);
        return;
      }

      const switchedTexture = pendingLinkedHoverRef.current?.textureId === hover.textureId;
      pendingLinkedHoverRef.current = undefined;
      panTexturePointIntoView(hover.x, hover.y, switchedTexture);

      drawTextureHoverOutline(hover);

      if (cursor) {
        const radius = selectMode || eyedropperActive ? 5 : brushSettings.radiusPx;
        const screenX = transform.x + hover.x * transform.scale;
        const screenY = transform.y + hover.y * transform.scale;
        const color =
          hover.scope === "island"
            ? "#c4b5fd"
            : hover.scope === "similar"
              ? "#facc15"
              : "#67e8f9";
        cursor.style.display = "block";
        cursor.style.left = `${screenX - radius}px`;
        cursor.style.top = `${screenY - radius}px`;
        cursor.style.width = `${radius * 2}px`;
        cursor.style.height = `${radius * 2}px`;
        cursor.style.borderColor = color;

        if (hardnessCursor) {
          const hardness = Math.max(0, Math.min(1, brushSettings.hardness));
          if (selectMode || eyedropperActive || hardness <= 0.01 || hardness >= 0.99) {
            hardnessCursor.style.display = "none";
          } else {
            hardnessCursor.style.display = "block";
            hardnessCursor.style.width = `${radius * hardness * 2}px`;
            hardnessCursor.style.height = `${radius * hardness * 2}px`;
            hardnessCursor.style.borderColor = color;
          }
        }
      }
    };

    const pendingHover = pendingLinkedHoverRef.current;
    if (view && pendingHover?.textureId === view.id) linkedHoverSinkRef.current(pendingHover);

    return () => {
      linkedHoverSinkRef.current = undefined;
    };
  }, [
    brushSettings.hardness,
    brushSettings.radiusPx,
    drawTextureHoverOutline,
    eyedropperActive,
    linkedHoverSinkRef,
    onSelectedTextureIdChange,
    panTexturePointIntoView,
    selectMode,
    transform.scale,
    transform.x,
    transform.y,
    view,
  ]);

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
      scope === "all" ? 0 : paddingPx,
    );
    if (!result?.changed) return false;
    strokeChangedRef.current = true;
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

    if (selectMode) {
      const operation = event.ctrlKey ? "toggle" : event.shiftKey ? "add" : "replace";
      const clicked =
        selectMode === "similar"
          ? session.selectSimilarTexturePoint(
              view.id,
              point.x,
              point.y,
              similarTolerance,
              operation,
            )
          : !!session.selectTexturePoint(
              view.id,
              point.x,
              point.y,
              selectMode,
              operation,
            );
      if (clicked) onSelectionComplete(session.selectionInfo, selectMode);
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
      drawTextureHoverOutline(undefined);
      onTextureHoverEnd();
      const last = lastPanPointRef.current;
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      lastPanPointRef.current = { x: event.clientX, y: event.clientY };
      transformModeRef.current = "manual";
      setTransform((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      return;
    }

    const point = pointerToTexture(event.clientX, event.clientY);
    if (point && point.x >= 0 && point.y >= 0 && point.x < view.width && point.y < view.height) {
      if (selectMode && selectMode !== "similar") {
        drawTextureHoverOutline(
          session.getTexturePointHover(view.id, point.x, point.y, selectMode),
        );
      } else {
        drawTextureHoverOutline(undefined);
      }
      onTextureHover(view.id, point.x, point.y);
    } else {
      drawTextureHoverOutline(undefined);
      onTextureHoverEnd();
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
    transformModeRef.current = "manual";
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

  const viewportBackgroundClass =
    backgroundMode === "checker"
      ? "bg-[linear-gradient(45deg,#111827_25%,transparent_25%),linear-gradient(-45deg,#111827_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#111827_75%),linear-gradient(-45deg,transparent_75%,#111827_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px]"
      : backgroundMode === "light"
        ? "bg-gray-200"
        : "bg-gray-950";
  const hasSelection = view.selectedUvTriangles.length > 0 || !!view.selectedPixelMask;

  return (
    <div className="absolute inset-0 z-10 bg-gray-950">
      <div className="absolute right-2 top-2 z-20 flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-end gap-1 rounded border border-gray-700 bg-gray-900/95 p-1 text-[11px] text-gray-200 shadow-lg">
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
        <label className="flex items-center gap-1 text-gray-400" title="Choose what the texture pane displays">
          View
          <select
            value={displayMode}
            onChange={(event) => setDisplayMode(event.target.value as TextureDisplayMode)}
            className="rounded border border-gray-600 bg-gray-800 px-1 py-1 text-gray-100"
          >
            <option value="textureUv">Texture + UV</option>
            <option value="uvOnly">UV only</option>
            <option value="selected" disabled={!hasSelection}>Selected only</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-gray-400" title="Texture editor background">
          BG
          <select
            value={backgroundMode}
            onChange={(event) => setBackgroundMode(event.target.value as TextureBackgroundMode)}
            className="rounded border border-gray-600 bg-gray-800 px-1 py-1 text-gray-100"
          >
            <option value="checker">Checker</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <button
          type="button"
          disabled={!hasSelection || displayMode === "selected"}
          onClick={() => setDimOutsideSelection((value) => !value)}
          className={`rounded border px-2 py-1 ${
            dimOutsideSelection || displayMode === "selected"
              ? "border-yellow-500 bg-yellow-950/50 text-yellow-100"
              : "border-gray-600 bg-gray-800 hover:border-yellow-500"
          } disabled:cursor-not-allowed disabled:opacity-40`}
          title={
            displayMode === "selected"
              ? "Selected only already dims everything outside the selection"
              : "Dim texels outside the current selection"
          }
        >
          Dim outside
        </button>
        <label className="flex items-center gap-1 text-gray-400" title="Extend scoped painting beyond UV boundaries">
          Pad
          <select
            value={scope === "all" || scope === "similar" || !!view.selectedPixelMask ? 0 : paddingPx}
            disabled={scope === "all" || scope === "similar" || !!view.selectedPixelMask}
            onChange={(event) => onPaddingPxChange(Number(event.target.value))}
            className="rounded border border-gray-600 bg-gray-800 px-1 py-1 text-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {[0, 2, 4, 8].map((padding) => (
              <option key={padding} value={padding}>{padding}px</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={fitTexture}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-blue-400"
          title="Fit texture to view"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={setOneToOne}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-blue-400"
          title="Show one texture pixel per screen pixel"
        >
          1:1
        </button>
        <span className="min-w-12 text-right tabular-nums text-gray-400">
          {Math.round(transform.scale * 100)}%
        </span>
      </div>

      <div
        ref={viewportRef}
        className={`absolute inset-0 cursor-crosshair overflow-hidden ${viewportBackgroundClass}`}
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
        onPointerLeave={() => {
          setCursor((current) => ({ ...current, visible: false }));
          drawTextureHoverOutline(undefined);
          onTextureHoverEnd();
        }}
        onWheel={onWheel}
      >
        <canvas
          ref={textureCanvasRef}
          className="pointer-events-none absolute left-0 top-0 shadow-2xl [image-rendering:pixelated]"
          style={{
            display: displayMode === "uvOnly" ? "none" : undefined,
            transformOrigin: "0 0",
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        />
        <canvas
          ref={selectionMaskCanvasRef}
          className="pointer-events-none absolute left-0 top-0"
          style={{
            display: displayMode === "uvOnly" && !view.selectedPixelMask ? "none" : undefined,
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
        <canvas
          ref={linkedHoverCanvasRef}
          className="pointer-events-none absolute left-0 top-0"
          style={{
            transformOrigin: "0 0",
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        />
        <div
          ref={linkedHoverCursorRef}
          className="pointer-events-none absolute hidden rounded-full border shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
        >
          <div
            ref={linkedHoverHardnessRef}
            className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
          />
        </div>
        {cursor.visible && activePanPointerRef.current == null && (() => {
          const precisionToolActive = !!selectMode || eyedropperActive;
          const radius = precisionToolActive ? 5 : brushSettings.radiusPx;
          const cursorColor =
            selectMode === "similar"
              ? "#facc15"
              : selectMode === "island"
                ? "#c4b5fd"
                : selectMode === "material" || eyedropperActive
                  ? "#67e8f9"
                  : "rgba(255,255,255,0.9)";
          return (
            <>
              <div
                className="pointer-events-none absolute rounded-full border shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
                style={{
                  left: cursor.x - radius,
                  top: cursor.y - radius,
                  width: radius * 2,
                  height: radius * 2,
                  borderColor: cursorColor,
                }}
              />
              {!precisionToolActive && (
                <div
                  className="pointer-events-none absolute rounded-full border border-dashed border-white/70"
                  style={{
                    left: cursor.x - radius * brushSettings.hardness,
                    top: cursor.y - radius * brushSettings.hardness,
                    width: radius * brushSettings.hardness * 2,
                    height: radius * brushSettings.hardness * 2,
                  }}
                />
              )}
            </>
          );
        })()}
      </div>

      <div className="pointer-events-none absolute bottom-2 left-2 z-20 rounded bg-gray-900/90 px-2 py-1 text-[11px] text-gray-400">
        {selectMode ? `LMB select ${selectMode}` : "LMB paint"} · Alt+click sample · RMB/MMB pan · Wheel zoom
        {scope !== "all"
          ? ` · clipped to selection${scope !== "similar" && !view.selectedPixelMask && paddingPx > 0 ? ` + ${paddingPx}px padding` : ""}`
          : ""}
      </div>
    </div>
  );
};

export default UnitPainterTextureEditor;
