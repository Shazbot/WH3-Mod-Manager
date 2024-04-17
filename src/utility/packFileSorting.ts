import { PackedFile } from "./../packFileTypes";
import bs from "binary-search";

export const findFirstDBFileInPresortedFiles = (packedFiles: PackedFile[]) => {
  return bs(packedFiles, packedFiles[0], (a: PackedFile, b: PackedFile, index: number | undefined) => {
    // console.log(
    //   "IN SORT:",
    //   a.name,
    //   index
    // );
    if (!a.name.startsWith("db\\")) return a.name.localeCompare("db\\");
    if (index != undefined) {
      const next = packedFiles.length - 1 > index ? packedFiles[index + 1].name : undefined;
      const prev = index > 0 ? packedFiles[index - 1].name : undefined;

      // console.log("next:", next);
      // console.log("prev:", prev);

      if (!next && !prev) return 0;
      if (next && prev && !next.startsWith("db\\") && !prev.startsWith("db\\")) return 0;
      if (!next && prev && !prev.startsWith("db\\")) return 0;
      if (!prev && next && !next.startsWith("db\\")) return 0;

      if (!next && prev) {
        const comparison = a.name.localeCompare(prev);
        if (comparison >= 0) return 0;
        else return 1;
      }
      if (next && !prev) {
        const comparison = a.name.localeCompare(next);
        if (comparison <= 0) return 0;
        else return -1;
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return next!.localeCompare(prev!);
    }
    return 0;
  });
};

export const checkIfPackedFilesAreSorted = (packedFiles: PackedFile[]) => {
  for (let i = 0; i < packedFiles.length - 1; i++) {
    if (i + 1 < packedFiles.length - 1) {
      if (packedFiles[i].name.localeCompare(packedFiles[i + 1].name) > 0) return false;
    }
  }
  return true;
};

export const collator = new Intl.Collator("en");

export const binarySearchIncludes = (input: string[], match: string) => {
  return bs(input, match, (a: string, b: string) => collator.compare(a, b)) > -1;
};

export const getInsertionIndexInPresortedArray = <T>(array: Array<T>, value: T) => {
  let low = 0,
    high = array.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (array[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
};

export const insertIntoPresortedArray = <T>(array: Array<T>, value: T) => {
  const insertionIndex = getInsertionIndexInPresortedArray(array, value);
  array.splice(insertionIndex, 0, value);
  return array;
};
