import React from "react";

export interface DBCloneRenameInputProps {
  id: string;
  value: string;
  disabled: boolean;
  hasWarning: boolean;
  onChange: (value: string) => void;
}

const stopTreeInteraction = (event: React.SyntheticEvent<HTMLInputElement>) => {
  event.stopPropagation();
};

/** A text editor embedded in a keyboard-navigable tree must not trigger the tree's own controls. */
const DBCloneRenameInput = ({ id, value, disabled, hasWarning, onChange }: DBCloneRenameInputProps) => (
  <input
    id={id}
    type="text"
    disabled={disabled}
    value={value}
    onPointerDown={stopTreeInteraction}
    onMouseDown={stopTreeInteraction}
    onClick={stopTreeInteraction}
    onKeyDown={stopTreeInteraction}
    onKeyUp={stopTreeInteraction}
    onChange={(event) => onChange(event.target.value)}
    className={`ml-4 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 ${
      hasWarning ? "!border-yellow-300" : ""
    }`}
  />
);

export default DBCloneRenameInput;
