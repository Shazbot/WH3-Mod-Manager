import * as fs from "node:fs/promises";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { parseRmv2, Rmv2CodecError } from "../packCore";
import { decodePackedTextBuffer } from "../utility/packFileViewing";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { AutomationError, throwIfAborted, yieldToEventLoop, type AutomationDiagnostic } from "./errors";
import { readAutomationPayload } from "./packAccess";
import {
  buildReferenceGraph,
  prepareReferenceEnvironment,
  resolveReferenceAsset,
  type ReferenceGraphEdge,
  type ReferenceGraphNode,
  type ReferenceGraphRoot,
  type ReferenceProvider,
} from "./references";
import type { CorePackEntry } from "../packCore";
import { runUnitResolve, unitResolveSchema } from "./units";
import type { AutomationContext } from "./operations";

export const assetMaterialsSchema = z
  .object({
    operation: z.literal("asset_materials"),
    packPaths: z.array(z.string().min(1)).min(1).max(512),
    vanillaPackPaths: z.array(z.string().min(1)).max(512).optional(),
    gameDataPath: z.string().min(1).optional(),
    assetPaths: z.array(z.string().min(1)).min(1).max(1000).optional(),
    unitKey: z.string().min(1).optional(),
    maxDepth: z.number().int().min(0).max(32).default(32),
    maxNodes: z.number().int().min(1).max(10000).default(10000),
    maxEdges: z.number().int().min(1).max(50000).default(50000),
    maxBindings: z.number().int().min(1).max(50000).default(10000),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(1000).default(100),
    reportPath: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (request) => Number(Boolean(request.assetPaths?.length)) + Number(request.unitKey !== undefined) === 1,
    "asset materials requires exactly one of assetPaths or unitKey",
  );

type MaterialsRequest = z.output<typeof assetMaterialsSchema>;
type UnitMaterialItem = Record<string, unknown>;
type ExplicitRootContext = {
  kind: "assetPath" | "unit";
  rootPath: string;
  unitKey?: string;
  evidence?: unknown;
  links?: unknown[];
};
type LoaderChain = {
  rootId: string;
  nodes: ReferenceGraphNode[];
  edges: ReferenceGraphEdge[];
  rootContext?: ExplicitRootContext;
};
type WsBinding = {
  lodIndex: number | null;
  partIndex: number | null;
  materialPath: string;
  location: string;
  invalidReason?: string;
};
type WsModelDocument = { geometryPath: string | null; bindings: WsBinding[]; diagnostics: AutomationDiagnostic[] };
type WsMaterialTexture = {
  slotName: string;
  typeId: number | null;
  typeName: string;
  path: string;
  sourceLocation: string;
  recognized: boolean;
};
type WsMaterialDocument = {
  name: string;
  shaderPath: string;
  alpha: boolean;
  textures: WsMaterialTexture[];
  parameters: Array<{ name: string; type: string; value: string }>;
  diagnostics: AutomationDiagnostic[];
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
});

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const asArray = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const textValue = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const item = record(value);
  if (!item) return "";
  if (typeof item["#text"] === "string") return item["#text"].trim();
  return "";
};
const diag = (code: string, message: string, path?: string): AutomationDiagnostic => ({
  code,
  message,
  severity: "warning",
  ...(path ? { path } : {}),
});
const pathExt = (value: string): string => {
  const lower = value.toLowerCase();
  if (lower.endsWith(".rigid_model_v2")) return "rigid_model_v2";
  if (lower.endsWith(".variantmeshdefinition")) return "variantmeshdefinition";
  if (lower.endsWith(".wsmodel")) return "wsmodel";
  if (lower.endsWith(".xml.material")) return "xml.material";
  return (
    lower
      .split("\\")
      .at(-1)
      ?.match(/\.([a-z0-9_]+)$/)?.[1] ?? ""
  );
};

const resolveTexture = (environment: Awaited<ReturnType<typeof prepareReferenceEnvironment>>, texturePath: string) => {
  if (!texturePath.trim()) return { status: "empty" as const, path: texturePath };
  const resolved = resolveReferenceAsset(environment, texturePath, false);
  return {
    status: resolved.status,
    path: resolved.path,
    ...(resolved.winner
      ? { provider: resolved.winner.provider.pack.path, providerKind: resolved.winner.provider.kind }
      : {}),
    ...(resolved.candidates?.length
      ? {
          candidates: resolved.candidates.map(({ provider, entry }) => ({
            packPath: provider.pack.path,
            entryPath: entry.name,
          })),
        }
      : {}),
    ...(resolved.shadowed?.length
      ? {
          shadowed: resolved.shadowed.map(({ provider, entry }) => ({
            packPath: provider.pack.path,
            entryPath: entry.name,
          })),
        }
      : {}),
  };
};

