import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { compareFilesByteForByte } from "../src/utility/fileComparison";

describe("compareFilesByteForByte", () => {
  it("compares the complete file contents instead of only their sizes", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "wh3mm-file-comparison-"));
    const firstPath = path.join(tempDirectory, "local.pack");
    const secondPath = path.join(tempDirectory, "workshop.pack");

    try {
      const contents = Buffer.alloc(1024 * 1024 + 17, 0x5a);
      await Promise.all([fs.writeFile(firstPath, contents), fs.writeFile(secondPath, contents)]);
      await expect(compareFilesByteForByte(firstPath, secondPath)).resolves.toBe(true);

      contents[contents.length - 1] = 0x2a;
      await fs.writeFile(secondPath, contents);
      await expect(compareFilesByteForByte(firstPath, secondPath)).resolves.toBe(false);

      await fs.appendFile(secondPath, Buffer.from([0]));
      await expect(compareFilesByteForByte(firstPath, secondPath)).resolves.toBe(false);
    } finally {
      await fs.rm(tempDirectory, { recursive: true });
    }
  });
});
