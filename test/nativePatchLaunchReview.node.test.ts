import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  launchNativePatchHelper,
  type NativePatchLaunchFiles,
  type NativePatchLaunchInvocation,
} from "../src/nativePatches/launch";

const folders: string[] = [];
const runId = "launch-review";
const files = (): NativePatchLaunchFiles => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-native-launch-review-"));
  folders.push(root);
  return {
    runDirectory: root,
    planPath: path.join(root, "plan.json"),
    statusPath: path.join(root, "status.json"),
    releasePath: path.join(root, "release.signal"),
    cancelPath: path.join(root, "cancel.signal"),
    decisionPath: path.join(root, "decision.json"),
  };
};
const fakeHelper = (
  launchFiles: NativePatchLaunchFiles,
  behavior: "activate" | "wait" | "wrong-session",
): NativePatchLaunchInvocation => ({
  command: process.execPath,
  args: [
    "-e",
    `
    const fs = require("node:fs");
    const paths = ${JSON.stringify(launchFiles)};
    const behavior = ${JSON.stringify(behavior)};
    const runId = ${JSON.stringify(runId)};
    const status = (state, id = runId) => fs.writeFileSync(paths.statusPath, JSON.stringify({ protocol: 1, runId: id, state, pid: process.pid }));
    status(behavior === "wait" ? "starting" : "activated", behavior === "wrong-session" ? "other-session" : runId);
    const deadline = setTimeout(() => process.exit(9), 5000);
    const timer = setInterval(() => {
      if (fs.existsSync(paths.cancelPath)) {
        status("failed"); clearInterval(timer); clearTimeout(deadline);
      } else if (fs.existsSync(paths.releasePath)) {
        status("release_ready");
        if (fs.existsSync(paths.decisionPath)) {
          const decision = JSON.parse(fs.readFileSync(paths.decisionPath, "utf8"));
          status(decision.decision === "release" ? "released" : "failed");
          clearInterval(timer); clearTimeout(deadline);
        }
      }
    }, 10);
  `,
  ],
  helperPath: process.execPath,
  launcher: "windows",
});

afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

describe("native patch launch reviewer regressions", () => {
  it("requires explicit activation and release acknowledgements", async () => {
    const launchFiles = files();
    const result = await launchNativePatchHelper({
      invocation: fakeHelper(launchFiles, "activate"),
      planFiles: launchFiles,
      runId,
      cwd: launchFiles.runDirectory,
      timeoutMs: 2000,
    });
    expect(result.started).toBe(true);
    expect(fs.readFileSync(launchFiles.releasePath, "utf8").trim()).toBe(runId);
    expect(JSON.parse(fs.readFileSync(launchFiles.decisionPath, "utf8")).decision).toBe("release");
    expect(fs.existsSync(launchFiles.cancelPath)).toBe(false);
  });

  it("cancels a timed-out helper and does not release the game", async () => {
    const launchFiles = files();
    const result = await launchNativePatchHelper({
      invocation: fakeHelper(launchFiles, "wait"),
      planFiles: launchFiles,
      runId,
      cwd: launchFiles.runDirectory,
      timeoutMs: 300,
    });
    expect(result.started).toBe(false);
    expect(fs.existsSync(launchFiles.releasePath)).toBe(false);
    expect(fs.readFileSync(launchFiles.cancelPath, "utf8").trim()).toBe(runId);
    expect(JSON.parse(fs.readFileSync(launchFiles.decisionPath, "utf8")).decision).toBe("cancel");
    expect(JSON.parse(fs.readFileSync(launchFiles.statusPath, "utf8")).state).toBe("failed");
  });

  it("ignores activation statuses belonging to another launch", async () => {
    const launchFiles = files();
    const result = await launchNativePatchHelper({
      invocation: fakeHelper(launchFiles, "wrong-session"),
      planFiles: launchFiles,
      runId,
      cwd: launchFiles.runDirectory,
      timeoutMs: 300,
    });
    expect(result.started).toBe(false);
    expect(fs.existsSync(launchFiles.releasePath)).toBe(false);
  });
});
