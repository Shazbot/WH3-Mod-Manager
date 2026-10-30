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
import { tooltipTheme as theme } from "flowbite-react";
import React, { useState } from "react";
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
  // Kept in state rather than a ref so the arrow middleware is added once the arrow element mounts.
  const [arrowElement, setArrowElement] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const floatingTooltip = useFloating({
    middleware: [
      offset(8),
      placement === "auto" ? autoPlacement() : flip(),
      // Keep clear of the title bar, which is layered above tooltips.
      shift({ padding: { top: 36, right: 8, bottom: 8, left: 8 } }),
      ...(showArrow && arrowElement ? [arrow({ element: arrowElement })] : []),
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
  const arrowSide = getArrowPlacement(floatingPlacement);
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
          // A fixed element shrinks near the viewport edge, so after a window resize it would be measured at the
          // squeezed width of its old spot and then overlap the trigger once moved.
          width: "max-content",
        },
        ...props,
      })}
    >
      <div
        className={classNames(
          theme.content,
          "max-h-[calc(100vh-60px)] max-w-[calc(100vw-1rem)] overflow-auto break-words",
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
          ref={setArrowElement}
          style={{
            top: arrowY ?? " ",
            left: arrowX ?? " ",
            right: " ",
            bottom: " ",
            [arrowSide]: theme.arrow.placement,
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
