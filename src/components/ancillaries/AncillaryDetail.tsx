import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import WindowedSelect, { components, type MenuListProps } from "react-windowed-select";
import { createFilter } from "react-select";
import { IoAdd, IoCopy, IoLockClosed, IoTrash } from "react-icons/io5";
import selectStyle from "../../styles/selectStyle";
import {
  LOC_TABLE,
  ancillaryRenameActions,
  findPendingRow,
  type AncillariesEditAction,
  type AncillariesEditState,
  type AncillariesNewRow,
  type AncillariesRowOrigin,
} from "../../ancillariesData/edits";
import { ancillaryColourTextLocKey, ancillaryExplanationLocKey, ancillaryNameLocKey } from "../../ancillariesData/data";
import AncillaryTypesModal from "./AncillaryTypesModal";
import { useLocalizations } from "../../localizationContext";
import type { AncillariesCatalog, AncillaryDetail as AncillaryDetailModel } from "../../ancillariesData/types";

/** A menu that renders in a portal needs to sit above the rest of the app. */
const portalSelectStyle = {
  ...selectStyle,
  menuPortal: (base: any) => ({ ...base, zIndex: 70 }),
  menu: (base: any) => ({ ...selectStyle.menu(base), zIndex: 70 }),
};

const EFFECT_OPTION_HEIGHT = 58;

/**
 * The default windowed menu measures a row by the `height` in the option style, falling back to
 * 35px. An option taller than that overlaps the next one, so every taller row states its height
 * here. The effect picker uses the same fixed height in its custom menu list below.
 */
const withOptionHeight = (height: number) => ({
  ...portalSelectStyle,
  option: (base: any, state: any) => ({
    ...selectStyle.option(base, state),
    height,
    display: "flex",
    alignItems: "center",
  }),
});

/** One line next to a 20px icon. */
const typeSelectStyle = withOptionHeight(44);
/** Two lines - the description and the effect key - next to a 20px icon. */
const effectSelectStyle = withOptionHeight(EFFECT_OPTION_HEIGHT);

export type AncillaryDetailProps = {
  detail?: AncillaryDetailModel;
  catalog?: AncillariesCatalog;
  edits: AncillariesEditState;
  dispatch: (action: AncillariesEditAction) => void;
  /** Editing controls only render for modders; the card itself is for everyone. */
  isEditingEnabled: boolean;
  onClone?: (key: string) => void;
  isCloning?: boolean;
  /** Follows a rename, so the tab keeps showing the ancillary the user is editing. */
  onKeyChange?: (key: string) => void;
};

/**
 * The `ancillaries_tables` columns the panel exposes inline.
 *
 * A deliberate subset: the rest of the row is still reachable through the New rows tab, but a form
 * with all 29 columns would bury the handful anyone actually changes.
 */
type SelectOption = { value: string; label: string; iconUrl?: string };

type FieldSpec =
  | { column: string; label: string; kind: "number" }
  | { column: string; label: string; kind: "boolean" }
  /** `withIcons` swaps the native select for a picker that can draw each option's icon. */
  | { column: string; label: string; kind: "select"; options: () => SelectOption[]; withIcons?: boolean };

const isTrue = (value: string | undefined) => (value ?? "").trim().toLowerCase() === "true";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-3 overflow-hidden rounded border border-gray-600/90 bg-gray-900/75">
    <h3 className="bg-gray-800 px-3 py-2 text-sm font-semibold text-amber-100">{title}</h3>
    <div className="p-3">{children}</div>
  </section>
);

/** The icon that goes with an option, or the space it would take, so the labels stay aligned. */
const OptionIcon = ({ iconUrl }: { iconUrl?: string }) =>
  iconUrl ? (
    <img src={iconUrl} alt="" className="h-5 w-5 shrink-0 object-contain" />
  ) : (
    <span className="h-5 w-5 shrink-0" />
  );

type FixedSizeListHandle = {
  scrollToItem: (index: number, align?: "auto" | "smart" | "center" | "end" | "start") => void;
};

