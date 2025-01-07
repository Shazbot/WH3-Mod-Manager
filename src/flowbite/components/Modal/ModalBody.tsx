import classNames from "classnames";
import type { ComponentProps, FC, HTMLProps, PropsWithChildren } from "react";
import React from "react";
import { excludeClassName } from "../../helpers/exclude";
import { useTheme } from "../Flowbite/ThemeContext";
import { useModalContext } from "./ModalContext";

export type ModalBodyProps = PropsWithChildren<Omit<ComponentProps<"div">, "className">>;

export const ModalBody: FC<ModalBodyProps> = ({ children, ...props }) => {
  const { popup } = useModalContext();
  const theme = useTheme().theme.modal.body;
  const theirProps = excludeClassName(props);

  return (
    <div
      className={classNames(theme.base, {
        [theme.popup]: popup,
      })}
      style={{
        maxHeight: "calc(100% - 6rem)",
        ...(theirProps as HTMLProps<'div'>).style
      }}
      {...theirProps}
    >
      {children}
    </div>
  );
};
