import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { AutomationError, throwIfAborted, yieldToEventLoop, type AutomationDiagnostic } from "./errors";
import { prepareReferenceEnvironment, resolveReferenceAsset } from "./references";
import { normalizeInternalPackPath } from "./filesystem";
import { createIncomingVisualReferenceIndex, type VisualRootChain } from "./graphUsers";
import { collectUnitVisualIndex } from "./units";
import { collectUnitVisualRoots } from "./visualRoots";
import { vanillaInputs } from "./vanilla";
import type { AutomationContext } from "./operations";

export const assetUsersSchema = z
  .object({
    operation: z.literal("asset_users"),
    packPath: z.string().min(1),
    packPaths: z.array(z.string().min(1)).max(512).default([]),
    ...vanillaInputs,
    targetPath: z.string().min(1).optional(),
    targetPaths: z.array(z.string().min(1)).min(1).max(1000).optional(),
    maxDepth: z.number().int().min(0).max(32).default(32),
    maxNodes: z.number().int().min(1).max(10000).default(10000),
    maxEdges: z.number().int().min(1).max(50000).default(50000),
    maxRoots: z.number().int().min(1).max(10000).default(10000),
    maxWorkNodes: z.number().int().min(1).max(1000000).default(100000),
    maxWorkEdges: z.number().int().min(1).max(5000000).default(500000),
    maxScanSources: z.number().int().min(1).max(5000000).default(1000000),
    maxIndexEdges: z.number().int().min(1).max(5000000).default(1000000),
    unitKeys: z.array(z.string().min(1).max(256)).min(1).max(256).optional()
      .describe("Exact main-unit or land-unit keys to scan, matched case-insensitively."),
    rootGlob: z.string().min(1).max(512).optional()
      .describe("Case-insensitive glob matched against each normalized full internal visual-root path."),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(1000).default(100),
    reportPath: z.string().min(1).optional(),
  })
  .strict();

type Request = z.output<typeof assetUsersSchema>;

const pathKey = (value: string) => normalizePackFilePathKey(normalizeInternalPackPath(value));
const normalizeRootGlob = (value: string): string => {
  if (
    !value || value.includes("\0") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value)
  ) {
    throw new AutomationError("INVALID_ARGUMENT", `Invalid visual root glob: ${JSON.stringify(value)}`);
  }
  const normalized = value.replace(/\\/g, "/");
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new AutomationError("INVALID_ARGUMENT", `Visual root glob cannot contain parent segments: ${value}`);
  }
  return normalized.toLowerCase();
};
const samePhysicalPath = (left: string, right: string) => {
  const leftPath = path.resolve(left);
  const rightPath = path.resolve(right);
  return process.platform === "win32" ? leftPath.toLowerCase() === rightPath.toLowerCase() : leftPath === rightPath;
};

