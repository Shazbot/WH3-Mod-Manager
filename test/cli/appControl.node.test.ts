import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/main";
import { appControlEndpoint } from "../../src/appControl/endpoint";
import { type AppControlRequest, type AppControlResponse } from "../../src/appControl/protocol";

// Unix sockets only: Windows and WSL reach the app through a named pipe.
const describeUnix = process.platform === "win32" ? describe.skip : describe;

const savedEnv = { ...process.env };
let runtimeDirectory: string;
let server: net.Server | undefined;

beforeEach(() => {
  runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-app-control-"));
  process.env["XDG_RUNTIME_DIR"] = runtimeDirectory;
  delete process.env["WSL_DISTRO_NAME"];
  delete process.env["WSL_INTEROP"];
  delete process.env["WHMM_APP_PATH"];
});

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  process.env = { ...savedEnv };
  fs.rmSync(runtimeDirectory, { recursive: true, force: true });
});

/** Fake app: answers each request with the next reply. */
const serveReplies = async (replies: Array<(request: AppControlRequest) => Omit<AppControlResponse, "v" | "id">>) => {
  const requests: AppControlRequest[] = [];
  server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as AppControlRequest;
      requests.push(request);
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)](request);
      socket.end(`${JSON.stringify({ v: 1, id: request.id, ...reply })}\n`);
    });
  });
  await new Promise<void>((resolve) => server!.listen(appControlEndpoint(), resolve));
  return requests;
};

const run = async (args: string[]) => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await main([...args, "--format", "json", "--no-cache"], {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });
  return { exitCode, envelope: JSON.parse(stdout.join("")), stderr: stderr.join("") };
};

describeUnix("CLI app control", () => {
  it("reports a stopped app without starting it", async () => {
    const { exitCode, envelope } = await run(["app", "status"]);
    expect(exitCode).toBe(0);
    expect(envelope).toMatchObject({ ok: true, data: { running: false } });
  });

  it("fails with --no-start-app when the app is not running", async () => {
    const { exitCode, envelope } = await run(["mods", "list", "--no-start-app"]);
    expect(exitCode).toBe(3);
    expect(envelope.error.message).toContain("WHMM is not running");
  });

  it("waits while the app loads, then forwards the mod selection", async () => {
    const requests = await serveReplies([
      () => ({ ok: false, error: { code: "NOT_READY", message: "loading" } }),
      () => ({
        ok: true,
        result: {
          game: "wh3",
          dryRun: false,
          changed: { enabled: ["b.pack"], disabled: [] },
          enabledMods: ["b.pack"],
          warnings: ["kept"],
        },
      }),
    ]);
    const { exitCode, envelope, stderr } = await run([
      "mods",
      "set",
      "--only",
      "b",
      "--preset",
      "P",
      "--order",
      "c",
      "--order",
      "b",
      "--no-start-app",
    ]);
    expect(exitCode).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      v: 1,
      method: "setMods",
      params: { only: ["b"], preset: "P", order: ["c", "b"], dryRun: false },
    });
    expect(envelope.data).toMatchObject({ enabledMods: ["b.pack"], startedApp: false });
    expect(stderr).toContain("APP_CONTROL_WARNING: kept");
  }, 10_000);

  it("passes launch options and maps a failed launch to a nonzero exit", async () => {
    const requests = await serveReplies([
      () => ({ ok: false, error: { code: "LAUNCH_FAILED", message: "Game executable not found" } }),
    ]);
    const { exitCode, envelope } = await run([
      "game",
      "launch",
      "--temporary",
      "--enable",
      "a",
      "--continue",
      "--skip-intros",
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.error).toMatchObject({
      message: "Game executable not found",
      details: { appCode: "LAUNCH_FAILED" },
    });
    expect(requests[0]).toMatchObject({
      method: "launch",
      params: {
        temporary: true,
        enable: ["a"],
        continueLastSave: true,
        options: { skipIntroMovies: true },
        timeoutSeconds: 900,
      },
    });
  });

  it("sends stop and relaunch requests", async () => {
    const requests = await serveReplies([
      () => ({ ok: true, result: { game: "wh3", wasRunning: true } }),
      () => ({ ok: true, result: { game: "wh3", enabledMods: [], started: true, restarted: true } }),
      () => ({ ok: false, error: { code: "STOP_FAILED", message: "still running" } }),
    ]);
    expect((await run(["game", "stop", "--stop-timeout", "5", "--no-start-app"])).envelope.data).toMatchObject({
      wasRunning: true,
    });
    expect((await run(["game", "relaunch", "--continue", "--no-start-app"])).exitCode).toBe(0);
    const failed = await run(["game", "launch", "--restart", "--no-start-app"]);
    expect(failed.exitCode).toBe(1);
    expect(failed.envelope.error.details).toMatchObject({ appCode: "STOP_FAILED" });
    expect(requests[0]).toMatchObject({ method: "stopGame", params: { timeoutSeconds: 5 } });
    expect(requests[1]).toMatchObject({
      method: "launch",
      params: { restart: true, continueLastSave: true, stopTimeoutSeconds: 30 },
    });
    expect(requests[2]).toMatchObject({ params: { restart: true } });
    expect((await run(["game", "stop", "--restart"])).exitCode).toBe(2);
  });

  it("rejects control flags on other commands and invalid combinations", async () => {
    expect((await run(["pack", "info", "x.pack", "--only", "a"])).exitCode).toBe(2);
    expect((await run(["mods", "list", "--temporary"])).exitCode).toBe(2);
    expect((await run(["game", "launch", "--temporary"])).exitCode).toBe(2);
    expect((await run(["mods", "set"])).exitCode).toBe(2);
  });
});
