import * as fs from "node:fs";
import * as path from "node:path";
import { AutomationError, throwIfAborted, type AutomationDiagnostic } from "./errors";
import type { AutomationContext } from "./operations";
import { deriveWorkshopContentFolder, discoverGameFolders } from "./vanilla";

/** Request fields that hold input pack paths, across all operations. */
const singlePackFields = ["packPath", "baselinePackPath", "beforePath", "afterPath"] as const;
const multiPackFields = ["packPaths", "vanillaPackPaths", "sourcePackPaths"] as const;
const WORKSHOP_STAT_CONCURRENCY = 32;

export const isBarePackName = (value: string): boolean =>
  !/[\\/]/.test(value) && !path.isAbsolute(value) && !/^[a-z]:/i.test(value) && /\.pack$/i.test(value) &&
  value !== ".pack";

interface Folders {
  dataPath?: string;
  contentFolder?: string;
  error?: string;
}

/**
 * Replaces bare pack names (e.g. "my_mod.pack") with a path, looking in the working directory,
 * then the game data folder, then the Steam workshop content folder. Mutates `request`.
 */
export const resolvePackInputs = async (
  request: Record<string, unknown>,
  context: AutomationContext,
): Promise<AutomationDiagnostic[]> => {
  const names = new Set<string>();
  for (const field of singlePackFields) {
    const value = request[field];
    if (typeof value === "string" && isBarePackName(value)) names.add(value);
  }
  for (const field of multiPackFields) {
    const value = request[field];
    if (Array.isArray(value))
      for (const item of value) if (typeof item === "string" && isBarePackName(item)) names.add(item);
  }
  if (!names.size) return [];

  const isReadableFile = async (candidate: string): Promise<string | undefined> => {
    try {
      const canonical = await context.policy.assertReadPath(candidate);
      return (await fs.promises.stat(canonical)).isFile() ? candidate : undefined;
    } catch {
      throwIfAborted(context.signal);
      return undefined;
    }
  };

  let folders: Promise<Folders> | undefined;
  const getFolders = (): Promise<Folders> =>
    (folders ??= (async () => {
      try {
        if (typeof request.gameDataPath === "string") {
          const dataPath = await context.policy.assertReadPath(request.gameDataPath);
          return { dataPath, contentFolder: deriveWorkshopContentFolder(dataPath) };
        }
        const found = await discoverGameFolders(context);
        return { dataPath: found.dataPath, contentFolder: found.contentFolder ?? deriveWorkshopContentFolder(found.dataPath) };
      } catch (error) {
        throwIfAborted(context.signal);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    })());

  let workshopItems: Promise<string[]> | undefined;
  const listWorkshopItems = (contentFolder: string): Promise<string[]> =>
    (workshopItems ??= (async () => {
      try {
        const canonical = await context.policy.assertReadPath(contentFolder);
        const entries = await fs.promises.readdir(canonical, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(contentFolder, entry.name));
      } catch {
        throwIfAborted(context.signal);
        return [];
      }
    })());

  const resolveName = async (name: string): Promise<string | undefined> => {
    // Existing behaviour: a relative path to an existing file still means that file.
    if (await isReadableFile(name)) return undefined;
    const { dataPath, contentFolder, error } = await getFolders();
    if (dataPath) {
      const inData = await isReadableFile(path.join(dataPath, name));
      if (inData) return inData;
    }
    const matches: string[] = [];
    if (contentFolder) {
      const items = await listWorkshopItems(contentFolder);
      for (let start = 0; start < items.length; start += WORKSHOP_STAT_CONCURRENCY) {
        throwIfAborted(context.signal);
        const batch = await Promise.all(
          items.slice(start, start + WORKSHOP_STAT_CONCURRENCY).map((item) => isReadableFile(path.join(item, name))),
        );
        for (const hit of batch) if (hit) matches.push(hit);
      }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1)
      throw new AutomationError("CONFLICT", `Pack name ${name} matches several workshop packs; pass a full path`, {
        candidates: matches,
      });
    throw new AutomationError(
      "INVALID_ARGUMENT",
      `Pack not found: ${name} (looked in the working directory, game data and workshop folders)`,
      { searched: [dataPath, contentFolder].filter(Boolean), ...(error ? { discoveryError: error } : {}) },
    );
  };

  const resolved = new Map<string, string>();
  for (const name of names) {
    const found = await resolveName(name);
    if (found) resolved.set(name, found);
  }
  if (!resolved.size) return [];
  const replace = (value: string) => resolved.get(value) ?? value;
  for (const field of singlePackFields) {
    const value = request[field];
    if (typeof value === "string") request[field] = replace(value);
  }
  for (const field of multiPackFields) {
    const value = request[field];
    if (Array.isArray(value)) request[field] = value.map((item) => (typeof item === "string" ? replace(item) : item));
  }
  return [...resolved].map(([name, resolvedPath]) => ({
    code: "PACK_NAME_RESOLVED",
    severity: "info" as const,
    message: `Resolved ${name} to ${resolvedPath}`,
  }));
};
