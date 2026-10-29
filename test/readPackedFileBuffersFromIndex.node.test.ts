import * as fsNative from "node:fs";
import * as os from "os";
import * as path from "path";
import { deflateSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPackedFileBuffersFromIndex } from "../src/packFileSerializer";
import type { PackedFile } from "../src/packFileTypes";
import { collator } from "../src/utility/packFileSorting";

const fsState = vi.hoisted(() => ({
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
  originalOpenSync: undefined as any,
  originalReadSync: undefined as any,
  originalCloseSync: undefined as any,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  fsState.originalOpenSync = actual.openSync.bind(actual);
  fsState.originalReadSync = actual.readSync.bind(actual);
  fsState.originalCloseSync = actual.closeSync.bind(actual);
  return {
    ...actual,
    openSync: fsState.openSync,
    readSync: fsState.readSync,
    closeSync: fsState.closeSync,
  };
});

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (value: Uint8Array) => value,
  decompress: async (value: Uint8Array) => value,
}));

const temporaryPaths: string[] = [];

beforeEach(() => {
  fsState.openSync.mockReset().mockImplementation(fsState.originalOpenSync);
  fsState.readSync.mockReset().mockImplementation(fsState.originalReadSync);
  fsState.closeSync.mockReset().mockImplementation(fsState.originalCloseSync);
});

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((filePath) => fsNative.promises.rm(filePath, { force: true })));
});

const createPack = (files: Array<{ name: string; startPos: number; bytes: Buffer; compressed?: boolean }>) => {
  const filePath = path.join(os.tmpdir(), `read-index-${Math.random().toString(16).slice(2)}.pack`);
  temporaryPaths.push(filePath);
  const fileLength = Math.max(0, ...files.map(({ startPos, bytes }) => startPos + bytes.length));
  const contents = Buffer.alloc(fileLength);
  for (const file of files) file.bytes.copy(contents, file.startPos);
  fsNative.writeFileSync(filePath, contents);
  const packedFiles = files
    .map(({ name, startPos, bytes, compressed }) => ({
      name,
      start_pos: startPos,
      file_size: bytes.length,
      is_compressed: compressed,
    }))
    .sort((first, second) => collator.compare(first.name, second.name)) as PackedFile[];
  return { path: filePath, packedFiles };
};

describe("readPackedFileBuffersFromIndex", () => {
  it("coalesces adjacent files, splits sparse files, and preserves request-order Map keys", async () => {
    const pack = createPack([
      { name: "folder\\a", startPos: 32, bytes: Buffer.from("alpha") },
      { name: "folder\\b", startPos: 37, bytes: Buffer.from("bravo") },
      { name: "folder\\z", startPos: 90_000, bytes: Buffer.from("zulu") },
    ]);
    const result = await readPackedFileBuffersFromIndex(pack, [
      "folder\\z",
      "folder\\missing",
      "folder\\b",
      "folder\\a",
      "folder\\z",
    ]);

    expect([...result.keys()]).toEqual(["folder\\z", "folder\\b", "folder\\a"]);
    expect(result.get("folder\\a")?.toString()).toBe("alpha");
    expect(result.get("folder\\b")?.toString()).toBe("bravo");
    expect(result.get("folder\\z")?.toString()).toBe("zulu");
    expect(fsState.openSync).toHaveBeenCalledOnce();
    expect(fsState.readSync).toHaveBeenCalledTimes(2);
  });

  it("splits adjacent payloads when a coalesced span would exceed four MiB", async () => {
    const first = Buffer.alloc(3 * 1024 * 1024, 0x31);
    const second = Buffer.alloc(3 * 1024 * 1024, 0x32);
    const pack = createPack([
      { name: "large\\a", startPos: 64, bytes: first },
      { name: "large\\b", startPos: 64 + first.length, bytes: second },
    ]);
    const result = await readPackedFileBuffersFromIndex(pack, ["large\\a", "large\\b"]);

    expect(result.get("large\\a")?.equals(first)).toBe(true);
    expect(result.get("large\\b")?.equals(second)).toBe(true);
    expect(fsState.readSync).toHaveBeenCalledTimes(2);
  });

  it("returns mixed compressed and plain payloads in the caller's order", async () => {
    const plain = Buffer.from("uncompressed icon bytes");
    const logicalCompressed = Buffer.from("compressed icon bytes");
    const compressed = deflateSync(logicalCompressed);
    const pack = createPack([
      { name: "icon\\plain", startPos: 16, bytes: plain },
      { name: "icon\\compressed", startPos: 16 + plain.length, bytes: compressed, compressed: true },
    ]);

    const result = await readPackedFileBuffersFromIndex(pack, ["icon\\compressed", "icon\\plain"]);

    expect([...result.keys()]).toEqual(["icon\\compressed", "icon\\plain"]);
    expect(result.get("icon\\plain")).toEqual(plain);
    expect(result.get("icon\\compressed")).toEqual(logicalCompressed);
  });

  it("does not open a pack when no requested path matches", async () => {
    const pack = createPack([{ name: "present", startPos: 0, bytes: Buffer.from("payload") }]);
    const result = await readPackedFileBuffersFromIndex(pack, ["missing"]);

    expect(result.size).toBe(0);
    expect(fsState.openSync).not.toHaveBeenCalled();
  });

  it("does not return a short read's uninitialized tail and closes the pack", async () => {
    const pack = createPack([{ name: "short", startPos: 0, bytes: Buffer.from([1, 2, 3]) }]);
    pack.packedFiles[0].file_size = 16;
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await readPackedFileBuffersFromIndex(pack, ["short"]);

    expect(result.size).toBe(0);
    expect(fsState.closeSync).toHaveBeenCalledOnce();
  });

  it("closes the pack after a read error while keeping the partial result empty", async () => {
    const pack = createPack([{ name: "read-error", startPos: 0, bytes: Buffer.from("payload") }]);
    fsState.readSync.mockImplementation(() => {
      throw new Error("forced read failure");
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await readPackedFileBuffersFromIndex(pack, ["read-error"]);

    expect(result.size).toBe(0);
    expect(fsState.closeSync).toHaveBeenCalledOnce();
  });

  it("keeps completed request-order payloads when a later read run fails", async () => {
    const pack = createPack([
      { name: "partial\\first", startPos: 0, bytes: Buffer.from("first") },
      { name: "partial\\later", startPos: 90_000, bytes: Buffer.from("later") },
    ]);
    fsState.readSync.mockImplementation(
      (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
        if (position >= 90_000) throw new Error("forced later-run failure");
        return fsState.originalReadSync(fd, buffer, offset, length, position);
      },
    );
    const loggedErrors: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => loggedErrors.push(args[0]));

    const result = await readPackedFileBuffersFromIndex(pack, ["partial\\first", "partial\\later"]);

    expect([...result.keys()], JSON.stringify({ readCalls: fsState.readSync.mock.calls.length, loggedErrors })).toEqual(
      ["partial\\first"],
    );
    expect(result.get("partial\\first")?.toString()).toBe("first");
    expect(fsState.closeSync).toHaveBeenCalledOnce();
  });
});
