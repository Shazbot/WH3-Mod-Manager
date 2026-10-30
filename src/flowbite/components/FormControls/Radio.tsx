import type { ComponentProps } from "react";
import React from "react";
import type { Ref } from "react";
import { excludeClassName } from "../../helpers/exclude";
import { useTheme } from "../Flowbite/ThemeContext";

export type RadioProps = Omit<ComponentProps<"input">, "type" | "className" | "ref">;

export const Radio = ({ ref, ...props }: RadioProps & { ref?: Ref<HTMLInputElement> }) => {
  const theme = useTheme().theme.formControls.radio;
  const theirProps = excludeClassName(props);
  return <input ref={ref} className={theme.base} type="radio" {...theirProps} />;
};

Radio.displayName = "Radio";
