import { ChildProcess, fork } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as nodePath from "path";
import { chunkSchemaIntoRows, getDBVersion, resolveKeyValue } from "../packFileSerializer";
import { readPackIndex, readPayload } from "../packCore/packFile";
import type { Pack } from "../packFileTypes";
import { isMixerPackName } from "./mixerPack";
import type { MixerStartposWorkerRequest, MixerStartposWorkerResponse } from "./types";

/** Bump when the cached file's contents would change for the same inputs (removal rules, worker output). */
export const MIXER_STARTPOS_CACHE_VERSION = 1;
/** Bump when the ESF removal code in tools/esf changes behavior. */
export const ESF_EDITOR_REVISION = 1;
const CAMPAIGN = "wh3_main_combi";
const STARTPOS_PATH = `campaigns\\${CAMPAIGN}\\startpos.esf`;
const FACTIONS_TABLES_PREFIX = "db\\factions_tables\\";
const CACHE_DIR_NAME = "mixer-startpos";
const KEEP_CACHE_FILES = 3;
const WORKER_TIMEOUT_MS = 10 * 60 * 1000;
const WORKER_MAX_OLD_SPACE_MB = 4096;

/** Every Mixer faction key that nothing else enabled or vanilla defines. Region owners are filtered later by the worker. */
export const buildRemovalSet = (
  mixerKeys: Iterable<string>,
  otherModKeys: Iterable<string>,
  vanillaKeys: Iterable<string>,
): string[] => {
  const used = new Set([...otherModKeys, ...vanillaKeys]);
  return [...new Set(mixerKeys)].filter((key) => !used.has(key)).sort();
};

/** `key` column of every factions_tables in a pack that has had them read. */
export const readFactionKeys = (pack: Pack | undefined): Set<string> => {
  const keys = new Set<string>();
  for (const packedFile of pack?.packedFiles ?? []) {
    if (!packedFile.name.startsWith(FACTIONS_TABLES_PREFIX) || !packedFile.schemaFields) continue;
    const dbVersion = getDBVersion(packedFile);
    const keyIndex = dbVersion?.fields.findIndex((field) => field.name === "key") ?? -1;
    if (!dbVersion || keyIndex < 0) continue;
    const keyType = dbVersion.fields[keyIndex].field_type;
    for (const row of chunkSchemaIntoRows(packedFile.schemaFields, dbVersion)) {
      // A string cell is [length, text], so go through the shared resolver rather than fields[0].
      const fields = row[keyIndex]?.fields;
      const value = fields && resolveKeyValue(keyType, fields);
      if (value) keys.add(value);
    }
  }
  return keys;
};

interface TrimOptions {
  /** Enabled mods in load order, Mixer included; later entries win file conflicts. */
  sortedMods: Mod[];
  /** Vanilla packs (db.pack) as passed to the start-game pack writer. */
  vanillaMods: Mod[];
  packsData: Pack[];
  userDataPath: string;
  notify: (message: string, type?: ToastType) => void;
}

let activeWorker: ChildProcess | undefined;
const inFlight = new Map<string, Promise<Buffer | undefined>>();

export const terminateMixerStartposWorker = () => {
  activeWorker?.kill();
  activeWorker = undefined;
};

const packHasFile = (modPath: string, fileName: string) =>
  readPackIndex(modPath, { game: "wh3" }).entries.some(
    (entry) => entry.name.replaceAll("/", "\\").toLowerCase() === fileName,
  );

const runWorker = (request: MixerStartposWorkerRequest) =>
  new Promise<Extract<MixerStartposWorkerResponse, { ok: true }>>((resolve, reject) => {
    const child = fork(nodePath.join(__dirname, "mixerStartposWorker.js"), [], {
      execArgv: [`--max-old-space-size=${WORKER_MAX_OLD_SPACE_MB}`],
    });
    activeWorker = child;
    let settled = false;
    const finish = (error?: Error, response?: Extract<MixerStartposWorkerResponse, { ok: true }>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeWorker === child) activeWorker = undefined;
      child.kill();
      if (response) resolve(response);
      else reject(error ?? new Error("Worker failed"));
    };
    const timer = setTimeout(() => finish(new Error("Timed out building the Mixer startpos")), WORKER_TIMEOUT_MS);
    child.once("message", (response: MixerStartposWorkerResponse) =>
      response.ok ? finish(undefined, response) : finish(new Error(response.error)),
    );
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => finish(new Error(`Worker exited with code ${code}`)));
    child.send(request);
  });

