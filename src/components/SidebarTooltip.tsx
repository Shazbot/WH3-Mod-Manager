import {
  arrow,
  autoPlacement,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useClick,
  useFocus,
  useFloating,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import classNames from "classnames";
import type { TooltipProps } from "flowbite-react";
import { useTheme } from "flowbite-react";
import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";

const getArrowPlacement = (placement: string) => {
  const side = placement.split("-")[0];
  return { top: "bottom", right: "left", bottom: "top", left: "right" }[side] || "bottom";
};

/**
 * Flowbite's tooltip is positioned inside its parent. The sidebar scrolls, so a large warning tooltip
 * must be portalled to the document body to avoid becoming part of that scroll container.
 */
const SidebarTooltip = ({
  animation = "duration-300",
  arrow: showArrow = true,
  children,
  content,
  placement = "top",
  style = "dark",
  trigger = "hover",
  className,
  ...props
}: TooltipProps) => {
  const theme = useTheme().theme.tooltip;
  const arrowRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const floatingTooltip = useFloating({
    middleware: [
      offset(8),
      placement === "auto" ? autoPlacement() : flip(),
      shift({ padding: 8 }),
      ...(showArrow && arrowRef.current ? [arrow({ element: arrowRef.current })] : []),
    ],
    onOpenChange: setOpen,
    open,
    placement: placement === "auto" ? undefined : placement,
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
  });
  const {
    context,
    middlewareData: { arrow: { x: arrowX, y: arrowY } = {} },
    placement: floatingPlacement,
    refs,
    strategy,
    x,
    y,
  } = floatingTooltip;
  const { getFloatingProps, getReferenceProps } = useInteractions([
    useClick(context, { enabled: trigger === "click" }),
    useFocus(context),
    useHover(context, {
      enabled: trigger === "hover",
      handleClose: safePolygon(),
    }),
    useRole(context, { role: "tooltip" }),
  ]);

  const tooltip = (
    <div
      data-testid="flowbite-tooltip"
      {...getFloatingProps({
        className: classNames(
          theme.base,
          animation && `${theme.animation} ${animation}`,
          !open && theme.hidden,
          theme.style[style],
          "z-[300]",
          className,
        ),
        ref: refs.setFloating,
        style: {
          position: strategy,
          top: y ?? " ",
          left: x ?? " ",
        },
        ...props,
      })}
    >
      <div
        className={classNames(
          theme.content,
          "max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] overflow-auto break-words",
        )}
      >
        {content}
      </div>
      {showArrow && (
        <div
          className={classNames(theme.arrow.base, {
            [theme.arrow.style.dark]: style === "dark",
            [theme.arrow.style.light]: style === "light",
            [theme.arrow.style.auto]: style === "auto",
          })}
          data-testid="flowbite-tooltip-arrow"
          ref={arrowRef}
          style={{
            top: arrowY ?? " ",
            left: arrowX ?? " ",
            right: " ",
            bottom: " ",
            [getArrowPlacement(floatingPlacement)]: theme.arrow.placement,
          }}
        >
          &nbsp;
        </div>
      )}
    </div>
  );

  return (
    <>
      <div
        className={theme.target}
        {...getReferenceProps({ ref: refs.setReference })}
        data-testid="flowbite-tooltip-target"
      >
        {children}
      </div>
      {createPortal(tooltip, document.body)}
    </>
  );
};

export default SidebarTooltip;
