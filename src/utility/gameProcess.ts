import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const MINIMUM_GAME_RSS_KB = 10_000;

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

export const setGameProcessPriority = async (
  processName: string,
  processIds: number[],
  platform = process.platform,
): Promise<void> => {
  if (processIds.length === 0) return;

  if (platform === "win32") {
    const processBaseName = processName.replace(/\.exe$/i, "");
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-Process -Name '${processBaseName}' | ForEach-Object { $_.PriorityClass = 'High' }`,
    ]);
    return;
  }

  if (platform === "linux") {
    for (const processId of processIds) {
      await execFileAsync("renice", ["-n", "-5", "-p", String(processId)]);
    }
  }
};
