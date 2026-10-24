import * as fs from "node:fs/promises";
import { z } from "zod";
import { resolveTextReplacements, stripGameMarkup } from "../utility/localizationText";
import { getLocKeyColumns } from "../utility/locKeyGeneration";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { getCanonicalLogicalTableName } from "../utility/effectiveDbRow";
import { AutomationError, throwIfAborted, yieldToEventLoop } from "./errors";
import { getAutomationSchemaProvider, readAutomationPayload } from "./packAccess";
import { loadPackedTable, tableRowsToJson } from "./tables";
import {
  loadEffectiveDbRows,
  prepareReferenceEnvironment,
  type EffectiveDbRow,
  type ReferenceEnvironment,
} from "./references";
import type { AutomationContext } from "./operations";

export const lookupInputs = {
  packPaths: z.array(z.string().min(1)).min(1).max(512),
  vanillaPackPaths: z.array(z.string().min(1)).max(512).optional(),
  gameDataPath: z.string().min(1).optional(),
  query: z.string().min(1).max(2048),
  match: z.enum(["exact", "contains"]).default("exact"),
  caseSensitive: z.boolean().default(false),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(100),
  reportPath: z.string().min(1).optional(),
};

export const localizationLookupSchema = z
  .object({
    operation: z.literal("localization_lookup"),
    ...lookupInputs,
    searchBy: z.enum(["text", "locKey", "dbKey"]).default("text"),
    tables: z.array(z.string().min(1)).max(128).optional(),
    referenceLimit: z.number().int().min(1).max(1000).default(100),
  })
  .strict();

export const matchesLookup = (
  value: string,
  query: string,
  match: "exact" | "contains",
  caseSensitive: boolean,
): boolean => {
  const [a, b] = caseSensitive ? [value, query] : [value.toLowerCase(), query.toLowerCase()];
  return match === "exact" ? a === b : a.includes(b);
};

export const rowEvidence = (item: EffectiveDbRow) => ({
  table: item.logicalTable,
  packPath: item.provider.pack.path,
  filePath: item.entry.name,
  rowIndex: item.rowIndex,
  row: item.row,
});

export interface LocalizationEntry {
  locKey: string;
  text: string;
  rawText: string;
  packPath: string;
  filePath: string;
  rowIndex: number;
}

/** Same low-to-high pack and in-pack file/row iteration used by the GUI loc lookup. */
export const loadLocalization = async (environment: ReferenceEnvironment): Promise<Map<string, LocalizationEntry>> => {
  const result = new Map<string, LocalizationEntry>();
  for (const provider of environment.providers) {
    for (const entry of provider.pack.entries) {
      if (!entry.name.toLowerCase().endsWith(".loc")) continue;
      await yieldToEventLoop(environment.context.signal);
      const samePath = provider.entriesByPath.get(normalizePackFilePathKey(entry.name));
      if (samePath?.length !== 1) {
        environment.complete = false;
        environment.diagnostics.push({
          code: "AMBIGUOUS_LOC_FILE",
          message: "Duplicate localization file path was excluded",
          severity: "warning",
          path: entry.name,
        });
        continue;
      }
      try {
        const loaded = await loadPackedTable(
          entry.name,
          await readAutomationPayload(provider.pack, entry, environment.context),
          getAutomationSchemaProvider(environment.context),
        );
        const rows = tableRowsToJson(loaded.parsed);
        for (let index = 0; index < rows.length; index++) {
          throwIfAborted(environment.context.signal);
          const row = rows[index];
          const key = String(row.key ?? "");
          if (!key) continue;
          const text = String(row.text ?? "");
          result.set(key, {
            locKey: key,
            text,
            rawText: text,
            packPath: provider.pack.path,
            filePath: entry.name,
            rowIndex: index,
          });
        }
      } catch (error) {
        if (error instanceof AutomationError && error.code === "CANCELLED") throw error;
        environment.complete = false;
        environment.diagnostics.push({
          code: "INVALID_LOC_FILE",
          message: error instanceof Error ? error.message : String(error),
          severity: "warning",
          path: entry.name,
        });
      }
    }
  }
  let resolved = 0;
  for (const item of result.values()) {
    if ((resolved++ & 255) === 0) await yieldToEventLoop(environment.context.signal);
    item.text = stripGameMarkup(
      resolveTextReplacements(item.rawText, (key) => result.get(key)?.rawText) ?? item.rawText,
    );
  }
  return result;
};

/** Loc identity is schema-defined, including concatenated composite keys in localised_key_order. */
export const rowLocalizationKeys = (item: EffectiveDbRow): Array<{ field: string; locKey: string }> => {
  const schema = item.loaded.parsed.schema;
  const indexes = getLocKeyColumns(schema);
  if (!indexes.length || indexes.some((index) => !schema.fields[index] || item.row[schema.fields[index].name] == null))
    return [];
  const suffix = indexes.map((index) => String(item.row[schema.fields[index].name])).join("");
  const table = item.logicalTable.replace(/^db\\/, "").replace(/_tables$/, "");
  return (schema.localised_fields ?? []).map((field) => ({
    field: field.name,
    locKey: `${table}_${field.name}_${suffix}`,
  }));
};

