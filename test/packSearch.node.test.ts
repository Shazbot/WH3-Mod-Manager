import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { packFileContains } from "../src/utility/packSearch";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("packFileContains", () => {
  it("searches UTF-8 and UTF-16LE pack contents", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-pack-search-"));
    temporaryDirectories.push(directory);
    const utf8Path = path.join(directory, "utf8.pack");
    const utf16Path = path.join(directory, "utf16.pack");
    await fs.promises.writeFile(utf8Path, "unit_key=greatswords");
    await fs.promises.writeFile(utf16Path, Buffer.from("unit_key=greatswords", "utf16le"));

    await expect(packFileContains(utf8Path, "GREATSWORDS")).resolves.toBe(true);
    await expect(packFileContains(utf16Path, "GREATSWORDS")).resolves.toBe(true);
  });

  it("treats an invalid regular expression as literal text", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-pack-search-"));
    temporaryDirectories.push(directory);
    const packPath = path.join(directory, "pack.pack");
    await fs.promises.writeFile(packPath, "effect[key");

    await expect(packFileContains(packPath, "effect[")).resolves.toBe(true);
  });
});
