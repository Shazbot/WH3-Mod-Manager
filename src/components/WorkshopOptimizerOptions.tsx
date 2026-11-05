import React from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { setWorkshopOptimizerOption } from "../appSlice";
import {
  DEFAULT_WORKSHOP_OPTIMIZER_OPTIONS,
  getWorkshopOptimizerOptionUnavailableReason,
} from "../workshopModOptimizer/options";

type BooleanOption = Exclude<keyof WorkshopOptimizerOptions, "armyScope" | "siblingScope">;
const groups: { title: string; options: { key: BooleanOption; label: string; help: string }[] }[] = [
  { title: "Models and geometry", options: [
    { key: "mergeCompatibleMeshes", label: "Merge compatible meshes", help: "Combine compatible meshes to reduce draw calls." },
    { key: "optimizeGeometry", label: "Optimize geometry", help: "Reorder and simplify model geometry." },
    { key: "crossRigidMerges", label: "Merge across rigid models", help: "Find compatible meshes in different rigid models." },
    { key: "crossRigidOnly", label: "Cross-rigid merges only", help: "Restrict mesh merging to separate rigid models." },
    { key: "remakeEditorLods", label: "Repair old editor LODs", help: "Rebuild older Asset Editor generated lower-detail levels." },
  ] },
  { title: "Textures and atlases", options: [
    { key: "shareAtlasesAcrossVmds", label: "Share atlases across variants", help: "Reuse compatible atlas layouts across variant mesh definitions." },
    { key: "buildAtlases", label: "Build new atlases (experimental)", help: "Small draw-call reduction that mainly helps CPU-limited systems. Costs part of the shared texture repack's memory saving and makes optimizing more than twice as slow. Experimental." },
    { key: "atlasAllVmds", label: "Process all variants", help: "Process every variant mesh definition in the pack, not only those units use, for mesh merging and atlases." },
    { key: "lodAwareAtlasPlanning", label: "Plan atlases by LOD", help: "Account for model detail levels in atlas planning." },
    { key: "downscaleTextures", label: "Downscale textures", help: "Reduce oversized texture dimensions." },
    { key: "sharedTextureRepack", label: "Repack shared textures", help: "Consolidate textures used by several assets." },
    { key: "compactTextures", label: "Compact textures", help: "Choose smaller texture representations." },
    { key: "dropUnreadAlpha", label: "Remove unused alpha", help: "Discard alpha channels that shaders do not read." },
  ] },
  { title: "Reachability and cleanup", options: [
    { key: "scoreAllGameUnits", label: "Score all game units", help: "Score all game units, not only those using this pack. Affects merge decisions." },
    { key: "pruneDeadFiles", label: "Remove unused files", help: "Conservatively remove files no retained asset or mod reaches or names." },
    { key: "switchOpaqueAlphaShaders", label: "Use opaque shaders where possible", help: "Switch character materials with fully opaque base textures to non-alpha shaders." },
  ] },
  { title: "Reports", options: [
    { key: "reportDiagnostics", label: "Detailed report audits", help: "Add report-only checks. Makes optimizing several times slower (about 4x on a large pack) and does not change the output pack." },
  ] },
];

export default function WorkshopOptimizerOptions() {
  const dispatch = useAppDispatch();
  const options = useAppSelector((state) => state.app.workshopOptimizerOptions);
  const rigidCompression = useAppSelector((state) => state.app.isRigidModelV2CompressionEnabled);
  const isDev = useAppSelector((state) => state.app.isDev);
  const armyScopeUnavailable = getWorkshopOptimizerOptionUnavailableReason("armyScope", options);
  const siblingScopeUnavailable = getWorkshopOptimizerOptionUnavailableReason("siblingScope", options);
  return <details className="mt-3 rounded border border-gray-600 bg-gray-800/40 px-3 py-2 text-sm">
    <summary className="cursor-pointer font-medium text-gray-200">Advanced optimization settings</summary>
    <p className="mt-2 text-xs text-gray-400">These settings apply to background optimization, Optimize now, and game launch. Changing an output setting creates a new cached result.</p>
    {groups.map((group) => {
      const visibleOptions = group.options.filter(({ key }) =>
        isDev || DEFAULT_WORKSHOP_OPTIMIZER_OPTIONS[key],
      );
      if (visibleOptions.length === 0) return null;
      return <fieldset key={group.title} className="mt-3 border-t border-gray-600 pt-2">
        <legend className="text-xs font-semibold uppercase text-gray-300">{group.title}</legend>
        {visibleOptions.map(({ key, label, help }) => {
          const unavailableReason = getWorkshopOptimizerOptionUnavailableReason(key, options);
          return <label key={key} className={`mt-2 flex items-start gap-2 ${unavailableReason ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
            <input type="checkbox" className="mt-0.5" checked={options[key]} disabled={!!unavailableReason}
              onChange={(event) => dispatch(setWorkshopOptimizerOption({ key, value: event.target.checked }))} />
            <span>
              <span className="block text-gray-200">{label}</span>
              <span className="block text-xs text-gray-400">{help}</span>
              {unavailableReason && <span className="block text-xs text-amber-300">{unavailableReason}</span>}
            </span>
          </label>;
        })}
      </fieldset>;
    })}
    <div className="mt-3 border-t border-gray-600 pt-2">
      <label className={`block text-xs text-gray-300 ${armyScopeUnavailable ? "opacity-60" : ""}`}>Army scoring scope (affects merge decisions)
        <select className="mt-1 block rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100"
          disabled={!!armyScopeUnavailable}
          value={options.armyScope} onChange={(event) => dispatch(setWorkshopOptimizerOption({ key: "armyScope", value: event.target.value }))}>
          <option value="subculture">Subculture (default)</option><option value="culture">Culture</option>
        </select>
        {armyScopeUnavailable && <span className="mt-1 block text-xs text-amber-300">{armyScopeUnavailable}</span>}
      </label>
      <label className={`mt-3 block text-xs text-gray-300 ${siblingScopeUnavailable ? "opacity-60" : ""}`}>Shared texture grouping
        <select className="mt-1 block rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100"
          disabled={!!siblingScopeUnavailable}
          value={options.siblingScope} onChange={(event) => dispatch(setWorkshopOptimizerOption({ key: "siblingScope", value: event.target.value }))}>
          <option value="model">Per model (default)</option><option value="pack">Across pack</option>
        </select>
        {siblingScopeUnavailable && <span className="mt-1 block text-xs text-amber-300">{siblingScopeUnavailable}</span>}
      </label>
      <p className="mt-3 text-xs text-gray-400">Rigid-model compression follows the existing WHMM setting and is currently {rigidCompression ? "on" : "off"}.</p>
      <button type="button" className="mt-3 rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
        onClick={() => {
          for (const [key, value] of Object.entries(DEFAULT_WORKSHOP_OPTIMIZER_OPTIONS)) {
            dispatch(setWorkshopOptimizerOption({ key: key as keyof WorkshopOptimizerOptions, value }));
          }
        }}>Restore defaults</button>
    </div>
  </details>;
}
