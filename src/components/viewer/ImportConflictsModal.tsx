import React, { useContext, useEffect, useMemo, useState } from "react";

import { Modal } from "../../flowbite";
import localizationContext from "../../localizationContext";

type ImportConflictsModalProps = {
  request: PackImportConflictRequest | null;
  isProcessing?: boolean;
  onCancel: () => void;
  onImport: (items: PackImportItem[]) => void | Promise<void>;
};

const ImportConflictsModal: React.FC<ImportConflictsModalProps> = ({
  request,
  isProcessing = false,
  onCancel,
  onImport,
}) => {
  const localized: Record<string, string> = useContext(localizationContext);
  const conflictIndexes = useMemo(
    () =>
      request?.plan.items.reduce<number[]>((indexes, item, index) => {
        if (item.conflictsWith) indexes.push(index);
        return indexes;
      }, []) ?? [],
    [request],
  );
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());

  useEffect(() => {
    setSelectedIndexes(new Set(conflictIndexes));
  }, [conflictIndexes]);

  const handleImport = () => {
    if (!request || isProcessing) return;
    const selected = new Set(selectedIndexes);
    const items = request.plan.items.filter((item, index) => !item.conflictsWith || selected.has(index));
    void onImport(items);
  };

  return (
    <Modal onClose={() => !isProcessing && onCancel()} show={!!request} size="4xl" position="center">
      <Modal.Header>{localized.viewerImportConflicts || "Import Conflicts"}</Modal.Header>
      <Modal.Body>
        <div className="text-sm text-gray-200">
          {request && (
            <>
              <p>
                {(
                  localized.viewerImportConflictExisting ||
                  "{{count}} file(s) already exist in the destination. Checked files will overwrite the current contents."
                ).replace("{{count}}", String(conflictIndexes.length))}
              </p>
              {(request.plan.items.length - conflictIndexes.length > 0 || request.plan.errors.length > 0) && (
                <p className="mt-2 text-gray-400">
                  {(
                    localized.viewerImportConflictNew || "{{count}} new file(s) will be imported automatically."
                  ).replace("{{count}}", String(request.plan.items.length - conflictIndexes.length))}
                  {request.plan.errors.length > 0 &&
                    ` ${(localized.viewerImportConflictUnplanned || "{{count}} path(s) could not be planned.").replace(
                      "{{count}}",
                      String(request.plan.errors.length),
                    )}`}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedIndexes(new Set(conflictIndexes))}
                  disabled={isProcessing}
                  className="rounded bg-gray-600 px-3 py-1 text-xs text-white hover:bg-gray-500 disabled:opacity-50"
                >
                  {localized.viewerSelectAll || "Select all"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIndexes(new Set())}
                  disabled={isProcessing}
                  className="rounded bg-gray-600 px-3 py-1 text-xs text-white hover:bg-gray-500 disabled:opacity-50"
                >
                  {localized.viewerSelectNone || "Select none"}
                </button>
              </div>
              <div className="mt-4 max-h-[50vh] overflow-auto rounded border border-gray-700">
                {request.plan.items.map((item, index) => {
                  if (!item.conflictsWith) return null;
                  return (
                    <label
                      key={`${item.packFilePath}-${item.diskPath}`}
                      data-testid="import-conflict-row"
                      className="flex cursor-pointer items-start gap-3 border-b border-gray-700 p-3 last:border-b-0 hover:bg-gray-800"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIndexes.has(index)}
                        onChange={() =>
                          setSelectedIndexes((previous) => {
                            const next = new Set(previous);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                        disabled={isProcessing}
                        aria-label={(localized.viewerOverwritePath || "Overwrite {{path}}").replace(
                          "{{path}}",
                          item.packFilePath,
                        )}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block break-all text-white">{item.packFilePath}</span>
                        <span className="mt-1 block break-all text-xs text-gray-400">
                          {item.diskPath} {localized.viewerConflictsWith || "· conflicts with"}{" "}
                          {item.conflictsWith === "unsaved"
                            ? localized.viewerUnsavedFile || "an unsaved file"
                            : localized.viewerPackFile || "a pack file"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <button
          type="button"
          onClick={onCancel}
          disabled={isProcessing}
          className="rounded bg-gray-600 px-4 py-2 font-medium text-white hover:bg-gray-500 disabled:opacity-50"
        >
          {localized.cancel || "Cancel"}
        </button>
        <button
          type="button"
          onClick={handleImport}
          disabled={isProcessing || !request}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isProcessing ? localized.viewerImporting || "Importing…" : localized.viewerImport || "Import"}
        </button>
      </Modal.Footer>
    </Modal>
  );
};

export default ImportConflictsModal;
