import { toVariantMeshDefinitionPath } from "../visuals/paths";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { shouldReplaceEffectiveDbRowWinner } from "../utility/effectiveDbRow";
import { getAutomationSchemaProvider, readAutomationPayload, readAutomationPayloadPrefix } from "./packAccess";
import { DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES, readDbTablePreamble } from "../packCore";
import { getEffectiveDbFileRefs, loadEffectiveDbRows, type ReferenceEnvironment } from "./references";
import { throwIfAborted, yieldToEventLoop } from "./errors";
import type { UnitVisualRoot } from "./units";

type Row = Record<string, unknown>;
const rootTables = ["main_units", "land_units", "unit_variants", "variants", "mounts", "battlefield_engines",
  "warscape_animated", "warscape_animated_lod", "land_units_to_extra_engines", "units_custom_battle_permissions",
  "agent_subtypes", "agent_subtype_subculture_overrides", "campaign_character_art_sets", "campaign_character_arts", "agent_uniforms"] as const;
type Table = typeof rootTables[number];
const value = (row: Row | undefined, field: string) => String(row?.[field] ?? "");

/** GUI catalog rows are discovery data only; returned users are hydrated from source DB/LOC evidence. */
const catalogRows = async (environment: ReferenceEnvironment, table: Table): Promise<Row[] | undefined> => {
  const mappings = {
    main_units: { field: "mainUnitLinks", columns: ["unit", "land_unit"], keys: ["unit"] },
    unit_variants: { field: "unitVariants", columns: ["unit", "faction", "variant", "name", "unit_card"], keys: ["unit", "faction"] },
    variants: { field: "variants", columns: ["variant_name", "variant_filename"], keys: ["variant_name"] },
  };
  if (!(table in mappings) || !environment.context.cacheRequest?.getVisualsCatalog) return undefined;
  const mapping = mappings[table as keyof typeof mappings];
  const logical = `db\\${table}_tables`;
  const refs = getEffectiveDbFileRefs(environment, logical);
  if (!refs.length) return [];
  const payloadLimit = environment.context.maxLogicalPayloadBytes ?? DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES;
  if (refs.some((ref) => !ref.entry.is_compressed && ref.entry.file_size > payloadLimit)) return undefined;
  // The GUI contribution flattens subfiles. Without a unique source file its precedence is not proven.
  if (refs.some((ref) => refs.filter((other) => other.provider === ref.provider).length !== 1)) return undefined;
  const schema = (await getAutomationSchemaProvider(environment.context)("wh3"))[`${table}_tables`];
  if (!schema?.length || schema.some((version) => {
    const keys = version.fields.filter((field) => field.is_key).map((field) => field.name).sort();
    return JSON.stringify(keys) !== JSON.stringify([...mapping.keys].sort()) ||
      version.fields.some((field) => field.is_key && !["StringU8", "StringU16", "OptionalStringU8", "OptionalStringU16"].includes(field.field_type)) ||
      mapping.columns.slice(0, table === "unit_variants" ? 3 : undefined).some((column) => !version.fields.some((field) => field.name === column));
  })) return undefined;
  const winners = new Map<string, { row: Row; ref: typeof refs[number]; index: number }>();
  let tableVersion: number | undefined;
  for (const ref of refs) {
    const cached = await environment.context.cacheRequest.getVisualsCatalog(ref.provider.pack);
    const tuples = cached?.tables?.contribution?.[mapping.field as "variants" | "unitVariants" | "mainUnitLinks"];
    if (!Array.isArray(tuples) || tuples.some((tuple) => !Array.isArray(tuple) ||
        tuple.length < (table === "unit_variants" ? 3 : 2) || tuple.some((item) => typeof item !== "string"))) return undefined;
    try {
      const prefix = ref.entry.is_compressed
        ? (await readAutomationPayload(ref.provider.pack, ref.entry, environment.context)).subarray(0, 128)
        : await readAutomationPayloadPrefix(ref.provider.pack, ref.entry, 128, environment.context);
      const preamble = readDbTablePreamble(prefix);
      if (preamble.rowCount !== tuples.length || !schema.some((version) => version.version === (preamble.version ?? 0))) return undefined;
      if (tableVersion !== undefined && tableVersion !== (preamble.version ?? 0)) return undefined;
      tableVersion = preamble.version ?? 0;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(String(error.code))) throw error;
      return undefined;
    }
    for (let index = 0; index < tuples.length; index++) {
      const row = Object.fromEntries(mapping.columns.map((column, columnIndex) => [column, tuples[index][columnIndex] ?? ""]));
      const key = JSON.stringify(mapping.keys.map((column) => row[column]));
      const current = winners.get(key);
      // GUI strings do not distinguish a null optional key from an explicit empty key.
      // That is harmless for unique keys; duplicate ambiguous keys need source precedence.
      if (current && schema.some((version) => version.fields.some((field) => field.is_key &&
          field.field_type.startsWith("OptionalString") && row[field.name] === ""))) return undefined;
      if (!current || shouldReplaceEffectiveDbRowWinner(ref.entry.name, current.ref.entry.name)) winners.set(key, { row, ref, index });
    }
  }
  environment.usedVisualCatalog = true;
  return [...winners.values()].sort((a, b) => a.ref.provider.order - b.ref.provider.order ||
    a.ref.entry.name.localeCompare(b.ref.entry.name) || a.index - b.index).map((item) => item.row);
};

