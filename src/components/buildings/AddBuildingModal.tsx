import React, { memo, useState } from "react";
import { Modal } from "../../flowbite";
import { useLocalizations } from "../../localizationContext";
import type { AddBuildingLevelInput, BuildingLevelShift } from "../../buildingsData/editActions";
import type { BuildingsRegionQuery, BuildingsTile } from "../../buildingsData/types";
import { suggestBuildingLevelKey } from "./buildingKey";

export type AddBuildingModalProps = {
  /** The source building, which also fixes the new level's chain and band. */
  from: BuildingsTile;
  direction?: "above" | "below";
  shiftedLevelRows?: BuildingLevelShift[];
  query: BuildingsRegionQuery;
  keyPrefix: string;
  onCancel: () => void;
  onAdd: (input: AddBuildingLevelInput) => void;
};

const labelClass = "flex flex-col gap-1 text-xs text-gray-400";
const inputClass = "rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-100";

const AddBuildingModal = memo(
  ({ from, direction = "above", shiftedLevelRows = [], query, keyPrefix, onCancel, onAdd }: AddBuildingModalProps) => {
    const localized = useLocalizations();
    const isBelow = direction === "below";
    const newLevel = isBelow ? from.level : from.level + 1;
    const suggestedKey = suggestBuildingLevelKey(keyPrefix, from.chainKey, newLevel);
    const [levelKey, setLevelKey] = useState(suggestedKey.toLowerCase());
    const [title, setTitle] = useState("");
    const [shortDescription, setShortDescription] = useState("");
    const [createTime, setCreateTime] = useState(`${from.createTime || 1}`);
    const [createCost, setCreateCost] = useState(`${Math.round((from.createCost || 500) * 1.5)}`);
    const [upkeepCost, setUpkeepCost] = useState(`${Math.round((from.upkeepCost || 0) * 1.5)}`);
    // A tier normally keeps what the one below it does and adds to it, so copying is the default.
    const [copyEffects, setCopyEffects] = useState(true);

    const trimmedKey = levelKey.trim();
    const canAdd = trimmedKey !== "" && title.trim() !== "";
    const scope =
      [query.culture, query.subculture, query.faction].filter(Boolean).join(" / ") ||
      localized.buildingsEveryCulture ||
      "every culture";
    const description = (
      isBelow
        ? localized.buildingsAddBuildingDescriptionBelow ||
          "Goes into {{chain}} at level {{level}}, upgrading to {{building}}. The culture variant is written for {{scope}}."
        : localized.buildingsAddBuildingDescriptionAbove ||
          "Goes into {{chain}} at level {{level}}, upgrading from {{building}}. The culture variant is written for {{scope}}."
    )
      .replace("{{chain}}", from.chainKey)
      .replace("{{level}}", `${newLevel}`)
      .replace("{{building}}", from.levelKey)
      .replace("{{scope}}", scope);

    return (
      <Modal onClose={onCancel} show size="lg" position="center">
        <Modal.Header>
          {(isBelow
            ? localized.buildingsAddBuildingBelowTitle || "Add a building below {{title}}"
            : localized.buildingsAddBuildingAboveTitle || "Add a building above {{title}}"
          ).replace("{{title}}", from.title)}
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-3">
            <p className="text-xs text-gray-400">{description}</p>

            <label className={labelClass}>
              {localized.buildingsBuildingKey || "Building key"}
              <input value={levelKey} onChange={(event) => setLevelKey(event.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>
              {localized.buildingsName || "Name"}
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={localized.buildingsShownInGame || "Shown in game"}
                className={inputClass}
                autoFocus
              />
            </label>
            <label className={labelClass}>
              {localized.buildingsShortDescription || "Short description"}
              <input
                value={shortDescription}
                onChange={(event) => setShortDescription(event.target.value)}
                className={inputClass}
              />
            </label>

            {from.effects.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <input
                  type="checkbox"
                  checked={copyEffects}
                  onChange={(event) => setCopyEffects(event.target.checked)}
                />
                {(from.effects.length === 1
                  ? localized.buildingsCopyEffectsOne || "Copy the effect from {{title}}"
                  : localized.buildingsCopyEffectsOther || "Copy the {{count}} effects from {{title}}"
                )
                  .replace("{{count}}", `${from.effects.length}`)
                  .replace("{{title}}", from.title)}
              </label>
            )}

            <div className="flex gap-3">
              <label className={`${labelClass} flex-1`}>
                {localized.buildingsTurns || "Turns"}
                <input
                  value={createTime}
                  onChange={(event) => setCreateTime(event.target.value)}
                  className={inputClass}
                  inputMode="numeric"
                />
              </label>
              <label className={`${labelClass} flex-1`}>
                {localized.buildingsCost || "Cost"}
                <input
                  value={createCost}
                  onChange={(event) => setCreateCost(event.target.value)}
                  className={inputClass}
                  inputMode="numeric"
                />
              </label>
              <label className={`${labelClass} flex-1`}>
                {localized.buildingsUpkeep || "Upkeep"}
                <input
                  value={upkeepCost}
                  onChange={(event) => setUpkeepCost(event.target.value)}
                  className={inputClass}
                  inputMode="numeric"
                />
              </label>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            onClick={onCancel}
            className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-500"
          >
            {localized.buildingsCancel || "Cancel"}
          </button>
          <button
            type="button"
            disabled={!canAdd}
            onClick={() =>
              onAdd({
                levelKey: trimmedKey,
                chainKey: from.chainKey,
                level: newLevel,
                setKey: from.setKey,
                culture: query.culture ?? "",
                subculture: query.subculture ?? "",
                faction: query.faction ?? "",
                title: title.trim(),
                shortDescription: shortDescription.trim() || undefined,
                icon: from.iconPath,
                createTime: Number(createTime) || 0,
                createCost: Number(createCost) || 0,
                upkeepCost: Number(upkeepCost) || 0,
                // Secondary tier rows are zero-based while the DB requirement is one-based. Primary
                // and port chains ignore this column and place themselves by their own DB level.
                primarySlotLevelRequirement: from.isSettlementOrPort ? 0 : from.tierRow + (isBelow ? 0 : 2),
                effects: copyEffects
                  ? from.effects.map((effect) => ({
                      effectKey: effect.effectKey,
                      scope: effect.scope,
                      value: effect.value,
                    }))
                  : undefined,
                recruitableUnits: (from.recruitableRows ?? from.recruitable).map((unit) => ({
                  unitKey: unit.unitKey,
                  faction: unit.faction,
                  xp: unit.xp,
                })),
                garrisonUnitGroups: from.garrison
                  .map((unit) => unit.unitGroup)
                  .filter((unitGroup): unitGroup is string => Boolean(unitGroup)),
                shiftedLevelRows: isBelow ? shiftedLevelRows : undefined,
                ...(isBelow ? { upgradeToLevelKey: from.levelKey } : { upgradeFromLevelKey: from.levelKey }),
              })
            }
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {localized.buildingsAdd || "Add"}
          </button>
        </Modal.Footer>
      </Modal>
    );
  },
);

export default AddBuildingModal;