export const finishLookup = async (
  environment: ReferenceEnvironment,
  request: { offset: number; limit: number; reportPath?: string },
  items: unknown[],
  metadata: Record<string, unknown> = {},
  previewItem: (item: unknown) => unknown = (item) => item,
) => {
  const full = {
    ...metadata,
    complete: environment.complete,
    total: items.length,
    items,
    diagnostics: environment.diagnostics,
  };
  let reportPath: string | undefined;
  if (request.reportPath) {
    reportPath = (
      await environment.context.policy.withAtomicOutput({
        outputPath: request.reportPath,
        sourcePaths: environment.sourcePaths,
        produce: async (temporaryPath) => fs.writeFile(temporaryPath, `${JSON.stringify(full, null, 2)}\n`),
      })
    ).path;
  }
  const page = items.slice(request.offset, request.offset + request.limit).map(previewItem);
  const hasMore = request.offset + page.length < items.length;
  return {
    data: {
      ...metadata,
      complete: environment.complete,
      total: items.length,
      items: page,
      offset: request.offset,
      limit: request.limit,
      hasMore,
      nextOffset: hasMore ? request.offset + page.length : null,
      ...(reportPath ? { reportPath } : {}),
    },
    diagnostics: environment.diagnostics,
  };
};

export const runLocalizationLookup = async (
  request: z.output<typeof localizationLookupSchema>,
  context: AutomationContext,
) => {
  const environment = await prepareReferenceEnvironment(
    context,
    request.packPaths,
    request.vanillaPackPaths,
    request.gameDataPath,
  );
  const locs = await loadLocalization(environment);
  const matches = new Map<string, LocalizationEntry & { dbReferences: unknown[] }>();
  if (request.searchBy !== "dbKey") {
    for (const loc of locs.values()) {
      if (
        matchesLookup(
          request.searchBy === "text" ? loc.text : loc.locKey,
          request.query,
          request.match,
          request.caseSensitive,
        )
      )
        matches.set(loc.locKey, { ...loc, dbReferences: [] });
    }
  }
  const schema = await getAutomationSchemaProvider(context)("wh3");
  const tables = request.tables?.map((table) =>
    getCanonicalLogicalTableName(/^db[\\/]/i.test(table) ? table : `db\\${table}`),
  ) ?? [...environment.dbFiles.keys()];
  for (const table of request.tables ?? []) {
    const key = getCanonicalLogicalTableName(table).replace(/^db\\/, "");
    if (!schema[key]) throw new AutomationError("INVALID_ARGUMENT", `Unknown localization table: ${table}`);
  }
  for (const table of new Set(tables)) {
    const versions = schema[table.replace(/^db\\/, "")];
    if (!versions?.some((version) => version.localised_fields?.length)) continue;
    const base = table.replace(/^db\\/, "").replace(/_tables$/, "");
    if (
      request.searchBy !== "dbKey" &&
      ![...matches.keys()].some((key) =>
        versions.some((version) => version.localised_fields?.some((field) => key.startsWith(`${base}_${field.name}_`))),
      )
    )
      continue;
    await yieldToEventLoop(context.signal);
    let scanned = 0;
    for (const item of await loadEffectiveDbRows(environment, table)) {
      if ((scanned++ & 127) === 0) await yieldToEventLoop(context.signal);
      const keys = item.loaded.parsed.schema.fields.filter((field) => field.is_key);
      if (
        request.searchBy === "dbKey" &&
        !keys.some((field) =>
          matchesLookup(String(item.row[field.name] ?? ""), request.query, request.match, request.caseSensitive),
        )
      )
        continue;
      for (const { field, locKey } of rowLocalizationKeys(item)) {
        if (request.searchBy === "dbKey") {
          const loc = locs.get(locKey);
          if (!matches.has(locKey))
            matches.set(locKey, {
              ...(loc ?? { locKey, text: "", rawText: "", packPath: "", filePath: "", rowIndex: -1 }),
              dbReferences: [],
            });
        }
        matches.get(locKey)?.dbReferences.push({
          ...rowEvidence(item),
          field,
          keys: Object.fromEntries(keys.map((key) => [key.name, item.row[key.name]])),
        });
      }
    }
  }
  const items = [...matches.values()]
    .sort((a, b) => a.locKey.localeCompare(b.locKey))
    .map((item) => ({
      ...item,
      translationFound: locs.has(item.locKey),
      dbReferenceCount: item.dbReferences.length,
      dbReferencesTruncated: false,
    }));
  return finishLookup(environment, request, items, { searchBy: request.searchBy, query: request.query }, (value) => {
    const item = value as (typeof items)[number];
    return {
      ...item,
      dbReferences: item.dbReferences.slice(0, request.referenceLimit),
      dbReferencesTruncated: item.dbReferences.length > request.referenceLimit,
    };
  });
};
