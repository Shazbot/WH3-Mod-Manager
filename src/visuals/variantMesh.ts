import { XMLParser } from "fast-xml-parser";
import { normalizePackFilePath } from "../utility/packFilePathUtils";

/** A choice made in one VMD slot. The path is structural so it remains stable across labels. */
export interface VariantMeshSelection {
  slotPath: string;
  choiceIndex: number;
}

export interface VariantMeshChoice {
  /** Index in the VMD's effective candidate order: inline meshes first, then references. */
  index: number;
  key: string;
  label: string;
  targetPath?: string;
  kind: "inline" | "reference";
}

export interface VariantMeshSlot {
  /** Structural path, for example root/slot[0]/choice[1]/slot[0]. */
  slotPath: string;
  name: string;
  label: string;
  attachmentPoint?: string;
  choices: VariantMeshChoice[];
  defaultChoiceIndex: number;
  /** The parent choice must be selected for this slot to exist in the composition. */
  parent?: VariantMeshSelection;
}

export interface VariantMeshCatalog {
  assetPath: string;
  slots: VariantMeshSlot[];
  combinationCount: number;
  combinationCountCapped: boolean;
  diagnostics: string[];
}

export interface VariantMeshCatalogResponse {
  success: boolean;
  catalog?: VariantMeshCatalog;
  error?: string;
}

type RawVariantMesh = {
  [key: string]: unknown;
  "@_model"?: unknown;
  SLOT?: unknown;
};

type RawSlot = {
  [key: string]: unknown;
  "@_name"?: unknown;
  "@_attach_point"?: unknown;
  VARIANT_MESH?: unknown;
  VARIANT_MESH_REFERENCE?: unknown;
};

type RawVariantMeshReference = {
  "@_definition"?: unknown;
};

type ResolvedVariantMeshNode = {
  definitionPath: string;
  modelPath?: string;
  /** An inline model attribute that points at another VMD. */
  modelDefinition?: ResolvedVariantMeshNode;
  slots: ResolvedVariantMeshSlot[];
};

type ResolvedVariantMeshCandidate = {
  index: number;
  kind: "inline" | "reference";
  targetPath?: string;
  node?: ResolvedVariantMeshNode;
};

type ResolvedVariantMeshSlot = {
  name: string;
  attachmentPoint?: string;
  candidates: ResolvedVariantMeshCandidate[];
};

type ReadVariantMeshDefinition = (assetPath: string) => Promise<string | undefined>;

const MAX_COMBINATION_COUNT = 1_000_000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  isArray: (name) => name === "SLOT" || name === "VARIANT_MESH" || name === "VARIANT_MESH_REFERENCE",
});

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? value : value == null ? [] : [value as T]);

const normalizePath = (value: unknown) => normalizePackFilePath(asString(value));

const isVariantMeshDefinitionPath = (value: string) => value.toLowerCase().endsWith(".variantmeshdefinition");

const fileNameOf = (value: string) => value.split("\\").pop() || value;

