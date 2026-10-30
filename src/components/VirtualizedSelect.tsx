import React, { createContext, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import Select, { components, type GroupBase, type MenuListProps, type Props as ReactSelectProps } from "react-select";

type VirtualizedSelectProps<Option, IsMulti extends boolean, Group extends GroupBase<Option>> = ReactSelectProps<
  Option,
  IsMulti,
  Group
> & { windowThreshold?: number };

type MenuRow = {
  child: React.ReactNode;
  key: React.Key | null;
  kind: "group" | "message" | "option";
  fixedHeight?: number;
  estimatedHeight: number;
};

type VariableSizeListHandle = {
  resetAfterIndex: (index: number, shouldForceUpdate?: boolean) => void;
  scrollToItem: (index: number, align?: "auto" | "smart" | "center" | "end" | "start") => void;
};

type VariableSizeListProps = {
  children: React.ComponentType<{ data: MenuRowData; index: number; style: React.CSSProperties }>;
  className?: string;
  height: number;
  innerElementType?: React.ElementType;
  itemCount: number;
  itemData: MenuRowData;
  itemKey?: (index: number, data: MenuRowData) => React.Key;
  itemSize: (index: number) => number;
  outerRef?: React.Ref<HTMLDivElement>;
  outerElementType?: React.ElementType;
  overscanCount?: number;
  style?: React.CSSProperties;
  width: number | string;
};

// react-window has no bundled TypeScript declarations. Keep its small runtime surface typed here,
// following the existing local facade used by the ancillary effect picker.
const { VariableSizeList } = require("react-window") as {
  VariableSizeList: React.ComponentType<VariableSizeListProps & { ref?: React.Ref<VariableSizeListHandle> }>;
};

type MenuRowData = {
  rows: MenuRow[];
  structureKey: string;
  getHeight: (index: number) => number;
  reportHeight: (index: number, height: number) => void;
  paddingTop: number;
};

type MeasurementCache = {
  structureKey: string;
  options: unknown;
  styles: unknown;
  formatOptionLabel: unknown;
  heights: Map<number, number>;
};

const emptyMeasuredHeights = new Map<number, number>();

type MenuListOuterProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
};
const menuListInnerProps = createContext<React.HTMLAttributes<HTMLDivElement>>({});
const menuListPadding = createContext({ top: 0, bottom: 0 });

const VirtualizedMenuListOuter = ({ children, ref, ...listProps }: MenuListOuterProps) => {
  const innerProps = React.useContext(menuListInnerProps);
  return (
    <div {...innerProps} {...listProps} ref={ref}>
      {children}
    </div>
  );
};
VirtualizedMenuListOuter.displayName = "VirtualizedMenuListOuter";

