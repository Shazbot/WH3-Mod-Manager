import * as fs from "fs";
import * as nodePath from "path";

const SCRIPT_LOG_PREFIX = "script_log_";

export const findLatestScriptLog = async (gamePath: string): Promise<string | undefined> => {
  const entries = await fs.promises.readdir(gamePath, { withFileTypes: true });
  const candidates = entries.filter(
    (entry) => entry.isFile() && entry.name.startsWith(SCRIPT_LOG_PREFIX),
  );

  const candidatesWithModifiedTimes = await Promise.all(
    candidates.map(async (entry) => {
      const filePath = nodePath.join(gamePath, entry.name);
      const stats = await fs.promises.stat(filePath);
      return { filePath, modifiedTime: stats.mtimeMs };
    }),
  );

  candidatesWithModifiedTimes.sort(
    (first, second) =>
      second.modifiedTime - first.modifiedTime || second.filePath.localeCompare(first.filePath),
  );
  return candidatesWithModifiedTimes[0]?.filePath;
};
