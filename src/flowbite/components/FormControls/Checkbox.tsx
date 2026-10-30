import type { ComponentProps } from "react";
import React from "react";
import type { Ref } from "react";
import { excludeClassName } from "../../helpers/exclude";
import { useTheme } from "../Flowbite/ThemeContext";

export type CheckboxProps = Omit<ComponentProps<"input">, "type" | "className" | "ref">;

export const Checkbox = ({ ref, ...props }: CheckboxProps & { ref?: Ref<HTMLInputElement> }) => {
  const theme = useTheme().theme.formControls.checkbox;
  const theirProps = excludeClassName(props);
  return <input ref={ref} className={theme.base} type="checkbox" {...theirProps} />;
};

Checkbox.displayName = "Checkbox";
