import type { DBVersion, Field, Pack, SchemaField, SCHEMA_FIELD_TYPE } from "../packFileTypes";
import { parseDBTablePath } from "../utility/packFileHelpers";
import { isSchemaFieldNumber, isSchemaFieldNumberInteger } from "../utility/frontend/packDataHandling";
import type { SearchEngineContext } from "./engineTypes";
import type { GlobalSearchDbResult } from "./types";

/** The same display conversion the viewer uses for a parsed cell. */
export const resolveSearchFieldValue = (fieldType: SCHEMA_FIELD_TYPE, fields: Field[]): string => {
  if (isSchemaFieldNumber(fieldType)) {
    const number = fields[0]?.val as number | undefined;
    if (number === undefined) return "";
    return isSchemaFieldNumberInteger(fieldType) ? number.toFixed(0) : number.toFixed(3);
  }
  if (fieldType === "OptionalStringU8" || fieldType === "StringU8") {
    if (!fields[0]?.val) return "";
    const value = fields[2]?.val || fields[1]?.val || fields[0]?.val;
    return value == null ? "" : String(value);
  }
  const value = fields[1]?.val || fields[0]?.val;
  return value == null ? "" : String(value);
};

export type PackLocVisitor = (
  pack: Pack,
  visit: (key: string, value: string, locFileName: string) => boolean | void,
) => void;

/** Searches parsed DB tables already held by a single pack read. */
export const searchPackDb = async (
  pack: Pack,
  context: SearchEngineContext,
): Promise<"canceled" | "complete" | "stopped"> => {
  let skippedWithoutSchema = 0;
  for (const packedFile of pack.packedFiles) {
    if (context.isCanceled()) return "canceled";
    const parsed = parseDBTablePath(packedFile.name);
    if (!parsed || packedFile.name.toLowerCase().endsWith(".loc")) continue;
    context.markFile(pack.path, packedFile.name);

    const tableSchema = packedFile.tableSchema as DBVersion | undefined;
    const schemaFields = packedFile.schemaFields;
    if (!tableSchema || !schemaFields || tableSchema.fields.length === 0) {
      skippedWithoutSchema++;
      continue;
    }

    const columnCount = tableSchema.fields.length;
    const usableCellCount = schemaFields.length - (schemaFields.length % columnCount);
    for (let index = 0; index < usableCellCount; index++) {
      if (context.isCanceled()) return "canceled";
      const column = tableSchema.fields[index % columnCount];
      const cell = schemaFields[index] as SchemaField;
      const value = resolveSearchFieldValue(column.field_type, cell.fields);
      if (!context.matcher.test(value)) continue;
      const found = context.matcher.find(value);
      if (!found) continue;

      const result: GlobalSearchDbResult = {
        kind: "db",
        packPath: pack.path,
        packLabel: context.packLabel,
        packedFilePath: packedFile.name,
        dbName: parsed.dbName,
        dbSubname: parsed.dbSubname,
        dbFolder: parsed.dbFolder,
        columnName: column.name,
        rowIndex: Math.floor(index / columnCount),
        value,
        matchStart: found.start,
        matchEnd: found.end,
      };
      const outcome = context.addResult(result);
      if (outcome === "stopTarget") return "stopped";
      if (outcome === "stopFile") {
        break;
      }
    }
    await context.yieldToEventLoop?.();
  }

  if (skippedWithoutSchema > 0) {
    context.addWarning(`${context.packLabel}: ${skippedWithoutSchema} DB table(s) skipped (no schema).`);
  }
  return context.isCanceled() ? "canceled" : "complete";
};

/** Searches loc rows from a pack read that included `readLocs: true`. */
export const searchPackLoc = (
  pack: Pack,
  context: SearchEngineContext,
  forEachLocEntry: PackLocVisitor,
): "canceled" | "complete" | "stopped" => {
  let stopped: "canceled" | "stopped" | undefined;
  forEachLocEntry(pack, (key, value, filePath) => {
    if (context.isCanceled()) {
      stopped = "canceled";
      return false;
    }
    const searchIn = context.request.locSearchIn ?? "both";
    const values: Array<["key" | "value", string]> = [];
    if (searchIn === "keys" || searchIn === "both") values.push(["key", key]);
    if (searchIn === "values" || searchIn === "both") values.push(["value", value]);

    for (const [matchedIn, searched] of values) {
      if (!context.matcher.test(searched)) continue;
      const found = context.matcher.find(searched);
      if (!found) continue;
      const result = {
        kind: "loc" as const,
        packPath: pack.path,
        packLabel: context.packLabel,
        filePath,
        key,
        value,
        matchedIn,
        matchStart: found.start,
        matchEnd: found.end,
      };
      const outcome = context.addResult(result);
      if (outcome === "stopTarget") {
        stopped = "stopped";
        return false;
      }
      if (outcome === "stopFile") {
        break;
      }
    }
    return undefined;
  });
  return stopped ?? (context.isCanceled() ? "canceled" : "complete");
};
