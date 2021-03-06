import { Tooltip } from "flowbite-react";
import React from "react";
import { toggleAlwaysEnabledMods, toggleAlwaysHiddenMods } from "./appSlice";
import { useAppDispatch } from "./hooks";

type ModDropdownProps = {
  isOpen: boolean;
  positionX: number;
  positionY: number;
  mod?: Mod;
};

export default function ModDropdown(props: ModDropdownProps) {
  const dispatch = useAppDispatch();

  const onGoToWorkshopPageClick = () => {
    window.open(`https://steamcommunity.com/workshop/filedetails/?id=${props.mod.workshopId}`);
  };

  return (
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
      >
        <ul className="py-1 text-sm text-gray-700 dark:text-gray-200" aria-labelledby="dropdownDefault">
          {props.mod && !props.mod.isInData && (
            <li>
              <a
                href="#"
                onClick={() => onGoToWorkshopPageClick()}
                className={
                  "block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white" +
                  ` disabled`
                }
              >
                Go to workshop page
              </a>
            </li>
          )}
          <li>
            <a
              onClick={() => dispatch(toggleAlwaysEnabledMods([props.mod]))}
              href="#"
              className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
            >
              <Tooltip placement="top" content="Mod will always be enable, even when hidden.">
                Keep always enabled
              </Tooltip>
            </a>
          </li>
          <li>
            <a
              onClick={() => dispatch(toggleAlwaysHiddenMods([props.mod]))}
              href="#"
              className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
            >
              <Tooltip
                placement="bottom"
                content="Mod will be hidden from the list and disabled (except when always enabled)."
              >
                Hide from list
              </Tooltip>
            </a>
          </li>
        </ul>
      </div>
    </>
  );
}
