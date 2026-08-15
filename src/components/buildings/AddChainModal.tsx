import React, { memo, useMemo, useState } from "react";
import { Modal } from "../../flowbite";
import { addBuildingChainRows, addBuildingLevelRows, type NewRowDraft } from "../../buildingsData/editActions";
import type { BuildingsRegionQuery, BuildingsRegionView } from "../../buildingsData/types";

export type AddChainModalProps = {
  /** The band the new chain is added to; a chain with no band has nowhere to be drawn. */
  setKey: string;
  setName: string;
  query: BuildingsRegionQuery;
  view: BuildingsRegionView;
  keyPrefix: string;
  numericIdCursors: Record<string, number>;
  onCancel: () => void;
  onAdd: (rows: NewRowDraft[], cursors: Record<string, number>) => void;
};

const labelClass = "flex flex-col gap-1 text-xs text-gray-400";
const inputClass = "rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-100";

/**
 * A whole new building chain, with its first level.
 *
 * The level and the set binding are written alongside the chain deliberately: a chain with no levels
 * draws nothing, and one bound to no building set is left out of the panel entirely. Adding all
 * three together is the difference between "it appeared" and "nothing happened and I cannot tell
 * why".
 */
const AddChainModal = memo(
  ({ setKey, setName, query, view, keyPrefix, numericIdCursors, onCancel, onAdd }: AddChainModalProps) => {
    const [name, setName_] = useState("");
    const [chainKey, setChainKey] = useState(`${keyPrefix}_chain`);
    const [superChain, setSuperChain] = useState("");
    const [createTime, setCreateTime] = useState("2");
    const [createCost, setCreateCost] = useState("500");
    const [upkeepCost, setUpkeepCost] = useState("0");

    // Every slot the region has, so the chain is offered somewhere. Without at least one of these
    // rows nothing can ever build it.
    const slotTemplates = useMemo(
      () => [...new Set(view.slotTemplates.map((slot) => slot.slotTemplate))],
      [view.slotTemplates],
    );

    const trimmedKey = chainKey.trim();
    const canAdd = trimmedKey !== "" && name.trim() !== "" && superChain.trim() !== "" && slotTemplates.length > 0;

    const add = () => {
      const cursors = { ...numericIdCursors };
      const levelKey = `${trimmedKey}_1`;
      const rows = [
        ...addBuildingChainRows(
          {
            chainKey: trimmedKey,
            superChain: superChain.trim(),
            culture: query.culture ?? "",
            subculture: query.subculture ?? "",
            faction: query.faction ?? "",
            campaign: query.campaign,
            slotTemplates,
            settlementTypes: query.settlementType ? [query.settlementType] : undefined,
          },
          cursors,
        ),
        ...addBuildingLevelRows(
          {
            levelKey,
            chainKey: trimmedKey,
            level: 0,
            setKey,
            culture: query.culture ?? "",
            subculture: query.subculture ?? "",
            faction: query.faction ?? "",
            title: name.trim(),
            createTime: Number(createTime) || 0,
            createCost: Number(createCost) || 0,
            upkeepCost: Number(upkeepCost) || 0,
            primarySlotLevelRequirement: 1,
            // A brand new chain is bound to nothing, so the junction row always has to be written.
            isChainAlreadyInSet: false,
          },
          cursors,
        ),
      ];
      onAdd(rows, cursors);
    };

    return (
      <Modal onClose={onCancel} show size="lg" position="center">
        <Modal.Header>New chain in {setName}</Modal.Header>
        <Modal.Body>
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Offered on {slotTemplates.length} slot template{slotTemplates.length === 1 ? "" : "s"} of{" "}
              <span className="text-gray-300">{query.region}</span>, available to{" "}
              {[query.culture, query.subculture, query.faction].filter(Boolean).join(" / ") || "every culture"}.
            </p>

            <label className={labelClass}>
              Chain key
              <input value={chainKey} onChange={(event) => setChainKey(event.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>
              Superchain
              <input
                value={superChain}
                onChange={(event) => setSuperChain(event.target.value)}
                placeholder="wh2_main_sch_military1_barracks"
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              First building's name
              <input
                value={name}
                onChange={(event) => setName_(event.target.value)}
                placeholder="Shown in game"
                className={inputClass}
                autoFocus
              />
            </label>

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

            {slotTemplates.length === 0 && (
              <p className="text-xs text-red-400">
                This region has no slot templates, so a new chain here could never be built.
              </p>
            )}
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
            onClick={add}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add chain
          </button>
        </Modal.Footer>
      </Modal>
    );
  },
);

export default AddChainModal;
