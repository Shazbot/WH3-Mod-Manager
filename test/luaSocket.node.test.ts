import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLuaSocketDll, luaSocketLoaderScript } from "../src/luaSocket";

let tempDir: string;
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-luasocket-"));
});
afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

describe("luaSocketLoaderScript", () => {
  it("embeds an escaped Lua string path, the guard and the export name", () => {
    const script = luaSocketLoaderScript('C:\\Users\\a "b"\\WH3LuaSocketLate.dll', "win32");
    expect(script).toContain('local dll_path="C:\\\\Users\\\\a \\"b\\"\\\\WH3LuaSocketLate.dll"');
    expect(script).toContain("__wh3_socket_late_loader");
    expect(script).toContain("luaopen_wh3_socket_late");
  });

  it("uses a Z: wine path on linux", () => {
    expect(luaSocketLoaderScript("/home/u/luaSocket/x/WH3LuaSocketLate.dll", "linux")).toContain(
      'local dll_path="Z:\\\\home\\\\u\\\\luaSocket\\\\x\\\\WH3LuaSocketLate.dll"',
    );
  });
});

describe("ensureLuaSocketDll", () => {
  it("copies into a hash-named folder and is idempotent", () => {
    const source = path.join(tempDir, "src.dll");
    fs.writeFileSync(source, "dll-bytes");
    const appData = path.join(tempDir, "appData");
    const hash = crypto.createHash("sha256").update("dll-bytes").digest("hex").slice(0, 16);
    const first = ensureLuaSocketDll(appData, source);
    expect(first).toBe(path.join(appData, "luaSocket", hash, "WH3LuaSocketLate.dll"));
    expect(fs.readFileSync(first, "utf8")).toBe("dll-bytes");
    expect(ensureLuaSocketDll(appData, source)).toBe(first);
  });

  it("throws when the source is missing", () => {
    expect(() => ensureLuaSocketDll(tempDir, path.join(tempDir, "nope.dll"))).toThrow(/missing/);
  });
});
