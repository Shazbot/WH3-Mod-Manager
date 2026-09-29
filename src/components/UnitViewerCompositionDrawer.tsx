import React, { useEffect, useState } from "react";
import { IoClose, IoInformationCircleOutline, IoWarningOutline } from "react-icons/io5";
import type { UnitViewerUnitModel } from "../unitViewer/types";
import type { VariantMeshSelection } from "../visuals/variantMesh";

type UnitViewerCompositionDrawerProps = {
  unit: UnitViewerUnitModel;
  assetPath: string;
  enabledMods: Mod[];
  variantSelections: readonly VariantMeshSelection[];
  onClose: () => void;
};

type HostCompositionComponent = {
  bindingId: string;
  sourceModelPath: string;
  attachmentPoint: string;
  skeletonName?: string | null;
  meshCount: number;
  hasWeights: boolean;
};

const entityRows = (unit: UnitViewerUnitModel) => unit.compositionEntities || [];

const formatEntityType = (value: string) =>
  value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const UnitViewerCompositionDrawer = ({
  unit,
  assetPath,
  enabledMods,
  variantSelections,
  onClose,
}: UnitViewerCompositionDrawerProps) => {
  const [components, setComponents] = useState<HostCompositionComponent[]>([]);
  const [compositionError, setCompositionError] = useState<string>();
  const [compositionLoading, setCompositionLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setCompositionLoading(true);
    setCompositionError(undefined);
    setComponents([]);
    window.api
      ?.getVisualsVariantMeshComposition(assetPath, enabledMods, variantSelections)
      .then((result) => {
        if (cancelled) return;
        if (!result?.success || !result.composition?.success) {
          setCompositionError(
            result?.error || result?.composition?.diagnostics?.[0] || "Unable to inspect rendered components.",
          );
          return;
        }
        setComponents(result.composition.components || []);
        if (result.composition.diagnostics.length > 0) {
          setCompositionError(result.composition.diagnostics.join(" "));
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setCompositionError(reason instanceof Error ? reason.message : "Unable to inspect rendered components.");
      })
      .finally(() => {
        if (!cancelled) setCompositionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetPath, enabledMods, variantSelections]);

  return (
    <aside
      role="dialog"
      aria-label="Unit composition"
      className="absolute inset-y-0 right-0 z-20 flex w-[min(24rem,calc(100%-1rem))] flex-col border-l border-gray-600 bg-gray-900 shadow-2xl"
    >
      <div className="flex shrink-0 items-start gap-3 border-b border-gray-700 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-100">Composition</h2>
          <p className="mt-0.5 text-xs text-gray-400">Preview-only entity and mesh diagnostics</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close composition"
          title="Close composition"
          className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-600 bg-gray-800 text-gray-300 hover:border-blue-400 hover:text-white"
        >
          <IoClose size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        <section>
          <div className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Rendered source</div>
          <div className="rounded border border-gray-700 bg-gray-800/80 p-2">
            <div className="font-medium text-gray-100">Unit variant mesh</div>
            <div className="mt-1 break-all font-mono text-[10px] text-gray-400">{assetPath}</div>
          </div>
        </section>

        <div className="flex gap-2 rounded border border-amber-700/60 bg-amber-950/40 p-2 text-amber-100">
          <IoWarningOutline className="mt-0.5 shrink-0 text-amber-300" size={15} />
          <p>
            Crew, mounts, engines, and articulated vehicles are database entities. The host can now inspect the rendered
            VMD components below, but it does not yet expose independent entity visibility.
          </p>
        </div>

        <section>
          <div className="mb-1 flex items-center gap-1 font-semibold uppercase tracking-wide text-gray-400">
            <span>Game entities</span>
            <span title="These records drive unit data and stats; they are not separate render toggles.">
              <IoInformationCircleOutline size={14} />
            </span>
          </div>
          <div className="divide-y divide-gray-700 rounded border border-gray-700 bg-gray-800/60">
            {entityRows(unit).length === 0 ? (
              <div className="p-3 text-gray-500">No mount, engine, or articulated entity was resolved.</div>
            ) : (
              entityRows(unit).map((entry) => (
                <div key={`${entry.role}:${entry.entity.key}`} className="flex items-start gap-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-gray-100">
                      <span className="font-medium">{entry.label}</span>
                      <span className="rounded border border-gray-600 px-1 text-[10px] text-gray-400">
                        ×{entry.count}
                      </span>
                    </div>
                    <div className="mt-0.5 break-all font-mono text-[10px] text-gray-500">
                      {entry.entity.key} · {formatEntityType(entry.entity.type)}
                    </div>
                  </div>
                  <span className="shrink-0 rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-500">
                    Visual binding unavailable
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <div className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Host-resolved components</div>
          <div className="divide-y divide-gray-700 rounded border border-gray-700 bg-gray-800/60">
            {compositionLoading ? (
              <div className="p-3 text-gray-500">Inspecting the selected composition…</div>
            ) : components.length === 0 ? (
              <div className="p-3 text-gray-500">No renderable components were returned by the asset host.</div>
            ) : (
              components.map((component) => (
                <div key={component.bindingId} className="p-2.5">
                  <div className="font-medium text-gray-100">{component.bindingId}</div>
                  <div className="mt-0.5 break-all font-mono text-[10px] text-gray-500">
                    {component.sourceModelPath}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-gray-400">
                    <span>
                      {component.meshCount} mesh{component.meshCount === 1 ? "" : "es"}
                    </span>
                    {component.attachmentPoint && <span>attach: {component.attachmentPoint}</span>}
                    {component.skeletonName && <span>skeleton: {component.skeletonName}</span>}
                    <span>{component.hasWeights ? "weighted" : "static"}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          {compositionError && <div className="mt-1 text-[10px] text-amber-300">{compositionError}</div>}
        </section>

        <section className="rounded border border-gray-700 bg-gray-800/40 p-2.5 text-gray-400">
          <div className="font-medium text-gray-200">Visual slots</div>
          <p className="mt-1">
            Available VariantMeshDefinition choices remain in the Appearance controls below the preview. Nested slots
            are applied together when the model is exported.
          </p>
        </section>
      </div>
    </aside>
  );
};

export default UnitViewerCompositionDrawer;
