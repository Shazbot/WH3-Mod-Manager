import React from "react";
import { LuArrowRight, LuCheck } from "react-icons/lu";

export interface CompatConflictSide {
  packName: string;
  fileName?: string;
  detail?: React.ReactNode;
  orderLabel?: string;
}

export interface CompatConflictCardLabels {
  winner: string;
  lowerPriority: string;
  compare: string;
}

interface CompatConflictCardProps {
  heading: React.ReactNode;
  headingLabel?: React.ReactNode;
  headingClassName?: string;
  meta?: React.ReactNode;
  metaClassName?: string;
  status?: React.ReactNode;
  first: CompatConflictSide;
  second: CompatConflictSide;
  firstIsWinner: boolean;
  labels: CompatConflictCardLabels;
  footer?: React.ReactNode;
}

const CompatConflictCard = ({
  heading,
  headingLabel,
  headingClassName,
  meta,
  metaClassName,
  status,
  first,
  second,
  firstIsWinner,
  labels,
  footer,
}: CompatConflictCardProps) => {
  const renderSide = (side: CompatConflictSide, isWinner: boolean) => (
    <div
      className={`min-w-0 rounded-lg border p-3 ${
        isWinner
          ? "border-emerald-500/70 bg-emerald-50 dark:bg-emerald-900/20"
          : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide">
        <span className={isWinner ? "text-emerald-700 dark:text-emerald-300" : "text-gray-500 dark:text-gray-400"}>
          {isWinner ? (
            <>
              <LuCheck className="mr-1 inline h-4 w-4 align-[-0.15em]" aria-hidden="true" />
              {labels.winner}
            </>
          ) : (
            labels.lowerPriority
          )}
        </span>
        {side.orderLabel && (
          <span className="font-normal normal-case text-gray-500 dark:text-gray-400">{side.orderLabel}</span>
        )}
      </div>
      <div className="mt-2 break-words font-semibold text-gray-900 dark:text-gray-100">{side.packName}</div>
      {side.fileName && (
        <code className="mt-1 block break-all text-xs text-gray-600 dark:text-gray-400">{side.fileName}</code>
      )}
      {side.detail && <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">{side.detail}</div>}
    </div>
  );

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50">
      <div className="border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
        {headingLabel && (
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {headingLabel}
          </div>
        )}
        <div
          className={`break-all text-gray-900 dark:text-gray-100 ${
            headingClassName ?? "font-mono text-sm font-semibold"
          }`}
        >
          {heading}
        </div>
        {meta && <div className={metaClassName ?? "mt-1 text-xs text-gray-500 dark:text-gray-400"}>{meta}</div>}
      </div>
      {status && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
          {status}
        </div>
      )}
      <div className="grid grid-cols-1 items-stretch gap-2 p-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {renderSide(first, firstIsWinner)}
        <div className="flex items-center justify-center px-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          <LuArrowRight className="mr-1 hidden h-4 w-4 md:inline" aria-hidden="true" />
          <span>{labels.compare}</span>
          <LuArrowRight className="ml-1 h-4 w-4 rotate-90 md:hidden" aria-hidden="true" />
        </div>
        {renderSide(second, !firstIsWinner)}
      </div>
      {footer && (
        <div className="border-t border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
          {footer}
        </div>
      )}
    </article>
  );
};

export default CompatConflictCard;
