import { HiArrowNarrowDown, HiArrowNarrowUp } from "react-icons/hi";
import React from "react";
import {
  getModsSortedByOrder,
  getModsSortedByName,
  getModsSortedByHumanName,
  getModsSortedByEnabled,
  getModsSortedByLastUpdated,
  getModsSortedByAuthor,
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
export function isHumanNameSort(sortingType: SortingType) {
  return sortingType === SortingType.HumanName || sortingType === SortingType.HumanNameReverse;
}
export function isLastUpdatedSort(sortingType: SortingType) {
  return sortingType === SortingType.LastUpdated || sortingType === SortingType.LastUpdatedReverse;
}
export function isAuthorSort(sortingType: SortingType) {
  return sortingType === SortingType.Author || sortingType === SortingType.AuthorReverse;
}

export function getSortingArrow(sortingType: SortingType) {
  return (
    (sortingType === SortingType.PackName && (
      <HiArrowNarrowDown className="inline h-4 overflow-visible"></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.PackNameReverse && (
      <HiArrowNarrowUp className="inline h-4 overflow-visible"></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.HumanName && (
      <HiArrowNarrowDown className="inline h-4 overflow-visible"></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.HumanNameReverse && (
      <HiArrowNarrowUp className="inline h-4 overflow-visible"></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.LastUpdated && (
      <HiArrowNarrowDown className="inline h-4 overflow-visible"></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.LastUpdatedReverse && (
      <HiArrowNarrowUp className="inline h-4 overflow-visible"></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.IsEnabled && (
      <HiArrowNarrowDown className="inline h-4 overflow-visible"></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.IsEnabledReverse && (
      <HiArrowNarrowUp className="inline h-4 overflow-visible"></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.Ordered && (
      <HiArrowNarrowDown className="inline h-4 overflow-visible"></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.OrderedReverse && (
      <HiArrowNarrowUp className="inline h-4 overflow-visible"></HiArrowNarrowUp>
    )) ||
    (sortingType === SortingType.Author && (
      <HiArrowNarrowDown className="inline h-4 overflow-visible"></HiArrowNarrowDown>
    )) ||
    (sortingType === SortingType.AuthorReverse && (
      <HiArrowNarrowUp className="inline h-4 overflow-visible"></HiArrowNarrowUp>
    )) || <></>
  );
}

export function getSortedMods(presetMods: Mod[], orderedMods: Mod[], sortingType: SortingType) {
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
    case SortingType.HumanName:
    case SortingType.HumanNameReverse:
      mods = getModsSortedByHumanName(presetMods);

      if (sortingType == SortingType.HumanNameReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.IsEnabled:
    case SortingType.IsEnabledReverse:
      mods = getModsSortedByEnabled(presetMods);
      if (sortingType == SortingType.IsEnabledReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.LastUpdated:
    case SortingType.LastUpdatedReverse:
      mods = getModsSortedByLastUpdated(presetMods);

      if (sortingType == SortingType.LastUpdatedReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.Author:
    case SortingType.AuthorReverse:
      mods = getModsSortedByAuthor(presetMods);

      if (sortingType == SortingType.AuthorReverse) {
        mods = mods.reverse();
      }
      break;
  }
  return mods;
}

export const onOrderedSort = (setSortingType: React.Dispatch<React.SetStateAction<SortingType>>) => {
  setSortingType((prevState) => {
    return prevState === SortingType.Ordered ? SortingType.OrderedReverse : SortingType.Ordered;
  });
};
export const onEnabledSort = (setSortingType: React.Dispatch<React.SetStateAction<SortingType>>) => {
  setSortingType((prevState) => {
    return prevState === SortingType.IsEnabled ? SortingType.IsEnabledReverse : SortingType.IsEnabled;
  });
};
export const onPackSort = (setSortingType: React.Dispatch<React.SetStateAction<SortingType>>) => {
  setSortingType((prevState) => {
    return prevState === SortingType.PackName ? SortingType.PackNameReverse : SortingType.PackName;
  });
};
export const onNameSort = (setSortingType: React.Dispatch<React.SetStateAction<SortingType>>) => {
  setSortingType((prevState) => {
    return prevState === SortingType.HumanName ? SortingType.HumanNameReverse : SortingType.HumanName;
  });
};
export const onLastUpdatedSort = (setSortingType: React.Dispatch<React.SetStateAction<SortingType>>) => {
  setSortingType((prevState) => {
    return prevState === SortingType.LastUpdated ? SortingType.LastUpdatedReverse : SortingType.LastUpdated;
  });
};
export const onAuthorSort = (setSortingType: React.Dispatch<React.SetStateAction<SortingType>>) => {
  setSortingType((prevState) => {
    return prevState === SortingType.Author ? SortingType.AuthorReverse : SortingType.Author;
  });
};
