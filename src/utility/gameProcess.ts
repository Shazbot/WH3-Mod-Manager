import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const MINIMUM_GAME_RSS_KB = 10_000;
const LINUX_GAME_NICENESS = -5;

/** Prefers the tool's own stderr, which says why it refused, over a generic "command failed". */
const describeCommandError = (error: unknown): string => {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
};

export type ProcessPriorityResult = {
  changed: boolean;
  /** Set when raising the priority was attempted and refused, so the caller can say so. */
  error?: string;
};

const parseLinuxProcesses = (output: string, processName: string): number[] => {
  const normalizedName = processName.toLowerCase();
  const pids: number[] = [];

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;

    const pid = Number(match[1]);
    const residentSetSizeKb = Number(match[2]);
    const commandLine = match[3].toLowerCase();
    if (residentSetSizeKb > MINIMUM_GAME_RSS_KB && commandLine.includes(normalizedName)) {
      pids.push(pid);
    }
  }

  return pids;
};

export const findGameProcessIds = async (processName: string, platform = process.platform): Promise<number[]> => {
  if (platform === "win32") {
    const { stdout } = await execFileAsync("tasklist", [
      "/nh",
      "/fi",
      `IMAGENAME eq ${processName}`,
      "/fi",
      `MEMUSAGE gt ${MINIMUM_GAME_RSS_KB}`,
    ]);
    return String(stdout).includes(processName) ? [-1] : [];
  }

  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,rss=,args="], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseLinuxProcesses(String(stdout), processName);
};

/**
 * Raises the running game's scheduling priority. Reports refusals rather than throwing: on Linux
 * lowering a nice value needs CAP_SYS_NICE or a raised RLIMIT_NICE, which a desktop session does
 * not normally grant, so being turned down is an ordinary outcome the user should hear about.
 */
export const setGameProcessPriority = async (
  processName: string,
  processIds: number[],
  platform = process.platform,
): Promise<ProcessPriorityResult> => {
  if (processIds.length === 0) return { changed: false };

  if (platform === "win32") {
    const processBaseName = processName.replace(/\.exe$/i, "");
    try {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Get-Process -Name '${processBaseName}' | ForEach-Object { $_.PriorityClass = 'High' }`,
      ]);
      return { changed: true };
    } catch (error) {
      return { changed: false, error: describeCommandError(error) };
    }
  }

  if (platform === "linux") {
    const failures: string[] = [];
    for (const processId of processIds) {
      try {
        await execFileAsync("renice", ["-n", String(LINUX_GAME_NICENESS), "-p", String(processId)]);
      } catch (error) {
        failures.push(describeCommandError(error));
      }
    }
    // Some of the game's processes may be reniceable even when others are not, so only report a
    // failure when every one of them was refused.
    if (failures.length > 0 && failures.length === processIds.length) {
      return { changed: false, error: failures[0] };
    }
    return { changed: true };
  }

  return { changed: false };
};
