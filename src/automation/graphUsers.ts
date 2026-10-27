import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { getSupportedVisualDependencyExtension, type VisualReferenceDetail } from "../visuals/dependencies";
import { throwIfAborted, yieldToEventLoop } from "./errors";
import {
  loadRigidReferenceModel,
  loadVisualReferenceExtraction,
  resolveReferenceAsset,
  type ReferenceEnvironment,
  type ReferenceGraphEdge,
  type ReferenceGraphResult,
  type ReferenceProvider,
} from "./references";
import type { UnitVisualRoot } from "./units";

export interface VisualRootChain {
  root: UnitVisualRoot;
  chain: Array<Record<string, unknown>>;
}

export interface IncomingVisualReferenceEdge {
  sourcePath: string;
  targetPath: string;
  sourceKey: string;
  targetKey: string;
  sourceProvider: { packPath: string; providerKind: "mod" | "vanilla" };
  targetProvider: { packPath: string; providerKind: "mod" | "vanilla" };
  details: VisualReferenceDetail[];
}

export interface IncomingVisualReferenceIndex {
  complete: boolean;
  edges: number;
  scannedSources: number;
  diagnostics: Array<{ code: string; message: string; severity: "warning" | "info"; path?: string }>;
  findMany(
    targetPaths: readonly string[],
    roots: readonly UnitVisualRoot[],
    limits: { maxDepth: number; maxNodes: number; maxEdges: number; maxWorkNodes?: number; maxWorkEdges?: number },
  ): Promise<{
    matches: Map<string, VisualRootChain[]>;
    coverageByPath: Map<string, { complete: boolean; walks: number; status?: "unsupported"; limitReason?: string }>;
    walks: number;
  }>;
}

const supportedSourceExtensions = new Set(["variantmeshdefinition", "wsmodel", "xml.material", "rigid_model_v2"]);
const pathExtension = (value: string) => getSupportedVisualDependencyExtension(value);
/** Build compact incoming edges once for a request. The per-pack reference cache stores only
 * the supported XML/RMV2 extraction; this index contains effective winners and is request-local. */