type FixedSizeListProps = {
  children: React.ComponentType<{
    data: React.ReactNode[];
    index: number;
    style: React.CSSProperties;
  }>;
  height: number;
  itemCount: number;
  itemData: React.ReactNode[];
  itemKey?: (index: number, data: React.ReactNode[]) => React.Key;
  itemSize: number;
  className?: string;
  outerElementType?: React.ElementType;
  outerRef?: React.Ref<HTMLDivElement>;
  overscanCount?: number;
  style?: React.CSSProperties;
  width: number | string;
  ref?: React.Ref<FixedSizeListHandle>;
};

// react-window has no bundled TypeScript declarations. Keep the small runtime surface used here
// typed locally instead of leaking an untyped module through the rest of the component.
const { FixedSizeList } = require("react-window") as { FixedSizeList: React.ComponentType<FixedSizeListProps> };

const menuListOuterProps = React.createContext<React.HTMLAttributes<HTMLDivElement>>({});

const FixedSizeMenuListOuter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, ...listProps }, ref) => {
    const innerProps = React.useContext(menuListOuterProps);
    return (
      <div {...innerProps} {...listProps} ref={ref}>
        {children}
      </div>
    );
  },
);

const FixedMenuOption = ({
  data,
  index,
  style,
}: {
  data: React.ReactNode[];
  index: number;
  style: React.CSSProperties;
}) => <div style={style}>{data[index]}</div>;

/**
 * The effect picker has a known, fixed row height. The package's default windowed menu uses a
 * VariableSizeList and calls getBoundingClientRect for every newly visible row, which makes a long
 * effect list visibly hitch while scrolling. A FixedSizeList needs no layout reads on the scroll
 * path and still keeps the menu's keyboard-focused option in view.
 */
const FixedEffectMenuList = (props: MenuListProps<unknown, boolean>) => {
  const optionElements = useMemo(() => React.Children.toArray(props.children), [props.children]);
  const listRef = React.useRef<FixedSizeListHandle>(null);
  const focusedIndex = useMemo(
    () =>
      optionElements.findIndex(
        (child) => React.isValidElement(child) && (child.props as { isFocused?: boolean }).isFocused,
      ),
    [optionElements],
  );

  useEffect(() => {
    if (focusedIndex >= 0) listRef.current?.scrollToItem(focusedIndex, "smart");
  }, [focusedIndex, optionElements]);

  const hasOptions = optionElements.every(
    (child) => React.isValidElement(child) && (child.props as { data?: unknown }).data !== undefined,
  );
  if (!hasOptions) return <components.MenuList {...props} />;

  const menuListStyle = props.getStyles("menuList", props) as React.CSSProperties;
  const paddingTop = Number.parseFloat(String(menuListStyle.paddingTop ?? 0)) || 0;
  const paddingBottom = Number.parseFloat(String(menuListStyle.paddingBottom ?? 0)) || 0;
  const contentHeight = optionElements.length * EFFECT_OPTION_HEIGHT + paddingTop + paddingBottom;
  const height = Math.min(props.maxHeight, contentHeight);
  const classNamePrefix = props.selectProps.classNamePrefix;

  return (
    <menuListOuterProps.Provider value={props.innerProps}>
      <FixedSizeList
        ref={listRef}
        outerRef={props.innerRef}
        outerElementType={FixedSizeMenuListOuter}
        className={classNamePrefix ? `${classNamePrefix}__menu-list` : undefined}
        height={height}
        itemCount={optionElements.length}
        itemData={optionElements}
        itemKey={(index, data) => (React.isValidElement(data[index]) ? (data[index].key ?? index) : index)}
        itemSize={EFFECT_OPTION_HEIGHT}
        overscanCount={2}
        style={menuListStyle}
        width="100%"
      >
        {FixedMenuOption}
      </FixedSizeList>
    </menuListOuterProps.Provider>
  );
};

const formatEffectOptionLabel = (option: unknown, meta: { context: string }) => {
  const { value, label, iconUrl } = option as SelectOption;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <OptionIcon iconUrl={iconUrl} />
      <div className="min-w-0">
        <div className="truncate">{label}</div>
        {meta.context === "menu" && label !== value && <div className="truncate text-xs text-gray-400">{value}</div>}
      </div>
    </div>
  );
};

