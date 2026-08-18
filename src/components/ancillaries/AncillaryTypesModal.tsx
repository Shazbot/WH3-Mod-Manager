import React, { memo, useMemo, useState } from "react";
import { Modal } from "../../flowbite";
import type { AncillariesIconOption, AncillariesOption } from "../../ancillariesData/types";

export type AncillaryTypesModalProps = {
  types: AncillariesOption[];
  /** Every icon the game's types use; a new type picks one of these. */
  icons: AncillariesIconOption[];
  selectedType: string;
  moddersPrefix: string;
  onSelect: (typeKey: string) => void;
  /** Adds the `ancillary_types_tables` row and points the ancillary at it. */
  onCreate: (typeKey: string, iconPath: string) => void;
  onClose: () => void;
};

const inputClass = "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100";

/** One tile in either grid: a big icon over its name, highlighted when it is the current pick. */
const IconTile = ({
  iconUrl,
  label,
  isSelected,
  onClick,
}: {
  iconUrl?: string;
  label: string;
  isSelected: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    className={`rounded border-2 p-2 text-center transition-colors ${
      isSelected ? "border-amber-500 bg-gray-700" : "border-gray-600 hover:border-gray-500 hover:bg-gray-700"
    }`}
  >
    {iconUrl ? (
      <img src={iconUrl} alt="" className="mx-auto h-16 w-16 object-contain" />
    ) : (
      <div className="mx-auto flex h-16 w-16 items-center justify-center text-xs text-gray-500">no icon</div>
    )}
    <div className="mt-2 truncate text-xs text-gray-300">{label}</div>
  </button>
);

/**
 * The type browser: the same icons the dropdown lists, at a size you can actually recognise.
 *
 * Two modes rather than two grids on one screen - browsing the existing types, and building a new
 * one out of an existing icon. A new type is a pending `ancillary_types_tables` row like every other
 * edit here, so it lands in the New rows tab and is saved with the rest.
 */
const AncillaryTypesModal = memo(
  ({ types, icons, selectedType, moddersPrefix, onSelect, onCreate, onClose }: AncillaryTypesModalProps) => {
    const [mode, setMode] = useState<"browse" | "create">("browse");
    const [search, setSearch] = useState("");
    const [newKey, setNewKey] = useState(`${moddersPrefix.trim().replace(/_+$/, "") || "custom"}_anc_type_`);
    const [newIconPath, setNewIconPath] = useState<string>();

    const needle = search.trim().toLowerCase();
    const shownTypes = useMemo(
      () => (needle ? types.filter((type) => type.key.toLowerCase().includes(needle)) : types),
      [needle, types],
    );
    const shownIcons = useMemo(
      () =>
        needle
          ? icons.filter((icon) => icon.name.toLowerCase().includes(needle) || icon.path.toLowerCase().includes(needle))
          : icons,
      [icons, needle],
    );

    const trimmedKey = newKey.trim();
    const isDuplicateKey = types.some((type) => type.key === trimmedKey);
    const createError = !trimmedKey
      ? "Give the type a key."
      : isDuplicateKey
        ? "That type key already exists."
        : !newIconPath
          ? "Pick an icon for the type."
          : undefined;

    return (
      <Modal
        show
        onClose={onClose}
        size="5xl"
        position="center"
        explicitClasses={[
          "max-w-[90vw]",
          "first-child-div-second-child-div-flex-grow",
          "first-child-div-flex-col",
          "!h-[85vh]",
        ]}
      >
        <Modal.Header>{mode === "browse" ? "Ancillary types" : "New ancillary type"}</Modal.Header>
        <Modal.Body>
          <div className="flex h-full flex-col gap-3">
            <div className="flex shrink-0 items-center gap-2">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={mode === "browse" ? "Search types…" : "Search icons…"}
                aria-label={mode === "browse" ? "Search types" : "Search icons"}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "browse" ? "create" : "browse");
                  setSearch("");
                }}
                className="shrink-0 rounded bg-gray-700 px-3 py-1 text-sm text-gray-100 hover:bg-gray-600"
              >
                {mode === "browse" ? "New type…" : "Back to types"}
              </button>
            </div>

            {mode === "create" && (
              <div className="shrink-0 space-y-1">
                <label className="block text-xs text-gray-400">
                  Type key
                  <input
                    type="text"
                    value={newKey}
                    onChange={(event) => setNewKey(event.target.value)}
                    aria-label="Type key"
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <div className="text-xs text-gray-500">
                  {newIconPath ? `Icon: ${newIconPath}` : "Pick an icon below."}
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid grid-cols-6 gap-3 p-1">
                {mode === "browse"
                  ? shownTypes.map((type) => (
                      <IconTile
                        key={type.key}
                        iconUrl={type.iconUrl}
                        label={type.key}
                        isSelected={type.key === selectedType}
                        onClick={() => {
                          onSelect(type.key);
                          onClose();
                        }}
                      />
                    ))
                  : shownIcons.map((icon) => (
                      <IconTile
                        key={icon.path}
                        iconUrl={icon.iconUrl}
                        label={icon.name}
                        isSelected={icon.path === newIconPath}
                        onClick={() => setNewIconPath(icon.path)}
                      />
                    ))}
              </div>
              {(mode === "browse" ? shownTypes.length : shownIcons.length) === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">
                  {mode === "browse" ? "No types match this search." : "No icons match this search."}
                </div>
              )}
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <div className="flex w-full items-center justify-end gap-2">
            {mode === "create" && createError && <span className="mr-auto text-xs text-amber-300">{createError}</span>}
            {mode === "create" && (
              <button
                type="button"
                disabled={createError !== undefined}
                onClick={() => {
                  onCreate(trimmedKey, newIconPath!);
                  onClose();
                }}
                className="rounded bg-amber-800 px-4 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Create type
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-gray-700 px-4 py-2 text-sm text-gray-100 hover:bg-gray-600"
            >
              Close
            </button>
          </div>
        </Modal.Footer>
      </Modal>
    );
  },
);

export default AncillaryTypesModal;
