import { HiArrowNarrowDown, HiArrowNarrowUp } from "react-icons/hi";
import React from "react";
import {
  getModsSortedByOrder,
  getModsSortedByName,
  getModsSortedByHumanName,
  getModsSortedByEnabled,
  getModsSortedByLastUpdated,
  getModsSortedByAuthor,
  getModsSortedBySubbedTime,
  getModsSortedByIsDataPack,
  getModsSortedByCustomizable,
} from "../modSortingHelpers";

export enum SortingType {
  PackName,
  PackNameReverse,
  HumanName,
  HumanNameReverse,
  IsEnabled,
  IsEnabledReverse,
  LastUpdated,
  LastUpdatedReverse,
  Ordered,
  OrderedReverse,
  Author,
  AuthorReverse,
  SubbedTime,
  SubbedTimeReverse,
  IsDataPack,
  IsDataPackReverse,
  IsCustomizable,
}

export function isOrderSort(sortingType: SortingType) {
  return sortingType === SortingType.Ordered || sortingType === SortingType.OrderedReverse;
}
export function isEnabledSort(sortingType: SortingType) {
  return sortingType === SortingType.IsEnabled || sortingType === SortingType.IsEnabledReverse;
}
export function isPackNameSort(sortingType: SortingType) {
  return sortingType === SortingType.PackName || sortingType === SortingType.PackNameReverse;
}
export function isDataPackSort(sortingType: SortingType) {
  return sortingType === SortingType.IsDataPack || sortingType === SortingType.IsDataPackReverse;
}
export function isHumanNameSort(sortingType: SortingType) {
  return sortingType === SortingType.HumanName || sortingType === SortingType.HumanNameReverse;
}
export function isLastUpdatedSort(sortingType: SortingType) {
  return sortingType === SortingType.LastUpdated || sortingType === SortingType.LastUpdatedReverse;
}
export function isSubbedTimeSort(sortingType: SortingType) {
  return sortingType === SortingType.SubbedTime || sortingType === SortingType.SubbedTimeReverse;
}
export function isAuthorSort(sortingType: SortingType) {
  return sortingType === SortingType.Author || sortingType === SortingType.AuthorReverse;
}
export function isCustomizableSort(sortingType: SortingType) {
  return sortingType === SortingType.IsCustomizable;
}

