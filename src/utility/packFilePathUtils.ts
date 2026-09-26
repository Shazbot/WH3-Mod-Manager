export const normalizePackFilePath = (value: string) =>
  value.replace(/\//g, "\\").replace(/\\+/g, "\\").replace(/^\\+/, "").trim();

export const normalizePackFilePathKey = (value: string) => normalizePackFilePath(value).toLowerCase();

export const hasParentSegment = (value: string) =>
  normalizePackFilePath(value)
    .split("\\")
    .some((segment) => segment === "..");
