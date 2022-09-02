import type { ComponentProps, FC } from "react";
import React from "react";
import { useContext } from "react";
import { HiMoon, HiSun } from "react-icons/hi";
import { excludeClassName } from "../../helpers/exclude";
import { ThemeContext, useTheme } from "../Flowbite/ThemeContext";

export type DarkThemeToggleProps = Omit<ComponentProps<"button">, "className">;

export const DarkThemeToggle: FC<DarkThemeToggleProps> = (props) => {
  const theirProps = excludeClassName(props);
  const theme = useTheme().theme.darkThemeToggle;
  const { mode, toggleMode } = useContext(ThemeContext);

  return (
    <button
      className={theme.base}
      data-testid="dark-theme-toggle"
      onClick={toggleMode}
      type="button"
      aria-label="Toggle dark mode"
      {...theirProps}
    >
      {mode === "dark" ? (
        <HiSun aria-label="Currently dark mode" className={theme.icon} />
      ) : (
        <HiMoon aria-label="Currently light mode" className={theme.icon} />
      )}
    </button>
  );
};
