import { forwardRef, memo, useCallback, useEffect, useRef, type CSSProperties, type HTMLAttributes } from "react";
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

type ItemData = Pick<GameLogViewerProps, "lines" | "rows" | "prefixMode" | "flashIndex">;

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
  return (
    <div
      style={{ ...style, tabSize: 4 }}
      className={`flex items-center whitespace-pre px-2 ${
        isFlashing ? "bg-yellow-600/60" : isError ? "bg-red-900/50" : ""
      }`}
    >
      <span className="inline-block w-12 shrink-0 text-right pr-2 text-gray-500 select-none">{row.index + 1}</span>
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

  const itemData: ItemData = { lines, rows, prefixMode, flashIndex };
  const containerStyle = { "--log-width": `calc(${maxChars}ch + 4.5rem)` } as CSSProperties;

  return (
    <div className="relative flex-1 min-h-0 font-mono text-[13px] text-gray-200 bg-gray-900" style={containerStyle}>
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
