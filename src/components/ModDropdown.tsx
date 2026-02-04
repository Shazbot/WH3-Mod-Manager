import React, { memo, useEffect, useRef, useState, useLayoutEffect } from "react";
import ModDropdownOptions from "./ModDropdownOptions";

type ModDropdownProps = {
  isOpen: boolean;
  positionX: number;
  positionY: number;
  mod?: Mod;
  referenceElement: HTMLElement | undefined;
  mods: Mod[];
  visibleMods: Mod[];
};

const VIEWPORT_PADDING = 8; // Padding from viewport edges

const ModDropdown = memo((props: ModDropdownProps) => {
  const modDropdownRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState({ x: props.positionX, y: props.positionY });
  const [delta, setDelta] = useState({ x: 0, y: 0 });

  // Calculate adjusted position based on actual menu dimensions
  useLayoutEffect(() => {
    if (!props.isOpen || !modDropdownRef.current) return;

    const menu = modDropdownRef.current;
    const menuRect = menu.getBoundingClientRect();
    const menuHeight = menuRect.height;
    const menuWidth = menuRect.width;

    let newX = props.positionX;
    let newY = props.positionY;

    // Adjust Y position if menu would overflow bottom of viewport
    if (newY + menuHeight > window.innerHeight - VIEWPORT_PADDING) {
      // Try positioning above the click point
      const positionAbove = props.positionY - menuHeight;
      if (positionAbove >= VIEWPORT_PADDING) {
        newY = positionAbove;
      } else {
        // If it doesn't fit above either, position at the bottom of viewport
        newY = window.innerHeight - menuHeight - VIEWPORT_PADDING;
      }
    }

    // Adjust X position if menu would overflow right edge of viewport
    if (newX + menuWidth > window.innerWidth - VIEWPORT_PADDING) {
      newX = window.innerWidth - menuWidth - VIEWPORT_PADDING;
    }

    // Ensure minimum position
    newX = Math.max(VIEWPORT_PADDING, newX);
    newY = Math.max(VIEWPORT_PADDING, newY);

    setAdjustedPosition({ x: newX, y: newY });

    // Calculate delta from reference element for scroll tracking
    if (props.referenceElement) {
      const refRect = props.referenceElement.getBoundingClientRect();
      setDelta({
        x: refRect.left - newX,
        y: refRect.top - newY,
      });
    }
  }, [props.isOpen, props.positionX, props.positionY, props.mod, props.referenceElement]);

  // Track reference element position during scroll
  useEffect(() => {
    if (!props.isOpen || !props.referenceElement) return;

    const interval = setInterval(() => {
      if (modDropdownRef.current && props.referenceElement) {
        const refRect = props.referenceElement.getBoundingClientRect();
        modDropdownRef.current.style.top = `${refRect.top - delta.y}px`;
        modDropdownRef.current.style.left = `${refRect.left - delta.x}px`;
      }
    }, 10);
    return () => clearInterval(interval);
  }, [props.isOpen, props.referenceElement, delta]);

  return (
    (props.mod == null && <></>) || (
      <>
        <div
          id="modDropdown"
          className={
            `${props.isOpen ? "" : "hidden"}` +
            ` fixed w-52 bg-white rounded divide-y divide-gray-100 shadow dark:bg-gray-700`
          }
          style={{
            left: adjustedPosition.x,
            top: adjustedPosition.y,
          }}
          ref={modDropdownRef}
        >
          <ModDropdownOptions
            mod={props.mod}
            mods={props.mods}
            visibleMods={props.visibleMods}
          ></ModDropdownOptions>
        </div>
      </>
    )
  );
});
export default ModDropdown;
