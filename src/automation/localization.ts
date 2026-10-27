import * as fs from "node:fs/promises";
import { z } from "zod";
import { vanillaInputs } from "./vanilla";
import { resolveTextReplacements, stripGameMarkup } from "../utility/localizationText";
import { getLocKeyColumns } from "../utility/locKeyGeneration";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { getCanonicalLogicalTableName } from "../utility/effectiveDbRow";
import { AutomationError, throwIfAborted, yieldToEventLoop } from "./errors";
import { getAutomationSchemaProvider, readAutomationReadonlyTable } from "./packAccess";
import type { RawLocalizationEntry, RawLocalizationLookupLease } from "./cacheService";
import {
  loadEffectiveDbRows,
  prepareReferenceEnvironment,
  type EffectiveDbRow,
  type ReferenceEnvironment,
} from "./references";
import type { AutomationContext } from "./operations";

export const lookupInputs = {
  packPaths: z.array(z.string().min(1)).min(1).max(512),
  ...vanillaInputs,
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

export interface LocalizationLookup {
  get(key: string): LocalizationEntry | undefined;
  forEachEntry(visit: (entry: LocalizationEntry) => boolean | void | Promise<boolean | void>): Promise<void>;
}

/** Layered raw lookup: mods override vanilla while rendering always sees the current overlay. */
export const loadLocalization = async (environment: ReferenceEnvironment): Promise<LocalizationLookup> => {
  const vanillaFallback = new Map<string, RawLocalizationEntry>();
  const modOverlay = new Map<string, RawLocalizationEntry>();
  // Empty packs do not affect LOC precedence. Avoid reopening every model/texture pack
  // when proving or loading the shared localization cache for a handful of matched units.
  const vanillaProviders = environment.providers.filter((provider) => provider.kind === "vanilla" &&
    provider.pack.entries.some((entry) => entry.name.toLowerCase().endsWith(".loc")));
  let vanillaLease: RawLocalizationLookupLease | undefined;
  if (environment.context.cacheRequest && vanillaProviders.length) {
    vanillaLease = await environment.context.cacheRequest.getVanillaRawLoc(
      vanillaProviders.map((provider) => provider.pack.path),
      "packIndex",
    );
  }

  const readProviders = async (
    providers: typeof environment.providers,
    destination: Map<string, RawLocalizationEntry>,
  ): Promise<void> => {
    for (const provider of providers) {
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
          const loaded = await readAutomationReadonlyTable(provider.pack, entry, environment.context);
          if (!loaded.isLoc)
            throw new AutomationError("VALIDATION", "Packed localization entry did not decode as a LOC table");
          for (let index = 0; index < loaded.rows.length; index++) {
            throwIfAborted(environment.context.signal);
            const row = loaded.rows[index];
            const key = String(row.key ?? "");
            if (!key) continue;
            destination.set(key, {
              rawText: String(row.text ?? ""),
              packPath: provider.pack.path,
              filePath: entry.name,
              rowIndex: index,
            });
          }
        } catch (error) {
          if (error instanceof AutomationError && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code))
            throw error;
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
  };

  if (!vanillaLease) await readProviders(vanillaProviders, vanillaFallback);
  await readProviders(
    environment.providers.filter((provider) => provider.kind === "mod"),
    modOverlay,
  );

  const getRaw = (key: string): RawLocalizationEntry | undefined =>
    modOverlay.get(key) ?? vanillaLease?.lookup.getRaw(key) ?? vanillaFallback.get(key);
  const entryFor = (key: string, source: RawLocalizationEntry): LocalizationEntry => ({
    locKey: key,
    ...source,
    text: stripGameMarkup(
      resolveTextReplacements(source.rawText, (replacementKey) => getRaw(replacementKey)?.rawText) ?? source.rawText,
    ),
  });
  return {
    get(key) {
      const source = getRaw(key);
      return source ? entryFor(key, source) : undefined;
    },
    async forEachEntry(visit) {
      let keepGoing = true;
      let scanned = 0;
      const emit = async (key: string, source: RawLocalizationEntry): Promise<boolean> => {
        if (modOverlay.has(key)) return true;
        throwIfAborted(environment.context.signal);
        if ((scanned++ & 255) === 0) await yieldToEventLoop(environment.context.signal);
        keepGoing = (await visit(entryFor(key, source))) !== false;
        return keepGoing;
      };
      if (vanillaLease) {
        await vanillaLease.lookup.forEachEntry((key, source) => emit(key, source));
      } else {
        for (const [key, source] of vanillaFallback) {
          if (!(await emit(key, source))) break;
        }
      }
      if (!keepGoing) return;
      for (const [key, source] of modOverlay) {
        throwIfAborted(environment.context.signal);
        if ((scanned++ & 255) === 0) await yieldToEventLoop(environment.context.signal);
        if ((await visit(entryFor(key, source))) === false) return;
      }
    },
  };
};

/** Loc identity is schema-defined, including concatenated composite keys in localised_key_order. */
export const rowLocalizationKeys = (item: EffectiveDbRow): Array<{ field: string; locKey: string }> => {
  const schema = item.loaded.schema;
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
    request.withVanilla,
  );
  const locs = await loadLocalization(environment);
  const matches = new Map<string, LocalizationEntry & { dbReferences: unknown[] }>();
  if (request.searchBy === "locKey" && request.match === "exact" && request.caseSensitive) {
    const loc = locs.get(request.query);
    if (loc) matches.set(loc.locKey, { ...loc, dbReferences: [] });
  } else if (request.searchBy !== "dbKey") {
    await locs.forEachEntry((loc) => {
      if (
        matchesLookup(
          request.searchBy === "text" ? loc.text : loc.locKey,
          request.query,
          request.match,
          request.caseSensitive,
        )
      ) {
        matches.set(loc.locKey, { ...loc, dbReferences: [] });
      }
    });
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
      const keys = item.loaded.schema.fields.filter((field) => field.is_key);
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
    .sort((a, b) => a.locKey.localeCompare(b.locKey) || (a.locKey === b.locKey ? 0 : a.locKey < b.locKey ? -1 : 1))
    .map((item) => ({
      ...item,
      translationFound: locs.get(item.locKey) !== undefined,
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
