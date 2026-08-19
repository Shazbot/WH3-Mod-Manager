/**
 * The tailwind classes a category's colour picks out, shared by everything that paints a category: the
 * badges in the categories tab and the group headings in the mod list's categories view.
 *
 * The classes are spelled out rather than composed from the colour name because tailwind only emits what
 * it can find as a literal in the source.
 */
export const categoryColorClasses: Record<string, { bg: string; text: string; hover: string; button: string }> = {
  blue: {
    bg: "bg-blue-100 dark:bg-blue-900",
    text: "text-blue-800 dark:text-blue-300",
    hover: "hover:bg-blue-200 dark:hover:bg-blue-800",
    button: "text-blue-400 hover:text-blue-900 dark:hover:text-blue-300",
  },
  emerald: {
    bg: "bg-emerald-100 dark:bg-emerald-900",
    text: "text-emerald-800 dark:text-emerald-300",
    hover: "hover:bg-emerald-200 dark:hover:bg-emerald-800",
    button: "text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300",
  },
  red: {
    bg: "bg-red-100 dark:bg-red-900",
    text: "text-red-800 dark:text-red-300",
    hover: "hover:bg-red-200 dark:hover:bg-red-800",
    button: "text-red-400 hover:text-red-900 dark:hover:text-red-300",
  },
  amber: {
    bg: "bg-amber-100 dark:bg-amber-900",
    text: "text-amber-800 dark:text-amber-300",
    hover: "hover:bg-amber-200 dark:hover:bg-amber-800",
    button: "text-amber-400 hover:text-amber-900 dark:hover:text-amber-300",
  },
  purple: {
    bg: "bg-purple-100 dark:bg-purple-900",
    text: "text-purple-800 dark:text-purple-300",
    hover: "hover:bg-purple-200 dark:hover:bg-purple-800",
    button: "text-purple-400 hover:text-purple-900 dark:hover:text-purple-300",
  },
  rose: {
    bg: "bg-rose-100 dark:bg-rose-900",
    text: "text-rose-800 dark:text-rose-300",
    hover: "hover:bg-rose-200 dark:hover:bg-rose-800",
    button: "text-rose-400 hover:text-rose-900 dark:hover:text-rose-300",
  },
  teal: {
    bg: "bg-teal-100 dark:bg-teal-900",
    text: "text-teal-800 dark:text-teal-300",
    hover: "hover:bg-teal-200 dark:hover:bg-teal-800",
    button: "text-teal-400 hover:text-teal-900 dark:hover:text-teal-300",
  },
  orange: {
    bg: "bg-orange-100 dark:bg-orange-900",
    text: "text-orange-800 dark:text-orange-300",
    hover: "hover:bg-orange-200 dark:hover:bg-orange-800",
    button: "text-orange-400 hover:text-orange-900 dark:hover:text-orange-300",
  },
  slate: {
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-800 dark:text-slate-300",
    hover: "hover:bg-slate-200 dark:hover:bg-slate-700",
    button: "text-slate-400 hover:text-slate-900 dark:hover:text-slate-300",
  },
  white: {
    bg: "bg-white dark:bg-white",
    text: "text-gray-900 dark:text-gray-900",
    hover: "hover:bg-gray-50 dark:hover:bg-gray-100",
    button: "text-gray-500 hover:text-gray-900 dark:hover:text-gray-900",
  },
  black: {
    bg: "bg-gray-900 dark:bg-gray-900",
    text: "text-white dark:text-white",
    hover: "hover:bg-gray-800 dark:hover:bg-gray-800",
    button: "text-gray-300 hover:text-white dark:hover:text-white",
  },
  lime: {
    bg: "bg-lime-200 dark:bg-lime-200",
    text: "text-gray-900 dark:text-gray-900",
    hover: "hover:bg-lime-300 dark:hover:bg-lime-300",
    button: "text-gray-600 hover:text-gray-900 dark:hover:text-gray-900",
  },
  sky: {
    bg: "bg-sky-200 dark:bg-sky-200",
    text: "text-gray-900 dark:text-gray-900",
    hover: "hover:bg-sky-300 dark:hover:bg-sky-300",
    button: "text-gray-600 hover:text-gray-900 dark:hover:text-gray-900",
  },
  fuchsia: {
    bg: "bg-fuchsia-200 dark:bg-fuchsia-200",
    text: "text-gray-900 dark:text-gray-900",
    hover: "hover:bg-fuchsia-300 dark:hover:bg-fuchsia-300",
    button: "text-gray-600 hover:text-gray-900 dark:hover:text-gray-900",
  },
};

/** Falls back to blue, which is what a category with no colour of its own has always been drawn in. */
export const getCategoryColorClasses = (color?: string) =>
  categoryColorClasses[color || "blue"] || categoryColorClasses.blue;
