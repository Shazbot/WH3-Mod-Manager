import * as path from "path";
import { Worker } from "worker_threads";
import * as schema from "../../schema/schema_wh3.json";
import { PackCollisions, Pack, DBRefOrigin } from "../packFileTypes";

import { emptyPackFileToFileReferences, findMissingFileReferences } from "./fileToFileReferences";
import { emptyPackFileAnalysisErrors, packFileAnalysisErrors } from "./fileSyntaxChecks";
import { findPackTableReferencesOptimized } from "./missingDBTableReferences";
import {
  emptyPackToScriptFilesWithListeners,
  processPackToScriptFilesWithListeners,
} from "./scriptFileListenerNames";
import { emptyPackToTablesWithUniqueIds, processPackToTablesWithUniqueIds } from "./uniqueDBTableIndices";
import { findPackFileCollisions } from "./packFileCollisions";
import { findPackTableCollisions } from "./packTableCollisions";
import * as fs from "fs";
import appData from "../appData";

export async function getCompatDataWithWorker(packsData: Pack[]): Promise<PackCollisions> {
  return await new Promise<PackCollisions>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "readPacksWorker.js"), {
      workerData: { checkCompat: true, packsData, schema },
    });
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Stopped with  ${code} exit code`));
    });
  });
}

export function getCompatData(
  packsData: Pack[],
  onPackChecked?: (
    currentIndex: number,
    maxIndex: number,
    firstPackName: string,
    secondPackName: string,
    type: PackCollisionCheckType
  ) => void
): PackCollisions {
  const { missingRefs, uniqueIdsCollisions, scriptListenerCollisions, packFileAnalysisErrors } =
    findPackTableMissingReferencesAndRunAnalysis(packsData, onPackChecked);

  const missingFileRefs = findMissingFileReferences(packsData);

  // fs.writeFileSync("dumps/missingRefs.json", JSON.stringify(missingRefs));
  // fs.writeFileSync(
  //   "dumps/allVanillaPackNames.json",
  //   JSON.stringify(
  //     appData.allVanillaPackNames.filter(
  //       (packName) =>
  //         packName.startsWith("local_en") ||
  //         (!packName.startsWith("audio_") && !packName.startsWith("local_"))
  //     )
  //   )
  // );

  return {
    packFileCollisions: findPackFileCollisions(packsData, onPackChecked),
    packTableCollisions: findPackTableCollisions(packsData, onPackChecked),
    missingTableReferences: missingRefs,
    uniqueIdsCollisions,
    scriptListenerCollisions,
    packFileAnalysisErrors,
    missingFileRefs,
  };
}

export const emptyAllCompatDataCollections = () => {
  emptyPackToTablesWithUniqueIds();
  emptyPackToScriptFilesWithListeners();
  emptyPackFileAnalysisErrors();
  emptyPackFileToFileReferences();
};

export const refSorting = (a: DBRefOrigin, b: DBRefOrigin): number => {
  const f = a.targetDBFileName.localeCompare(b.targetDBFileName);
  if (f !== 0) return f;
  const c = a.targetFieldName.localeCompare(b.targetFieldName);
  if (c !== 0) return c;
  const e = a.value.localeCompare(b.value);
  if (e !== 0) return e;
  const d = a.originFieldName.localeCompare(b.originFieldName);
  if (d !== 0) return d;
  const g = a.originDBFileName.localeCompare(b.originDBFileName);
  if (g !== 0) return d;
  return a.originFileSuffix.localeCompare(b.originFileSuffix);
};

export function findPackTableMissingReferencesAndRunAnalysis(
  packsData: Pack[],
  onPackChecked?: OnPackChecked
) {
  // keep this at top, these are populated inside findPackTableReferencesOptimized
  emptyAllCompatDataCollections();

  const missingRefs = findPackTableReferencesOptimized(packsData, onPackChecked);

  Object.values(missingRefs).forEach((refs) => refs.sort(refSorting));

  // fs.writeFileSync("dumps/packToTablesWithUniqueIds.json", JSON.stringify(packToTablesWithUniqueIds));
  const uniqueIdsCollisions = processPackToTablesWithUniqueIds();
  const scriptListenerCollisions = processPackToScriptFilesWithListeners();
  // fs.writeFileSync("dumps/uniqueIdsCollisions.json", JSON.stringify(uniqueIdsCollisions));
  // fs.writeFileSync(
  //   "dumps/packToScriptFilesWithListeners.json",
  //   JSON.stringify(packToScriptFilesWithListeners)
  // );
  // fs.writeFileSync("dumps/scriptListenerCollisions.json", JSON.stringify(scriptListenerCollisions));

  return {
    missingRefs,
    uniqueIdsCollisions,
    scriptListenerCollisions,
    packFileAnalysisErrors,
  } as PacksAnalysisData;
}