export const inspectWsModelBindings = (text: string, filePath: string): WsModelDocument => {
  const valid = XMLValidator.validate(text);
  if (valid !== true)
    return {
      geometryPath: null,
      bindings: [],
      diagnostics: [diag("INVALID_WSMODEL_XML", JSON.stringify(valid), filePath)],
    };
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(text);
  } catch (error) {
    return {
      geometryPath: null,
      bindings: [],
      diagnostics: [diag("INVALID_WSMODEL_XML", error instanceof Error ? error.message : String(error), filePath)],
    };
  }
  const root = record(record(parsed)?.model);
  if (!root)
    return {
      geometryPath: null,
      bindings: [],
      diagnostics: [diag("INVALID_WSMODEL_ROOT", "WS model XML has no /model root", filePath)],
    };
  const geometryValues = asArray(root.geometry).map(textValue).filter(Boolean);
  const diagnostics: AutomationDiagnostic[] = [];
  if (geometryValues.length !== 1)
    diagnostics.push(
      diag("INVALID_WSMODEL_GEOMETRY", `Expected one /model/geometry path; found ${geometryValues.length}`, filePath),
    );
  const materialContainer = record(root.materials);
  const materialNodes = asArray(materialContainer?.material);
  const bindings: WsBinding[] = materialNodes.map((raw, index) => {
    const item = record(raw) ?? {};
    const lodText = item["@_lod_index"];
    const partText = item["@_part_index"];
    const lodIndex = typeof lodText === "string" && /^\d+$/.test(lodText) ? Number(lodText) : null;
    const partIndex = typeof partText === "string" && /^\d+$/.test(partText) ? Number(partText) : null;
    const materialPath = textValue(item);
    const invalidReason =
      lodIndex === null || partIndex === null
        ? "lod_index and part_index must be non-negative integers"
        : !materialPath
          ? "material path is empty"
          : undefined;
    if (invalidReason)
      diagnostics.push(diag("INVALID_WSMODEL_BINDING", `Material binding ${index}: ${invalidReason}`, filePath));
    return {
      lodIndex,
      partIndex,
      materialPath,
      location: `/model/materials/material[${index}]`,
      ...(invalidReason ? { invalidReason } : {}),
    };
  });
  return { geometryPath: geometryValues.length === 1 ? geometryValues[0] : null, bindings, diagnostics };
};

const wsTextureType = (slot: string): { typeId: number | null; typeName: string; recognized: boolean } => {
  const lower = slot.toLowerCase();
  const exact: Record<string, { typeId: number; typeName: string }> = {
    diffuse: { typeId: 0, typeName: "Diffuse" },
    t_xml_diffuse: { typeId: 0, typeName: "Diffuse" },
    normal: { typeId: 1, typeName: "Normal" },
    t_xml_normal: { typeId: 1, typeName: "Normal" },
    mask: { typeId: 3, typeName: "Mask" },
    t_xml_mask: { typeId: 3, typeName: "Mask" },
    ambient_occlusion: { typeId: 5, typeName: "Ambient_occlusion" },
    t_xml_ao: { typeId: 5, typeName: "Ambient_occlusion" },
    tiling_dirt_uv2: { typeId: 7, typeName: "Tiling_dirt_uv2" },
    skin_mask: { typeId: 10, typeName: "Skin_mask" },
    specular: { typeId: 11, typeName: "Specular" },
    t_xml_specular: { typeId: 11, typeName: "Specular" },
    gloss: { typeId: 12, typeName: "Gloss" },
    t_xml_gloss: { typeId: 12, typeName: "Gloss" },
    decal_dirtmap: { typeId: 13, typeName: "Decal_dirtmap" },
    decal_dirtmask: { typeId: 14, typeName: "Decal_dirtmask" },
    decal_mask: { typeId: 15, typeName: "Decal_mask" },
    diffuse_damage: { typeId: 17, typeName: "Diffuse_damage" },
    t_xml_base_colour: { typeId: 27, typeName: "BaseColour" },
    base_colour: { typeId: 27, typeName: "BaseColour" },
    t_xml_material_map: { typeId: 29, typeName: "MaterialMap" },
    material_map: { typeId: 29, typeName: "MaterialMap" },
    t_xml_blood_map: { typeId: 1001, typeName: "Blood" },
    t_xml_distortion: { typeId: 1002, typeName: "Distortion" },
    t_xml_distortion_noise: { typeId: 1003, typeName: "DistortionNoise" },
    t_xml_emissive_texture: { typeId: 1004, typeName: "Emissive" },
    t_xml_emissive_distortion: { typeId: 1005, typeName: "EmissiveDistortion" },
  };
  const known = exact[lower];
  if (known) return { ...known, recognized: true };
  return { typeId: null, typeName: slot || "unknown", recognized: false };
};

