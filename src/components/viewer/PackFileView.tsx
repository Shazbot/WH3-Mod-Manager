import React, { memo, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";
import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { useAppSelector } from "@/src/hooks";
import { makeSelectCurrentPackData, makeSelectCurrentPackUnsavedFiles } from "./viewerSelectors";
import type { ShowViewerDialog } from "./viewerDialogs";
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
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });

  const viewerKind = useMemo(() => getPackedFileViewerKind(filePath), [filePath]);
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
  }, [filePath, packPath, packedFile, showDialog, viewerKind]);

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
      <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">{filePath}</div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={loadedState.text || ""}
          height="100%"
          extensions={editorExtensions}
          editable={false}
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
