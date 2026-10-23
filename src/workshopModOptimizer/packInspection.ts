import { createHash } from "node:crypto";
import * as fs from "node:fs";

import { PFH5_HEADER_BYTES, parsePFH5Header, parsePFH5Index } from "../compressionAnalysis/analyzer";

/**
 * True when the pack's index lists a `.variantmeshdefinition` or `.wsmodel`: only those mods have
 * unit visuals the optimizer can change. Reads the header and file index, never file data.
 * An unreadable or non-PFH5 pack is not eligible.
 */
export const packHasOptimizableVisuals = async (packPath: string): Promise<boolean> => {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(packPath, "r");
    const { size } = await handle.stat();
    const headerBuffer = Buffer.alloc(PFH5_HEADER_BYTES);
    await handle.read(headerBuffer, 0, PFH5_HEADER_BYTES, 0);
    const header = parsePFH5Header(headerBuffer, size);
    const indexBuffer = Buffer.alloc(header.packedFileIndexSize);
    await handle.read(indexBuffer, 0, indexBuffer.length, PFH5_HEADER_BYTES + header.dependencyIndexSize);
    return parsePFH5Index(indexBuffer, header).some((entry) => {
      const name = entry.name.toLowerCase();
      return name.endsWith(".variantmeshdefinition") || name.endsWith(".wsmodel");
    });
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

export const hashFileSha256 = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

/** Name, size and modification time of every vanilla pack: a game patch changes it. */
export const computeGameIdentity = async (vanillaPackPaths: readonly string[]): Promise<string> => {
  const parts: string[] = [];
  for (const packPath of vanillaPackPaths) {
    try {
      const stats = await fs.promises.stat(packPath);
      parts.push(
        `${packPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase()}|${stats.size}|${Math.round(stats.mtimeMs)}`,
      );
    } catch {
      parts.push(`${packPath}|missing`);
    }
  }
  return createHash("sha256").update(parts.sort().join("\n")).digest("hex").slice(0, 32);
};
