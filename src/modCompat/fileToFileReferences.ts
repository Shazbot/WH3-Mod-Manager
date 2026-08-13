import { DBFileName, FileToFileReference, Pack, PackedFile } from "../packFileTypes";
import { binarySearchIncludes } from "../utility/packFileSorting";
import appData from "../appData";

const packFileToFileReferences: Record<string, Record<DBFileName, FileToFileReference[]>> = {};

export const emptyPackFileToFileReferences = () => {
  for (const packName of Object.keys(packFileToFileReferences)) {
    delete packFileToFileReferences[packName];
  }
};

export function findMissingFileReferences(packsData: Pack[]) {
  console.time("findMissingFileReferences");

  // filename -> pack names containing it. References are already normalized to lower case when they
  // enter the registry, so every lookup below is O(1) and does no repeated case conversion.
  const packNamesByFileName = new Map<string, Set<string>>();
  for (const pack of packsData) {
    for (const packedFile of pack.packedFiles) {
      const normalizedName = packedFile.name.toLowerCase();
      const packNames = packNamesByFileName.get(normalizedName) || new Set<string>();
      packNames.add(pack.name);
      packNamesByFileName.set(normalizedName, packNames);
    }
  }

  for (const [packName, fileToFileRefs] of Object.entries(packFileToFileReferences)) {
    if (!appData.isCompatCheckingVanillaPacks && appData.allVanillaPackNames.has(packName)) continue;

    for (const [fileName, missingFileRefs] of Object.entries(fileToFileRefs)) {
      packFileToFileReferences[packName][fileName] = missingFileRefs.filter((reference) => {
        const containingPackNames = packNamesByFileName.get(reference.reference);
        if (!containingPackNames) return true;
        for (const containingPackName of containingPackNames) {
          if (containingPackName !== packName) return false;
        }
        return true;
      });
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

      packFileToFileReferences[pack.name][packFile.name] = packFileToFileReferences[pack.name][packFile.name] || [];
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
