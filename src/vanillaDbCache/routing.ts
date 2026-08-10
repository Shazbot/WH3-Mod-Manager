import * as nodePath from "path";

import { PackedFile } from "../packFileTypes";
import { parseDBTablePath } from "../utility/packFileHelpers";

/** Path comparison used before any cache reader is opened or built. */
export const isSamePackPath = (candidatePath: string, expectedPath: string): boolean =>
  nodePath.resolve(candidatePath) === nodePath.resolve(expectedPath);

export const isVanillaDbPackPath = (
  candidatePath: string,
  dataFolder: string | undefined,
  dbPackName: string,
): boolean =>
  dataFolder != undefined && isSamePackPath(candidatePath, nodePath.join(dataFolder, dbPackName));

/**
 * The indexed pack, not the cache directory, defines what a prefix must contain to be fully served.
 * A cache can deliberately omit a packed file, and that omission must force the caller's pack fallback.
 */
export const getIndexedDbTablePathsForPrefix = (
  packedFiles: readonly PackedFile[],
  prefix: string,
): string[] =>
  packedFiles
    .filter((packedFile) => packedFile.name.startsWith(prefix) && parseDBTablePath(packedFile.name))
    .map((packedFile) => packedFile.name);