const VirtualizedMenuListInner = ({
  children,
  style,
  ref,
  ...innerProps
}: MenuListOuterProps & { style?: React.CSSProperties }) => {
  const padding = React.useContext(menuListPadding);
  return (
    <div
      {...innerProps}
      ref={ref}
      style={{
        ...style,
        height: (Number.parseFloat(String(style?.height ?? 0)) || 0) + padding.top + padding.bottom,
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
};
VirtualizedMenuListInner.displayName = "VirtualizedMenuListInner";

const VirtualizedMenuRow = ({
  data,
  index,
  style,
}: {
  data: MenuRowData;
  index: number;
  style: React.CSSProperties;
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const row = data.rows[index];

  useLayoutEffect(() => {
    // Explicit heights are already known and must not incur a layout read on scroll.
    if (row.fixedHeight !== undefined) return;
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const height = content.getBoundingClientRect().height;
      if (height > 0) data.reportHeight(index, height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [data.structureKey, data.reportHeight, index, row.fixedHeight]);

  return (
    <div style={{ ...style, top: (Number.parseFloat(String(style.top ?? 0)) || 0) + data.paddingTop }}>
      <div ref={contentRef}>{row.child}</div>
    </div>
  );
};

const numericPixels = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !/^\s*-?(?:\d+\.?\d*|\.\d+)px?\s*$/.test(value)) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getPaddingValue = (style: React.CSSProperties, side: "top" | "right" | "bottom" | "left") => {
  const explicit = numericPixels(style[`padding${side[0].toUpperCase()}${side.slice(1)}` as keyof React.CSSProperties]);
  if (explicit !== undefined) return explicit;

  const shorthand = style.padding;
  if (typeof shorthand === "number") return shorthand;
  if (typeof shorthand !== "string") return 0;
  const values = shorthand.trim().split(/\s+/).map(numericPixels);
  if (values.length === 0 || values.some((value) => value === undefined)) return 0;
  if (values.length === 1) return values[0] ?? 0;
  if (side === "top") return values[0] ?? 0;
  if (side === "right") return values[1] ?? values[0] ?? 0;
  if (side === "bottom") return values[2] ?? values[0] ?? 0;
  return values[3] ?? values[1] ?? values[0] ?? 0;
};

const getOptionCount = (options: readonly unknown[] | undefined) =>
  (options ?? []).reduce<number>((count, option) => {
    const groupOptions = (option as { options?: unknown[] } | null)?.options;
    return count + (Array.isArray(groupOptions) ? groupOptions.length : 1);
  }, 0);

const flattenMenuChildren = (children: React.ReactNode): Array<{ child: React.ReactNode; kind: MenuRow["kind"] }> =>
  React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [{ child, kind: "message" as const }];
    const childProps = child.props as {
      children?: React.ReactNode;
      options?: unknown[];
      data?: unknown;
      Heading?: unknown;
      headingProps?: unknown;
    };

    // react-select renders each group as a Group element containing its options. Keep the group's
    // own heading component as one row and move its options beside it so focused options can scroll
    // independently inside the virtual list.
    if (Array.isArray(childProps.options) && childProps.Heading && childProps.headingProps) {
      const heading = React.cloneElement(child as React.ReactElement<{ children?: React.ReactNode }>, {
        children: null,
      });
      return [
        { child: heading, kind: "group" as const },
        ...React.Children.toArray(childProps.children).map((groupChild) => ({
          child: groupChild,
          kind:
            React.isValidElement(groupChild) && "data" in (groupChild.props as { data?: unknown })
              ? ("option" as const)
              : ("message" as const),
        })),
      ];
    }

    return [{ child, kind: "data" in childProps ? ("option" as const) : ("message" as const) }];
  });

function getRowStyleHeight<Option, IsMulti extends boolean, Group extends GroupBase<Option>>(
  row: { child: React.ReactNode; kind: MenuRow["kind"] },
  props: MenuListProps<Option, IsMulti, Group>,
) {
  if (row.kind === "option" && React.isValidElement(row.child)) {
    const style = props.getStyles("option", row.child.props as never) as React.CSSProperties;
    return numericPixels(style.height);
  }
  if (row.kind === "group" && React.isValidElement(row.child)) {
    const style = props.getStyles("groupHeading", row.child.props as never) as React.CSSProperties;
    return numericPixels(style.height);
  }
  const styleKey = props.selectProps.isLoading ? "loadingMessage" : "noOptionsMessage";
  const style = props.getStyles(styleKey, props as never) as React.CSSProperties;
  return numericPixels(style.height);
}

function VirtualizedMenuList<Option, IsMulti extends boolean, Group extends GroupBase<Option>>(
  props: MenuListProps<Option, IsMulti, Group>,
) {
  const listRef = useRef<VariableSizeListHandle>(null);
  const menuStyle = props.getStyles("menuList", props) as React.CSSProperties;
  const paddingTop = getPaddingValue(menuStyle, "top");
  const paddingBottom = getPaddingValue(menuStyle, "bottom");
  const padding = { top: paddingTop, bottom: paddingBottom };
  const rows = flattenMenuChildren(props.children).map((row) => {
    const fixedHeight = getRowStyleHeight(row, props);
    const defaultHeight = row.kind === "group" ? 25 : 35;
    return {
      ...row,
      key: React.isValidElement(row.child) ? row.child.key : null,
      fixedHeight,
      estimatedHeight: fixedHeight ?? defaultHeight,
    } satisfies MenuRow;
  });
  const structureKey = useMemo(
    () =>
      `${props.selectProps.inputValue}\u0000${rows
        .map(({ child, key, kind, fixedHeight }) => {
          const label = React.isValidElement(child) ? String((child.props as { label?: unknown }).label ?? "") : "";
          return `${String(key ?? "")}:${kind}:${fixedHeight ?? ""}:${label}`;
        })
        .join("\u0001")}`,
    [props.selectProps.inputValue, rows],
  );
  const focusedIndex = rows.findIndex(
    ({ child, kind }) =>
      kind === "option" && React.isValidElement(child) && Boolean((child.props as { isFocused?: boolean }).isFocused),
  );

  const [measurementCache, setMeasurementCache] = useState<MeasurementCache>(() => ({
    structureKey: "",
    options: null,
    styles: null,
    formatOptionLabel: null,
    heights: emptyMeasuredHeights,
  }));
  const optionSource = props.selectProps.options;
  const styleSource = props.selectProps.styles;
  const formatOptionLabel = props.selectProps.formatOptionLabel;
  const measurementMatches =
    measurementCache.structureKey === structureKey &&
    measurementCache.options === optionSource &&
    measurementCache.styles === styleSource &&
    measurementCache.formatOptionLabel === formatOptionLabel;
  const measuredHeights = measurementMatches ? measurementCache.heights : emptyMeasuredHeights;
  const reportHeight = useCallback(
    (index: number, height: number) => {
      setMeasurementCache((current) => {
        const currentMatches =
          current.structureKey === structureKey &&
          current.options === optionSource &&
          current.styles === styleSource &&
          current.formatOptionLabel === formatOptionLabel;
        const currentHeights = currentMatches ? current.heights : emptyMeasuredHeights;
        if (currentHeights.get(index) === height) return current;
        const nextHeights = new Map(currentHeights);
        nextHeights.set(index, height);
        return {
          structureKey,
          options: optionSource,
          styles: styleSource,
          formatOptionLabel,
          heights: nextHeights,
        };
      });
      listRef.current?.resetAfterIndex(index);
    },
    [structureKey, optionSource, styleSource, formatOptionLabel],
  );
  const getHeight = useCallback(
    (index: number) => measuredHeights.get(index) ?? rows[index]?.fixedHeight ?? rows[index]?.estimatedHeight ?? 35,
    [measuredHeights, rows],
  );
  const itemData: MenuRowData = { rows, structureKey, getHeight, reportHeight, paddingTop };

  useLayoutEffect(() => {
    listRef.current?.resetAfterIndex(0, true);
  }, [structureKey, optionSource, styleSource, formatOptionLabel]);

  useLayoutEffect(() => {
    if (focusedIndex >= 0) listRef.current?.scrollToItem(focusedIndex, "smart");
  }, [focusedIndex, structureKey]);

  if (rows.length === 0) return <components.MenuList {...props} />;

  const listStyle: React.CSSProperties = { ...menuStyle };
  delete listStyle.maxHeight;
  delete listStyle.padding;
  delete listStyle.paddingTop;
  delete listStyle.paddingBottom;
  listStyle.paddingLeft = getPaddingValue(menuStyle, "left");
  listStyle.paddingRight = getPaddingValue(menuStyle, "right");

  const contentHeight = rows.reduce((total, _row, index) => total + getHeight(index), padding.top + padding.bottom);
  const height = Math.min(props.maxHeight, contentHeight);
  const classNamePrefix = props.selectProps.classNamePrefix;

  return (
    <menuListInnerProps.Provider value={props.innerProps}>
      <menuListPadding.Provider value={padding}>
        <VariableSizeList
          ref={listRef}
          className={
            classNamePrefix
              ? `${classNamePrefix}__menu-list${props.selectProps.isMulti ? ` ${classNamePrefix}__menu-list--is-multi` : ""}`
              : undefined
          }
          outerRef={props.innerRef}
          outerElementType={VirtualizedMenuListOuter}
          innerElementType={VirtualizedMenuListInner}
          height={height}
          itemCount={rows.length}
          itemData={itemData}
          itemKey={(index, data) => data.rows[index]?.key ?? index}
          itemSize={itemData.getHeight}
          overscanCount={2}
          style={listStyle}
          width="100%"
        >
          {VirtualizedMenuRow}
        </VariableSizeList>
      </menuListPadding.Provider>
    </menuListInnerProps.Provider>
  );
}

/**
 * react-select with bounded menu rendering for large option sets. The default menu rows retain
 * react-select's option components and styles, while callers that provide their own MenuList keep
 * complete control over their list implementation.
 */
export const VirtualizedSelect = <
  Option = unknown,
  IsMulti extends boolean = false,
  Group extends GroupBase<Option> = GroupBase<Option>,
>(
  props: VirtualizedSelectProps<Option, IsMulti, Group>,
) => {
  const { windowThreshold = 100, components: selectComponents, options, ...selectProps } = props;
  const shouldVirtualize = getOptionCount(options) >= windowThreshold;
  const mergedComponents = useMemo(() => {
    if (!shouldVirtualize || selectComponents?.MenuList) return selectComponents;
    return { ...selectComponents, MenuList: VirtualizedMenuList };
  }, [selectComponents, shouldVirtualize]);

  return <Select<Option, IsMulti, Group> {...selectProps} options={options} components={mergedComponents} />;
};

export default VirtualizedSelect;
