import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import appData from "../src/appData";
import { beginGameLaunch } from "../src/appControl/launchOutcome";
import { appControlEndpoint } from "../src/appControl/endpoint";
import { type AppControlRequest, type AppControlResponse } from "../src/appControl/protocol";
import { startAppControlServer } from "../src/appControl/server";

// vi.mock calls are hoisted above these imports.

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const quitHandlers: Array<() => void> = [];
  return {
    handlers,
    quitHandlers,
    module: {
      app: {
        getVersion: () => "test",
        isPackaged: false,
        getPath: () => "",
        once: (_event: string, handler: () => void) => quitHandlers.push(handler),
      },
      ipcMain: { on: (channel: string, handler: (...args: unknown[]) => void) => handlers.set(channel, handler) },
    },
  };
});
const gameProcess = vi.hoisted(() => ({ findGameProcessIds: vi.fn(), terminateGameProcess: vi.fn() }));

vi.mock("electron", () => electron.module);
vi.mock("../src/utility/gameProcess", () => gameProcess);

// Unix sockets only: Windows uses a named pipe.
const describeUnix = process.platform === "win32" ? describe.skip : describe;

let runtimeDirectory: string;
const savedRuntimeDirectory = process.env["XDG_RUNTIME_DIR"];
const rendererRequests: AppControlRequest[] = [];
let rendererReply: (request: AppControlRequest) => Omit<AppControlResponse, "v" | "id">;
const afterGameExit = vi.fn(async () => undefined);

/** Stands in for the main window: records forwarded requests and answers them. */
const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    id: 1,
    send: (_channel: string, request: AppControlRequest) => {
      rendererRequests.push(request);
      const reply = rendererReply(request);
      setImmediate(() => electron.handlers.get("appControlResponse")!({}, { v: 1, id: request.id, ...reply }));
    },
  },
};

const send = (method: string, params: unknown) =>
  new Promise<AppControlResponse>((resolve, reject) => {
    const socket = net.connect(appControlEndpoint());
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ v: 1, id: "request", method, params })}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, buffer.indexOf("\n"))));
    });
    socket.on("error", reject);
  });

beforeEach(async () => {
  runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-app-control-server-"));
  process.env["XDG_RUNTIME_DIR"] = runtimeDirectory;
  rendererRequests.length = 0;
  electron.handlers.clear();
  appData.isAppControlEnabled = true;
  appData.isWH3Running = false;
  gameProcess.findGameProcessIds.mockReset().mockResolvedValue([]);
  gameProcess.terminateGameProcess.mockReset().mockImplementation(async () => {
    // The running-game poll in index.ts would notice the exit like this.
    appData.isWH3Running = false;
  });
  afterGameExit.mockClear();
  rendererReply = (request) => {
    const params = request.params as { validateOnly?: boolean };
    // A real launch makes the startGame handler report its outcome.
    if (request.method === "launch" && !params.validateOnly) setTimeout(() => beginGameLaunch()({ started: true }), 10);
    return { ok: true, result: { game: "wh3", enabledMods: [] } };
  };
  startAppControlServer(() => fakeWindow as never, afterGameExit);
  electron.handlers.get("appControlReady")!({ sender: { id: 1, on: () => undefined, once: () => undefined } });
  await new Promise((resolve) => setTimeout(resolve, 50));
});

afterEach(() => {
  electron.quitHandlers.splice(0).forEach((handler) => handler());
  if (savedRuntimeDirectory === undefined) delete process.env["XDG_RUNTIME_DIR"];
  else process.env["XDG_RUNTIME_DIR"] = savedRuntimeDirectory;
  fs.rmSync(runtimeDirectory, { recursive: true, force: true });
});

describeUnix("app control server", () => {
  it("refuses to launch over a running game unless asked to restart", async () => {
    appData.isWH3Running = true;
    const response = await send("launch", {});
    expect(response).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(gameProcess.terminateGameProcess).not.toHaveBeenCalled();
    expect(rendererRequests).toHaveLength(0);
  });

  it("validates a restart before stopping the game, then launches after cleanup", async () => {
    appData.isWH3Running = true;
    const response = await send("launch", { restart: true, only: ["a"] });
    expect(response).toMatchObject({ ok: true, result: { started: true, restarted: true } });
    expect(rendererRequests.map((request) => (request.params as { validateOnly?: boolean }).validateOnly)).toEqual([
      true,
      undefined,
    ]);
    expect(gameProcess.terminateGameProcess).toHaveBeenCalledTimes(1);
    expect(afterGameExit).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("leaves the game running when the restart request is invalid", async () => {
    appData.isWH3Running = true;
    rendererReply = () => ({ ok: false, error: { code: "VALIDATION", message: "Could not match every mod" } });
    const response = await send("launch", { restart: true, only: ["typo"] });
    expect(response).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(gameProcess.terminateGameProcess).not.toHaveBeenCalled();
  });

  it("stops a running game and reports when nothing was running", async () => {
    appData.isWH3Running = true;
    expect(await send("stopGame", {})).toMatchObject({ ok: true, result: { wasRunning: true } });
    expect(await send("stopGame", {})).toMatchObject({ ok: true, result: { wasRunning: false } });
    expect(gameProcess.terminateGameProcess).toHaveBeenCalledTimes(1);
  });

  it("reports a game that does not exit in time", async () => {
    appData.isWH3Running = true;
    gameProcess.terminateGameProcess.mockResolvedValue(undefined);
    gameProcess.findGameProcessIds.mockResolvedValue([1]);
    const response = await send("stopGame", { timeoutSeconds: 1 });
    expect(response).toMatchObject({ ok: false, error: { code: "STOP_FAILED" } });
  }, 10_000);
});
