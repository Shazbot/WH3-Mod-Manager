import type { CompressionMethod, CompressionMethodStatsByMethod } from "./types";

export interface VanillaCompressionExtensionRecord {
  extension: string;
  totalFiles: number;
  counts: Record<CompressionMethod, number>;
  percentages: Record<CompressionMethod, number>;
}

const parseNumber = (value: string | undefined, fallback = 0): number => {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeExtension = (extension: string): string => {
  const normalized = extension.trim().toLowerCase();
  return normalized || "<none>";
};

/**
 * Parses the checked-in vanilla CSV without assuming a particular column order. This makes the
 * guardrail tolerant of future columns while still rejecting malformed rows rather than silently
 * treating them as a 100%-NONE precedent.
 */
export const parseVanillaCompressionCsv = (csv: string): Map<string, VanillaCompressionExtensionRecord> => {
  const records = new Map<string, VanillaCompressionExtensionRecord>();
  const rows = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (rows.length === 0) return records;

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = !quoted;
        }
      } else if (character === "," && !quoted) {
        fields.push(field);
        field = "";
      } else {
        field += character;
      }
    }
    fields.push(field);
    return fields;
  };

  const header = parseRow(rows[0]).map((field) => field.trim());
  const indexByName = new Map(header.map((field, index) => [field, index]));
  const indexOf = (name: string): number | undefined => indexByName.get(name);
  const extensionIndex = indexOf("extension");
  const totalIndex = indexOf("total_files");
  if (extensionIndex === undefined || totalIndex === undefined) return records;

  for (const row of rows.slice(1)) {
    const fields = parseRow(row);
    const extensionValue = fields[extensionIndex];
    if (extensionValue === undefined || extensionValue.trim() === "") continue;
    const extension = normalizeExtension(extensionValue);
    const totalFiles = Math.max(0, Math.round(parseNumber(fields[totalIndex])));
    const counts = {
      NONE: Math.max(0, Math.round(parseNumber(fields[indexOf("NONE_count") ?? -1]))),
      LZ4: Math.max(0, Math.round(parseNumber(fields[indexOf("LZ4_count") ?? -1]))),
      ZSTD: Math.max(0, Math.round(parseNumber(fields[indexOf("ZSTD_count") ?? -1]))),
      UNKNOWN: Math.max(0, Math.round(parseNumber(fields[indexOf("UNKNOWN_count") ?? -1]))),
    } as Record<CompressionMethod, number>;
    const percentages = {
      NONE: parseNumber(fields[indexOf("NONE_percent") ?? -1]),
      LZ4: parseNumber(fields[indexOf("LZ4_percent") ?? -1]),
      ZSTD: parseNumber(fields[indexOf("ZSTD_percent") ?? -1]),
      UNKNOWN: parseNumber(fields[indexOf("UNKNOWN_percent") ?? -1]),
    } as Record<CompressionMethod, number>;
    records.set(extension, { extension, totalFiles, counts, percentages });
  }
  return records;
};

export const vanillaRecordIsAllNone = (record: VanillaCompressionExtensionRecord | undefined): boolean => {
  if (!record || record.totalFiles <= 0) return false;
  // Counts are authoritative. The percentage fallback handles older/manual CSVs with no counts,
  // and allows for the CSV's two-decimal rounding without accidentally blocking a benchmark.
  return (
    record.counts.NONE >= record.totalFiles ||
    (record.counts.NONE === 0 && record.percentages.NONE >= 100) ||
    record.percentages.NONE >= 99.999
  );
};

export const createEmptyMethodStats = (): CompressionMethodStatsByMethod => ({
  NONE: { count: 0, storedBytes: 0 },
  LZ4: { count: 0, storedBytes: 0 },
  ZSTD: { count: 0, storedBytes: 0 },
  UNKNOWN: { count: 0, storedBytes: 0 },
});
