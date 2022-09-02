import classNames from "classnames";
import type { ComponentProps, FC, PropsWithChildren, ReactNode } from "react";
import React from "react";
import { HiX } from "react-icons/hi";
import type { FlowbiteColors } from "../Flowbite/FlowbiteTheme";
import { useTheme } from "../Flowbite/ThemeContext";

export interface AlertProps extends PropsWithChildren<Omit<ComponentProps<"div">, "color">> {
  additionalContent?: ReactNode;
  color?: keyof AlertColors;
  icon?: FC<ComponentProps<"svg">>;
  onDismiss?: boolean | (() => void);
  rounded?: boolean;
  withBorderAccent?: boolean;
}

export interface AlertColors
  extends Pick<FlowbiteColors, "failure" | "gray" | "info" | "success" | "warning"> {
  [key: string]: string;
}

export const Alert: FC<AlertProps> = ({
  additionalContent,
  children,
  color = "info",
  icon: Icon,
  onDismiss,
  rounded = true,
  withBorderAccent,
}) => {
  const theme = useTheme().theme.alert;

  return (
    <div
      className={classNames(
        theme.base,
        theme.color[color],
        rounded && theme.rounded,
        withBorderAccent && theme.borderAccent
      )}
      role="alert"
    >
      <div className="flex items-center">
        {Icon && <Icon className={theme.icon} />}
        <div>{children}</div>
        {typeof onDismiss === "function" && (
          <button
            aria-label="Dismiss"
            className={classNames(theme.closeButton.base, theme.closeButton.color[color])}
            onClick={onDismiss}
            type="button"
          >
            <HiX aria-hidden className="h-5 w-5" />
          </button>
        )}
      </div>
      {additionalContent && <div>{additionalContent}</div>}
    </div>
  );
};
