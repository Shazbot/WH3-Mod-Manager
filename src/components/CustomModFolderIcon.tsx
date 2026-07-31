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

  const tooltipText = (localized.customFolderModTooltip || "Custom folder: {{path}}").replace(
    "{{path}}",
    folderPath,
  );
  const tooltipContent = (
    <div className="max-w-sm text-left">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
        {localized.customFolderModLabel || "Custom folder"}
      </div>
      <div className="break-all font-mono text-xs font-normal leading-4 text-slate-100">{folderPath}</div>
    </div>
  );

  return (
    <Tooltip
      placement="bottom"
      style="dark"
      arrow
      className="custom-mod-folder-tooltip !z-[100] !border-0 !bg-transparent !p-0 !text-slate-100 !shadow-none"
      content={tooltipContent}
    >
      <span
        className="ml-1 inline-flex shrink-0 items-center text-slate-400 opacity-80"
        aria-label={tooltipText}
      >
        <FiFolder className="h-3.5 w-3.5" />
      </span>
    </Tooltip>
  );
});

CustomModFolderIcon.displayName = "CustomModFolderIcon";

export default CustomModFolderIcon;