/**
 * A select that draws each option's icon next to its name.
 *
 * A native `<select>` cannot render an image inside an `<option>`, so this is the one field that
 * goes through react-select. The menu is portalled for the same reason the effects picker is: the
 * panel scrolls, and the field can sit near the bottom of the window.
 */
const IconSelect = ({
  options,
  value,
  onChange,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}) => {
  // A value the options do not cover still has to show, or the cell would look empty and get reset.
  const selected = options.find((option) => option.value === value) ?? { value, label: value || "—" };
  return (
    <WindowedSelect
      filterOption={createFilter({ ignoreAccents: false })}
      options={options}
      value={selected}
      // @ts-expect-error react-select value type does not match the windowed select wrapper.
      onChange={(option: SelectOption | null) => onChange(option?.value ?? "")}
      formatOptionLabel={(option: unknown) => (
        <div className="flex min-w-0 items-center gap-2">
          <OptionIcon iconUrl={(option as SelectOption).iconUrl} />
          <span className="truncate">{(option as SelectOption).label}</span>
        </div>
      )}
      styles={typeSelectStyle}
      className="mt-1"
      menuPortalTarget={document.body}
      menuPosition="fixed"
      menuPlacement="auto"
    />
  );
};

const AncillaryDetail = memo(
  ({ detail, catalog, edits, dispatch, isEditingEnabled, onClone, isCloning, onKeyChange }: AncillaryDetailProps) => {
    const [pendingEffectKey, setPendingEffectKey] = useState<string>();
    const [isTypesOpen, setIsTypesOpen] = useState(false);
    const localized = useLocalizations();

    const booleanFields = useMemo(
      () => [
        { column: "transferrable", label: localized.ancillariesFieldTransferrable || "Transferrable" },
        { column: "legendary_item", label: localized.ancillariesFieldLegendary || "Legendary" },
        { column: "immortal", label: localized.ancillariesFieldImmortal || "Immortal" },
        { column: "unique_to_world", label: localized.ancillariesFieldUniqueToWorld || "Unique to world" },
        { column: "unique_to_faction", label: localized.ancillariesFieldUniqueToFaction || "Unique to faction" },
        { column: "randomly_dropped", label: localized.ancillariesFieldRandomlyDropped || "Randomly dropped" },
        { column: "can_be_stolen", label: localized.ancillariesFieldCanBeStolen || "Can be stolen" },
        { column: "can_be_destroyed", label: localized.ancillariesFieldCanBeDestroyed || "Can be destroyed" },
      ],
      [localized],
    );

    /**
     * Writes one column, keeping a single override row per `(table, key)`.
     *
     * The first edit seeds the row from the effective values so the override is complete - a partial
     * row would blank every column the user did not touch when the game reads it back.
     */
    const setField = useCallback(
      (
        table: string,
        keyValues: Record<string, string>,
        seed: Record<string, string>,
        column: string,
        value: string,
        origin: AncillariesRowOrigin,
      ) => {
        const existing = findPendingRow(edits, table, keyValues);
        if (existing) {
          dispatch({ type: "setCell", id: existing.id, column, value });
          return;
        }
        dispatch({
          type: "addRows",
          rows: [{ table, origin, values: { ...seed, ...keyValues, [column]: value } }],
        });
      },
      [dispatch, edits],
    );

    const ancillaryKey = detail?.key ?? "";
    const pendingRow: AncillariesNewRow | undefined = useMemo(
      () => (detail ? findPendingRow(edits, "ancillaries_tables", { key: ancillaryKey }) : undefined),
      [ancillaryKey, detail, edits],
    );

    /** The effective value of a column: the pending override if there is one, else the source row. */
    const valueOf = useCallback(
      (column: string) => pendingRow?.values[column] ?? detail?.rowValues[column] ?? "",
      [detail, pendingRow],
    );

    /**
     * A key the user can still change: only a *new* ancillary has one, since renaming an override
     * would just point it at a different ancillary. The New ancillary action writes both rows in
     * one group, which is what tells it apart from an edit to a vanilla row that has no info row.
     */
    const isNewAncillary = useMemo(() => {
      if (pendingRow?.origin !== "newAncillary") return false;
      const infoRow = findPendingRow(edits, "ancillary_info_tables", { ancillary: ancillaryKey });
      return infoRow?.groupId === pendingRow.groupId;
    }, [ancillaryKey, edits, pendingRow]);

    const [draftKey, setDraftKey] = useState(ancillaryKey);
    const [keyError, setKeyError] = useState<string>();
    // A different ancillary, or one the rename already went through for, starts the box over.
    useEffect(() => {
      setDraftKey(ancillaryKey);
      setKeyError(undefined);
    }, [ancillaryKey]);

    /** Committed on blur or Enter rather than per keystroke: a rename rewrites every row at once. */
    const commitKey = useCallback(() => {
      const nextKey = draftKey.trim();
      if (!detail || nextKey === detail.key) return;
      if (!nextKey) {
        setKeyError(localized.ancillariesKeyRequired || "Give the ancillary a key.");
        return;
      }
      if (catalog?.ancillaries.some((ancillary) => ancillary.key === nextKey)) {
        setKeyError(localized.ancillariesKeyTaken || "That ancillary key already exists.");
        return;
      }
      setKeyError(undefined);
      for (const action of ancillaryRenameActions(edits, detail.key, nextKey)) dispatch(action);
      onKeyChange?.(nextKey);
    }, [catalog, detail, dispatch, draftKey, edits, localized, onKeyChange]);

    const setAncillaryField = useCallback(
      (column: string, value: string) => {
        if (!detail) return;
        setField(
          "ancillaries_tables",
          { key: detail.key },
          detail.rowValues,
          column,
          value,
          detail.hasInfoRow ? "editAncillary" : "newAncillary",
        );
      },
      [detail, setField],
    );

    /**
     * A brand new `ancillary_types_tables` row, pointed at an icon that already ships with the game.
     *
     * One group with the field write, so undoing the row and the reference to it is a single step.
     */
    const createType = useCallback(
      (typeKey: string, iconPath: string) => {
        const schema = catalog?.tableSchemas.ancillary_types_tables;
        const values: Record<string, string> = {};
        for (const field of schema?.fields ?? []) values[field.name] = field.default_value ?? "";
        values.type = typeKey;
        values.ui_icon = iconPath;
        dispatch({ type: "addRows", rows: [{ table: "ancillary_types_tables", origin: "newType", values }] });
        setAncillaryField("type", typeKey);
      },
      [catalog, dispatch, setAncillaryField],
    );

    const setLocField = useCallback(
      (locKey: string, text: string) => {
        setField(LOC_TABLE, { key: locKey }, { key: locKey }, "text", text, "editAncillary");
      },
      [setField],
    );

    const locValue = useCallback(
      (locKey: string, fallback: string | undefined) =>
        findPendingRow(edits, LOC_TABLE, { key: locKey })?.values.text ?? fallback ?? "",
      [edits],
    );

    const fields = useMemo<FieldSpec[]>(
      () => [
        {
          column: "category",
          label: localized.ancillariesFieldCategory || "Category",
          kind: "select",
          options: () => (catalog?.categories ?? []).map((row) => ({ value: row.key, label: row.localizedName })),
        },
        {
          column: "subcategory",
          label: localized.ancillariesFieldSubcategory || "Subcategory",
          kind: "select",
          options: () => [
            { value: "", label: "—" },
            ...(catalog?.subcategories ?? []).map((row) => ({ value: row.key, label: row.localizedName })),
          ],
        },
        {
          column: "type",
          label: localized.ancillariesFieldType || "Type (icon)",
          kind: "select",
          withIcons: true,
          options: () =>
            (catalog?.types ?? []).map((row) => ({
              value: row.key,
              label: row.localizedName,
              iconUrl: row.iconUrl,
            })),
        },
        {
          column: "uniqueness_score",
          label: localized.ancillariesFieldUniquenessScore || "Uniqueness score",
          kind: "number",
        },
        { column: "precedence", label: localized.ancillariesFieldPrecedence || "Precedence", kind: "number" },
      ],
      [catalog, localized],
    );

    const effectOptions = useMemo(() => {
      const options = catalog?.effects ?? [];
      // Effects an ancillary already uses come first: they are the ones that make sense here, and
      // the other ~13k are mostly for buildings and technologies.
      return [...options].sort(
        (a, b) =>
          Number(b.usedByAncillaries) - Number(a.usedByAncillaries) || a.localizedName.localeCompare(b.localizedName),
      );
    }, [catalog]);

    const effectSelectOptions = useMemo<SelectOption[]>(
      () =>
        effectOptions.map((effect) => ({
          value: effect.key,
          label: effect.localizedName,
          iconUrl: effect.iconUrl,
        })),
      [effectOptions],
    );

    const selectedEffect = useMemo(
      () => catalog?.effects.find((effect) => effect.key === pendingEffectKey),
      [catalog, pendingEffectKey],
    );

    const addEffect = useCallback(() => {
      if (!detail || !pendingEffectKey) return;
      const option = catalog?.effects.find((effect) => effect.key === pendingEffectKey);
      dispatch({
        type: "addRows",
        rows: [
          {
            table: "ancillary_to_effects_tables",
            origin: "addEffect",
            values: {
              ancillary: detail.key,
              effect: pendingEffectKey,
              effect_scope: option?.preferredScope ?? catalog?.effectScopes[0] ?? "",
              value: "0",
            },
          },
        ],
      });
      setPendingEffectKey(undefined);
    }, [catalog, detail, dispatch, pendingEffectKey]);

    if (!detail) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
          {localized.ancillariesPickOne || "Pick an ancillary on the left to see its effects."}
        </div>
      );
    }

    const name = locValue(ancillaryNameLocKey(detail.key), detail.localizedName);
    const explanation = locValue(ancillaryExplanationLocKey(detail.key), detail.explanation);
    const colourText = locValue(ancillaryColourTextLocKey(detail.key), detail.colourText);

    return (
      <div className={`h-full overflow-y-auto p-4 ${isEditingEnabled ? "" : "flex flex-col justify-center"}`}>
        {/* The frame is drawn in CSS rather than with the tooltip background image, so it stays
            crisp at any card height instead of stretching. */}
        <div
          style={{ fontFamily: '"Libre Baskerville", serif' }}
          className="space-y-2 rounded-md border-2 border-amber-900/70 bg-gradient-to-b from-gray-900 to-gray-950 p-4 text-sm text-gray-100 shadow-[inset_0_0_0_1px_rgba(217,164,80,0.35)]"
        >
          <div className="flex items-start gap-3">
            {detail.iconUrl ? (
              <img src={detail.iconUrl} alt="" className="h-12 w-12 shrink-0 object-contain" />
            ) : (
              <span className="h-12 w-12 shrink-0 rounded border border-amber-900/60 bg-amber-700/30" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-amber-100">{name}</div>
              <div className="text-xs text-gray-300">
                {detail.categoryName}
                {detail.subcategoryName ? ` · ${detail.subcategoryName}` : ""}
              </div>
              <div className="break-all text-[11px] text-gray-400">{detail.key}</div>
            </div>
            {isEditingEnabled && onClone && (
              <button
                type="button"
                onClick={() => onClone(detail.key)}
                disabled={isCloning}
                title={localized.ancillariesCloneTooltip || "Deep clone this ancillary and everything it references"}
                className="flex shrink-0 items-center gap-1 rounded bg-gray-800/80 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
              >
                <IoCopy size={13} />{" "}
                {isCloning ? localized.ancillariesCloneOpening || "Opening…" : localized.ancillariesClone || "Clone"}
              </button>
            )}
          </div>

          {colourText && <p className="border-t border-red-900/40 pt-2 text-xs italic text-gray-300">{colourText}</p>}
          {explanation && <p className="text-xs text-gray-200">{explanation}</p>}

          {detail.effects.length > 0 && (
            <div className="space-y-1 border-t border-red-900/40 pt-2">
              {detail.effects.map((effect) => (
                <div key={`${effect.effectKey}`} className="flex items-center gap-2 text-xs">
                  {effect.iconUrl ? (
                    <img src={effect.iconUrl} alt="" className="h-5 w-5 shrink-0 object-contain" />
                  ) : (
                    <span className="h-5 w-5 shrink-0" />
                  )}
                  <span className={effect.isPositiveValueGood === effect.value >= 0 ? "text-lime-200" : "text-red-200"}>
                    {effect.localizedKey}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {!detail.hasInfoRow && (
          <div className="mt-3 rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
            {localized.ancillariesNoInfoRow ||
              "No ancillary_info_tables row for this key. The game drops ancillaries without one."}
          </div>
        )}

        {isEditingEnabled && (
          <>
            {isNewAncillary && (
              <Section title={localized.ancillariesSectionKey || "Key"}>
                <input
                  type="text"
                  value={draftKey}
                  aria-label={localized.ancillariesAncillaryKey || "Ancillary key"}
                  onChange={(event) => setDraftKey(event.target.value)}
                  onBlur={commitKey}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                />
                {keyError && <div className="mt-1 text-xs text-amber-300">{keyError}</div>}
              </Section>
            )}

            <Section title={localized.ancillariesSectionText || "Text"}>
              <div className="space-y-2">
                {[
                  {
                    locKey: ancillaryNameLocKey(detail.key),
                    label: localized.ancillariesTextName || "Name",
                    value: name,
                  },
                  // Flavour first, the order the card above shows them in.
                  {
                    locKey: ancillaryColourTextLocKey(detail.key),
                    label: localized.ancillariesTextFlavour || "Flavour text",
                    value: colourText,
                  },
                  {
                    locKey: ancillaryExplanationLocKey(detail.key),
                    label: localized.ancillariesTextExplanation || "Explanation",
                    value: explanation,
                  },
                ].map((entry) => (
                  <label key={entry.locKey} className="block text-xs text-gray-400">
                    {entry.label}
                    <textarea
                      value={entry.value}
                      rows={entry.locKey === ancillaryNameLocKey(detail.key) ? 1 : 2}
                      onChange={(event) => setLocField(entry.locKey, event.target.value)}
                      className="mt-1 w-full resize-y rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                    />
                  </label>
                ))}
              </div>
            </Section>

            <Section title={localized.ancillariesSectionEffects || "Effects"}>
              <div className="space-y-1">
                {detail.effects.map((effect) => (
                  <div key={effect.effectKey} className="flex items-center gap-2">
                    <OptionIcon iconUrl={effect.iconUrl} />
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-300" title={effect.effectKey}>
                      {effect.localizedKey}
                    </span>
                    <input
                      type="number"
                      step="any"
                      value={effect.value}
                      onChange={(event) =>
                        setField(
                          "ancillary_to_effects_tables",
                          { ancillary: detail.key, effect: effect.effectKey },
                          { ancillary: detail.key, effect: effect.effectKey, effect_scope: effect.scope },
                          "value",
                          event.target.value,
                          "editEffect",
                        )
                      }
                      className="w-24 shrink-0 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                    />
                    {effect.isPending && effect.pendingRowId ? (
                      <button
                        type="button"
                        title={localized.ancillariesRemovePendingEffect || "Remove this pending effect row"}
                        onClick={() => dispatch({ type: "removeRow", id: effect.pendingRowId! })}
                        className="shrink-0 rounded p-1 text-red-300 hover:bg-red-950"
                      >
                        <IoTrash size={13} />
                      </button>
                    ) : (
                      <span
                        title={
                          localized.ancillariesEffectLocked ||
                          "ancillary_to_effects_tables is keyed on (ancillary, effect); a pack can override a pair but never delete one."
                        }
                        className="shrink-0 p-1 text-gray-600"
                      >
                        <IoLockClosed size={13} />
                      </span>
                    )}
                  </div>
                ))}
                {detail.effects.length === 0 && (
                  <div className="text-xs text-gray-500">{localized.ancillariesNoEffectsYet || "No effects yet."}</div>
                )}
              </div>

              <div className="mt-3 flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-xs text-gray-400">{localized.ancillariesAddEffect || "Add effect"}</div>
                  <WindowedSelect
                    filterOption={createFilter({ ignoreAccents: false })}
                    options={effectSelectOptions}
                    // Name and key both, because the description is what the player reads and the
                    // key is what goes in the row - and the default filter searches label and value
                    // alike, so either one finds the effect.
                    formatOptionLabel={formatEffectOptionLabel}
                    value={
                      pendingEffectKey
                        ? {
                            value: pendingEffectKey,
                            label: selectedEffect?.localizedName ?? pendingEffectKey,
                            iconUrl: selectedEffect?.iconUrl,
                          }
                        : null
                    }
                    // @ts-expect-error react-select value type does not match the windowed select wrapper.
                    onChange={(option: { value: string } | null) => setPendingEffectKey(option?.value)}
                    // The wrapper replaces a custom MenuList once its own threshold is reached;
                    // this picker supplies its own fixed-size virtual list instead.
                    windowThreshold={effectSelectOptions.length + 1}
                    components={{ MenuList: FixedEffectMenuList }}
                    styles={effectSelectStyle}
                    placeholder={localized.ancillariesSearchEffects || "Search effects…"}
                    isClearable
                    // The panel scrolls and this select sits at its bottom: portal the menu out of the
                    // clipping container and let react-select flip it upwards when the viewport is tight.
                    menuPortalTarget={document.body}
                    menuPosition="fixed"
                    menuPlacement="auto"
                  />
                </div>
                <button
                  type="button"
                  onClick={addEffect}
                  disabled={!pendingEffectKey}
                  className="flex shrink-0 items-center gap-1 rounded bg-amber-800 px-3 py-2 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  <IoAdd size={14} /> {localized.ancillariesAdd || "Add"}
                </button>
              </div>
            </Section>

            <Section title={localized.ancillariesSectionFields || "Fields"}>
              <div className="grid grid-cols-2 gap-2">
                {fields.map((field) => (
                  <label key={field.column} className="text-xs text-gray-400">
                    {field.label}
                    {field.kind === "select" && field.withIcons ? (
                      <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <IconSelect
                            options={field.options()}
                            value={valueOf(field.column)}
                            onChange={(value) => setAncillaryField(field.column, value)}
                          />
                        </div>
                        <button
                          type="button"
                          title={
                            localized.ancillariesBrowseTypesTooltip ||
                            "Browse the types at a readable size, or make a new one"
                          }
                          onClick={() => setIsTypesOpen(true)}
                          className="mt-1 shrink-0 rounded bg-gray-700 px-3 py-2 text-xs text-gray-100 hover:bg-gray-600"
                        >
                          {localized.ancillariesBrowse || "Browse…"}
                        </button>
                      </div>
                    ) : field.kind === "select" ? (
                      <select
                        value={valueOf(field.column)}
                        onChange={(event) => setAncillaryField(field.column, event.target.value)}
                        className="mt-1 w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                      >
                        {/* A value the options do not cover would silently reset the cell on render. */}
                        {!field.options().some((option) => option.value === valueOf(field.column)) && (
                          <option value={valueOf(field.column)}>{valueOf(field.column) || "—"}</option>
                        )}
                        {field.options().map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        value={valueOf(field.column)}
                        onChange={(event) => setAncillaryField(field.column, event.target.value)}
                        className="mt-1 w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                      />
                    )}
                  </label>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-1">
                {booleanFields.map((field) => (
                  <label key={field.column} className="flex items-center gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={isTrue(valueOf(field.column))}
                      onChange={(event) => setAncillaryField(field.column, event.target.checked ? "true" : "false")}
                      className="rounded border-gray-600 bg-gray-800"
                    />
                    {field.label}
                  </label>
                ))}
              </div>
            </Section>

            {isTypesOpen && (
              <AncillaryTypesModal
                types={catalog?.types ?? []}
                icons={catalog?.icons ?? []}
                selectedType={valueOf("type")}
                moddersPrefix={catalog?.moddersPrefix ?? ""}
                onSelect={(typeKey) => setAncillaryField("type", typeKey)}
                onCreate={createType}
                onClose={() => setIsTypesOpen(false)}
              />
            )}
          </>
        )}
      </div>
    );
  },
);

export default AncillaryDetail;
