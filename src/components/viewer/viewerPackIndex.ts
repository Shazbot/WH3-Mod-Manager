import { Pack, PackedFile } from "@/src/packFileTypes";

/**
 * Reuses an already-loaded pack index while giving the requested table its own mutable descriptor.
 * Cache filling and getPackViewData both mutate that descriptor, so the shared index must not be used
 * directly.
 */
export const clonePackIndexForTable = (
  indexedPack: Pack,
  packedFilePath: string,
): { pack: Pack; packedFile: PackedFile } | undefined => {
  const sourceIndex = indexedPack.packedFiles.findIndex((file) => file.name === packedFilePath);
  if (sourceIndex < 0) return undefined;

  const packedFile = {
    ...indexedPack.packedFiles[sourceIndex],
    schemaFields: [],
    tableSchema: undefined,
  };
  const packedFiles = [...indexedPack.packedFiles];
  packedFiles[sourceIndex] = packedFile;

  return {
    pack: {
      ...indexedPack,
      packedFiles,
      readTables: [packedFilePath],
    },
    packedFile,
  };
};
