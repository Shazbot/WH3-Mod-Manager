import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as nodePath from "path";
import * as os from "os";

import { canonicalizeExistingPath, getCanonicalFileIdentity } from "../src/vanillaCacheIdentity";

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("canonical cache source identity", () => {
  it("resolves existing files and preserves bigint stat identity as decimal values", () => {
    temporaryDirectory = fs.mkdtempSync(nodePath.join(os.tmpdir(), "whmm-cache-identity-"));
    const sourcePath = nodePath.join(temporaryDirectory, "source.pack");
    fs.writeFileSync(sourcePath, "source bytes");
    const linkPath = nodePath.join(temporaryDirectory, "source-link.pack");
    const source = getCanonicalFileIdentity(sourcePath)!;
    try {
      fs.symlinkSync(sourcePath, linkPath);
    } catch {
      expect(canonicalizeExistingPath(sourcePath)).toBe(source.path);
      expect(source.size).toBe(BigInt(Buffer.byteLength("source bytes")));
      return;
    }
    const linkedSource = getCanonicalFileIdentity(linkPath)!;
    expect(canonicalizeExistingPath(linkPath)).toBe(source.path);
    expect(linkedSource.path).toBe(source.path);
    expect(linkedSource.size).toBe(source.size);
    expect(linkedSource.mtimeNs.toString(10)).toMatch(/^\d+$/);
    expect(linkedSource.ctimeNs.toString(10)).toMatch(/^\d+$/);
    expect(linkedSource.dev.toString(10)).toMatch(/^\d+$/);
    expect(linkedSource.ino.toString(10)).toMatch(/^\d+$/);
  });
});
