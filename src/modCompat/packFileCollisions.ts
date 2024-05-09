import { PackFileCollision, Pack } from "../packFileTypes";
import { vanillaPackNames } from "../supportedGames";
import { collator } from "../utility/packFileSorting";
import { diff } from "deep-object-diff";
import * as fs from "fs";

export function removeFromPackFileCollisions(
  packFileCollisions: PackFileCollision[],
  removedPackName: string
) {
  return packFileCollisions.filter((collision) => {
    return collision.firstPackName != removedPackName && collision.secondPackName != removedPackName;
  });
}

export function appendPackFileCollisions(
  packsData: Pack[],
  packFileCollisions: PackFileCollision[],
  newPack: Pack
) {
  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    if (pack === newPack) continue;
    if (pack.name === newPack.name) continue;
    if (vanillaPackNames.includes(pack.name) || vanillaPackNames.includes(newPack.name)) continue;

    findPackFileCollisionsBetweenPacks(pack, newPack, packFileCollisions);
  }

  return packFileCollisions;
}

export function findPackFileCollisionsBetweenPacks(
  pack: Pack,
  packTwo: Pack,
  conflicts: PackFileCollision[]
) {
  for (const packFile of pack.packedFiles) {
    if (packFile.name.endsWith(".rpfm_reserved")) continue;
    for (const packTwoFile of packTwo.packedFiles) {
      if (packTwoFile.name.endsWith(".rpfm_reserved")) continue;
      if (packFile.name === packTwoFile.name) {
        conflicts.push({
          firstPackName: pack.name,
          secondPackName: packTwo.name,
          fileName: packFile.name,
        });

        conflicts.push({
          secondPackName: pack.name,
          firstPackName: packTwo.name,
          fileName: packFile.name,
        });
        // console.log("FOUND CONFLICT");
        // console.log(pack.name, packTwo.name, packFile.name);
      }
    }
  }
}

export function findPackFileCollisionsBetweenPacksOptimized(
  pack: Pack,
  packTwo: Pack,
  conflicts: PackFileCollision[]
) {
  let i = 0,
    j = 0;
  while (i < pack.packedFiles.length && j < packTwo.packedFiles.length) {
    const packFile = pack.packedFiles[i];
    const packTwoFile = packTwo.packedFiles[j];

    if (packFile.name.endsWith(".rpfm_reserved")) {
      i++;
      continue;
    }
    if (packTwoFile.name.endsWith(".rpfm_reserved")) {
      j++;
      continue;
    }

    const compared = collator.compare(packFile.name, packTwoFile.name);
    switch (compared) {
      case -1:
        i++;
        break;
      case 0:
        // if (packFile.file_size != packTwoFile.file_size) {
        //   console.log("name:", packFile.name);
        //   console.log("sizes:", packFile.file_size, packTwoFile.file_size);
        // }
        conflicts.push({
          firstPackName: pack.name,
          secondPackName: packTwo.name,
          fileName: packFile.name,
          areSameSize: packFile.file_size == packTwoFile.file_size,
        });

        conflicts.push({
          secondPackName: pack.name,
          firstPackName: packTwo.name,
          fileName: packFile.name,
          areSameSize: packFile.file_size == packTwoFile.file_size,
        });
        i++;
        j++;
        break;
      case 1:
        j++;
        break;
    }
  }
}

// TEST METHOD, test the optimized algorithm against the unoptimized one to check for equality
export function findPackFileCollisionsAndCompareWithUnoptimizedMethod(
  packsData: Pack[],
  onPackChecked?: OnPackChecked
) {
  console.time("findPackFileCollisionsBetweenPacks");
  const conflicts: PackFileCollision[] = [];
  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    for (let j = i + 1; j < packsData.length; j++) {
      const packTwo = packsData[j];
      if (pack === packTwo) continue;
      if (pack.name === packTwo.name) continue;
      if (vanillaPackNames.includes(pack.name) || vanillaPackNames.includes(packTwo.name)) continue;

      if (onPackChecked) onPackChecked(i, packsData.length - 1, pack.name, packTwo.name, "TableKeys");
      findPackFileCollisionsBetweenPacks(pack, packTwo, conflicts);
    }
  }
  console.timeEnd("findPackFileCollisionsBetweenPacks");

  const conflicts2 = findPackFileCollisions(packsData, onPackChecked);

  const areConflictsEqual =
    conflicts.length == conflicts2.length &&
    conflicts.every((conflict) =>
      conflicts2.some(
        (conflict2) =>
          conflict.fileName == conflict2.fileName &&
          conflict.firstPackName == conflict2.firstPackName &&
          conflict.secondPackName == conflict2.secondPackName
      )
    );
  console.log("findPackFileCollisions are EQUAL:", areConflictsEqual);
  const diffData = diff(conflicts, conflicts2);
  if (!areConflictsEqual) fs.writeFileSync("findPackFileCollisions.json", JSON.stringify(diffData));

  return conflicts2;
}

export function findPackFileCollisions(packsData: Pack[], onPackChecked?: OnPackChecked) {
  console.time("findPackFileCollisionsBetweenPacksOptimized");
  const conflicts: PackFileCollision[] = [];
  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    for (let j = i + 1; j < packsData.length; j++) {
      const packTwo = packsData[j];
      if (pack === packTwo) continue;
      if (pack.name === packTwo.name) continue;
      if (vanillaPackNames.includes(pack.name) || vanillaPackNames.includes(packTwo.name)) continue;

      if (onPackChecked) onPackChecked(i, packsData.length - 1, pack.name, packTwo.name, "TableKeys");
      findPackFileCollisionsBetweenPacksOptimized(pack, packTwo, conflicts);
    }
  }
  console.timeEnd("findPackFileCollisionsBetweenPacksOptimized");

  return conflicts;
}