const sortingArrowClassNames = "inline h-4 overflow-visible";
export function getSortingArrow(sortingType: SortingType) {
  return (
    (sortingType === SortingType.PackName && (
      <HiArrowNarrowDown className={sortingArrowClassNames}></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.PackNameReverse && (
      <HiArrowNarrowUp className={sortingArrowClassNames}></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.HumanName && (
      <HiArrowNarrowDown className={sortingArrowClassNames}></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.HumanNameReverse && (
      <HiArrowNarrowUp className={sortingArrowClassNames}></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.LastUpdated && (
      <HiArrowNarrowDown className={sortingArrowClassNames}></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.SubbedTime && (
      <HiArrowNarrowDown className={sortingArrowClassNames}></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.SubbedTimeReverse && (
      <HiArrowNarrowUp className={sortingArrowClassNames}></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.LastUpdatedReverse && (
      <HiArrowNarrowUp className={sortingArrowClassNames}></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.IsEnabled && (
      <HiArrowNarrowDown className={sortingArrowClassNames}></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.IsEnabledReverse && (
      <HiArrowNarrowUp className={sortingArrowClassNames}></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.IsDataPack && (
      <HiArrowNarrowDown className={sortingArrowClassNames}></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.IsDataPackReverse && (
      <HiArrowNarrowUp className={sortingArrowClassNames}></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.Ordered && (
      <HiArrowNarrowDown className={sortingArrowClassNames}></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.OrderedReverse && (
      <HiArrowNarrowUp className={sortingArrowClassNames}></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.Author && (
      <HiArrowNarrowDown className={sortingArrowClassNames}></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.AuthorReverse && (
      <HiArrowNarrowUp className={sortingArrowClassNames}></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.IsCustomizable && (
      <HiArrowNarrowDown className={sortingArrowClassNames}></HiArrowNarrowDown>
    )) || <></>
  );
}

export function getSortedMods(
  presetMods: Mod[],
  orderedMods: Mod[],
  sortingType: SortingType,
  customizableMods: Record<string, string[]>,
) {
  let mods: Mod[] = [];

  switch (sortingType) {
    case SortingType.Ordered:
    case SortingType.OrderedReverse:
      mods = getModsSortedByOrder(presetMods, orderedMods);

      if (sortingType == SortingType.OrderedReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.PackName:
    case SortingType.PackNameReverse:
      mods = getModsSortedByName(presetMods);

      if (sortingType == SortingType.PackNameReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.IsDataPack:
    case SortingType.IsDataPackReverse:
      mods = getModsSortedByIsDataPack(presetMods);

      if (sortingType == SortingType.IsDataPackReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.HumanName:
    case SortingType.HumanNameReverse:
      mods = getModsSortedByHumanName(presetMods);

      if (sortingType == SortingType.HumanNameReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.IsEnabled:
    case SortingType.IsEnabledReverse:
      mods = getModsSortedByEnabled(presetMods, orderedMods, sortingType === SortingType.IsEnabled);
      break;
    case SortingType.LastUpdated:
    case SortingType.LastUpdatedReverse:
      mods = getModsSortedByLastUpdated(presetMods);

      if (sortingType == SortingType.LastUpdatedReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.SubbedTime:
    case SortingType.SubbedTimeReverse:
      mods = getModsSortedBySubbedTime(presetMods);

      if (sortingType == SortingType.SubbedTimeReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.Author:
    case SortingType.AuthorReverse:
      // The direction goes in rather than being applied after, so the authorless mods stay at the end.
      mods = getModsSortedByAuthor(presetMods, sortingType === SortingType.AuthorReverse);
      break;
    case SortingType.IsCustomizable:
      mods = getModsSortedByCustomizable(presetMods, customizableMods);
      break;
  }
  return mods;
}

/**
 * The fields the compact layout stacks into its one name column, in the order right clicking steps
 * through them. Data mods are only worth a step in a list that holds any.
 */
export const getNameSortingCycle = (hasDataMods: boolean) =>
  hasDataMods
    ? [SortingType.HumanName, SortingType.PackName, SortingType.Author, SortingType.IsDataPack]
    : [SortingType.HumanName, SortingType.PackName, SortingType.Author];

/** Which of those fields a sorting type sorts by, or undefined when it belongs to another column. */
export function getNameSortingField(sortingType: SortingType) {
  if (isHumanNameSort(sortingType)) return SortingType.HumanName;
  if (isPackNameSort(sortingType)) return SortingType.PackName;
  if (isAuthorSort(sortingType)) return SortingType.Author;
  if (isDataPackSort(sortingType)) return SortingType.IsDataPack;
  return undefined;
}

/**
 * The field right clicking the column moves to. A sort that belongs to another column starts the cycle
 * from the top, and so does a data pack sort in a list that no longer has any data mods.
 */
export function getNextNameSortingType(sortingType: SortingType, hasDataMods: boolean) {
  const cycle = getNameSortingCycle(hasDataMods);
  const currentField = getNameSortingField(sortingType);
  const currentIndex = currentField === undefined ? -1 : cycle.indexOf(currentField);
  return cycle[(currentIndex + 1) % cycle.length];
}

/** The two dates the time column can sort by, in the order right clicking swaps between them. */
export const getTimeSortingCycle = () => [SortingType.LastUpdated, SortingType.SubbedTime];

/** Which of the two a sorting type sorts by, or undefined when it belongs to another column. */
export function getTimeSortingField(sortingType: SortingType) {
  if (isLastUpdatedSort(sortingType)) return SortingType.LastUpdated;
  if (isSubbedTimeSort(sortingType)) return SortingType.SubbedTime;
  return undefined;
}

/**
 * The date right clicking the time column swaps to. A sort that belongs to another column lands on the
 * subscribed date: it is the one a left click cannot reach, so the gesture always changes something.
 */
export function getNextTimeSortingType(sortingType: SortingType) {
  return isSubbedTimeSort(sortingType) ? SortingType.LastUpdated : SortingType.SubbedTime;
}

const sortTypeToReverseType: { [key in SortingType]?: SortingType } = {
  [SortingType.Ordered]: SortingType.OrderedReverse,
  [SortingType.IsEnabled]: SortingType.IsEnabledReverse,
  [SortingType.PackName]: SortingType.PackNameReverse,
  [SortingType.IsDataPack]: SortingType.IsDataPackReverse,
  [SortingType.HumanName]: SortingType.HumanNameReverse,
  [SortingType.LastUpdated]: SortingType.LastUpdatedReverse,
  [SortingType.SubbedTime]: SortingType.SubbedTimeReverse,
  [SortingType.Author]: SortingType.AuthorReverse,
  [SortingType.IsCustomizable]: SortingType.IsCustomizable,
};

export const getNewSortType = (newSortingType: SortingType, currentSortingType: SortingType) => {
  return (currentSortingType == newSortingType && sortTypeToReverseType[currentSortingType]) || newSortingType;
};
