import * as fs from "fs";
import * as nodePath from "path";

export interface CanonicalFileIdentity {
  path: string;
  size: bigint;
  mtimeMs: number;
  mtimeNs: bigint;
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
}

/** Resolves an existing path through links, falling back to a normalized absolute path if missing. */
export const canonicalizeExistingPath = (filePath: string): string => {
  const resolvedPath = nodePath.resolve(filePath);
  try {
    return fs.realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
};

/** Returns bigint stat identity for an existing regular file under its canonical path. */
export const getCanonicalFileIdentity = (filePath: string): CanonicalFileIdentity | undefined => {
  try {
    const canonicalPath = canonicalizeExistingPath(filePath);
    const stats = fs.statSync(canonicalPath, { bigint: true });
    if (!stats.isFile()) return undefined;
    return {
      path: canonicalPath,
      size: stats.size,
      mtimeMs: Number(stats.mtimeNs) / 1_000_000,
      mtimeNs: stats.mtimeNs,
      ctimeNs: stats.ctimeNs,
      dev: stats.dev,
      ino: stats.ino,
    };
  } catch {
    return undefined;
  }
};