export const runAssetUsers = async (request: Request, context: AutomationContext, useCatalog = true): Promise<{
  data: Record<string, unknown>; diagnostics: AutomationDiagnostic[];
}> => {
  if (Boolean(request.targetPath) === Boolean(request.targetPaths))
    throw new AutomationError("INVALID_ARGUMENT", "asset users requires exactly one of targetPath or targetPaths");
  const targetPaths = (request.targetPaths ?? [request.targetPath!]).map((value) => normalizeInternalPackPath(value));
  const targetPackPath = path.resolve(request.packPath);
  const normalizedUnitKeys = request.unitKeys
    ? [...new Set(request.unitKeys.map((key) => key.toLowerCase()))].sort()
    : undefined;
  const unitKeyFilter = normalizedUnitKeys ? new Set(normalizedUnitKeys) : undefined;
  const normalizedRootGlob = request.rootGlob === undefined ? undefined : normalizeRootGlob(request.rootGlob);
  const environment = await prepareReferenceEnvironment(
    context,
    [...request.packPaths.filter((candidate) => !samePhysicalPath(candidate, request.packPath)), request.packPath],
    request.vanillaPackPaths,
    request.gameDataPath,
    request.withVanilla,
    true,
  );
  const diagnostics: AutomationDiagnostic[] = [];
  const usageDiagnostics: AutomationDiagnostic[] = [];
  const metadataDiagnostics: AutomationDiagnostic[] = [];
  const diagnosticSets = new Map<AutomationDiagnostic[], Set<string>>([
    [diagnostics, new Set()],
    [usageDiagnostics, new Set()],
    [metadataDiagnostics, new Set()],
  ]);
  const addDiagnostics = (target: AutomationDiagnostic[], items: readonly AutomationDiagnostic[]) => {
    const targetSet = diagnosticSets.get(target)!;
    const combinedSet = diagnosticSets.get(diagnostics)!;
    for (const item of items) {
      const signature = `${item.code}\0${item.path ?? ""}\0${item.message}`;
      if (!targetSet.has(signature)) {
        targetSet.add(signature);
        target.push(item);
      }
      if (target !== diagnostics && !combinedSet.has(signature)) {
        combinedSet.add(signature);
        diagnostics.push(item);
      }
    }
  };
  const addUsageDiagnostics = (items: readonly AutomationDiagnostic[]) => addDiagnostics(usageDiagnostics, items);
  const addMetadataDiagnostics = (items: readonly AutomationDiagnostic[]) => addDiagnostics(metadataDiagnostics, items);
  let rootScan = await collectUnitVisualRoots(environment, useCatalog, unitKeyFilter);
  addUsageDiagnostics(environment.diagnostics);
  const discoveredUnitRoots = rootScan.roots;
  const groupRootsByPath = (roots: readonly typeof discoveredUnitRoots[number][]) => {
    const groups = new Map<string, typeof discoveredUnitRoots>();
    for (const root of roots) {
      const key = pathKey(root.path);
      const group = groups.get(key) ?? [];
      group.push(root);
      groups.set(key, group);
    }
    return groups;
  };
  const discoveredRootGroups = groupRootsByPath(discoveredUnitRoots);
  let filteredUnitRoots = discoveredUnitRoots;
  if (normalizedRootGlob !== undefined) {
    try {
      filteredUnitRoots = discoveredUnitRoots.filter((root) =>
        path.posix.matchesGlob(pathKey(root.path).replace(/\\/g, "/").toLowerCase(), normalizedRootGlob),
      );
    } catch (error) {
      throw new AutomationError("INVALID_ARGUMENT", `Invalid visual root glob: ${request.rootGlob}`, error);
    }
  }
  const filteredRootGroups = groupRootsByPath(filteredUnitRoots);
  const targetRootPaths = new Set(targetPaths.map(pathKey));
  const rankedRoots = [...filteredRootGroups].map(([key, roots], index) => {
    const provider = resolveReferenceAsset(environment, roots[0].path).winner?.provider;
    const rank = targetRootPaths.has(key) ? 0 : provider
      ? samePhysicalPath(provider.pack.path, targetPackPath) ? 1 : provider.kind === "mod" ? 2 : 3
      : 4;
    return { key, roots, index, rank };
  }).sort((left, right) => left.rank - right.rank || left.index - right.index);
  const selectedRootGroups = rankedRoots.slice(0, request.maxRoots);
  const selectedUnitRoots = selectedRootGroups.flatMap((item) => item.roots);
  const rootLimitHit = rankedRoots.length > request.maxRoots;
  if (rootLimitHit) addUsageDiagnostics([{
    code: "ASSET_USER_ROOT_LIMIT",
    message: `Unit visual root scan reached maxRoots (${request.maxRoots})`,
    severity: "warning",
  }]);
  const index = await createIncomingVisualReferenceIndex(environment, selectedUnitRoots.length ? targetPaths : [], {
    maxSources: request.maxScanSources,
    maxIndexEdges: request.maxIndexEdges,
  });
  addUsageDiagnostics(index.diagnostics);
  const traversal = await index.findMany(targetPaths, selectedUnitRoots, {
    maxDepth: request.maxDepth,
    maxNodes: request.maxNodes,
    maxEdges: request.maxEdges,
    maxWorkNodes: request.maxWorkNodes,
    maxWorkEdges: request.maxWorkEdges,
  });
  let usageComplete = environment.complete && !rootLimitHit && index.complete &&
    [...traversal.coverageByPath.values()].every((coverage) => coverage.complete);
  let metadataComplete = true;
  let metadataRequested = false;
  let metadataMissingTables: string[] = [];
  const usersByTarget = new Map<string, Map<string, Record<string, unknown> & { roots: unknown[] }>>();
  const rootSignatures = new Map<string, Set<string>>();
  for (const targetPath of targetPaths) {
    const key = pathKey(targetPath);
    const users = usersByTarget.get(key) ?? new Map<string, Record<string, unknown> & { roots: unknown[] }>();
    usersByTarget.set(key, users);
    for (const { root, chain } of traversal.matches.get(key) ?? []) {
      const identity = `${root.unitKey}\0${root.landUnitKey}`;
      const user = users.get(identity) ?? {
        unitKey: root.unitKey || null,
        mainUnitKey: root.unitKey || null,
        landUnitKey: root.landUnitKey,
        localizedName: root.localizedName,
        locKey: root.locKey,
        roster: { scopeSource: root.scopeSource, unscoped: root.unscoped, factions: root.factions,
          customBattlePermissions: root.customBattlePermissions },
        campaignRules: root.campaignRules,
        conditionalCharacterArtCandidates: root.characterArtCandidates,
        roots: [],
      };
      const signatures = rootSignatures.get(`${key}\0${identity}`) ?? new Set<string>();
      rootSignatures.set(`${key}\0${identity}`, signatures);
      const evidence = { path: root.path, rootKind: root.rootKind, reason: root.reason, evidence: root.evidence, chain };
      const signature = JSON.stringify(evidence);
      if (!signatures.has(signature)) { signatures.add(signature); user.roots.push(evidence); }
      users.set(identity, user);
    }
  }
  const allMatchedUsers = new Map<string, Record<string, unknown> & { roots: unknown[] }>();
  for (const users of usersByTarget.values()) for (const [identity, user] of users) allMatchedUsers.set(identity, user);
  if (allMatchedUsers.size) {
    metadataRequested = true;
    const matchedKeys = new Set([...allMatchedUsers.values()].map((user) => String(user.unitKey)).filter(Boolean));
    const metadataEnvironment = { ...environment, complete: true, diagnostics: [] as AutomationDiagnostic[] };
    const detailed = await collectUnitVisualIndex(metadataEnvironment, matchedKeys);
    metadataMissingTables = [...new Set(detailed.missingTables)].sort();
    metadataComplete = metadataEnvironment.complete && metadataMissingTables.length === 0;
    addMetadataDiagnostics(metadataEnvironment.diagnostics);
    const rootKey = (unit: string, land: string, root: { path: string; rootKind: string; reason: string }) =>
      JSON.stringify([unit, land, pathKey(root.path), root.rootKind, root.reason]);
    const detailedRoots = new Map(detailed.roots.map((root) => [rootKey(root.unitKey, root.landUnitKey, root), root]));
    let sourceMismatch = false;
    for (const users of usersByTarget.values()) for (const [identity, user] of users) {
      const detail = detailed.units.find((item) => item.unitKey === user.unitKey && item.landUnitKey === user.landUnitKey);
      if (!detail) {
        sourceMismatch = true;
        metadataComplete = false;
        addMetadataDiagnostics([{ code: "UNIT_VISUAL_EVIDENCE_MISSING", message: `Source evidence could not confirm unit ${user.unitKey}`, severity: "warning" }]);
        users.delete(identity);
        continue;
      }
      user.localizedName = detail.localizedName;
      user.locKey = detail.locKey;
      user.roster = { scopeSource: detail.scopeSource, unscoped: detail.unscoped, factions: detail.factions,
        customBattlePermissions: detail.customBattlePermissions };
      user.campaignRules = detail.campaignRules;
      user.conditionalCharacterArtCandidates = detail.characterArtCandidates;
      const confirmed: unknown[] = [];
      for (const raw of user.roots) {
        const root = raw as { path: string; rootKind: string; reason: string; evidence: unknown[] };
        const exact = detailedRoots.get(rootKey(String(user.unitKey), String(user.landUnitKey), root));
        if (!exact) {
          sourceMismatch = true;
          metadataComplete = false;
          addMetadataDiagnostics([{ code: "UNIT_VISUAL_EVIDENCE_MISSING", message: `Source evidence could not confirm ${root.path} for unit ${user.unitKey}`, severity: "warning" }]);
          continue;
        }
        root.evidence = exact.evidence;
        confirmed.push(root);
      }
      user.roots = confirmed;
      if (!confirmed.length) users.delete(identity);
    }
    if (sourceMismatch && useCatalog && (environment.usedVisualCatalog || metadataEnvironment.usedVisualCatalog))
      return runAssetUsers(request, context, false);
  }
  addUsageDiagnostics(environment.diagnostics);
  usageComplete = usageComplete && environment.complete;
  const complete = usageComplete && metadataComplete;
  const modPackPaths = [...new Set(environment.providers.filter((provider) => provider.kind === "mod").map((provider) => provider.pack.path))];
  const vanillaPackPaths = [...new Set(environment.providers.filter((provider) => provider.kind === "vanilla").map((provider) => provider.pack.path))];
  const targetResults = targetPaths.map((targetPath) => {
    const key = pathKey(targetPath);
    const resolution = resolveReferenceAsset(environment, targetPath, false);
    const candidateProviders = resolution.candidates.map((candidate) => ({
      packPath: candidate.provider.pack.path,
      filePath: candidate.entry.name,
      providerKind: candidate.provider.kind,
      role: samePhysicalPath(candidate.provider.pack.path, targetPackPath) ? "target" : "support",
      order: candidate.provider.order,
      status: resolution.status === "ambiguous" && candidate.provider.order === candidateProvidersOrder(resolution.candidates)
        ? "ambiguous" : candidate === resolution.winner ? "effective" : "shadowed",
    }));
    const users = [...(usersByTarget.get(key)?.values() ?? [])].sort((a, b) => String(a.unitKey).localeCompare(String(b.unitKey)));
    const pathCoverage = traversal.coverageByPath.get(key);
    const unsupported = pathCoverage?.status === "unsupported";
    const targetUsageComplete = !unsupported && environment.complete && !rootLimitHit && index.complete && Boolean(pathCoverage?.complete);
    const status = unsupported ? "unsupported" : users.length ? "matched" : targetUsageComplete ? "noMatch" : "incomplete";
    return {
      targetPath,
      resolution: resolution.status,
      fileProviders: candidateProviders.map(({ order: _order, ...candidate }) => candidate),
      complete: targetUsageComplete && metadataComplete,
      usageComplete: targetUsageComplete,
      metadataComplete,
      changedPathCoverage: { status, complete: targetUsageComplete, walks: pathCoverage?.walks ?? 0,
        ...(pathCoverage?.limitReason ? { limitReason: pathCoverage.limitReason } : {}) },
      total: users.length,
      offset: request.offset,
      limit: request.limit,
      nextOffset: request.offset + request.limit < users.length ? request.offset + request.limit : null,
      hasMore: request.offset + request.limit < users.length,
      users,
    };
  });
  const totalMatchedRoots = [...usersByTarget.values()].reduce((sum, users) =>
    sum + [...users.values()].reduce((userCount, user) => userCount + user.roots.length, 0), 0);
  const metadataCoverage = {
    requested: metadataRequested,
    complete: metadataComplete,
    missingTables: metadataMissingTables,
    diagnostics: metadataDiagnostics,
  };
  const coverage = {
    scope: {
      unitKeys: normalizedUnitKeys ?? null,
      rootGlob: normalizedRootGlob ?? null,
      packScope: { targetPack: targetPackPath, modPackPaths, vanillaPackPaths },
    },
    units: { total: rootScan.totalUnits, selected: rootScan.selectedUnits, scanned: rootScan.scannedUnits },
    roots: { discovered: discoveredRootGroups.size, filtered: filteredRootGroups.size, unique: filteredRootGroups.size,
      selected: selectedRootGroups.length, scanned: selectedRootGroups.length, indexedSources: index.scannedSources },
    budgets: {
      maxDepth: request.maxDepth, maxNodes: request.maxNodes, maxEdges: request.maxEdges, maxRoots: request.maxRoots,
      maxWorkNodes: request.maxWorkNodes, maxWorkEdges: request.maxWorkEdges,
      maxScanSources: request.maxScanSources, maxIndexEdges: request.maxIndexEdges,
    },
    unitVisualRoots: filteredRootGroups.size,
    uniqueRoots: filteredRootGroups.size,
    processedRoots: selectedRootGroups.length,
    matchedRoots: totalMatchedRoots,
    nodes: selectedRootGroups.length,
    edges: index.edges,
    reversePathWalks: traversal.walks,
    maxWorkNodes: request.maxWorkNodes,
    maxWorkEdges: request.maxWorkEdges,
  };
  const batch = targetPaths.length > 1 || Boolean(request.targetPaths);
  const pageTargets = targetResults.map((target) => ({ ...target, users: target.users.slice(request.offset, request.offset + request.limit) }));
  const full: Record<string, unknown> = batch ? {
    packPath: targetPackPath,
    targetPaths,
    complete,
    usageComplete,
    metadataComplete,
    metadataCoverage,
    coverage,
    usageDiagnostics,
    diagnostics,
    totalTargets: targetPaths.length,
    targets: pageTargets,
  } : {
    packPath: targetPackPath,
    ...pageTargets[0],
    complete,
    usageComplete,
    metadataComplete,
    metadataCoverage,
    coverage: {
      ...coverage,
      budgets: { ...coverage.budgets, maxWorkNodes: request.maxWorkNodes, maxWorkEdges: request.maxWorkEdges },
    },
    usageDiagnostics,
    diagnostics,
  };
  let reportPath: string | undefined;
  if (request.reportPath) {
    const report = await context.policy.withAtomicOutput({
      outputPath: request.reportPath,
      sourcePaths: environment.sourcePaths,
      produce: async (temporaryPath) => fs.writeFile(temporaryPath, `${JSON.stringify(batch ? {
        ...full,
        targets: targetResults,
      } : { ...full, users: targetResults[0].users }, null, 2)}\n`),
    });
    reportPath = report.path;
  }
  return { data: { ...full, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};

const candidateProvidersOrder = <T extends { provider: { order: number } }>(candidates: readonly T[]) =>
  Math.max(...candidates.map((candidate) => candidate.provider.order));