const parseWsMaterial = (text: string, filePath: string): WsMaterialDocument => {
  const valid = XMLValidator.validate(text);
  if (valid !== true)
    return {
      name: "",
      shaderPath: "",
      alpha: false,
      textures: [],
      parameters: [],
      diagnostics: [diag("INVALID_WSMODEL_MATERIAL_XML", JSON.stringify(valid), filePath)],
    };
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(text);
  } catch (error) {
    return {
      name: "",
      shaderPath: "",
      alpha: false,
      textures: [],
      parameters: [],
      diagnostics: [
        diag("INVALID_WSMODEL_MATERIAL_XML", error instanceof Error ? error.message : String(error), filePath),
      ],
    };
  }
  const root = record(record(parsed)?.material);
  if (!root)
    return {
      name: "",
      shaderPath: "",
      alpha: false,
      textures: [],
      parameters: [],
      diagnostics: [diag("INVALID_WSMODEL_MATERIAL_ROOT", "XML material has no /material root", filePath)],
    };
  const name = textValue(root.name);
  const shaderPath = textValue(root.shader);
  const textures: WsMaterialTexture[] = [];
  const textureNodes = asArray(record(root.textures)?.texture);
  for (let index = 0; index < textureNodes.length; index++) {
    const texture = record(textureNodes[index]) ?? {};
    const slotName = textValue(texture.slot);
    const texturePath = textValue(texture.source) || textValue(texture);
    const slot = wsTextureType(slotName);
    textures.push({ ...slot, slotName, path: texturePath, sourceLocation: `/material/textures/texture[${index}]` });
  }
  const parameters = asArray(record(root.params)?.param).map((raw) => {
    const parameter = record(raw) ?? {};
    return { name: textValue(parameter.name), type: textValue(parameter.type), value: textValue(parameter.value) };
  });
  return { name, shaderPath, alpha: name.toLowerCase().includes("alpha_on"), textures, parameters, diagnostics: [] };
};

const parseMaterialModel = async (
  node: ReferenceGraphNode,
  environment: Awaited<ReturnType<typeof prepareReferenceEnvironment>>,
): Promise<{ provider: ReferenceProvider; entry: CorePackEntry; model: ReturnType<typeof parseRmv2> } | undefined> => {
  if (!node.provider) return undefined;
  const provider = environment.providers.find((candidate) => candidate.pack.path === node.provider);
  const entry = provider?.entriesByPath.get(normalizePackFilePathKey(node.path))?.[0];
  if (!provider || !entry) return undefined;
  const bytes = await readAutomationPayload(provider.pack, entry, environment.context);
  return { provider, entry, model: parseRmv2(bytes) };
};

const getUnitMaterialItems = (unitItem: UnitMaterialItem) => {
  const visuals = record(unitItem.visuals) ?? {};
  const variants = record(visuals.variants) ?? {};
  const variantItems = asArray(variants.items).map((raw) => record(raw) ?? {});
  const mounts = record(visuals.mount) ?? {};
  const engine = record(visuals.engine) ?? {};
  const extras = record(visuals.extraEngines) ?? {};
  const extraItems = asArray(extras.items).map((raw) => record(raw) ?? {});
  return { visuals, variantItems, mounts, engine, extraItems };
};

const chainFor = (
  nodeId: string,
  byId: ReadonlyMap<string, ReferenceGraphNode>,
  incoming: ReadonlyMap<string, ReferenceGraphEdge[]>,
  roots: ReadonlySet<string>,
  limit: number,
  budget: { remaining: number; exceeded: boolean },
): LoaderChain[] => {
  const visit = (id: string, stack: ReadonlySet<string>): LoaderChain[] => {
    if (stack.has(id) || budget.exceeded) return [];
    if (budget.remaining <= 0) {
      budget.exceeded = true;
      return [];
    }
    budget.remaining -= 1;
    const node = byId.get(id);
    if (!node) return [];
    const nextStack = new Set(stack);
    nextStack.add(id);
    const output: LoaderChain[] = roots.has(id) ? [{ rootId: id, nodes: [node], edges: [] }] : [];
    for (const edge of incoming.get(id) ?? []) {
      if (output.length >= limit || budget.exceeded) break;
      for (const parent of visit(edge.source, nextStack)) {
        if (output.length >= limit) break;
        output.push({ rootId: parent.rootId, nodes: [...parent.nodes, node], edges: [...parent.edges, edge] });
      }
    }
    return output;
  };
  return visit(nodeId, new Set()).slice(0, limit);
};

