import React, { memo, useContext } from "react";
import { Tooltip } from "flowbite-react";
import { FiFolder } from "react-icons/fi";
import localizationContext from "../localizationContext";

type CustomModFolderIconProps = {
  folderPath?: string;
};

const CustomModFolderIcon = memo(({ folderPath }: CustomModFolderIconProps) => {
  const localized: Record<string, string> = useContext(localizationContext);
  if (!folderPath) return null;

  const tooltip = (localized.customFolderModTooltip || "Custom folder: {{path}}").replace(
    "{{path}}",
    folderPath,
  );

  return (
    <Tooltip placement="bottom" style="light" content={tooltip}>
      <span
        className="ml-1 inline-flex shrink-0 items-center text-slate-400 opacity-80"
        aria-label={tooltip}
      >
        <FiFolder className="h-3.5 w-3.5" />
      </span>
    </Tooltip>
  );
});

CustomModFolderIcon.displayName = "CustomModFolderIcon";

export default CustomModFolderIcon;
