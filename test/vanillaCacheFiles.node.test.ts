import { afterEach, describe, expect, it } from "vitest";
import * as crypto from "crypto";
import * as fs from "fs";
import * as nodePath from "path";
import * as os from "os";

import { publishCacheFiles } from "../src/vanillaCacheFiles";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const makeDirectory = () => {
  const directory = fs.mkdtempSync(nodePath.join(os.tmpdir(), "whmm-cache-publish-"));
  temporaryDirectories.push(directory);
  return directory;
};

describe("cache file publication", () => {
  it("keeps concurrent publishers' staged files unique and publishes a matching stamp", async () => {
    const directory = makeDirectory();
    const cachePath = nodePath.join(directory, "cache.bin");
    const stampPath = `${cachePath}.id`;
    const publications = ["first", "second"].map((identity) => {
      const cacheBytes = Buffer.from(`cache-${identity}`);
      const stampBytes = Buffer.from(
        JSON.stringify({
          identity,
          contentSha256: crypto.createHash("sha256").update(cacheBytes).digest("hex"),
        }),
      );
      return publishCacheFiles({ cachePath, cacheBytes, stampPath, stampBytes, shouldPublish: () => true });
    });

    expect(await Promise.all(publications)).toEqual([true, true]);
    const finalBytes = fs.readFileSync(cachePath);
    const stamp = JSON.parse(fs.readFileSync(stampPath, "utf8")) as {
      identity: string;
      contentSha256: string;
    };
    expect(["first", "second"]).toContain(stamp.identity);
    expect(stamp.contentSha256).toBe(crypto.createHash("sha256").update(finalBytes).digest("hex"));
    expect(fs.readdirSync(directory).filter((name) => name.endsWith(".building"))).toEqual([]);
  });

  it("cleans its own staged files when publication is canceled", async () => {
    const directory = makeDirectory();
    const cachePath = nodePath.join(directory, "cache.bin");
    const stampPath = `${cachePath}.id`;
    fs.writeFileSync(cachePath, "old cache");
    fs.writeFileSync(stampPath, "old stamp");
    let sawStagedFiles = false;

    const published = await publishCacheFiles({
      cachePath,
      cacheBytes: Buffer.from("new cache"),
      stampPath,
      stampBytes: Buffer.from("new stamp"),
      shouldPublish: () => {
        sawStagedFiles = fs.readdirSync(directory).some((name) => name.endsWith(".building"));
        return false;
      },
    });

    expect(published).toBe(false);
    expect(sawStagedFiles).toBe(true);
    expect(fs.readFileSync(cachePath, "utf8")).toBe("old cache");
    expect(fs.readFileSync(stampPath, "utf8")).toBe("old stamp");
    expect(fs.readdirSync(directory).filter((name) => name.endsWith(".building"))).toEqual([]);
  });
});