export interface UnitVisualRootScan {
  roots: UnitVisualRoot[];
  totalUnits: number;
  selectedUnits: number;
  scannedUnits: number;
}

/** Discover roots without constructing recruitment, localization, or source-detail reports for every unit. */
export const collectUnitVisualRoots = async (
  environment: ReferenceEnvironment,
  useCatalog = true,
  unitKeys?: ReadonlySet<string>,
): Promise<UnitVisualRootScan> => {
  const data = new Map<Table, Row[]>();
  for (const table of rootTables) {
    await yieldToEventLoop(environment.context.signal);
    const cached = useCatalog ? await catalogRows(environment, table) : undefined;
    data.set(table, cached ?? (await loadEffectiveDbRows(environment, `db\\${table}_tables`)).map((item) => item.row));
    if (["main_units", "land_units", "unit_variants"].includes(table) && !environment.dbFiles.has(`db\\${table}_tables`)) {
      environment.complete = false;
      environment.diagnostics.push({ code: "UNIT_VISUAL_JOIN_TABLE_MISSING", message: `Unit visual roots need db\\${table}_tables`,
        severity: "warning", path: `db\\${table}_tables` });
    }
  }
  const indexes = new Map<string, Map<string, Row[]>>();
  const rows = (table: Table, field: string, key: string): Row[] => {
    const id = `${table}.${field}`;
    let index = indexes.get(id);
    if (!index) {
      index = new Map();
      for (const row of data.get(table) ?? []) {
        const normalized = value(row, field).toLowerCase();
        const group = index.get(normalized) ?? []; group.push(row); index.set(normalized, group);
      }
      indexes.set(id, index);
    }
    return index.get(key.toLowerCase()) ?? [];
  };
  const first = (table: Table, field: string, key: string) => rows(table, field, key)[0];
  const roots: UnitVisualRoot[] = [];
  const seen = new Set<string>();
  const missing = (message: string) => {
    environment.complete = false;
    environment.diagnostics.push({ code: "UNRESOLVED_UNIT_VISUAL", message, severity: "warning" });
  };
  let scanned = 0;
  let selected = 0;
  const mainUnits = data.get("main_units") ?? [];
  environment.context.progress?.({ stage: "roots", completed: 0, total: mainUnits.length, units: 0, message: "Scanning unit visual roots" });
  for (const main of mainUnits) {
    throwIfAborted(environment.context.signal);
    if ((scanned++ & 127) === 0) await yieldToEventLoop(environment.context.signal);
    if ((scanned & 255) === 0 || scanned === mainUnits.length) environment.context.progress?.({
      stage: "roots", completed: scanned, total: mainUnits.length, units: scanned, message: `Scanned ${scanned} of ${mainUnits.length} units`,
    });
    const unitKey = value(main, "unit");
    const landUnitKey = value(main, "land_unit");
    if (unitKeys && !unitKeys.has(unitKey.toLowerCase()) && !unitKeys.has(landUnitKey.toLowerCase())) continue;
    selected++;
    const land = first("land_units", "key", landUnitKey);
    if (!land) missing(`Land unit ${landUnitKey} was not resolved`);
    const add = (assetPath: string, rootKind: UnitVisualRoot["rootKind"], reason: string) => {
      if (!assetPath || assetPath === ".") return;
      const key = JSON.stringify([unitKey, landUnitKey, normalizePackFilePathKey(assetPath), rootKind, reason]);
      if (seen.has(key)) return;
      seen.add(key);
      roots.push({ path: assetPath, unitKey, landUnitKey, rootKind, reason, locKey: `land_units_onscreen_name_${landUnitKey}`,
        scopeSource: "visualFallback", unscoped: false, factions: [], customBattlePermissions: [], campaignRules: [],
        characterArtCandidates: [], evidence: [] });
    };
    const variant = (key: string, kind: UnitVisualRoot["rootKind"], reason: string) => {
      if (!key || key === ".") return;
      const filename = value(first("variants", "variant_name", key), "variant_filename");
      if (!filename) { missing(`Variant ${key} was not resolved`); return; }
      add(toVariantMeshDefinitionPath(filename), kind, reason);
    };
    const engine = (key: string, kind: "engine" | "extraEngine") => {
      if (!key || key === ".") return;
      const row = first("battlefield_engines", "key", key);
      if (!row) { missing(`Engine ${key} was not resolved`); return; }
      const label = kind === "engine" ? "land unit engine" : "extra engine";
      variant(value(row, "variant"), kind, `${label} variant`);
      const model = value(row, "model");
      if (!model || model === ".") return;
      if (/\.(?:rigid_model_v2|wsmodel|variantmeshdefinition)$/i.test(model)) add(model, kind, `${label} model`);
      else {
        const animated = first("warscape_animated", "key", model);
        const lods = animated ? rows("warscape_animated_lod", "animated", value(animated, "key")) : [];
        if (!lods.length) missing(`Engine ${key} model ${model} was not resolved`);
        for (const lod of lods) add(value(lod, "filename"), kind, `${label} LOD`);
      }
    };
    for (const row of rows("unit_variants", "unit", landUnitKey)) variant(value(row, "variant"), "variant", "unit variant");
    const mountKey = value(land, "mount");
    if (mountKey && mountKey !== ".") {
      const mount = first("mounts", "key", mountKey);
      if (!mount) missing(`Mount ${mountKey} was not resolved`);
      else variant(value(mount, "variant"), "mount", "land unit mount");
    }
    engine(value(land, "engine"), "engine");
    for (const row of rows("land_units_to_extra_engines", "land_unit", landUnitKey)) engine(value(row, "battle_engine"), "extraEngine");
    const subtypes = new Set([
      ...rows("agent_subtypes", "associated_unit_override", unitKey).map((row) => value(row, "key")),
      ...rows("agent_subtype_subculture_overrides", "associated_unit_override", unitKey).map((row) => value(row, "subtype")),
    ].filter(Boolean));
    const artSets = [...subtypes].flatMap((key) => rows("campaign_character_art_sets", "agent_subtype", key));
    const arts = artSets.flatMap((set) => rows("campaign_character_arts", "art_set_id", value(set, "art_set_id")));
    const uniforms = new Set([
      ...rows("units_custom_battle_permissions", "unit", unitKey).map((row) => value(row, "general_uniform")),
      ...arts.flatMap((row) => ["uniform", "sea_uniform", "navy_uniform"].map((field) => value(row, field))),
    ].filter((key) => Boolean(key) && key !== "."));
    for (const key of uniforms) {
      const uniform = first("agent_uniforms", "uniform_name", key);
      if (!uniform) { missing(`Agent uniform ${key} was not resolved`); continue; }
      const battle = value(uniform, "battle_filename");
      variant(battle && battle !== "." ? battle : value(uniform, "filename"), "characterUniform", "character uniform candidate");
    }
  }
  if (scanned !== mainUnits.length) environment.context.progress?.({
    stage: "roots", completed: scanned, total: mainUnits.length, units: scanned, message: `Scanned ${scanned} of ${mainUnits.length} units`,
  });
  return { roots, totalUnits: mainUnits.length, selectedUnits: selected, scannedUnits: scanned };
};
