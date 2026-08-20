import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { packFileContains } from "../src/utility/packSearch";

const temporaryDirectories: string[] = [];

const makeDirectory = async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-pack-search-"));
  temporaryDirectories.push(directory);
  return directory;
};

const writePack = async (contents: Buffer | string, name = "pack.pack") => {
  const packPath = path.join(await makeDirectory(), name);
  await fs.promises.writeFile(packPath, contents);
  return packPath;
};

// Tiny windows keep the boundary tests fast; the production defaults are 4 MiB / 64 KiB. The
// overlap has to exceed the longest match under test ("greatswords" is 22 bytes as UTF-16LE),
// otherwise a match straddling a boundary falls into the gap between windows.
const tinyWindows = { chunkBytes: 64, overlapBytes: 32 };

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("packFileContains", () => {
  it("searches UTF-8 and UTF-16LE pack contents", async () => {
    const utf8Path = await writePack("unit_key=greatswords", "utf8.pack");
    const utf16Path = await writePack(Buffer.from("unit_key=greatswords", "utf16le"), "utf16.pack");

    await expect(packFileContains(utf8Path, "GREATSWORDS")).resolves.toBe(true);
    await expect(packFileContains(utf16Path, "GREATSWORDS")).resolves.toBe(true);
  });

  it("treats an invalid regular expression as literal text", async () => {
    const packPath = await writePack("effect[key");

    await expect(packFileContains(packPath, "effect[")).resolves.toBe(true);
  });

  it("reports no match when the term is absent", async () => {
    const packPath = await writePack(Buffer.alloc(4096, 0x41));

    await expect(packFileContains(packPath, "greatswords", tinyWindows)).resolves.toBe(false);
  });

  it("finds UTF-8 matches that straddle a chunk boundary", async () => {
    // The term lands astride the 64-byte chunk boundary, so no single read contains it.
    const packPath = await writePack("x".repeat(60) + "greatswords" + "y".repeat(60));

    await expect(packFileContains(packPath, "greatswords", tinyWindows)).resolves.toBe(true);
  });

  it("finds UTF-16LE matches that straddle a chunk boundary", async () => {
    const packPath = await writePack(Buffer.from("x".repeat(28) + "greatswords" + "y".repeat(60), "utf16le"));

    await expect(packFileContains(packPath, "greatswords", tinyWindows)).resolves.toBe(true);
  });

  it("keeps the UTF-16LE view aligned across many windows", async () => {
    // An odd-length preamble makes each raw chunk boundary land mid-character.
    const packPath = await writePack(
      Buffer.concat([
        Buffer.alloc(4097, 0x20),
        Buffer.from("unit_key=greatswords", "utf16le"),
        Buffer.alloc(4096, 0x20),
      ]),
    );

    await expect(packFileContains(packPath, "greatswords", tinyWindows)).resolves.toBe(true);
  });

  it("finds matches at every byte offset, odd offsets included", async () => {
    // A pack puts text wherever its binary layout lands, so neither encoding can assume alignment.
    const directory = await makeDirectory();
    for (const [label, encode] of [
      ["utf8", (t: string) => Buffer.from(t, "utf8")],
      ["utf16le", (t: string) => Buffer.from(t, "utf16le")],
    ] as const) {
      for (let offset = 0; offset <= 96; offset++) {
        const packPath = path.join(directory, `${label}-${offset}.pack`);
        await fs.promises.writeFile(
          packPath,
          Buffer.concat([Buffer.alloc(offset, 0x20), encode("greatswords"), Buffer.alloc(64, 0x20)]),
        );
        await expect(
          packFileContains(packPath, "greatswords", tinyWindows),
          `${label} at offset ${offset}`,
        ).resolves.toBe(true);
      }
    }
  });

  it("finds a multi-byte UTF-8 match split across a chunk boundary", async () => {
    const packPath = await writePack("z".repeat(62) + "Grünburg" + "z".repeat(62));

    await expect(packFileContains(packPath, "Grünburg", tinyWindows)).resolves.toBe(true);
  });

  it("searches a pack larger than one chunk without loading it whole", async () => {
    const filler = Buffer.alloc(2 * 1024 * 1024, 0x41);
    const packPath = await writePack(Buffer.concat([filler, Buffer.from("unit_key=greatswords"), filler]));

    await expect(packFileContains(packPath, "greatswords", { chunkBytes: 64 * 1024 })).resolves.toBe(true);
  });
});
