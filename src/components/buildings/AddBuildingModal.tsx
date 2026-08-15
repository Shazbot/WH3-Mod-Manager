import React, { memo, useState } from "react";
import { Modal } from "../../flowbite";
import type { AddBuildingLevelInput } from "../../buildingsData/editActions";
import type { BuildingsRegionQuery, BuildingsTile } from "../../buildingsData/types";

export type AddBuildingModalProps = {
  /** The building the new one upgrades from, which also fixes its chain and band. */
  from: BuildingsTile;
  query: BuildingsRegionQuery;
  keyPrefix: string;
  onCancel: () => void;
  onAdd: (input: AddBuildingLevelInput) => void;
};

const labelClass = "flex flex-col gap-1 text-xs text-gray-400";
const inputClass = "rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-100";

const AddBuildingModal = memo(({ from, query, keyPrefix, onCancel, onAdd }: AddBuildingModalProps) => {
  const suggestedKey = `${keyPrefix}_${from.chainKey.replace(/^wh[0-9_a-z]*?_/, "")}_${from.level + 2}`;
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

  return (
    <Modal onClose={onCancel} show size="lg" position="center">
      <Modal.Header>Add a building above {from.title}</Modal.Header>
      <Modal.Body>
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Goes into <span className="text-gray-300">{from.chainKey}</span> at level {from.level + 1}, upgrading from{" "}
            <span className="text-gray-300">{from.levelKey}</span>. The culture variant is written for{" "}
            {[query.culture, query.subculture, query.faction].filter(Boolean).join(" / ") || "every culture"}.
          </p>

          <label className={labelClass}>
            Building key
            <input value={levelKey} onChange={(event) => setLevelKey(event.target.value)} className={inputClass} />
          </label>
          <label className={labelClass}>
            Name
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Shown in game"
              className={inputClass}
              autoFocus
            />
          </label>
          <label className={labelClass}>
            Short description
            <input
              value={shortDescription}
              onChange={(event) => setShortDescription(event.target.value)}
              className={inputClass}
            />
          </label>

          {from.effects.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={copyEffects} onChange={(event) => setCopyEffects(event.target.checked)} />
              Copy the {from.effects.length} effect{from.effects.length === 1 ? "" : "s"} from {from.title}
            </label>
          )}

          <div className="flex gap-3">
            <label className={`${labelClass} flex-1`}>
              Turns
              <input
                value={createTime}
                onChange={(event) => setCreateTime(event.target.value)}
                className={inputClass}
                inputMode="numeric"
              />
            </label>
            <label className={`${labelClass} flex-1`}>
              Cost
              <input
                value={createCost}
                onChange={(event) => setCreateCost(event.target.value)}
                className={inputClass}
                inputMode="numeric"
              />
            </label>
            <label className={`${labelClass} flex-1`}>
              Upkeep
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
          Cancel
        </button>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() =>
            onAdd({
              levelKey: trimmedKey,
              chainKey: from.chainKey,
              level: from.level + 1,
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
              primarySlotLevelRequirement: from.isSettlementOrPort ? 0 : from.tierRow + 2,
              effects: copyEffects
                ? from.effects.map((effect) => ({
                    effectKey: effect.effectKey,
                    scope: effect.scope,
                    value: effect.value,
                  }))
                : undefined,
              upgradeFromLevelKey: from.levelKey,
            })
          }
          className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add
        </button>
      </Modal.Footer>
    </Modal>
  );
});

export default AddBuildingModal;
