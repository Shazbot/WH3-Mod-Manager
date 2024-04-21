import * as path from "path";
import { Worker } from "worker_threads";
import * as schema from "../schema/schema_wh3.json";
import { PackCollisions, Pack } from "./packFileTypes";
import {
  findPackFileCollisions,
  findPackTableCollisions,
  findPackTableMissingReferencesAndUniqueIds,
} from "./packFileSerializer";

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
  const [missingTableReferences, uniqueIdsCollisions] = findPackTableMissingReferencesAndUniqueIds(
    packsData,
    onPackChecked
  );

  return {
    packFileCollisions: findPackFileCollisions(packsData, onPackChecked),
    packTableCollisions: findPackTableCollisions(packsData, onPackChecked),
    missingTableReferences,
    uniqueIdsCollisions,
  };
}