const labelOfPath = (value: string | undefined, fallback: string) => {
  if (!value) return fallback;
  const fileName = fileNameOf(value).replace(/\.(?:variantmeshdefinition|rigid_model_v2|wsmodel)$/i, "");
  return (
    fileName
      .replace(/[_.-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) || fallback
  );
};

const slotLabel = (name: string, index: number) => labelOfPath(name, `Slot ${index + 1}`);

const parseRoot = (text: string, assetPath: string): RawVariantMesh => {
  const parsed = xmlParser.parse(text) as Record<string, unknown>;
  const root = parsed.VARIANT_MESH;
  const rootObject = Array.isArray(root) ? root[0] : root;
  if (!rootObject || typeof rootObject !== "object") {
    throw new Error(`No VARIANT_MESH root was found in '${assetPath}'.`);
  }
  return rootObject as RawVariantMesh;
};

const cappedMultiply = (first: number, second: number, capped: { value: boolean }) => {
  if (first === 0 || second === 0) return 0;
  if (first > MAX_COMBINATION_COUNT / second) {
    capped.value = true;
    return MAX_COMBINATION_COUNT;
  }
  return first * second;
};

const combinationCountOf = (node: ResolvedVariantMeshNode, capped: { value: boolean }): number => {
  let count = node.modelDefinition ? combinationCountOf(node.modelDefinition, capped) : 1;
  for (const slot of node.slots) {
    if (slot.candidates.length === 0) continue;
    let slotCount = 0;
    for (const candidate of slot.candidates) {
      const candidateCount = candidate.node ? combinationCountOf(candidate.node, capped) : 1;
      slotCount = Math.min(MAX_COMBINATION_COUNT, slotCount + candidateCount);
      if (slotCount === MAX_COMBINATION_COUNT) capped.value = true;
    }
    count = cappedMultiply(count, slotCount, capped);
  }
  return count;
};

/** Returns only slots whose parent choices are active in the supplied selection. */
export const getActiveVariantMeshSlots = (
  catalog: VariantMeshCatalog,
  selections: Readonly<Record<string, number>>,
): VariantMeshSlot[] => {
  const slotsByPath = new Map(catalog.slots.map((slot) => [slot.slotPath, slot]));
  const activeCache = new Map<string, boolean>();
  const isActive = (slot: VariantMeshSlot): boolean => {
    const cached = activeCache.get(slot.slotPath);
    if (cached !== undefined) return cached;
    const parent = slot.parent;
    const active =
      !parent ||
      (slotsByPath.has(parent.slotPath) &&
        isActive(slotsByPath.get(parent.slotPath)!) &&
        (selections[parent.slotPath] ?? slotsByPath.get(parent.slotPath)!.defaultChoiceIndex) === parent.choiceIndex);
    activeCache.set(slot.slotPath, active);
    return active;
  };
  return catalog.slots.filter(isActive);
};

/** Builds a selectable catalog while leaving model export and selection application to the host. */
export const buildVariantMeshCatalog = async (
  assetPath: string,
  readDefinition: ReadVariantMeshDefinition,
): Promise<VariantMeshCatalog> => {
  const normalizedAssetPath = normalizePath(assetPath);
  const diagnostics: string[] = [];
  const definitionCache = new Map<string, Promise<ResolvedVariantMeshNode | undefined>>();
  const activeDefinitions: string[] = [];

  const readText = async (path: string) => {
    try {
      return await readDefinition(path);
    } catch (error) {
      diagnostics.push(
        `Unable to read VariantMeshDefinition '${path}': ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  };

  const parseNode = async (raw: RawVariantMesh, ownerPath: string): Promise<ResolvedVariantMeshNode> => {
    const modelPath = normalizePath(raw["@_model"]);
    const node: ResolvedVariantMeshNode = {
      definitionPath: ownerPath,
      modelPath: modelPath || undefined,
      slots: [],
    };

    if (modelPath && isVariantMeshDefinitionPath(modelPath)) {
      node.modelDefinition = await resolveDefinition(modelPath, `model reference in '${ownerPath}'`);
    }

    for (const rawSlot of asArray<RawSlot>(raw.SLOT)) {
      const slotName = asString(rawSlot["@_name"]);
      if (slotName.toLowerCase().startsWith("stump_")) continue;

      const slot: ResolvedVariantMeshSlot = {
        name: slotName,
        attachmentPoint: asString(rawSlot["@_attach_point"]) || undefined,
        candidates: [],
      };

      let candidateIndex = 0;
      // The game loader keeps these as separate collections and resolves inline meshes first.
      for (const rawChild of asArray<RawVariantMesh>(rawSlot.VARIANT_MESH)) {
        slot.candidates.push({
          index: candidateIndex++,
          kind: "inline",
          targetPath: normalizePath(rawChild["@_model"]) || undefined,
          node: await parseNode(rawChild, ownerPath),
        });
      }
      for (const rawReference of asArray<RawVariantMeshReference>(rawSlot.VARIANT_MESH_REFERENCE)) {
        const targetPath = normalizePath(rawReference["@_definition"]) || undefined;
        const node =
          targetPath && isVariantMeshDefinitionPath(targetPath)
            ? await resolveDefinition(targetPath, `slot '${slot.name}' in '${ownerPath}'`)
            : targetPath
              ? { definitionPath: targetPath, modelPath: targetPath, slots: [] }
              : undefined;
        slot.candidates.push({ index: candidateIndex++, kind: "reference", targetPath, node });
      }
      node.slots.push(slot);
    }
    return node;
  };

  const resolveDefinition = (path: string, context: string): Promise<ResolvedVariantMeshNode | undefined> => {
    const normalizedPath = normalizePath(path);
    if (!normalizedPath) {
      diagnostics.push(`Empty VariantMeshDefinition reference in ${context}.`);
      return Promise.resolve(undefined);
    }
    if (activeDefinitions.includes(normalizedPath.toLowerCase())) {
      const cycle = [...activeDefinitions, normalizedPath.toLowerCase()].join(" -> ");
      diagnostics.push(`VariantMeshDefinition cycle detected while resolving ${context}: ${cycle}.`);
      return Promise.resolve(undefined);
    }
    const cached = definitionCache.get(normalizedPath.toLowerCase());
    if (cached) return cached;

    const promise = (async () => {
      activeDefinitions.push(normalizedPath.toLowerCase());
      try {
        const text = await readText(normalizedPath);
        if (!text) {
          diagnostics.push(`VariantMeshDefinition '${normalizedPath}' was not found while resolving ${context}.`);
          return undefined;
        }
        let raw: RawVariantMesh;
        try {
          raw = parseRoot(text, normalizedPath);
        } catch (error) {
          diagnostics.push(
            `Unable to parse VariantMeshDefinition '${normalizedPath}': ${error instanceof Error ? error.message : String(error)}`,
          );
          return undefined;
        }
        return await parseNode(raw, normalizedPath);
      } finally {
        activeDefinitions.pop();
      }
    })();
    definitionCache.set(normalizedPath.toLowerCase(), promise);
    return promise;
  };

  const root = await resolveDefinition(normalizedAssetPath, "root");
  if (!root) {
    return {
      assetPath: normalizedAssetPath,
      slots: [],
      combinationCount: 1,
      combinationCountCapped: false,
      diagnostics,
    };
  }

  const slots: VariantMeshSlot[] = [];
  const collectSlots = (node: ResolvedVariantMeshNode, nodePath: string, parent: VariantMeshSelection | undefined) => {
    if (node.modelDefinition) collectSlots(node.modelDefinition, `${nodePath}/model`, parent);
    node.slots.forEach((slot, slotIndex) => {
      const slotPath = `${nodePath}/slot[${slotIndex}]`;
      const choices = slot.candidates.map((candidate) => ({
        index: candidate.index,
        key: `${slotPath}/choice[${candidate.index}]`,
        label: labelOfPath(candidate.targetPath, `Variant ${candidate.index + 1}`),
        targetPath: candidate.targetPath,
        kind: candidate.kind,
      }));
      slots.push({
        slotPath,
        name: slot.name || `slot_${slotIndex + 1}`,
        label: slotLabel(slot.name, slotIndex),
        attachmentPoint: slot.attachmentPoint,
        choices,
        defaultChoiceIndex: choices[0]?.index ?? 0,
        parent,
      });
      for (const candidate of slot.candidates) {
        if (candidate.node) {
          collectSlots(candidate.node, `${slotPath}/choice[${candidate.index}]`, {
            slotPath,
            choiceIndex: candidate.index,
          });
        }
      }
    });
  };
  collectSlots(root, "root", undefined);

  const capped = { value: false };
  const combinationCount = combinationCountOf(root, capped);
  return {
    assetPath: normalizedAssetPath,
    slots,
    combinationCount,
    combinationCountCapped: capped.value,
    diagnostics,
  };
};
