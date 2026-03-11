import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";
import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { useAppSelector } from "@/src/hooks";
import { makeSelectCurrentPackData, makeSelectCurrentPackUnsavedFiles } from "./viewerSelectors";
import type { ShowViewerDialog } from "./viewerDialogs";
import { getPackNameFromPath } from "@/src/utility/packFileHelpers";
import { vanillaPackNames } from "@/src/supportedGames";
import {
  decodePackedTextBuffer,
  getPackedFileLowerExtension,
  getPackedFileMimeType,
  getPackedFileViewerKind,
} from "@/src/utility/packFileViewing";

type PackFileViewProps = {
  packPath: string;
  filePath: string;
  showDialog: ShowViewerDialog;
};

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; text?: string; imageSrc?: string }
  | { status: "error"; error: string };

const PackFileView = memo(({ packPath, filePath, showDialog }: PackFileViewProps) => {
  const selectCurrentPackData = useMemo(makeSelectCurrentPackData, []);
  const selectCurrentPackUnsavedFiles = useMemo(makeSelectCurrentPackUnsavedFiles, []);
  const packData = useAppSelector((state) => selectCurrentPackData(state, packPath));
  const unsavedFiles = useAppSelector((state) => selectCurrentPackUnsavedFiles(state, packPath));
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [workingText, setWorkingText] = useState<string | undefined>(undefined);
  const [persistedText, setPersistedText] = useState("");
  const [isPersisting, setIsPersisting] = useState(false);

  const viewerKind = useMemo(() => getPackedFileViewerKind(filePath), [filePath]);
  const openedTextFileKey = viewerKind === "text" ? `${packPath}|${filePath}` : "";
  const packName = getPackNameFromPath(packPath) ?? packPath;
  const canEditTextFile = viewerKind === "text" && isFeaturesForModdersEnabled && !vanillaPackNames.includes(packName);
  const hydratedTextFileKeyRef = useRef<string | null>(null);
  const latestWorkingTextRef = useRef<string | undefined>(undefined);
  const persistedTextRef = useRef("");
  const saveTimeoutRef = useRef<number | null>(null);
  const saveRequestIdRef = useRef(0);
  const packedFile = useMemo(() => {
    const unsavedMatch =
      unsavedFiles.find((file) => file.name === filePath) || unsavedFiles.find((file) => file.name.startsWith(filePath));
    if (unsavedMatch) return unsavedMatch;
    if (!packData?.packedFiles) return undefined;
    if (packData.packedFiles[filePath]) return packData.packedFiles[filePath];

    for (const [iterPackedFilePath, iterPackedFile] of Object.entries(packData.packedFiles)) {
      if (iterPackedFilePath.startsWith(filePath)) {
        return iterPackedFile;
      }
    }
    return undefined;
  }, [filePath, packData, unsavedFiles]);

  const editorExtensions = useMemo(() => {
    const extension = getPackedFileLowerExtension(filePath);
    if (extension === ".lua") {
      return [StreamLanguage.define(lua)];
    }
    if ([".xml", ".variantmeshdefinition", ".wsmodel", ".xml.material"].includes(extension)) {
      return [xml()];
    }
    return [];
  }, [filePath]);

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      if (!viewerKind) {
        setLoadState({ status: "error", error: `Unsupported file type: ${filePath}` });
        return;
      }

      if (viewerKind === "text") {
        if (packedFile?.text != null) {
          setLoadState({ status: "loaded", text: packedFile.text });
          return;
        }
        if (packedFile?.buffer) {
          setLoadState({ status: "loaded", text: decodePackedTextBuffer(packedFile.buffer) });
          return;
        }
      }

      setLoadState({ status: "loading" });
      const result = await window.api?.readFileFromPack(packPath, filePath);
      if (isCancelled) return;

      if (!result?.success) {
        const error = result?.error || "Failed to read file from pack";
        setLoadState({ status: "error", error });
        showDialog(`Failed to read ${filePath}: ${error}`, { title: "Read Failed" });
        return;
      }

      if (viewerKind === "image") {
        if (!result.base64) {
          setLoadState({ status: "error", error: "Image data is unavailable" });
          return;
        }
        const mimeType = result.mimeType || getPackedFileMimeType(filePath) || "application/octet-stream";
        setLoadState({ status: "loaded", imageSrc: `data:${mimeType};base64,${result.base64}` });
        return;
      }

      setLoadState({ status: "loaded", text: result.text || "" });
    };

    void load();
    return () => {
      isCancelled = true;
    };
  }, [filePath, packPath, packedFile?.buffer, packedFile?.text, showDialog, viewerKind]);

  useEffect(() => {
    latestWorkingTextRef.current = workingText;
  }, [workingText]);

  useEffect(() => {
    persistedTextRef.current = persistedText;
  }, [persistedText]);

  useEffect(() => {
    if (viewerKind !== "text" || loadState.status !== "loaded") return;

    const nextText = loadState.text || "";
    const shouldHydrate = hydratedTextFileKeyRef.current !== openedTextFileKey || workingText == null;
    if (!shouldHydrate) return;

    hydratedTextFileKeyRef.current = openedTextFileKey;
    setWorkingText(nextText);
    setPersistedText(nextText);
    setIsPersisting(false);
    latestWorkingTextRef.current = nextText;
  }, [loadState, openedTextFileKey, viewerKind, workingText]);

  const persistText = useCallback(
    async (nextText: string, options?: { suppressDialog?: boolean }) => {
      if (!canEditTextFile) return true;

      const requestId = ++saveRequestIdRef.current;
      setIsPersisting(true);

      try {
        const result = await window.api?.saveTextPackedFileEdits(packPath, filePath, nextText);
        if (!result?.success) {
          throw new Error(result?.error || "Failed to store text file edits");
        }

        if (requestId === saveRequestIdRef.current) {
          setPersistedText(nextText);
          setIsPersisting(false);
        }

        return true;
      } catch (error) {
        if (requestId === saveRequestIdRef.current) {
          setIsPersisting(false);
        }
        if (!options?.suppressDialog) {
          showDialog(
            `Failed to save ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`,
            { title: "Save Failed" },
          );
        }
        return false;
      }
    },
    [canEditTextFile, filePath, packPath, showDialog],
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current != null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      const pendingText = latestWorkingTextRef.current;
      if (!canEditTextFile || pendingText == null || pendingText === persistedTextRef.current) return;
      void persistText(pendingText, { suppressDialog: true });
    };
  }, [canEditTextFile, openedTextFileKey, persistText]);

  const handleTextChange = useCallback(
    (nextText: string) => {
      if (!canEditTextFile) return;

      setWorkingText(nextText);
      latestWorkingTextRef.current = nextText;

      if (saveTimeoutRef.current != null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      saveTimeoutRef.current = window.setTimeout(() => {
        saveTimeoutRef.current = null;
        void persistText(nextText);
      }, 250);
    },
    [canEditTextFile, persistText],
  );

  if (!viewerKind) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Unsupported file type.</div>;
  }

  if (loadState.status === "loading" || loadState.status === "idle") {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading file...</div>;
  }

  if (loadState.status === "error") {
    return <div className="h-full flex items-center justify-center text-sm text-red-300">{loadState.error}</div>;
  }

  const loadedState = loadState as Extract<LoadState, { status: "loaded" }>;
  const displayedText = workingText ?? loadedState.text ?? "";
  const hasPendingTextChanges = canEditTextFile && displayedText !== persistedText;

  if (viewerKind === "image") {
    return (
      <div className="h-full flex flex-col bg-gray-900">
        <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">{filePath}</div>
        <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4">
          {loadedState.imageSrc ? (
            <img src={loadedState.imageSrc} alt={filePath} className="max-w-full max-h-full object-contain" />
          ) : (
            <div className="text-sm text-gray-400">Image data is unavailable.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-gray-900">
      <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700 flex items-center justify-between gap-3">
        <span className="truncate">{filePath}</span>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-gray-500">
          {canEditTextFile ? (isPersisting ? "Saving..." : hasPendingTextChanges ? "Modified" : "Editable") : "Read Only"}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={displayedText}
          height="100%"
          theme={vscodeDark}
          extensions={editorExtensions}
          editable={canEditTextFile}
          onChange={handleTextChange}
          basicSetup={{
            foldGutter: true,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
        />
      </div>
    </div>
  );
});

export default PackFileView;
