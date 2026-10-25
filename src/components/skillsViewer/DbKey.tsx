import React, { useEffect, useState } from "react";
import { useLocalizations } from "@/src/localizationContext";
import { skillText } from "./skillPanelLayout";

// Small and faded so the game text stays first.
const dbKeyStyle = {
  fontFamily: "ui-monospace, monospace",
  fontSize: 10,
  color: skillText.descriptionColour,
  overflowWrap: "anywhere" as const,
};
// How long the check mark stays after a copy.
const copiedMarkMs = 1000;

/** Props for DbKey. */
type DbKeyProps = {
  /** The key, which a click copies. */
  value: string;
  className?: string;
};

/**
 * Draws a DB key in a skill or spell tooltip. Clicking it copies the key to the clipboard and shows a check mark.
 * @param props.value The key.
 * @param props.className Extra classes, such as `block`.
 * @returns The key.
 */
const DbKey = ({ value, className = "" }: DbKeyProps) => {
  const localized = useLocalizations();
  const [isCopied, setIsCopied] = useState(false);
  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), copiedMarkMs);
    return () => clearTimeout(timer);
  }, [isCopied]);

  return (
    <span
      className={`cursor-copy select-text hover:underline ${className}`}
      style={dbKeyStyle}
      title={localized.copy || "Copy"}
      onClick={(e) => {
        // The tooltip sits inside the skill's node, which would take the click as selecting the node.
        e.stopPropagation();
        navigator.clipboard
          ?.writeText(value)
          .then(() => setIsCopied(true))
          .catch(() => undefined);
      }}
    >
      {value}
      {isCopied && " ✓"}
    </span>
  );
};

export default DbKey;
