import * as fs from "fs";
import * as nodePath from "path";

export const LEGACY_WORKSHOP_BIN_REGEX = /_legacy\.bin$/i;

export const isLegacyWorkshopBin = (name: string) => LEGACY_WORKSHOP_BIN_REGEX.test(name);

const DETAILS_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const FETCH_TIMEOUT_MS = 5000;

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; json: () => Promise<any> }>;

/** Resolves the original pack name of a legacy workshop item via Steam's public API. */
export async function resolveLegacyPackName(
  workshopId: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<string> {
  const fallback = `${workshopId}.pack`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(DETAILS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `itemcount=1&publishedfileids[0]=${encodeURIComponent(workshopId)}`,
      signal: controller.signal,
    });
    if (!response.ok) return fallback;
    const json = await response.json();
    const filename = json?.response?.publishedfiledetails?.[0]?.filename;
    if (typeof filename !== "string") return fallback;
    const name = nodePath.posix.basename(filename.replaceAll("\\", "/")).trim();
    if (!/\.pack$/i.test(name) || name.length <= 5 || /[<>:"/\\|?*\u0000-\u001f]/.test(name)) return fallback;
    return name;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

const inFlight = new Map<string, Promise<string | undefined>>();

/**
 * Legacy (Shogun 2) workshop items download as `<ugchandle>_legacy.bin`. Creates a hardlink (or copy)
 * named after the original pack next to it. Returns the pack file name if one was created.
 */
export function ensureLegacyWorkshopPack(
  contentSubfolder: string,
  workshopId: string,
  log: (msg: string) => void,
  fetchImpl?: FetchLike,
): Promise<string | undefined> {
  const key = nodePath.resolve(contentSubfolder);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = createLegacyPack(contentSubfolder, workshopId, log, fetchImpl).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function createLegacyPack(
  contentSubfolder: string,
  workshopId: string,
  log: (msg: string) => void,
  fetchImpl?: FetchLike,
): Promise<string | undefined> {
  const files = await fs.promises.readdir(contentSubfolder);
  if (files.some((file) => /\.pack$/i.test(file))) return undefined;
  const bin = files.find(isLegacyWorkshopBin);
  if (!bin) return undefined;

  const packName = await resolveLegacyPackName(workshopId, fetchImpl);
  const binPath = nodePath.join(contentSubfolder, bin);
  const packPath = nodePath.join(contentSubfolder, packName);
  try {
    await fs.promises.link(binPath, packPath);
    log(`Linked legacy workshop file ${bin} as ${packName}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return packName;
    try {
      await fs.promises.copyFile(binPath, packPath, fs.constants.COPYFILE_EXCL);
      log(`Copied legacy workshop file ${bin} as ${packName}`);
    } catch (copyErr) {
      if ((copyErr as NodeJS.ErrnoException).code === "EEXIST") return packName;
      log(`ERROR: could not create ${packName} from ${bin}: ${copyErr}`);
      return undefined;
    }
  }
  return packName;
}
