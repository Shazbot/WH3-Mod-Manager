import type { ComponentProps, FC } from "react";
import React from "react";
import { FaBars } from "react-icons/fa";
import { excludeClassName } from "../../helpers/exclude";
import { useTheme } from "../Flowbite/ThemeContext";
import { useNavbarContext } from "./NavbarContext";

export interface NavbarToggleProps extends Omit<ComponentProps<"button">, "className"> {
  barIcon?: FC<ComponentProps<"svg">>;
}

export const NavbarToggle: FC<NavbarToggleProps> = ({ barIcon: BarIcon = FaBars, ...props }) => {
  const { isOpen, setIsOpen } = useNavbarContext();

  const handleClick = () => {
    setIsOpen(!isOpen);
  };

  const theme = useTheme().theme.navbar.toggle;
  const theirProps = excludeClassName(props);

  return (
    <button className={theme.base} data-testid="flowbite-navbar-toggle" onClick={handleClick} {...theirProps}>
      <span className="sr-only">Open main menu</span>
      <BarIcon className={theme.icon} />
    </button>
  );
};