export const createIncomingVisualReferenceIndex = async (
  environment: ReferenceEnvironment,
  targetPaths: readonly string[],
  limits: { maxSources: number; maxIndexEdges: number },
): Promise<IncomingVisualReferenceIndex> => {
  const targetExtensions = new Set(targetPaths.map(pathExtension));
  const supportedTargets = new Set([...supportedSourceExtensions, "dds"]);
  const hasSupportedTargets = [...targetExtensions].some((extension) => Boolean(extension && supportedTargets.has(extension)));
  const needsTextures = targetExtensions.has("dds");
  const sourceExtensions = new Set<string>(hasSupportedTargets ? ["variantmeshdefinition", "wsmodel", "xml.material"] : []);
  if (needsTextures) sourceExtensions.add("rigid_model_v2");
  const incoming = new Map<string, IncomingVisualReferenceEdge[]>();
  const edgeByPair = new Map<string, IncomingVisualReferenceEdge>();
  const diagnostics: IncomingVisualReferenceIndex["diagnostics"] = [];
  const diagnosticKeys = new Set<string>();
  const resolutionCache = new Map<string, ReturnType<typeof resolveReferenceAsset>>();
  let complete = true;
  let scannedSources = 0;
  let scannedGroups = 0;
  let totalCandidatePaths = 0;
  const report = (force = false) => {
    if (force || (scannedSources & 255) === 0) environment.context.progress?.({
      stage: "indexing",
      completed: scannedSources,
      total: totalCandidatePaths,
      edges: edgeByPair.size,
      message: `Indexed ${scannedSources} visual sources`,
    });
  };
  const noteIncomplete = (code: string, message: string, sourcePath?: string) => {
    complete = false;
    const signature = `${code}\0${sourcePath ?? ""}\0${message}`;
    if (diagnosticKeys.has(signature)) return;
    diagnosticKeys.add(signature);
    diagnostics.push({ code, message, severity: "warning", ...(sourcePath ? { path: sourcePath } : {}) });
  };
  let edgeLimitHit = false;
  const addReference = (
    source: { provider: ReferenceProvider; entry: ReferenceEnvironment["providers"][number]["pack"]["entries"][number] },
    detail: VisualReferenceDetail,
  ) => {
    const requestedKey = normalizePackFilePathKey(detail.path);
    let resolution = resolutionCache.get(requestedKey);
    if (!resolution) {
      resolution = resolveReferenceAsset(environment, detail.path, false);
      resolutionCache.set(requestedKey, resolution);
    }
    if (resolution.status === "ambiguous") {
      noteIncomplete("INCOMING_REFERENCE_TARGET_AMBIGUOUS", `Multiple effective entries provide ${resolution.path}`, resolution.path);
      return;
    }
    if (resolution.status !== "found" || !resolution.winner) return;
    const sourcePath = source.entry.name;
    const targetPath = resolution.path;
    const sourceKey = normalizePackFilePathKey(sourcePath);
    const targetKey = resolution.key;
    const pair = `${sourceKey}\0${targetKey}`;
    let edge = edgeByPair.get(pair);
    if (!edge) {
      if (edgeByPair.size >= limits.maxIndexEdges) {
        edgeLimitHit = true;
        return;
      }
      edge = {
        sourcePath,
        targetPath,
        sourceKey,
        targetKey,
        sourceProvider: { packPath: source.provider.pack.path, providerKind: source.provider.kind },
        targetProvider: { packPath: resolution.winner.provider.pack.path, providerKind: resolution.winner.provider.kind },
        details: [],
      };
      edgeByPair.set(pair, edge);
      const group = incoming.get(targetKey) ?? [];
      group.push(edge);
      incoming.set(targetKey, group);
    }
    if (!edge.details.some((item) => item.relationship === detail.relationship && item.location === detail.location &&
        JSON.stringify(item.conditional) === JSON.stringify(detail.conditional))) edge.details.push(detail);
  };

  const effectiveSources: Array<{ key: string; extension: string; provider: ReferenceProvider; entry: ReferenceEnvironment["providers"][number]["pack"]["entries"][number] }> = [];
  for (const [key, candidates] of environment.assetCandidates) {
    const extension = pathExtension(key);
    if (!extension || !sourceExtensions.has(extension) || !supportedSourceExtensions.has(extension)) continue;
    const highestOrder = candidates[candidates.length - 1]?.provider.order;
    const top = candidates.filter((candidate) => candidate.provider.order === highestOrder);
    if (top.length !== 1) {
      noteIncomplete("INCOMING_REFERENCE_SOURCE_AMBIGUOUS", "An effective visual source path is duplicated in its winning pack", top[0]?.entry.name);
      continue;
    }
    effectiveSources.push({ key, extension, provider: top[0].provider, entry: top[0].entry });
  }
  // Target and supporting mod sources are scanned before the much larger vanilla set. The
  // array is limited to supported active source paths, not copied pack payloads or parse trees.
  effectiveSources.sort((left, right) => right.provider.order - left.provider.order || left.key.localeCompare(right.key));
  totalCandidatePaths = effectiveSources.length;
  for (const { key, extension, provider, entry } of effectiveSources) {
    throwIfAborted(environment.context.signal);
    if ((scannedGroups++ & 127) === 0) await yieldToEventLoop(environment.context.signal);
    if (scannedSources >= limits.maxSources) {
      noteIncomplete("INCOMING_REFERENCE_SOURCE_LIMIT", `Incoming visual indexing reached maxSources (${limits.maxSources})`);
      break;
    }
    scannedSources++;
    try {
      if (extension === "rigid_model_v2") {
        const model = await loadRigidReferenceModel(environment, provider, entry, false);
        for (const lod of model.lods) for (const part of lod.parts) {
          if (!part.complete || !part.textures) {
            noteIncomplete("INCOMING_REFERENCE_RMV2_PART_INCOMPLETE", `LOD ${part.lodIndex} part ${part.partIndex} has unsupported texture coverage`, entry.name);
            continue;
          }
          for (let textureSlotIndex = 0; textureSlotIndex < part.textures.length; textureSlotIndex++) {
            const texture = part.textures[textureSlotIndex];
            if (!texture.path.trim()) continue;
            addReference({ provider, entry }, {
              path: texture.path,
              extension: "dds",
              relationship: "texture",
              sourceField: texture.typeName ?? "texturePath",
              location: `lod[${lod.lodIndex}]/part[${part.partIndex}]/texture[${textureSlotIndex}]`,
            });
          }
        }
      } else {
        const extraction = await loadVisualReferenceExtraction(environment, provider, entry, false);
        if (!extraction.valid) {
          noteIncomplete("INCOMING_REFERENCE_XML_UNREADABLE", extraction.error ?? "Visual XML is malformed", entry.name);
          continue;
        }
        for (const detail of extraction.references) addReference({ provider, entry }, detail);
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(String(error.code))) throw error;
      noteIncomplete(extension === "rigid_model_v2" ? "INCOMING_REFERENCE_RMV2_UNREADABLE" : "INCOMING_REFERENCE_XML_UNREADABLE",
        error instanceof Error ? error.message : String(error), entry.name);
    }
    if (edgeLimitHit) {
      noteIncomplete("INCOMING_REFERENCE_EDGE_LIMIT", `Incoming visual indexing reached maxIndexEdges (${limits.maxIndexEdges})`);
      break;
    }
    report();
  }
  report(true);

  return {
    complete,
    edges: edgeByPair.size,
    scannedSources,
    diagnostics,
    async findMany(paths, roots, walkLimits) {
      const matches = new Map<string, VisualRootChain[]>();
      const coverageByPath = new Map<string, { complete: boolean; walks: number; status?: "unsupported"; limitReason?: string }>();
      const rootsByPath = new Map<string, UnitVisualRoot[]>();
      for (const root of roots) {
        const key = normalizePackFilePathKey(root.path);
        const group = rootsByPath.get(key) ?? [];
        group.push(root);
        rootsByPath.set(key, group);
      }
      type State = { seed: string; current: string; reversed: IncomingVisualReferenceEdge[]; depth: number };
      const queue: State[] = [];
      const visited = new Map<string, Set<string>>();
      const seedCounts = new Map<string, number>();
      const seedWalks = new Map<string, number>();
      const seedEdges = new Map<string, number>();
      const seedIncomplete = new Map<string, string>();
      const resultSignatures = new Map<string, Set<string>>();
      const uniqueSeeds = [...new Map(paths.map((value) => [normalizePackFilePathKey(value), value])).entries()];
      const maxWorkNodes = walkLimits.maxWorkNodes ?? Number.POSITIVE_INFINITY;
      const maxWorkEdges = walkLimits.maxWorkEdges ?? Number.POSITIVE_INFINITY;
      let workNodes = 0;
      let workEdges = 0;
      let workLimitHit = false;
      let workLimitReason = "";
      const addState = (seed: string, current: string, reversed: IncomingVisualReferenceEdge[], depth: number) => {
        const group = visited.get(seed) ?? new Set<string>();
        visited.set(seed, group);
        if (group.has(current)) return;
        if (workNodes >= maxWorkNodes) {
          seedIncomplete.set(seed, `maxWorkNodes (${maxWorkNodes})`);
          workLimitHit = true;
          workLimitReason = `maxWorkNodes (${maxWorkNodes})`;
          return;
        }
        group.add(current);
        queue.push({ seed, current, reversed, depth });
        seedCounts.set(seed, (seedCounts.get(seed) ?? 0) + 1);
        workNodes++;
      };
      for (const [seed] of uniqueSeeds) {
        matches.set(seed, []);
        seedCounts.set(seed, 0);
        seedWalks.set(seed, 0);
        seedEdges.set(seed, 0);
        addState(seed, seed, [], 0);
      }
      let cursor = 0;
      while (cursor < queue.length && !workLimitHit) {
        throwIfAborted(environment.context.signal);
        if ((workEdges & 255) === 0) await yieldToEventLoop(environment.context.signal);
        const state = queue[cursor++];
        seedCounts.set(state.seed, Math.max(0, (seedCounts.get(state.seed) ?? 1) - 1));
        seedWalks.set(state.seed, (seedWalks.get(state.seed) ?? 0) + 1);
        for (const root of rootsByPath.get(state.current) ?? []) {
          const chain = [...state.reversed].reverse().map((edge) => {
            const detail = edge.details[0];
            return {
              from: edge.sourcePath,
              to: edge.targetPath,
              fromProvider: edge.sourceProvider,
              toProvider: edge.targetProvider,
              relationship: detail?.relationship,
              sourceField: detail?.sourceField,
              location: detail?.location,
              conditional: detail?.conditional,
              references: edge.details,
            };
          });
          const signature = JSON.stringify([root.path, root.unitKey, root.landUnitKey, root.rootKind, root.reason, chain]);
          const signatures = resultSignatures.get(state.seed) ?? new Set<string>();
          resultSignatures.set(state.seed, signatures);
          if (!signatures.has(signature)) {
            signatures.add(signature);
            matches.get(state.seed)!.push({ root, chain });
          }
        }
        const currentIncoming = incoming.get(state.current) ?? [];
        const hasUnvisitedIncoming = currentIncoming.some((edge) => !visited.get(state.seed)?.has(edge.sourceKey));
        if (state.depth >= walkLimits.maxDepth && hasUnvisitedIncoming) {
          seedIncomplete.set(state.seed, `maxDepth (${walkLimits.maxDepth})`);
          continue;
        }
        for (const edge of currentIncoming) {
          if (visited.get(state.seed)?.has(edge.sourceKey)) continue;
          if ((seedEdges.get(state.seed) ?? 0) >= walkLimits.maxEdges) {
            seedIncomplete.set(state.seed, `maxEdges (${walkLimits.maxEdges})`);
            break;
          }
          if (workEdges >= maxWorkEdges) {
            seedIncomplete.set(state.seed, `maxWorkEdges (${maxWorkEdges})`);
            workLimitHit = true;
            workLimitReason = `maxWorkEdges (${maxWorkEdges})`;
            break;
          }
          const nextDepth = state.depth + 1;
          if ((visited.get(state.seed)?.size ?? 0) >= walkLimits.maxNodes) {
            seedIncomplete.set(state.seed, `maxNodes (${walkLimits.maxNodes})`);
            break;
          }
          const wasVisited = visited.get(state.seed)?.has(edge.sourceKey) ?? false;
          addState(state.seed, edge.sourceKey, [...state.reversed, edge], nextDepth);
          if (wasVisited) continue;
          if (!visited.get(state.seed)?.has(edge.sourceKey)) break;
          seedEdges.set(state.seed, (seedEdges.get(state.seed) ?? 0) + 1);
          workEdges++;
        }
      }
      for (const [seed] of uniqueSeeds) {
        if ((seedCounts.get(seed) ?? 0) > 0 && !seedIncomplete.has(seed)) {
          seedIncomplete.set(seed, workLimitReason || `maxEdges (${walkLimits.maxEdges})`);
        }
      }
      for (const [seed] of uniqueSeeds) {
        const reason = seedIncomplete.get(seed);
        const unsupported = !supportedTargets.has(pathExtension(seed) ?? "");
        coverageByPath.set(seed, {
          complete: !unsupported && complete && !reason && (seedCounts.get(seed) ?? 0) === 0,
          walks: seedWalks.get(seed) ?? 0,
          ...(unsupported ? { status: "unsupported", limitReason: "unsupported target extension" as const } :
            reason ? { limitReason: reason } : complete ? {} : { limitReason: "incoming index incomplete" }),
        });
      }
      environment.context.progress?.({ stage: "traversal", completed: uniqueSeeds.length, total: uniqueSeeds.length, paths: uniqueSeeds.length,
        edges: workEdges, message: `Traversed ${uniqueSeeds.length} changed paths` });
      return { matches, coverageByPath, walks: workEdges };
    },
  };
};

