import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { AutoSizer } from "react-virtualized";
import { VscWarning } from "react-icons/vsc";
import { isErrorLine, stripPrefix, type PrefixMode, type VisibleRow } from "../../gameLog/parse";

export const ROW_HEIGHT = 20;

type ListChildComponentProps<T> = { index: number; style: CSSProperties; data: T };
type FixedSizeListHandle = { scrollToItem: (index: number, align?: "auto" | "center" | "end" | "start") => void };
type FixedSizeListProps = {
  height: number;
  width: number | string;
  itemCount: number;
  itemSize: number;
  itemData: ItemData;
  overscanCount?: number;
  innerElementType?: React.ElementType;
  outerRef?: React.Ref<HTMLDivElement>;
  onScroll?: (info: { scrollOffset: number; scrollUpdateWasRequested: boolean }) => void;
  children: React.ComponentType<ListChildComponentProps<ItemData>>;
  ref?: React.Ref<FixedSizeListHandle>;
};

// react-window has no bundled TypeScript declarations; type the small surface used here locally.
const { FixedSizeList } = require("react-window") as { FixedSizeList: React.ComponentType<FixedSizeListProps> };

export type GameLogViewerProps = {
  lines: readonly string[];
  rows: readonly VisibleRow[];
  prefixMode: PrefixMode;
  isPinned: boolean;
  onPinnedChange: (value: boolean) => void;
  /** Row position to scroll to; a new nonce re-triggers the scroll. */
  scrollRequest: { position: number; nonce: number } | undefined;
  flashIndex: number | undefined;
};

type ItemData = Pick<GameLogViewerProps, "lines" | "rows" | "prefixMode" | "flashIndex"> & {
  selected: ReadonlySet<number>;
  onGutterMouseDown: (position: number, event: MouseEvent) => void;
};

/** Where a line-number drag started, and what it adds to or removes from. */
type SelectionAnchor = { lineIndex: number; base: ReadonlySet<number>; isRemoving: boolean };

const EDGE_SCROLL_PX = 24;

/** The base selection with every line between two row positions added or removed. */
const applyRange = (rows: readonly VisibleRow[], anchor: SelectionAnchor, from: number, to: number) => {
  const next = new Set(anchor.base);
  for (let position = Math.min(from, to); position <= Math.max(from, to); position++) {
    const row = rows[position];
    if (row?.kind !== "line") continue;
    if (anchor.isRemoving) next.delete(row.index);
    else next.add(row.index);
  }
  return next;
};

// The inner element is widened to the longest line so the list itself scrolls horizontally.
const InnerElement = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { style?: CSSProperties }>(
  ({ style, ...rest }, ref) => <div ref={ref} style={{ ...style, width: "max(100%, var(--log-width))" }} {...rest} />,
);
InnerElement.displayName = "GameLogInnerElement";

const Row = memo(({ index, style, data }: ListChildComponentProps<ItemData>) => {
  const row = data.rows[index];
  if (row.kind === "separator") {
    return (
      <div style={style} className="px-2 text-gray-500 border-y border-dashed border-gray-700 select-none">
        ···
      </div>
    );
  }
  const line = data.lines[row.index];
  const isError = isErrorLine(line);
  const isFlashing = data.flashIndex === row.index;
  const isSelected = data.selected.has(row.index);
  return (
    <div
      style={{ ...style, tabSize: 4 }}
      className={`flex items-center whitespace-pre px-2 ${
        isFlashing ? "bg-yellow-600/60" : isSelected ? "bg-blue-500/[.22]" : isError ? "bg-red-900/50" : ""
      }`}
    >
      <span
        className={`inline-block w-12 shrink-0 text-right pr-2 select-none cursor-default ${
          isSelected ? "text-blue-200" : "text-gray-500 hover:text-gray-300"
        }`}
        onMouseDown={(event) => data.onGutterMouseDown(index, event)}
      >
        {row.index + 1}
      </span>
      <span className="inline-block w-4 shrink-0 text-red-400" title={isError ? "Error" : undefined}>
        {isError && <VscWarning aria-label="Error" />}
      </span>
      <span>{stripPrefix(line, data.prefixMode)}</span>
    </div>
  );
});
Row.displayName = "GameLogRow";

