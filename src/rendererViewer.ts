import "./index.css";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-material.css";

import hash from "object-hash";

import store from "./store";
import { renderViewerWindow } from "./appViewer";
import { setupRendererLogging } from "./rendererCommon";
import {
  selectDBTable,
  setCurrentGameNaive,
  setCurrentLanguage,
  setIsFeaturesForModdersEnabled,
  setModdersPrefix,
  setPacksData,
  setReferencesHash,
  setStartArgs,
  setUnsavedPacksData,
} from "./appSlice";
import { DBFieldName, DBFileName, DBVersion, Pack, PackedFile } from "./packFileTypes";
import { dataFromBackend, doneRequests, packDataStore } from "./components/viewer/packDataStore";
import { tableNameWithDBPrefix } from "./utility/packFileHelpers";

setupRendererLogging();

console.log("IN RENDERER (viewer)");

window.api?.viewerIsReady();

window.api?.setStartArgs((event, startArgs) => {
  store.dispatch(setStartArgs(startArgs));
});

window.api?.setCurrentLanguage((event, language: string) => {
  store.dispatch(setCurrentLanguage(language));
});

window.api?.setIsFeaturesForModdersEnabled((event, isFeaturesForModdersEnabled) => {
  store.dispatch(setIsFeaturesForModdersEnabled(isFeaturesForModdersEnabled));
});

window.api?.setModdersPrefix((event, moddersPrefix) => {
  store.dispatch(setModdersPrefix(moddersPrefix));
});

window.api?.setCurrentGameNaive((event, game) => {
  store.dispatch(setCurrentGameNaive(game));
});

window.api?.openModInViewer((event, modPath: string) => {
  store.dispatch(
    selectDBTable({
      packPath: modPath,
      dbName: "main_units_tables",
      dbSubname: "",
    }),
  );
});

window.api?.setPacksData((event, packsData: PackViewData[]) => {
  if (!packsData || packsData.length == 0) return;
  store.dispatch(setPacksData(packsData));
});

window.api?.setUnsavedPacksData((event, packPath: string, unsavedFileData: PackedFile[]) => {
  store.dispatch(setUnsavedPacksData({ packPath, unsavedFileData } as SetUnsavedPacksDataPayload));
});

window.api?.setPackDataStore(
  (event, packPath: string, pack: Pack, tableReferenceRequests: TableReferenceRequest[]) => {
    packDataStore[packPath] = pack;

    doneRequests[packPath] = doneRequests[packPath] || [];
    tableReferenceRequests
      .filter(
        (tableReferenceRequest) =>
          !doneRequests[packPath].some(
            (doneReq) =>
              tableNameWithDBPrefix(tableReferenceRequest.tableName) == tableNameWithDBPrefix(doneReq),
          ),
      )
      .forEach((tableReferenceRequest) => {
        doneRequests[packPath].push(tableNameWithDBPrefix(tableReferenceRequest.tableName));
      });

    store.dispatch(setReferencesHash(hash(packDataStore[packPath].packedFiles.map((pf) => pf.name))));
  },
);

window.api?.appendPackDataStore(
  (
    event,
    packPath: string,
    packFilesToAppend: PackedFile[],
    tableReferenceRequests: TableReferenceRequest[],
  ) => {
    const pack = packDataStore[packPath];
    if (!pack) return;

    pack.packedFiles = pack.packedFiles
      .filter((pF) => !packFilesToAppend.some((pFPlus) => pFPlus.name == pF.name))
      .concat(packFilesToAppend);

    doneRequests[packPath] = doneRequests[packPath] || [];
    tableReferenceRequests
      .filter(
        (tableReferenceRequest) =>
          !doneRequests[packPath].some(
            (doneReq) =>
              tableNameWithDBPrefix(tableReferenceRequest.tableName) == tableNameWithDBPrefix(doneReq),
          ),
      )
      .forEach((tableReferenceRequest) => {
        doneRequests[packPath].push(tableNameWithDBPrefix(tableReferenceRequest.tableName));
      });

    store.dispatch(setReferencesHash(hash(packDataStore[packPath].packedFiles.map((pf) => pf.name))));
  },
);

window.api?.setDBNameToDBVersions(
  (
    event,
    DBNameToDBVersions: Record<string, DBVersion[]>,
    DBFieldsThatReference: Record<DBFileName, Record<DBFieldName, string[]>>,
    referencedColums: Record<string, string[]>,
  ) => {
    dataFromBackend.DBNameToDBVersions = DBNameToDBVersions;
    dataFromBackend.DBFieldsThatReference = DBFieldsThatReference;
    dataFromBackend.DBFieldsReferencedBy = {} as Record<DBFileName, Record<DBFieldName, string[][]>>;
    dataFromBackend.referencedColums = referencedColums;

    for (const [tableName, dbFieldToReference] of Object.entries(DBFieldsThatReference)) {
      for (const [dbFieldName, references] of Object.entries(dbFieldToReference)) {
        const [referencedTableName, referencedFieldName] = references;
        dataFromBackend.DBFieldsReferencedBy[referencedTableName] =
          dataFromBackend.DBFieldsReferencedBy[referencedTableName] || {};

        if (!dataFromBackend.DBFieldsReferencedBy[referencedTableName][referencedFieldName])
          dataFromBackend.DBFieldsReferencedBy[referencedTableName][referencedFieldName] = [];

        if (
          !dataFromBackend.DBFieldsReferencedBy[referencedTableName][referencedFieldName].some(
            (reference) => reference[0] == tableName && reference[1] == dbFieldName,
          )
        ) {
          dataFromBackend.DBFieldsReferencedBy[referencedTableName][referencedFieldName].push([
            tableName,
            dbFieldName,
          ]);
        }
      }
    }
  },
);

renderViewerWindow();