/** Reverse index shared by asset users and affected-unit diff queries. */
export const createGraphUserIndex = async (graph: ReferenceGraphResult, roots: readonly UnitVisualRoot[], signal?: AbortSignal) => {
  const nodes = new Map<string, ReferenceGraphResult["nodes"][number]>();
  const assetsByPath = new Map<string, ReferenceGraphResult["nodes"]>();
  let scanned = 0;
  for (const node of graph.nodes) {
    throwIfAborted(signal);
    if ((scanned++ & 255) === 0) await yieldToEventLoop(signal);
    nodes.set(node.id, node);
    if (node.type === "asset") {
      const key = normalizePackFilePathKey(node.path);
      const group = assetsByPath.get(key) ?? [];
      group.push(node);
      assetsByPath.set(key, group);
    }
  }
  const rootIds = new Set(graph.roots);
  const incoming = new Map<string, ReferenceGraphEdge[]>();
  const rootsByPath = new Map<string, UnitVisualRoot[]>();
  for (const root of roots) {
    throwIfAborted(signal);
    if ((scanned++ & 255) === 0) await yieldToEventLoop(signal);
    const key = normalizePackFilePathKey(root.path);
    const group = rootsByPath.get(key) ?? [];
    group.push(root);
    rootsByPath.set(key, group);
  }
  for (const edge of graph.edges) {
    throwIfAborted(signal);
    if ((scanned++ & 255) === 0) await yieldToEventLoop(signal);
    const group = incoming.get(edge.target) ?? [];
    group.push(edge);
    incoming.set(edge.target, group);
  }

  const owner = (id: string) => {
    const node = nodes.get(id);
    return node
      ? {
          packPath: node.provider,
          providerKind: node.providerKind,
          shadowed: node.shadowedCandidates,
          status: node.status,
        }
      : undefined;
  };

  return {
    async find(targetPath: string, maxWalks: number): Promise<{ matches: VisualRootChain[]; walked: number; limitHit: boolean }> {
      const targetKey = normalizePackFilePathKey(targetPath);
      const targets = assetsByPath.get(targetKey) ?? [];
      const matches: VisualRootChain[] = [];
      const signatures = new Set<string>();
      let walked = 0;
      for (const target of targets) {
        const queue: Array<{ id: string; reversed: ReferenceGraphEdge[]; pathIds: Set<string> }> = [
          { id: target.id, reversed: [], pathIds: new Set([target.id]) },
        ];
        let cursor = 0;
        while (cursor < queue.length) {
          throwIfAborted(signal);
          if ((walked++ & 255) === 0) await yieldToEventLoop(signal);
          if (walked > maxWalks) return { matches, walked, limitHit: true };
          const current = queue[cursor++];
          const node = nodes.get(current.id);
          if (rootIds.has(current.id) && node) {
            for (const root of rootsByPath.get(normalizePackFilePathKey(node.path)) ?? []) {
              const chain = [...current.reversed].reverse().map((edge) => ({
                from: nodes.get(edge.source)?.path ?? edge.source,
                to: nodes.get(edge.target)?.path ?? edge.target,
                fromProvider: owner(edge.source),
                toProvider: owner(edge.target),
                relationship: edge.relationship,
                sourceField: edge.sourceField,
                location: edge.location,
                conditional: edge.conditional,
              }));
              const signature = JSON.stringify([root.path, root.unitKey, root.landUnitKey, root.rootKind, root.reason, chain]);
              if (!signatures.has(signature)) {
                signatures.add(signature);
                matches.push({ root, chain });
              }
            }
          }
          for (const edge of incoming.get(current.id) ?? []) {
            if ((edge.status && edge.status !== "found") || current.pathIds.has(edge.source)) continue;
            queue.push({ id: edge.source, reversed: [...current.reversed, edge], pathIds: new Set([...current.pathIds, edge.source]) });
          }
        }
      }
      return { matches, walked, limitHit: false };
    },
  };
};
