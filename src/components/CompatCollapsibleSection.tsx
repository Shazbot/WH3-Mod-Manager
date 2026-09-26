import React from "react";
import { LuChevronRight } from "react-icons/lu";

interface CompatCollapsibleSectionProps {
  title: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}

/** A compatibility result disclosure. It is intentionally closed on first render. */
const CompatCollapsibleSection = ({ title, count, children }: CompatCollapsibleSectionProps) => (
  <details className="group overflow-hidden rounded-lg border border-gray-200 bg-white/60 dark:border-gray-700 dark:bg-gray-800/40">
    <summary className="flex list-none cursor-pointer items-center gap-2 px-3 py-2.5 font-semibold text-gray-900 outline-none transition-colors [&::-webkit-details-marker]:hidden hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-100 dark:hover:bg-gray-700/60">
      <LuChevronRight
        className="h-5 w-5 shrink-0 text-blue-600 transition-transform group-open:rotate-90 dark:text-blue-400"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 break-all">{title}</span>
      {count !== undefined && (
        <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
          {count}
        </span>
      )}
    </summary>
    <div className="border-t border-gray-200 px-3 py-3 dark:border-gray-700">{children}</div>
  </details>
);

export default CompatCollapsibleSection;
