import React, { useContext, useEffect, useMemo, useState } from "react";
import TreeView, { flattenTree } from "react-accessible-treeview";
import { IoMdArrowDropright } from "react-icons/io";

import { Modal } from "../../flowbite";
import localizationContext from "../../localizationContext";
import {
  planPackFileMove,
  planPackFileRename,
  type PackFileRenameEntry,
  type PackFileRenamePlan,
} from "../../utility/packFileRenamePlan";
import type { ExistingPackFilePaths } from "../../utility/packImportPlan";
import { normalizePackFilePath, normalizePackFilePathKey } from "../../utility/packFilePathUtils";
import { getParentPackFolder } from "../../utility/packFolderPaths";

type PackFileRenameModalProps = {
  show: boolean;
  mode: "rename" | "move";
  paths: string[];
  existingPaths: ExistingPackFilePaths;
  extraFolders?: string[];
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

type FolderTreeData = {
  id?: string | number;
  name: string;
  children?: FolderTreeData[];
  metadata?: { path: string };
};

const MOVE_FOLDER_ROOT_ID = "move-folder-root";

const getFolderNodeId = (folderPath: string) => {
  const normalizedPath = normalizePackFilePath(folderPath);
  return normalizedPath
    ? `move-folder:${encodeURIComponent(normalizePackFilePathKey(normalizedPath))}`
    : MOVE_FOLDER_ROOT_ID;
};

const getCommonParentFolder = (paths: string[]) => {
  const parentSegments = paths.map(getParentPackFolder).map((folderPath) => folderPath.split("\\"));
  if (parentSegments.length === 0) return "";

  const firstSegments = parentSegments[0];
  const commonLength = firstSegments.findIndex((segment, index) =>
    parentSegments.some((candidate) => candidate[index]?.toLowerCase() !== segment.toLowerCase()),
  );
  return firstSegments.slice(0, commonLength < 0 ? firstSegments.length : commonLength).join("\\");
};

const buildFolderTree = (filePaths: string[], extraFolders: string[], rootName: string): FolderTreeData => {
  const rootFolder: FolderTreeData = {
    id: MOVE_FOLDER_ROOT_ID,
    name: rootName,
    metadata: { path: "" },
    children: [],
  };
  const root: FolderTreeData = { id: 0, name: "", children: [rootFolder] };

  const addFolder = (folderPath: string) => {
    const normalizedFolderPath = normalizePackFilePath(folderPath);
    if (!normalizedFolderPath) return;

    let currentNode = rootFolder;
    let currentPath = "";
    for (const segment of normalizedFolderPath.split("\\").filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}\\${segment}` : segment;
      const currentKey = normalizePackFilePathKey(currentPath);
      let nextNode = currentNode.children?.find(
        (child) => normalizePackFilePathKey(child.metadata?.path || "") === currentKey,
      );
      if (!nextNode) {
        nextNode = {
          id: getFolderNodeId(currentPath),
          name: segment,
          metadata: { path: currentPath },
          children: [],
        };
        currentNode.children?.push(nextNode);
      }
      currentNode = nextNode;
    }
  };

  for (const filePath of filePaths) addFolder(getParentPackFolder(filePath));
  for (const folderPath of extraFolders) addFolder(folderPath);

  const sortChildren = (node: FolderTreeData) => {
    node.children?.sort((first, second) => first.name.localeCompare(second.name));
    node.children?.forEach(sortChildren);
  };
  sortChildren(root);
  return root;
};

const PackFileRenameModal: React.FC<PackFileRenameModalProps> = ({
  show,
  mode,
  paths,
  existingPaths,
  extraFolders = [],
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
  const [usePatternMove, setUsePatternMove] = useState(false);
  const [destinationFolder, setDestinationFolder] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | number>(MOVE_FOLDER_ROOT_ID);
  const [createdFolders, setCreatedFolders] = useState<string[]>([]);
  const [isNewFolderFormOpen, setIsNewFolderFormOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState("");
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
    setUsePatternMove(false);
    setCreatedFolders([]);
    setIsNewFolderFormOpen(false);
    setNewFolderName("");
    setNewFolderError("");
    if (mode === "move") {
      const initialDestinationFolder = getCommonParentFolder(paths);
      setDestinationFolder(initialDestinationFolder);
      setSelectedFolderId(getFolderNodeId(initialDestinationFolder));
    } else {
      setDestinationFolder("");
      setSelectedFolderId(MOVE_FOLDER_ROOT_ID);
    }
    setPreviewPlan(emptyPlan);
    setIsApplying(false);
  }, [show, mode, paths]);

  const currentPackPaths = useMemo(
    () => [...new Set([...existingPaths.pack, ...existingPaths.unsaved])],
    [existingPaths],
  );
  const folderTreeData = useMemo(
    () =>
      flattenTree(
        buildFolderTree(
          currentPackPaths,
          [...extraFolders, ...createdFolders],
          localized.viewerPackRoot || "Pack root",
        ),
      ),
    [createdFolders, currentPackPaths, extraFolders, localized.viewerPackRoot],
  );
  const folderPathKeys = useMemo(
    () =>
      new Set(
        folderTreeData
          .map((node) => (typeof node.metadata?.path === "string" ? normalizePackFilePathKey(node.metadata.path) : ""))
          .filter(Boolean),
      ),
    [folderTreeData],
  );
  const filePathKeys = useMemo(
    () => new Set(currentPackPaths.map(normalizePackFilePathKey).filter(Boolean)),
    [currentPackPaths],
  );
  const folderTreeDefaultExpandedIds = useMemo(() => {
    const branchIds = folderTreeData.filter((node) => node.id !== 0 && node.children.length > 0).map((node) => node.id);
    const destinationSegments = normalizePackFilePath(destinationFolder).split("\\").filter(Boolean);
    const destinationAncestorIds: Array<string | number> = [MOVE_FOLDER_ROOT_ID];
    let currentPath = "";
    for (const segment of destinationSegments) {
      currentPath = currentPath ? `${currentPath}\\${segment}` : segment;
      destinationAncestorIds.push(getFolderNodeId(currentPath));
    }
    const availableIds = new Set(folderTreeData.map((node) => node.id));
    return [...new Set([...destinationAncestorIds, ...branchIds])].filter((id) => availableIds.has(id));
  }, [destinationFolder, folderTreeData]);

  useEffect(() => {
    if (!show) return;
    if (mode === "move" && !usePatternMove) {
      setPreviewPlan(planPackFileMove(paths, destinationFolder, existingPaths));
      return;
    }
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
  }, [
    destinationFolder,
    existingPaths,
    find,
    mode,
    newFileName,
    paths,
    renameStrategy,
    replace,
    scope,
    show,
    usePatternMove,
    useRegex,
  ]);

  const handleCreateFolder = () => {
    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      setNewFolderError(localized.viewerEnterFolderName || "Enter a folder name.");
      return;
    }
    if (/[\\/]/.test(trimmedName) || trimmedName === "." || trimmedName === "..") {
      setNewFolderError(localized.viewerInvalidFolderName || "Enter a folder name without path separators.");
      return;
    }

    const newPath = normalizePackFilePath(destinationFolder ? `${destinationFolder}\\${trimmedName}` : trimmedName);
    const newPathKey = normalizePackFilePathKey(newPath);
    if (folderPathKeys.has(newPathKey)) {
      setNewFolderError(localized.viewerFolderAlreadyExists || "That folder already exists.");
      return;
    }
    if (filePathKeys.has(newPathKey)) {
      setNewFolderError(localized.viewerFolderConflictsWithFile || "A file already exists at that path.");
      return;
    }

    setCreatedFolders((previousFolders) => [...previousFolders, newPath]);
    setDestinationFolder(newPath);
    setSelectedFolderId(getFolderNodeId(newPath));
    setIsNewFolderFormOpen(false);
    setNewFolderName("");
    setNewFolderError("");
  };

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
              : !usePatternMove
                ? localized.viewerMoveFilesDestinationPrompt ||
                  "{{count}} file(s) selected. Choose their destination folder below. File names will be kept."
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
            <label className="mb-4 flex cursor-pointer items-center gap-2 text-white">
              <input
                type="checkbox"
                checked={usePatternMove}
                onChange={(event) => setUsePatternMove(event.target.checked)}
                className="h-4 w-4"
              />
              {localized.viewerUsePatternMove || "Use pattern-based move"}
            </label>
          )}

          {mode === "move" && !usePatternMove && (
            <div data-testid="move-destination-picker" className="rounded border border-gray-700 bg-gray-800/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="font-medium text-white">
                  {localized.viewerMoveDestinationFolder || "Destination folder"}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewFolderError("");
                    setNewFolderName("");
                    setIsNewFolderFormOpen(true);
                  }}
                  disabled={isApplying}
                  className="rounded bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-500 disabled:opacity-50"
                >
                  {localized.viewerNewFolder || "New folder"}
                </button>
              </div>
              <div
                data-testid="move-folder-tree"
                className="max-h-[28vh] overflow-auto rounded border border-gray-700 bg-gray-900/50 p-2"
              >
                <TreeView
                  key={`move-folder-tree-${show}-${paths.join("|")}`}
                  data={folderTreeData}
                  aria-label={localized.viewerMoveDestinationTree || "Pack folders"}
                  selectedIds={[selectedFolderId]}
                  defaultExpandedIds={folderTreeDefaultExpandedIds}
                  focusedId={selectedFolderId}
                  clickAction="EXCLUSIVE_SELECT"
                  nodeRenderer={({
                    element,
                    isBranch,
                    isExpanded,
                    isSelected,
                    getNodeProps,
                    handleExpand,
                    handleSelect,
                    level,
                  }) => {
                    const nodeProps = getNodeProps({
                      onClick: (event) => {
                        event.stopPropagation();
                        handleSelect(event);
                      },
                    });
                    return (
                      <div
                        {...nodeProps}
                        style={{ marginLeft: 16 * (level - 1) }}
                        className={`${nodeProps.className} flex items-center rounded px-1 py-1 ${
                          isSelected ? "bg-blue-700/60" : "hover:bg-gray-700/60"
                        }`}
                      >
                        {isBranch ? (
                          <button
                            type="button"
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${element.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleExpand(event);
                            }}
                            className="mr-1 rounded text-gray-300 hover:bg-gray-700"
                          >
                            <IoMdArrowDropright
                              aria-hidden="true"
                              className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            />
                          </button>
                        ) : (
                          <span className="mr-1 inline-block w-4" aria-hidden="true" />
                        )}
                        <span
                          className="min-w-0 select-none break-all text-gray-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSelect(event);
                          }}
                        >
                          {element.name}
                        </span>
                      </div>
                    );
                  }}
                  onSelect={({ element, isSelected }) => {
                    if (!isSelected) return;
                    const path = element.metadata?.path;
                    setDestinationFolder(typeof path === "string" ? path : "");
                    setSelectedFolderId(element.id);
                  }}
                />
              </div>
              <p data-testid="move-destination-path" className="mt-2 break-all text-xs text-gray-400">
                {localized.viewerSelectedDestination || "Selected:"}{" "}
                {destinationFolder || localized.viewerPackRoot || "Pack root"}
              </p>

              {isNewFolderFormOpen && (
                <form
                  data-testid="move-new-folder-form"
                  className="mt-3 rounded border border-gray-700 bg-gray-900/50 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCreateFolder();
                  }}
                >
                  <label className="block">
                    <span className="mb-1 block text-gray-300">{localized.viewerFolderName || "Folder name"}</span>
                    <input
                      aria-label={localized.viewerFolderName || "Folder name"}
                      value={newFolderName}
                      onChange={(event) => {
                        setNewFolderName(event.target.value);
                        setNewFolderError("");
                      }}
                      className="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                      autoFocus
                    />
                  </label>
                  {newFolderError && <p className="mt-2 text-xs text-red-300">{newFolderError}</p>}
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsNewFolderFormOpen(false);
                        setNewFolderError("");
                      }}
                      className="rounded bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-500"
                    >
                      {localized.cancel || "Cancel"}
                    </button>
                    <button
                      type="submit"
                      disabled={isApplying || !newFolderName.trim()}
                      className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {localized.viewerCreate || "Create"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {mode === "move" && usePatternMove && (
            <>
              <label className="mb-3 flex items-center gap-2 text-white">
                <input
                  type="checkbox"
                  checked={useRegex}
                  onChange={(event) => setUseRegex(event.target.checked)}
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

              <label className="mt-4 flex items-center gap-2 text-white">
                <input
                  type="checkbox"
                  checked={replaceFileName}
                  onChange={(event) => setReplaceFileName(event.target.checked)}
                  className="h-4 w-4"
                />
                {localized.viewerAlsoReplaceFileName || "Also replace the file name"}
              </label>
            </>
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
