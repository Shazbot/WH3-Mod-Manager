import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { AutomationError, throwIfAborted } from "./errors";
import type { AutomationContext } from "./operations";

export const vanillaInputs = {
  vanillaPackPaths: z.array(z.string().min(1)).max(512).optional(),
  gameDataPath: z
    .string()
    .min(1)
    .optional()
    .describe("WH3 data directory containing manifest.txt; overrides automatic discovery."),
  withVanilla: z
    .boolean()
    .default(false)
    .describe(
      "Include base game manifest packs. Discover data via gameDataPath, WHMM_GAME_DATA_PATH, or WHMM saved WH3 configuration. Mods retain priority.",
    ),
};

/** Read only WH3's saved data path; do not import Electron or the GUI config loader. */
export const discoverGameDataPath = async (context: AutomationContext): Promise<string> => {
  const env = process.env;
  if (env.WHMM_GAME_DATA_PATH) return env.WHMM_GAME_DATA_PATH;
  const configRoot =
    process.platform === "win32"
      ? env.APPDATA
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : (env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"));
  if (configRoot) {
    try {
      const config = JSON.parse(
        (await context.policy.readFile(path.join(configRoot, "wh3mm", "config.json"))).bytes.toString("utf8"),
      );
      const dataFolder = config?.gameFolderPaths?.wh3?.dataFolder ?? config?.appFolderPaths?.dataFolder;
      if (typeof dataFolder === "string" && dataFolder.length) return dataFolder;
    } catch {
      // Optional discovery may be unavailable under restricted MCP read roots.
      throwIfAborted(context.signal);
    }
  }
  throw new AutomationError(
    "INVALID_ARGUMENT",
    "Could not discover WH3 game data. Supply --game-data <directory> (gameDataPath in MCP/JSON), set WHMM_GAME_DATA_PATH, or configure WH3 in WHMM.",
  );
};
