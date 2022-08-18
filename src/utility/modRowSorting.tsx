import { ArrowNarrowDownIcon, ArrowNarrowUpIcon } from "@heroicons/react/solid";
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
      <ArrowNarrowDownIcon className="inline h-4 overflow-visible"></ArrowNarrowDownIcon>
    )) ||
    (sortingType === SortingType.PackNameReverse && (
      <ArrowNarrowUpIcon className="inline h-4 overflow-visible"></ArrowNarrowUpIcon>
    )) ||
    (sortingType === SortingType.HumanName && (
      <ArrowNarrowDownIcon className="inline h-4 overflow-visible"></ArrowNarrowDownIcon>
    )) ||
    (sortingType === SortingType.HumanNameReverse && (
      <ArrowNarrowUpIcon className="inline h-4 overflow-visible"></ArrowNarrowUpIcon>
    )) ||
    (sortingType === SortingType.LastUpdated && (
      <ArrowNarrowDownIcon className="inline h-4 overflow-visible"></ArrowNarrowDownIcon>
    )) ||
    (sortingType === SortingType.LastUpdatedReverse && (
      <ArrowNarrowUpIcon className="inline h-4 overflow-visible"></ArrowNarrowUpIcon>
    )) ||
    (sortingType === SortingType.IsEnabled && (
      <ArrowNarrowDownIcon className="inline h-4 overflow-visible"></ArrowNarrowDownIcon>
    )) ||
    (sortingType === SortingType.IsEnabledReverse && (
      <ArrowNarrowUpIcon className="inline h-4 overflow-visible"></ArrowNarrowUpIcon>
    )) ||
    (sortingType === SortingType.Ordered && (
      <ArrowNarrowDownIcon className="inline h-4 overflow-visible"></ArrowNarrowDownIcon>
    )) ||
    (sortingType === SortingType.OrderedReverse && (
      <ArrowNarrowUpIcon className="inline h-4 overflow-visible"></ArrowNarrowUpIcon>
    )) ||
    (sortingType === SortingType.Author && (
      <ArrowNarrowDownIcon className="inline h-4 overflow-visible"></ArrowNarrowDownIcon>
    )) ||
    (sortingType === SortingType.AuthorReverse && (
      <ArrowNarrowUpIcon className="inline h-4 overflow-visible"></ArrowNarrowUpIcon>
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
