import { Pack, PackedFile, PackHeader, PackSource } from "../packFileTypes";
import {
  FrontCodedBlock,
  buildFrontCodedBlock,
  findFrontCodedPrefixRange,
  findFrontCodedRank,
  forEachFrontCodedEntry,
  readFrontCodedEntry,
} from "../vanillaDbCache/frontCodedBlock";

/**
 * A pack directory without one JS object and one filename string per embedded file.
 * Parallel arrays use the filename's front-coded rank as their key.
 */
export interface CompactPackIndex extends PackSource {
  size: number;
  mtimeMs: number;
  packHeader: PackHeader;
  dependencyPacks: string[];
  names: FrontCodedBlock;
  fileSizes: Uint32Array;
  startPositions: Float64Array;
  compressionFlags: Uint8Array;
}

export const buildCompactPackIndex = (pack: Pack): CompactPackIndex => {
  const entries = pack.packedFiles
    .map((file) => ({
      name: file.name,
      fileSize: file.file_size,
      startPosition: file.start_pos,
      isCompressed: file.is_compressed === true,
    }))
    .sort((first, second) => (first.name < second.name ? -1 : first.name > second.name ? 1 : 0));

  return {
    name: pack.name,
    path: pack.path,
    size: pack.size,
    mtimeMs: pack.lastChangedLocal,
    packHeader: pack.packHeader,
    dependencyPacks: pack.dependencyPacks ?? [],
    names: buildFrontCodedBlock(entries.map((entry) => entry.name)),
    fileSizes: Uint32Array.from(entries, (entry) => entry.fileSize),
    startPositions: Float64Array.from(entries, (entry) => entry.startPosition),
    compressionFlags: Uint8Array.from(entries, (entry) => (entry.isCompressed ? 1 : 0)),
  };
};

const materializeEntry = (index: CompactPackIndex, rank: number): PackedFile | undefined => {
  const name = readFrontCodedEntry(index.names, rank);
  if (name === undefined) return undefined;
  return {
    name,
    file_size: index.fileSizes[rank],
    start_pos: index.startPositions[rank],
    is_compressed: index.compressionFlags[rank] === 1,
  };
};

export const findCompactPackFile = (index: CompactPackIndex, fileName: string): PackedFile | undefined => {
  const rank = findFrontCodedRank(index.names, fileName);
  return rank < 0 ? undefined : materializeEntry(index, rank);
};

export const findCompactPackFilesUnderPrefix = (index: CompactPackIndex, prefix: string): PackedFile[] => {
  const { start, end } = findFrontCodedPrefixRange(index.names, prefix);
  const files: PackedFile[] = [];
  for (let rank = start; rank < end; rank++) {
    const file = materializeEntry(index, rank);
    if (file) files.push(file);
  }
  return files;
};

export const forEachCompactPackFileName = (
  index: CompactPackIndex,
  visit: (fileName: string, rank: number) => boolean | void,
): void => forEachFrontCodedEntry(index.names, visit);
