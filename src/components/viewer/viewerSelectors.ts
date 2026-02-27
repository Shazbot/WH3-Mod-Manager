import { createSelector } from "@reduxjs/toolkit";
import { RootState } from "@/src/store";
import { PackedFile } from "@/src/packFileTypes";

const selectPacksData = (state: RootState) => state.app.packsData;
const selectUnsavedPacksData = (state: RootState) => state.app.unsavedPacksData;
const selectPackPath = (_state: RootState, packPath: string) => packPath;
const EMPTY_UNSAVED_FILES: PackedFile[] = [];

export const makeSelectCurrentPackData = () =>
  createSelector([selectPacksData, selectPackPath], (packsData, packPath) => packsData[packPath]);

export const makeSelectCurrentPackUnsavedFiles = () =>
  createSelector(
    [selectUnsavedPacksData, selectPackPath],
    (unsavedPacksData, packPath) => unsavedPacksData[packPath] || EMPTY_UNSAVED_FILES,
  );
