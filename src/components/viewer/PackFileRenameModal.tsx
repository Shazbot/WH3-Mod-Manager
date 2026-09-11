import React, { useContext, useEffect, useMemo, useState } from "react";

import { Modal } from "../../flowbite";
import localizationContext from "../../localizationContext";
import {
  planPackFileRename,
  type PackFileRenameEntry,
  type PackFileRenamePlan,
} from "../../utility/packFileRenamePlan";
import type { ExistingPackFilePaths } from "../../utility/packImportPlan";

type PackFileRenameModalProps = {
  show: boolean;
  mode: "rename" | "move";
  paths: string[];
  existingPaths: ExistingPackFilePaths;
  onClose: () => void;
  onApply: (entries: PackFileRenameEntry[]) => void | Promise<void>;
};

type RenameStrategy = "whole" | "partial";

const emptyPlan: PackFileRenamePlan = {
  entries: [],
  unchangedCount: 0,
  errors: [],
  conflicts: [],
};

const PackFileRenameModal: React.FC<PackFileRenameModalProps> = ({
  show,
  mode,
  paths,
  existingPaths,
  onClose,
  onApply,
}) => {
  const localized: Record<string, string> = useContext(localizationContext);
  const [newFileName, setNewFileName] = useState("");
  const [renameStrategy, setRenameStrategy] = useState<RenameStrategy>("whole");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [replaceFileName, setReplaceFileName] = useState(false);
  const [previewPlan, setPreviewPlan] = useState<PackFileRenamePlan>(emptyPlan);
  const [isApplying, setIsApplying] = useState(false);

  const scope = useMemo(
    () => (mode === "rename" ? "name" : replaceFileName ? "full" : "folder"),
    [mode, replaceFileName],
  );

  useEffect(() => {
    if (!show) return;
    setNewFileName("");
    setRenameStrategy("whole");
    setFind("");
    setReplace("");
    setUseRegex(false);
    setReplaceFileName(false);
    setPreviewPlan(emptyPlan);
    setIsApplying(false);
  }, [show, mode, paths]);

  useEffect(() => {
    if (!show) return;
    setPreviewPlan(emptyPlan);
    const timeout = window.setTimeout(() => {
      const useWholeName = mode === "rename" && renameStrategy === "whole";
      const activeFind = useWholeName ? "" : find;
      const activeReplace = useWholeName ? newFileName : replace;
      if (!activeReplace && !activeFind) {
        setPreviewPlan(emptyPlan);
        return;
      }
      setPreviewPlan(
        planPackFileRename(
          {
            paths,
            find: activeFind,
            replace: activeReplace,
            useRegex: useWholeName ? false : useRegex,
            scope,
            replaceWholeName: useWholeName,
          },
          existingPaths,
        ),
      );
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [existingPaths, find, mode, newFileName, paths, renameStrategy, replace, scope, show, useRegex]);

  const canApply =
    !isApplying &&
    !!previewPlan &&
    previewPlan.entries.length > 0 &&
    previewPlan.errors.length === 0 &&
    previewPlan.conflicts.length === 0 &&
    !previewPlan.invalidRegex;

  const handleApply = async () => {
    if (!canApply) return;
    setIsApplying(true);
    try {
      await onApply(previewPlan.entries);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Modal onClose={() => !isApplying && onClose()} show={show} size="4xl" position="center">
      <Modal.Header>
        {mode === "rename"
          ? localized.viewerRenameFilesTitle || "Rename files"
          : localized.viewerMoveFilesTitle || "Move files"}
      </Modal.Header>
      <Modal.Body>
        <div data-testid="pack-file-rename-modal" className="text-sm text-gray-200">
          <p className="mb-4">
            {(mode === "rename"
              ? localized.viewerSelectedFilesRename ||
                "{{count}} file(s) selected. Choose a rename method below to preview the result."
              : localized.viewerSelectedFilesPattern ||
                "{{count}} file(s) selected. Enter a pattern to preview the result."
            ).replace("{{count}}", String(paths.length))}
          </p>

          {mode === "rename" && (
            <fieldset className="space-y-3">
              <legend className="mb-2 font-medium text-white">{localized.viewerRenameMethod || "Rename method"}</legend>

              <div
                className={`rounded border p-4 ${
                  renameStrategy === "whole" ? "border-blue-500 bg-blue-950/30" : "border-gray-700 bg-gray-800/40"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-2 font-medium text-white">
                  <input
                    type="radio"
                    name="rename-strategy"
                    value="whole"
                    checked={renameStrategy === "whole"}
                    onChange={() => setRenameStrategy("whole")}
                    className="h-4 w-4"
                  />
                  {localized.viewerRenameWholeName || "Replace whole file name"}
                </label>
                <p className="ml-6 mt-1 text-xs text-gray-400">
                  {localized.viewerRenameWholeNameHelp || "Set the complete file name exactly."}
                </p>
                <label className="mt-3 block">
                  <span className="mb-1 block text-gray-300">{localized.viewerNewFileName || "New file name"}</span>
                  <input
                    aria-label={localized.viewerNewFileName || "New file name"}
                    value={newFileName}
                    onFocus={() => setRenameStrategy("whole")}
                    onChange={(event) => {
                      setRenameStrategy("whole");
                      setNewFileName(event.target.value);
                    }}
                    className="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                    autoFocus
                  />
                </label>
              </div>

              <div
                className={`rounded border p-4 ${
                  renameStrategy === "partial" ? "border-blue-500 bg-blue-950/30" : "border-gray-700 bg-gray-800/40"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-2 font-medium text-white">
                  <input
                    type="radio"
                    name="rename-strategy"
                    value="partial"
                    checked={renameStrategy === "partial"}
                    onChange={() => setRenameStrategy("partial")}
                    className="h-4 w-4"
                  />
                  {localized.viewerPartialMatching || "Partial matching"}
                </label>
                <p className="ml-6 mt-1 text-xs text-gray-400">
                  {localized.viewerPartialMatchingHelp || "Find text and replace only the matching part."}
                </p>

                <div className="mt-3">
                  <label className="mb-3 flex cursor-pointer items-center gap-2 text-white">
                    <input
                      type="checkbox"
                      checked={useRegex}
                      onFocus={() => setRenameStrategy("partial")}
                      onChange={(event) => {
                        setRenameStrategy("partial");
                        setUseRegex(event.target.checked);
                      }}
                      className="h-4 w-4"
                    />
                    {localized.viewerUseRegularExpression || "Use regular expression"}
                  </label>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-gray-300">{localized.viewerFind || "Find"}</span>
                      <input
                        aria-label={localized.viewerFind || "Find"}
                        value={find}
                        onFocus={() => setRenameStrategy("partial")}
                        onChange={(event) => {
                          setRenameStrategy("partial");
                          setFind(event.target.value);
                        }}
                        className="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-gray-300">{localized.viewerReplaceWith || "Replace with"}</span>
                      <input
                        aria-label={localized.viewerReplaceWith || "Replace with"}
                        value={replace}
                        onFocus={() => setRenameStrategy("partial")}
                        onChange={(event) => {
                          setRenameStrategy("partial");
                          setReplace(event.target.value);
                        }}
                        className="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </fieldset>
          )}

          {mode === "move" && (
            <label className="mb-3 flex items-center gap-2 text-white">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(event) => setUseRegex(event.target.checked)}
                className="h-4 w-4"
              />
              {localized.viewerUseRegularExpression || "Use regular expression"}
            </label>
          )}

          {mode === "move" && (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-gray-300">{localized.viewerFind || "Find"}</span>
                <input
                  aria-label={localized.viewerFind || "Find"}
                  value={find}
                  onChange={(event) => setFind(event.target.value)}
                  className="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-gray-300">{localized.viewerReplaceWith || "Replace with"}</span>
                <input
                  aria-label={localized.viewerReplaceWith || "Replace with"}
                  value={replace}
                  onChange={(event) => setReplace(event.target.value)}
                  className="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                />
              </label>
            </div>
          )}

          {mode === "move" && (
            <label className="mt-4 flex items-center gap-2 text-white">
              <input
                type="checkbox"
                checked={replaceFileName}
                onChange={(event) => setReplaceFileName(event.target.checked)}
                className="h-4 w-4"
              />
              {localized.viewerAlsoReplaceFileName || "Also replace the file name"}
            </label>
          )}

          {previewPlan.invalidRegex && (
            <p data-testid="rename-invalid-regex" className="mt-4 text-red-300">
              {localized.viewerInvalidRegularExpression || "Invalid regular expression:"} {previewPlan.invalidRegex}
            </p>
          )}

          {previewPlan.errors.length > 0 && (
            <div data-testid="rename-errors" className="mt-4 rounded border border-red-700 bg-red-950/30 p-3">
              <div className="font-medium text-red-300">
                {localized.viewerInvalidDestinationPaths || "Invalid destination paths"}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-red-200">
                {previewPlan.errors.map((error) => (
                  <li key={`${error.path}-${error.message}`}>
                    <span className="break-all">{error.path}</span>: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {previewPlan.conflicts.length > 0 && (
            <div data-testid="rename-conflicts" className="mt-4 rounded border border-amber-700 bg-amber-950/30 p-3">
              <div className="font-medium text-amber-300">{localized.viewerConflicts || "Conflicts"}</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-200">
                {previewPlan.conflicts.map((conflict) => (
                  <li key={`${conflict.with}-${conflict.newPath}`}>
                    <span className="break-all">{conflict.newPath}</span>{" "}
                    {localized.viewerConflictsWith || "conflicts with"} {conflict.with}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 font-medium text-white">{localized.preview || "Preview"}</div>
            <div data-testid="rename-preview" className="max-h-[35vh] overflow-auto rounded border border-gray-700">
              {previewPlan.entries.length === 0 ? (
                <div className="p-3 text-gray-400">
                  {localized.viewerNoChangesToPreview || "No changes to preview."}
                </div>
              ) : (
                previewPlan.entries.map((entry) => (
                  <div
                    key={`${entry.originalPath}-${entry.newPath}`}
                    className="border-b border-gray-700 p-2 last:border-b-0"
                  >
                    <span className="break-all text-gray-300">{entry.originalPath}</span>
                    <span className="px-2 text-gray-500">→</span>
                    <span className="break-all text-white">{entry.newPath}</span>
                  </div>
                ))
              )}
            </div>
            {previewPlan.unchangedCount > 0 && (
              <p className="mt-2 text-xs text-gray-400">
                {(localized.viewerFilesRemainUnchanged || "{{count}} file(s) would remain unchanged.").replace(
                  "{{count}}",
                  String(previewPlan.unchangedCount),
                )}
              </p>
            )}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <button
          type="button"
          onClick={onClose}
          disabled={isApplying}
          className="rounded bg-gray-600 px-4 py-2 font-medium text-white hover:bg-gray-500 disabled:opacity-50"
        >
          {localized.cancel || "Cancel"}
        </button>
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={!canApply}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isApplying ? localized.viewerApplying || "Applying…" : localized.viewerApply || "Apply"}
        </button>
      </Modal.Footer>
    </Modal>
  );
};

export default PackFileRenameModal;