const visibleChain = (chain: LoaderChain) =>
  chain.edges.map((edge) => {
    const source = chain.nodes.find((node) => node.id === edge.source);
    const target = chain.nodes.find((node) => node.id === edge.target);
    return {
      from: source?.path ?? edge.source,
      to: target?.path ?? edge.target,
      relationship: edge.relationship,
      ...(edge.sourceField ? { sourceField: edge.sourceField } : {}),
      ...(edge.targetField ? { targetField: edge.targetField } : {}),
      ...(edge.location ? { location: edge.location } : {}),
      ...(edge.conditional ? { conditional: edge.conditional } : {}),
      ...(edge.loadMode ? { loadMode: edge.loadMode } : {}),
    };
  });

export const runAssetMaterials = async (request: MaterialsRequest, context: AutomationContext) => {
  const environment = await prepareReferenceEnvironment(
    context,
    request.packPaths,
    request.vanillaPackPaths,
    request.gameDataPath,
  );
  const roots: ReferenceGraphRoot[] = [];
  const rootContexts = new Map<string, ExplicitRootContext[]>();
  const addAssetRoot = (assetPath: string, rootContext: ExplicitRootContext) => {
    roots.push({ type: "asset", path: assetPath });
    const key = normalizePackFilePathKey(assetPath);
    const contexts = rootContexts.get(key) ?? [];
    contexts.push(rootContext);
    rootContexts.set(key, contexts);
  };
  if (request.assetPaths) {
    for (const assetPath of request.assetPaths) {
      const extension = pathExt(assetPath);
      if (!["rigid_model_v2", "wsmodel", "variantmeshdefinition"].includes(extension)) {
        throw new AutomationError(
          "INVALID_ARGUMENT",
          `asset_materials root must be an RMV2, WSModel, or variant mesh definition: ${assetPath}`,
        );
      }
      addAssetRoot(assetPath, { kind: "assetPath", rootPath: assetPath });
    }
  }

  let unitComplete = true;
  const unitDiagnostics: AutomationDiagnostic[] = [];
  let unitItemCount = 0;
  if (request.unitKey !== undefined) {
    const unitRequest = unitResolveSchema.parse({
      operation: "unit_resolve",
      packPaths: request.packPaths,
      ...(request.vanillaPackPaths ? { vanillaPackPaths: request.vanillaPackPaths } : {}),
      ...(request.gameDataPath ? { gameDataPath: request.gameDataPath } : {}),
      query: request.unitKey,
      match: "exact",
      caseSensitive: true,
      searchBy: "key",
      offset: 0,
      limit: 1000,
      detailLimit: 1000,
    });
    const unitResult = await runUnitResolve(unitRequest, context);
    const unitData = unitResult.data as { complete?: boolean; items?: UnitMaterialItem[] };
    const unitItems = unitData.items ?? [];
    unitItemCount = unitItems.length;
    // unit_resolve also checks recruitment, localization, optimization, and unrelated tables.
    // Material completeness is driven by its selected visual roots and their loader paths.
    if (!unitItems.length) {
      unitComplete = false;
      unitDiagnostics.push(diag("UNIT_ROOT_NOT_FOUND", `No exact unit key matched ${request.unitKey}`));
    }
    for (const item of unitItems) {
      await yieldToEventLoop(context.signal);
      const { visuals, variantItems, mounts, engine, extraItems } = getUnitMaterialItems(item);
      const mainEvidence = item.mainUnit;
      const landEvidence = item.landUnit;
      const linkContext = (source: string, sourceField: string, evidence: unknown, extraEvidence?: unknown) => ({
        kind: "unit" as const,
        rootPath: "",
        unitKey: request.unitKey,
        evidence: {
          mainUnit: mainEvidence,
          landUnit: landEvidence,
          visualSource: evidence,
          ...(extraEvidence !== undefined ? { targetEvidence: extraEvidence } : {}),
        },
        links: [
          { source, sourceField, evidence },
          ...(extraEvidence !== undefined ? [{ targetField: "key", evidence: extraEvidence }] : []),
        ],
      });
      const addUnitPath = (assetPath: string, provenance: ExplicitRootContext, evidenceField?: string) => {
        const rootContext = {
          ...provenance,
          rootPath: assetPath,
          ...(evidenceField ? { links: [...(provenance.links ?? []), { targetField: evidenceField }] } : {}),
        };
        addAssetRoot(assetPath, rootContext);
      };
      const optimization = record(item.optimization) ?? {};
      const issues = [...asArray(item.issues), ...asArray(optimization.issues)].map((raw) => record(raw) ?? {});
      for (const issue of issues) {
        const code = typeof issue.code === "string" ? issue.code : "";
        if (!/VISUAL|MOUNT|ENGINE|MISSING_LAND_UNIT|NO_MAIN_UNIT/i.test(code)) continue;
        unitComplete = false;
        unitDiagnostics.push(
          diag(
            code || "UNRESOLVED_UNIT_VISUAL",
            String(issue.message ?? "Selected unit visual did not resolve"),
            request.unitKey,
          ),
        );
      }
      for (const variant of variantItems) {
        const variantPath = typeof variant.path === "string" ? variant.path : "";
        if (variantPath && variant.status === "found")
          addUnitPath(
            variantPath,
            linkContext("unit_variants", "variant", variant.evidence, {
              variantName: variant.variantName,
              path: variant.path,
              packPath: variant.packPath,
            }),
          );
      }
      const mountVariant = record(mounts.variant) ?? {};
      if (typeof mountVariant.path === "string" && mountVariant.status === "found") {
        addUnitPath(mountVariant.path, linkContext("mounts", "variant", mounts, { ...mountVariant }));
      }
      const engineVariant = record(engine.variant) ?? {};
      if (typeof engineVariant.path === "string" && engineVariant.status === "found") {
        addUnitPath(engineVariant.path, linkContext("battlefield_engines", "variant", engine, { ...engineVariant }));
      }
      for (const extra of extraItems) {
        const extraModel = record(extra.model) ?? {};
        for (const lod of asArray(extraModel.lods).map((entry) => record(entry) ?? {})) {
          if (typeof lod.modelPath === "string" && lod.status === "found") {
            addUnitPath(
              lod.modelPath,
              linkContext("land_units_to_extra_engines", "battle_engine", extra.evidence, {
                engine: extra.engine,
                animated: extraModel.animated,
                lod,
              }),
            );
          }
        }
        const directPath = typeof extraModel.path === "string" && extraModel.status === "found" ? extraModel.path : "";
        if (directPath) addUnitPath(directPath, linkContext("battlefield_engines", "model", extra.engine, extraModel));
      }
      const engineModel = record(engine.model) ?? {};
      for (const lod of asArray(engineModel.lods).map((entry) => record(entry) ?? {})) {
        if (typeof lod.modelPath === "string" && lod.status === "found") {
          addUnitPath(
            lod.modelPath,
            linkContext("battlefield_engines", "model", engine, { animated: engineModel.animated, lod }),
          );
        }
      }
      const directEnginePath = typeof engineModel.path === "string" ? engineModel.path : "";
      if (directEnginePath && engineModel.status === "found") {
        addUnitPath(directEnginePath, linkContext("battlefield_engines", "model", engine, engineModel));
      }
      void visuals;
    }
    if (unitItems.length && !roots.length) {
      unitComplete = false;
      unitDiagnostics.push(
        diag(
          "UNIT_VISUAL_ROOTS_MISSING",
          `No resolvable visual roots were found for unit ${request.unitKey}`,
          request.unitKey,
        ),
      );
    }
  }

  const graph = await buildReferenceGraph(environment, roots, {
    traversal: "recursive",
    maxDepth: request.maxDepth,
    maxNodes: request.maxNodes,
    maxEdges: request.maxEdges,
    traverseRigidInternals: false,
    traverseWsmodelMaterials: false,
  });
  const diagnostics: AutomationDiagnostic[] = [...unitDiagnostics, ...graph.diagnostics];
  let complete = graph.complete && unitComplete;
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incomingEdgesByTarget = new Map<string, ReferenceGraphEdge[]>();
  for (const edge of graph.edges) {
    const edges = incomingEdgesByTarget.get(edge.target) ?? [];
    edges.push(edge);
    incomingEdgesByTarget.set(edge.target, edges);
  }
  const rootIdSet = new Set(graph.roots);
  const modelNodes = graph.nodes.filter(
    (node) => node.type === "asset" && node.extension === "rigid_model_v2" && node.status === "found",
  );
  const items: Array<Record<string, unknown>> = [];
  let bindingLimitReached = false;
  let chainLimitReached = false;
  const chainBudget = { remaining: 100_000, exceeded: false };
  const wsDocumentByNode = new Map<string, WsModelDocument>();
  const wsIssueKeys = new Set<string>();
  const wsModelNodes = graph.nodes.filter(
    (node) => node.type === "asset" && node.extension === "wsmodel" && node.status === "found",
  );
  for (const wsNode of wsModelNodes) {
    throwIfAborted(context.signal);
    const provider = environment.providers.find((candidate) => candidate.pack.path === wsNode.provider);
    const entry = provider?.entriesByPath.get(normalizePackFilePathKey(wsNode.path))?.[0];
    if (!provider || !entry) {
      complete = false;
      diagnostics.push(diag("WSMODEL_SOURCE_MISSING", `Could not load reached WS model ${wsNode.path}`, wsNode.path));
      continue;
    }
    try {
      const bytes = await readAutomationPayload(provider.pack, entry, context);
      const document = inspectWsModelBindings(decodePackedTextBuffer(bytes), entry.name);
      wsDocumentByNode.set(wsNode.id, document);
      if (document.diagnostics.length) {
        complete = false;
        diagnostics.push(...document.diagnostics);
      }
    } catch (error) {
      if (error instanceof AutomationError && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code)) throw error;
      complete = false;
      diagnostics.push(
        diag("WSMODEL_READ_FAILED", error instanceof Error ? error.message : String(error), wsNode.path),
      );
    }
  }
  const addWsIssueOnce = (key: string, issue: AutomationDiagnostic) => {
    if (wsIssueKeys.has(key)) return;
    wsIssueKeys.add(key);
    diagnostics.push(issue);
  };
  let processedModels = 0;
  for (const modelNode of modelNodes) {
    throwIfAborted(context.signal);
    if ((processedModels++ & 31) === 0) await yieldToEventLoop(context.signal);
    let parsed;
    try {
      parsed = await parseMaterialModel(modelNode, environment);
    } catch (error) {
      if (error instanceof AutomationError && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code)) throw error;
      complete = false;
      diagnostics.push(
        diag(
          error instanceof Rmv2CodecError && error.code === "UNSUPPORTED"
            ? "UNSUPPORTED_RMV2_MODEL"
            : "INVALID_RMV2_MODEL",
          error instanceof Error ? error.message : String(error),
          modelNode.path,
        ),
      );
      continue;
    }
    if (!parsed) continue;
    const { model } = parsed;
    const rawChains = chainFor(
      modelNode.id,
      graphNodeById,
      incomingEdgesByTarget,
      rootIdSet,
      request.maxBindings + 1,
      chainBudget,
    );
    if (chainBudget.exceeded) chainLimitReached = true;
    if (!rawChains.length && rootIdSet.has(modelNode.id))
      rawChains.push({ rootId: modelNode.id, nodes: [modelNode], edges: [] });
    if (!rawChains.length) {
      complete = false;
      diagnostics.push(
        diag("RIGID_MODEL_ROOT_CHAIN_MISSING", `No selected loader path reaches ${modelNode.path}`, modelNode.path),
      );
      continue;
    }
    const chains: LoaderChain[] = [];
    for (const chain of rawChains) {
      const rootNode = chain.nodes[0];
      const contexts = rootNode ? rootContexts.get(normalizePackFilePathKey(rootNode.path)) : undefined;
      if (contexts?.length) {
        for (const rootContext of contexts) {
          if (chains.length > request.maxBindings) break;
          chains.push({ ...chain, rootContext });
        }
      } else {
        chains.push(chain);
      }
      if (chains.length > request.maxBindings) break;
    }
    if (rawChains.length > request.maxBindings || chains.length > request.maxBindings) bindingLimitReached = true;
    if (chains.length > request.maxBindings) chains.length = request.maxBindings;
    const materialCache = new Map<string, WsMaterialDocument>();
    for (const chain of chains) {
      const lastModelEdge = [...chain.edges].reverse().find((edge) => edge.target === modelNode.id && edge.loadMode);
      const loadMode = lastModelEdge?.loadMode ?? "direct";
      const wsModelNode = loadMode === "wsmodel" && lastModelEdge ? graphNodeById.get(lastModelEdge.source) : undefined;
      const wsDocument = loadMode === "wsmodel" && wsModelNode ? wsDocumentByNode.get(wsModelNode.id) : undefined;
      if (wsDocument) {
        if (
          wsDocument.geometryPath &&
          normalizePackFilePathKey(wsDocument.geometryPath) !== normalizePackFilePathKey(modelNode.path)
        ) {
          complete = false;
          addWsIssueOnce(
            `${wsModelNode?.id}:geometry:${modelNode.id}`,
            diag(
              "WSMODEL_GEOMETRY_MISMATCH",
              `WS geometry ${wsDocument.geometryPath} does not bind ${modelNode.path}`,
              wsModelNode?.path,
            ),
          );
        }
        const countsByPair = new Map<string, number>();
        for (const binding of wsDocument.bindings) {
          if (binding.lodIndex === null || binding.partIndex === null) continue;
          const key = `${binding.lodIndex}:${binding.partIndex}`;
          countsByPair.set(key, (countsByPair.get(key) ?? 0) + 1);
        }
        for (const [key, count] of countsByPair) {
          if (count > 1) {
            complete = false;
            addWsIssueOnce(
              `${wsModelNode?.id}:duplicate:${key}`,
              diag(
                "DUPLICATE_WSMODEL_BINDING",
                `WS model has ${count} material bindings for lod/part ${key}`,
                wsModelNode?.path,
              ),
            );
          }
        }
        for (const binding of wsDocument.bindings) {
          if (
            binding.lodIndex === null ||
            binding.partIndex === null ||
            binding.lodIndex >= model.lods.length ||
            binding.partIndex >= (model.lods[binding.lodIndex]?.meshCount ?? 0)
          ) {
            complete = false;
            addWsIssueOnce(
              `${wsModelNode?.id}:index:${binding.location}`,
              diag(
                "INVALID_WSMODEL_BINDING_INDEX",
                `WS material binding ${binding.location} is outside the referenced geometry`,
                wsModelNode?.path,
              ),
            );
          }
        }
      }

      for (const lod of model.lods) {
        for (const part of lod.parts) {
          if (items.length >= request.maxBindings) {
            bindingLimitReached = true;
            break;
          }
          const embeddedTextures = (part.textures ?? []).map((texture, textureSlotIndex) => ({
            ...texture,
            textureSlotIndex,
            resolution: resolveTexture(environment, texture.path),
          }));
          const textureErrors: AutomationDiagnostic[] = [];
          let materialSource: Record<string, unknown> = { kind: "embedded", modelPath: modelNode.path };
          let effectiveTextures: Array<Record<string, unknown>> = embeddedTextures.map((texture) => ({ ...texture }));
          let partComplete = part.complete;
          if (!part.complete) {
            partComplete = false;
            textureErrors.push(
              diag(
                "UNSUPPORTED_RMV2_PART",
                `LOD ${part.lodIndex} part ${part.partIndex}: ${part.unsupportedReason ?? "unsupported layout"}`,
                modelNode.path,
              ),
            );
          }

          if (loadMode === "wsmodel") {
            const matches = (wsDocument?.bindings ?? []).filter(
              (binding) => binding.lodIndex === lod.lodIndex && binding.partIndex === part.partIndex,
            );
            if (matches.length !== 1 || matches[0].invalidReason) {
              partComplete = false;
              const code = matches.length > 1 ? "DUPLICATE_WSMODEL_BINDING" : "MISSING_WSMODEL_BINDING";
              textureErrors.push(
                diag(
                  code,
                  `WS model does not have exactly one valid material binding for lod ${lod.lodIndex} part ${part.partIndex}`,
                  wsModelNode?.path,
                ),
              );
              effectiveTextures = [];
              materialSource = { kind: "wsmodel", wsModelPath: wsModelNode?.path ?? null, status: "unresolvedBinding" };
            } else {
              const binding = matches[0];
              const resolvedMaterial = resolveReferenceAsset(environment, binding.materialPath, false);
              if (resolvedMaterial.status !== "found" || !resolvedMaterial.winner) {
                partComplete = false;
                textureErrors.push(
                  diag(
                    resolvedMaterial.status === "missing" ? "MISSING_WSMODEL_MATERIAL" : "AMBIGUOUS_WSMODEL_MATERIAL",
                    `WS material ${binding.materialPath} has status ${resolvedMaterial.status}`,
                    binding.materialPath,
                  ),
                );
                effectiveTextures = [];
                materialSource = {
                  kind: "wsmodel",
                  wsModelPath: wsModelNode?.path ?? null,
                  materialPath: binding.materialPath,
                  status: resolvedMaterial.status,
                };
              } else {
                const cacheKey = `${resolvedMaterial.winner.provider.pack.path}\0${resolvedMaterial.winner.entry.name}`;
                let wsMaterial = materialCache.get(cacheKey);
                if (!wsMaterial) {
                  const materialBytes = await readAutomationPayload(
                    resolvedMaterial.winner.provider.pack,
                    resolvedMaterial.winner.entry,
                    context,
                  );
                  wsMaterial = parseWsMaterial(
                    decodePackedTextBuffer(materialBytes),
                    resolvedMaterial.winner.entry.name,
                  );
                  materialCache.set(cacheKey, wsMaterial);
                }
                diagnostics.push(...wsMaterial.diagnostics);
                if (wsMaterial.diagnostics.length) {
                  complete = false;
                  partComplete = false;
                }
                const declared = wsMaterial.textures.map((texture, textureSlotIndex) => ({
                  ...texture,
                  textureSlotIndex,
                  source: "wsmodelMaterial" as const,
                  resolution: resolveTexture(environment, texture.path),
                }));
                effectiveTextures = declared;
                const invalidSlots = declared.filter((texture) => !texture.slotName.trim());
                if (invalidSlots.length) {
                  partComplete = false;
                  for (const texture of invalidSlots)
                    textureErrors.push(
                      diag(
                        "INVALID_WSMODEL_TEXTURE_SLOT",
                        "WS material texture slot identifier is empty",
                        resolvedMaterial.winner.entry.name,
                      ),
                    );
                }
                const missingPaths = declared.filter((texture) => !texture.path.trim());
                if (missingPaths.length) {
                  partComplete = false;
                  for (const texture of missingPaths)
                    textureErrors.push(
                      diag(
                        "INVALID_WSMODEL_TEXTURE_PATH",
                        `WS material texture slot ${texture.slotName} has an empty path`,
                        resolvedMaterial.winner.entry.name,
                      ),
                    );
                }
                materialSource = {
                  kind: "wsmodel",
                  wsModelPath: wsModelNode?.path ?? null,
                  materialPath: resolvedMaterial.winner.entry.name,
                  materialPackPath: resolvedMaterial.winner.provider.pack.path,
                  name: wsMaterial.name,
                  shaderPath: wsMaterial.shaderPath,
                  alpha: wsMaterial.alpha,
                  parameters: wsMaterial.parameters,
                  declaredTextures: declared,
                  effectiveTextures,
                };
              }
            }
          }

          for (const texture of effectiveTextures) {
            const resolution = record(texture.resolution);
            if (resolution?.status !== "found" && (loadMode !== "wsmodel" || texture.path !== "")) {
              partComplete = false;
              textureErrors.push(
                diag(
                  "UNRESOLVED_MATERIAL_TEXTURE",
                  `Texture ${String(texture.path)} has status ${String(resolution?.status)}`,
                  modelNode.path,
                ),
              );
            }
          }
          diagnostics.push(...textureErrors);
          if (textureErrors.length) complete = false;
          items.push({
            root: chain.nodes[0]?.path ?? modelNode.path,
            ...(chain.rootContext ? { rootContext: chain.rootContext } : {}),
            loadMode,
            loaderChain: visibleChain(chain),
            conditional: chain.edges.flatMap((edge) => (edge.conditional ? [edge.conditional] : [])),
            model: {
              path: modelNode.path,
              packPath: modelNode.provider,
              version: model.version,
              skeletonName: model.skeletonName,
              validationComplete: model.validationComplete,
            },
            lodIndex: lod.lodIndex,
            partIndex: part.partIndex,
            partName: part.name,
            partComplete,
            ...(part.unsupportedReason ? { unsupportedReason: part.unsupportedReason } : {}),
            materialTypeId: part.materialTypeId,
            materialTypeName: part.materialTypeName,
            vertexFormatId: part.vertexFormatId,
            vertexFormatName: part.vertexFormatName,
            vertexCount: part.vertexCount,
            indexCount: part.indexCount,
            triangleCount: part.triangleCount,
            materialSource,
            embeddedTextures,
            effectiveTextures,
          });
        }
        if (bindingLimitReached) break;
      }
      if (bindingLimitReached || chainLimitReached) break;
    }
    if (bindingLimitReached || chainLimitReached) break;
  }
  if (bindingLimitReached) {
    complete = false;
    diagnostics.push(
      diag("ASSET_MATERIALS_BINDING_LIMIT", `Asset material results reached maxBindings=${request.maxBindings}`),
    );
  }
  if (chainLimitReached) {
    complete = false;
    diagnostics.push(
      diag("ASSET_MATERIALS_CHAIN_LIMIT", "Loader-chain reconstruction reached its 100000-visit safety limit"),
    );
  }

  const full = {
    roots: roots.map((root) =>
      root.type === "asset"
        ? { type: "asset", path: root.path }
        : root.type === "db-row"
          ? { type: "db-row", path: root.row.entry.name, table: root.row.logicalTable, rowIndex: root.row.rowIndex }
          : { type: "db", path: root.path, where: root.where },
    ),
    unitKey: request.unitKey,
    unitItemCount,
    complete,
    total: items.length,
    items,
    coverage: graph.coverage,
    diagnostics,
  };
  let reportPath: string | undefined;
  if (request.reportPath) {
    reportPath = (
      await context.policy.withAtomicOutput({
        outputPath: request.reportPath,
        sourcePaths: environment.sourcePaths,
        produce: async (temporaryPath) => fs.writeFile(temporaryPath, `${JSON.stringify(full, null, 2)}\n`),
      })
    ).path;
  }
  const page = items.slice(request.offset, request.offset + request.limit);
  return {
    data: {
      roots: full.roots,
      unitKey: request.unitKey,
      complete,
      total: items.length,
      offset: request.offset,
      limit: request.limit,
      items: page,
      nextOffset: request.offset + page.length < items.length ? request.offset + page.length : null,
      hasMore: request.offset + page.length < items.length,
      coverage: graph.coverage,
      diagnosticsTotal: diagnostics.length,
      diagnostics: diagnostics.slice(0, 1000),
      ...(reportPath ? { reportPath } : {}),
    },
    diagnostics: diagnostics.slice(0, 1000),
  };
};
