import * as os from "node:os";
import * as path from "node:path";

// Where the control pipe lives. Kept out of protocol.ts: the window bundle can't load node: modules.

/** Name of the per-user Windows pipe. The WSL relay rebuilds it from $env:USERNAME, so keep the format in sync. */
export const appControlPipeName = (userName = os.userInfo().username): string =>
  `wh3mm-control-${userName.toLowerCase()}`;

export const appControlEndpoint = (): string => {
  if (process.platform === "win32") return `\\\\.\\pipe\\${appControlPipeName()}`;
  const runtimeDir = process.env["XDG_RUNTIME_DIR"] || os.tmpdir();
  return path.join(runtimeDir, `${appControlPipeName()}.sock`);
};