const GameLogViewer = memo((props: GameLogViewerProps) => {
  const { lines, rows, prefixMode, flashIndex, isPinned, onPinnedChange, scrollRequest } = props;
  const listRef = useRef<FixedSizeListHandle>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<SelectionAnchor>(undefined);
  const stopDragRef = useRef<() => void>(undefined);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const heightRef = useRef(0);
  const isProgrammaticScroll = useRef(false);

  // Widest rendered row (in characters), measured over visible rows only; cheap enough at ~10^5 lines.
  let maxChars = 0;
  for (const row of rows) {
    if (row.kind !== "line") continue;
    const length = stripPrefix(lines[row.index], prefixMode).length;
    if (length > maxChars) maxChars = length;
  }

  useEffect(() => {
    if (isPinned && rows.length > 0) {
      isProgrammaticScroll.current = true;
      listRef.current?.scrollToItem(rows.length - 1, "end");
    }
  }, [isPinned, rows.length]);

  useEffect(() => {
    if (!scrollRequest) return;
    isProgrammaticScroll.current = true;
    listRef.current?.scrollToItem(scrollRequest.position, "center");
  }, [scrollRequest]);

  const onScroll = useCallback(
    ({ scrollOffset, scrollUpdateWasRequested }: { scrollOffset: number; scrollUpdateWasRequested: boolean }) => {
      if (scrollUpdateWasRequested) {
        isProgrammaticScroll.current = false;
        return;
      }
      const atBottom = scrollOffset + heightRef.current >= rows.length * ROW_HEIGHT - ROW_HEIGHT;
      onPinnedChange(atBottom);
    },
    [onPinnedChange, rows.length],
  );

  useEffect(() => () => stopDragRef.current?.(), []);

  // Line-number gutter: click selects a line, Shift extends from the last anchor, Ctrl toggles; dragging extends the range.
  const onGutterMouseDown = useCallback(
    (position: number, event: MouseEvent) => {
      if (event.button !== 0) return;
      const row = rows[position];
      if (row?.kind !== "line") return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      containerRef.current?.focus();

      const previous = anchorRef.current;
      const previousPosition =
        event.shiftKey && previous ? rows.findIndex((r) => r.kind === "line" && r.index === previous.lineIndex) : -1;
      let anchor: SelectionAnchor;
      let anchorPosition: number;
      if (previous && previousPosition >= 0) {
        anchor = previous;
        anchorPosition = previousPosition;
      } else {
        const isToggle = event.ctrlKey || event.metaKey;
        anchor = {
          lineIndex: row.index,
          base: isToggle ? selected : new Set(),
          isRemoving: isToggle && selected.has(row.index),
        };
        anchorPosition = position;
        anchorRef.current = anchor;
      }
      setSelected(applyRange(rows, anchor, anchorPosition, position));

      // Follow the pointer, scrolling while it is above or below the list.
      stopDragRef.current?.();
      let clientY = event.clientY;
      let frame = 0;
      let lastPosition = position;
      const update = () => {
        frame = 0;
        const outer = outerRef.current;
        if (!outer) return;
        const rect = outer.getBoundingClientRect();
        const edge = clientY < rect.top + EDGE_SCROLL_PX ? -1 : clientY > rect.bottom - EDGE_SCROLL_PX ? 1 : 0;
        outer.scrollTop += edge * EDGE_SCROLL_PX;
        const y = Math.min(Math.max(clientY, rect.top), rect.bottom - 1) - rect.top + outer.scrollTop;
        const current = Math.min(Math.max(Math.floor(y / ROW_HEIGHT), 0), rows.length - 1);
        if (current !== lastPosition) {
          lastPosition = current;
          setSelected(applyRange(rows, anchor, anchorPosition, current));
        }
        // Keep scrolling while the pointer rests at an edge.
        if (edge !== 0) frame = requestAnimationFrame(update);
      };
      const onMove = (moveEvent: globalThis.MouseEvent) => {
        clientY = moveEvent.clientY;
        if (!frame) frame = requestAnimationFrame(update);
      };
      const stop = () => {
        cancelAnimationFrame(frame);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", stop);
        stopDragRef.current = undefined;
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", stop);
      stopDragRef.current = stop;
    },
    [rows, selected],
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && selected.size > 0) {
      setSelected(new Set());
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c" || selected.size === 0) return;
    // Selected text inside a line wins over the line selection.
    if (window.getSelection()?.toString()) return;
    event.preventDefault();
    const text = [...selected]
      .filter((lineIndex) => lineIndex < lines.length)
      .sort((a, b) => a - b)
      .map((lineIndex) => stripPrefix(lines[lineIndex], prefixMode))
      .join("\n");
    void navigator.clipboard.writeText(text);
  };

  const itemData: ItemData = { lines, rows, prefixMode, flashIndex, selected, onGutterMouseDown };
  const containerStyle = { "--log-width": `calc(${maxChars}ch + 4.5rem)` } as CSSProperties;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="relative flex-1 min-h-0 font-mono text-[13px] text-gray-200 bg-gray-900 outline-none"
      style={containerStyle}
    >
      <AutoSizer onResize={({ height }) => (heightRef.current = height)}>
        {({ height, width }) => (
          <FixedSizeList
            ref={listRef}
            height={height}
            width={width}
            itemCount={rows.length}
            itemSize={ROW_HEIGHT}
            itemData={itemData}
            overscanCount={20}
            innerElementType={InnerElement}
            outerRef={outerRef}
            onScroll={onScroll}
          >
            {Row}
          </FixedSizeList>
        )}
      </AutoSizer>
      {!isPinned && rows.length > 0 && (
        <button
          type="button"
          className="absolute bottom-3 right-5 px-3 py-1 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow"
          onClick={() => onPinnedChange(true)}
        >
          Jump to latest
        </button>
      )}
    </div>
  );
});

export default GameLogViewer;