const pruneCache = async (cacheDir: string, keepFile: string) => {
  const files = await Promise.all(
    (await fs.promises.readdir(cacheDir))
      .filter((name) => name.endsWith(".esf"))
      .map(async (name) => ({ name, mtimeMs: (await fs.promises.stat(nodePath.join(cacheDir, name))).mtimeMs })),
  );
  const stale = files
    .filter((file) => file.name !== keepFile)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(KEEP_CACHE_FILES - 1);
  await Promise.all(stale.map((file) => fs.promises.rm(nodePath.join(cacheDir, file.name), { force: true })));
};

const buildTrimmedStartpos = async (
  options: TrimOptions,
  mixerMod: Mod,
  keys: string[],
  cacheFile: string,
): Promise<Buffer> => {
  const cacheDir = nodePath.dirname(cacheFile);
  await fs.promises.mkdir(cacheDir, { recursive: true });
  options.notify(`Removing ${keys.length} unused Mixer factions (first time takes ~2 min)`);
  const pack = readPackIndex(mixerMod.path, { game: "wh3" });
  const entry = pack.entries.find((e) => e.name.replaceAll("/", "\\").toLowerCase() === STARTPOS_PATH);
  if (!entry) throw new Error(`${mixerMod.name} has no ${STARTPOS_PATH}`);
  const inputPath = `${cacheFile}.input`;
  const tempOutput = `${cacheFile}.tmp`;
  try {
    await fs.promises.writeFile(inputPath, await readPayload(pack, entry));
    const result = await runWorker({ inputPath, outputPath: tempOutput, keys });
    console.log(
      `Mixer startpos: removed ${result.removedCount} factions, kept ${result.keptRegionOwners.length} region owners`,
    );
    await fs.promises.rename(tempOutput, cacheFile);
  } finally {
    await fs.promises.rm(inputPath, { force: true });
    await fs.promises.rm(tempOutput, { force: true });
  }
  await pruneCache(cacheDir, nodePath.basename(cacheFile)).catch((error) => console.error(error));
  return fs.promises.readFile(cacheFile);
};

/**
 * Mixer's Immortal Empires startpos with every unused Mixer faction removed, or undefined when there is nothing to
 * do or it failed (a failure never blocks the launch). Built once in a worker process, then cached by input.
 */
export const getTrimmedMixerStartpos = async (options: TrimOptions): Promise<Buffer | undefined> => {
  try {
    const mixerIndex = options.sortedMods.findIndex((mod) => isMixerPackName(mod.name));
    if (mixerIndex < 0) return undefined;
    const mixerMod = options.sortedMods[mixerIndex];

    // The first pack in load order wins, so only a mod sorted before Mixer can override its startpos.
    const overridingMod = options.sortedMods
      .slice(0, mixerIndex)
      .find((mod) => mod.hasStartpos && packHasFile(mod.path, STARTPOS_PATH));
    if (overridingMod) {
      options.notify(`Not removing unused factions: ${overridingMod.name} overrides Mixer's startpos`);
      return undefined;
    }

    const packByPath = new Map(options.packsData.map((pack) => [pack.path, pack]));
    const mixerKeys = readFactionKeys(packByPath.get(mixerMod.path));
    const otherKeys = options.sortedMods
      .filter((mod) => mod.path !== mixerMod.path)
      .flatMap((mod) => [...readFactionKeys(packByPath.get(mod.path))]);
    const vanillaKeys = options.vanillaMods.flatMap((mod) => [...readFactionKeys(packByPath.get(mod.path))]);
    if (mixerKeys.size === 0) {
      console.log(`Mixer startpos: no factions_tables keys read from ${mixerMod.name}; skipping`);
      return undefined;
    }
    const keys = buildRemovalSet(mixerKeys, otherKeys, vanillaKeys);
    console.log(`Mixer startpos: ${mixerKeys.size} Mixer factions, ${keys.length} unused`);
    if (keys.length === 0) return undefined;

    const mixerStat = await fs.promises.stat(mixerMod.path);
    const hash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          MIXER_STARTPOS_CACHE_VERSION,
          ESF_EDITOR_REVISION,
          mixerMod.path,
          mixerStat.size,
          mixerMod.lastChangedLocal ?? mixerStat.mtimeMs,
          CAMPAIGN,
          keys,
        ]),
      )
      .digest("hex");
    const cacheFile = nodePath.join(options.userDataPath, CACHE_DIR_NAME, `${hash}.esf`);
    const hit = await fs.promises.readFile(cacheFile).catch(() => undefined);
    if (hit) return hit;

    let pending = inFlight.get(cacheFile);
    if (!pending) {
      pending = buildTrimmedStartpos(options, mixerMod, keys, cacheFile).finally(() => inFlight.delete(cacheFile));
      inFlight.set(cacheFile, pending);
    }
    return await pending;
  } catch (error) {
    console.error("Failed to trim Mixer startpos:", error);
    options.notify("Couldn't trim Mixer startpos; launching with Mixer's original", "warning");
    return undefined;
  }
};
