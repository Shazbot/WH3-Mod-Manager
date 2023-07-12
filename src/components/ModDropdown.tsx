import React, { memo, useEffect, useRef } from "react";
import ModDropdownOptions from "./ModDropdownOptions";

type ModDropdownProps = {
  isOpen: boolean;
  positionX: number;
  positionY: number;
  mod?: Mod;
  referenceElement: HTMLElement | undefined;
};

const ModDropdown = memo((props: ModDropdownProps) => {
  let deltaX = 0;
  let deltaY = 0;
  if (props.referenceElement) {
    deltaX = props.referenceElement.getBoundingClientRect().left - props.positionX;
    deltaY = props.referenceElement.getBoundingClientRect().top - props.positionY;
  }

  const modDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      if (modDropdownRef.current && props.referenceElement) {
        modDropdownRef.current.style.top = `${(
          props.referenceElement.getBoundingClientRect().top - deltaY
        ).toString()}px`;
        modDropdownRef.current.style.left = `${(
          props.referenceElement.getBoundingClientRect().left - deltaX
        ).toString()}px`;
      }
    }, 10);
    return () => clearInterval(interval);
  }, [props.positionX, props.positionY, props.referenceElement, modDropdownRef.current]);

  return (
    (props.mod == null && <></>) || (
      <>
        <div
          id="modDropdown"
          className={
            `${props.isOpen ? "" : "hidden"}` +
            ` fixed w-44 bg-white rounded divide-y divide-gray-100 shadow dark:bg-gray-700`
          }
          style={{
            left: props.positionX,
            top: props.positionY,
          }}
          ref={modDropdownRef}
        >
          <ModDropdownOptions isOpen={props.isOpen} mod={props.mod}></ModDropdownOptions>
        </div>
      </>
    )
  );
});
export default ModDropdown;
