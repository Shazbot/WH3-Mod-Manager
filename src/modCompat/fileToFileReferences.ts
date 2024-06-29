import bs from "binary-search";
import { DBFileName, FileToFileReference, Pack, PackedFile } from "../packFileTypes";
import { vanillaPackNames } from "../supportedGames";
import { collator, binarySearchIncludes } from "../utility/packFileSorting";
import appData from "../appData";

const packFileToFileReferences: Record<string, Record<DBFileName, FileToFileReference[]>> = {};

export const emptyPackFileToFileReferences = () => {
  for (const packName of Object.keys(packFileToFileReferences)) {
    delete packFileToFileReferences[packName];
  }
};

export function findMissingFileReferences(packsData: Pack[]) {
  // console.log("packFileToFileReferences:", packFileToFileReferences);
  console.time("findMissingFileReferences");
  const foundFileRefs: FileToFileReference[] = [];
  for (const [packName, fileToFileRefs] of Object.entries(packFileToFileReferences)) {
    for (let i = 0; i < packsData.length; i++) {
      const packTwo = packsData[i];
      // console.log("looking:", packTwo.name, packName);
      if (packTwo.name === packName) continue;
      if (!appData.isCompatCheckingVanillaPacks) {
        if (appData.allVanillaPackNames.includes(packName)) continue;
      }

      for (const [fileName, missingFileRefs] of Object.entries(fileToFileRefs)) {
        for (const missingFileRef of missingFileRefs) {
          const bsIndex = bs(packTwo.packedFiles, missingFileRef.reference, (a: PackedFile, b: string) =>
            collator.compare(a.name.toLowerCase(), b.toLowerCase())
          );
          if (bsIndex > -1) {
            foundFileRefs.push(missingFileRef);
            // console.log(
            //   `findMissingFileReferences: found ${missingFileRef.reference} in ${packName} in ${packTwo.name}`
            // );
          }
        }

        packFileToFileReferences[packName][fileName] = packFileToFileReferences[packName][fileName].filter(
          (ref) => !foundFileRefs.includes(ref)
        );
        foundFileRefs.length = 0;
      }

      // if (onPackChecked) onPackChecked(i, packsData.length - 1, pack.name, packTwo.name, "TableKeys");
      // findPackFileCollisionsBetweenPacksOptimized(pack, packTwo, conflicts);
    }
  }
  console.timeEnd("findMissingFileReferences");
  return packFileToFileReferences;
}

export function appendToFileToFileRegistry(pack: Pack, packFile: PackedFile, referencedFiles: string[]) {
  // console.log(xmlAsObject);
  referencedFiles = referencedFiles.map((refFile) => refFile.replaceAll("/", "\\").toLowerCase());
  // console.log("packFile:", packFile.name, "referencedFiles:", referencedFiles);
  const packedFilesNames = pack.packedFiles.map((pF) => pF.name.toLowerCase());
  // console.log(packedFilesNames);
  for (const referencedFile of referencedFiles) {
    if (!binarySearchIncludes(packedFilesNames, referencedFile)) {
      packFileToFileReferences[pack.name] = packFileToFileReferences[pack.name] || {};

      if (
        packFileToFileReferences[pack.name][packFile.name] &&
        packFileToFileReferences[pack.name][packFile.name].some((fileToFileRef) => {
          return (
            fileToFileRef.reference == referencedFile &&
            fileToFileRef.packName == pack.name &&
            fileToFileRef.packFileName == packFile.name
          );
        })
      )
        continue;

      packFileToFileReferences[pack.name][packFile.name] =
        packFileToFileReferences[pack.name][packFile.name] || [];
      packFileToFileReferences[pack.name][packFile.name].push({
        reference: referencedFile,
        packName: pack.name,
        packFileName: packFile.name,
      });
      // console.log(`referenced file ${referencedFile} not found in pack ${pack.name}`);
    }
  }
  // if (packFile.name.includes("aarb_alrahem_nomad_bow_sword"))
  //   fs.writeFileSync("dumps/aarb_alrahem_nomad_bow_sword.json", JSON.stringify(xmlAsObject));
}
