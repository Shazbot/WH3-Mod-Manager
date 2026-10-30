import classNames from "classnames";
import type { ComponentProps, ReactNode } from "react";
import React from "react";
import type { Ref } from "react";
import { excludeClassName } from "../../helpers/exclude";
import { useTheme } from "../Flowbite/ThemeContext";
import HelperText from "./HelperText";
import type { TextInputColors, TextInputSizes } from "./TextInput";

export interface FileInputProps extends Omit<ComponentProps<"input">, "type" | "ref" | "color" | "className"> {
  sizing?: keyof TextInputSizes;
  helperText?: ReactNode;
  color?: keyof TextInputColors;
}

export const FileInput = ({
  sizing = "md",
  helperText,
  color = "gray",
  ref,
  ...props
}: FileInputProps & { ref?: Ref<HTMLInputElement> }) => {
  const theme = useTheme().theme.formControls.fileInput;
  const theirProps = excludeClassName(props);
  return (
    <>
      <div className={theme.base}>
        <div className={theme.field.base}>
          <input
            className={classNames(
              theme.field.input.base,
              theme.field.input.colors[color],
              theme.field.input.sizes[sizing],
            )}
            {...theirProps}
            type="file"
            ref={ref}
          />
        </div>
      </div>
      {helperText && <HelperText color={color}>{helperText}</HelperText>}
    </>
  );
};

FileInput.displayName = "FileInput";
