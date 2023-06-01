import type { Placement } from "@floating-ui/core";
import {
  autoUpdate,
  useClick,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react-dom-interactions";
import classNames from "classnames";
import type { ComponentProps, FC, PropsWithChildren, ReactNode } from "react";
import React from "react";
import { useEffect, useRef, useState } from "react";
import { excludeClassName } from "../../helpers/exclude";
import { getArrowPlacement, getMiddleware, getPlacement } from "../../helpers/floating";
import { FlowbiteDropdownTheme } from "../Dropdown";

export interface FlowbiteFloatingTheme {
  target: string;
  base: string;
  animation: string;
  hidden: string;
  style: {
    dark: string;
    light: string;
    auto: string;
  };
  content: string;
  arrow: {
    base: string;
    style: {
      dark: string;
      light: string;
      auto: string;
    };
    placement: string;
  };
}

export interface FloatingProps
  extends PropsWithChildren<Omit<ComponentProps<"div">, "content" | "className" | "style">> {
  content: ReactNode;
  theme: FlowbiteFloatingTheme | FlowbiteDropdownTheme;
  placement?: "auto" | Placement;
  trigger?: "hover" | "click";
  style?: "dark" | "light" | "auto";
  animation?: false | `duration-${number}`;
  arrow?: boolean;
}

/**
 * @see https://floating-ui.com/docs/react-dom-interactions
 */
export const Floating: FC<FloatingProps> = ({
  children,
  content,
  theme,
  animation = "duration-300",
  arrow = true,
  placement = "top",
  style = "dark",
  trigger = "hover",
  ...props
}) => {
  const theirProps = excludeClassName(props);

  const arrowRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const floatingTooltip = useFloating<HTMLElement>({
    middleware: getMiddleware({ arrowRef, placement }),
    onOpenChange: setOpen,
    open,
    placement: getPlacement({ placement }),
  });
  const {
    context,
    floating,
    middlewareData: { arrow: { x: arrowX, y: arrowY } = {} },
    reference,
    refs,
    strategy,
    update,
    x,
    y,
  } = floatingTooltip;

  const { getFloatingProps, getReferenceProps } = useInteractions([
    useClick(context, { enabled: trigger === "click" }),
    useFocus(context),
    useHover(context, { enabled: trigger === "hover" }),
    useRole(context, { role: "tooltip" }),
  ]);

  useEffect(() => {
    if (refs.reference.current && refs.floating.current && open) {
      return autoUpdate(refs.reference.current, refs.floating.current, update);
    }
  }, [open, refs.floating, refs.reference, update]);

  return (
    <>
      <div
        className={theme.target}
        {...getReferenceProps({ ref: reference })}
        data-testid="flowbite-tooltip-target"
      >
        {children}
      </div>
      <div
        data-testid="flowbite-tooltip"
        {...getFloatingProps({
          className: classNames(
            theme.base,
            animation && `${theme.animation} ${animation}`,
            !open && theme.hidden,
            theme.style[style]
          ),
          ref: floating,
          style: {
            position: strategy,
            top: y ?? " ",
            left: x ?? " ",
          },
          ...theirProps,
        })}
      >
        <div className={theme.content}>{content}</div>
        {arrow && (
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
              [getArrowPlacement({ placement: floatingTooltip.placement })]: theme.arrow.placement,
            }}
          >
            &nbsp;
          </div>
        )}
      </div>
    </>
  );
};
