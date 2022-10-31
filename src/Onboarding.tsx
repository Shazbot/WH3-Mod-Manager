import React, { memo, useCallback, useRef } from "react";
import Joyride, { Placement, CallBackProps } from "react-joyride";
import { faGrip } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppDispatch, useAppSelector } from "./hooks";
import { setIsOnboardingToRun, setWasOnboardingEverRun } from "./appSlice";

const Onboarding = memo(() => {
  const dispatch = useAppDispatch();
  const isOnboardingToRun = useAppSelector((state) => state.app.isOnboardingToRun);

  const isSetAppFolderPathsDone = useAppSelector((state) => state.app.isSetAppFolderPathsDone);
  const appFolderPaths = useAppSelector((state) => state.app.appFolderPaths);
  const isAnyPathEmpty = appFolderPaths.contentFolder == "" || appFolderPaths.gamePath == "";

  const toRun = !(isSetAppFolderPathsDone && isAnyPathEmpty) && isOnboardingToRun;

  const { current: steps } = useRef([
    {
      target: "body",
      content:
        "Welcome and thank you for using the Mod Manager. This little tutorial will familiarize you with the UI.",
      disableBeacon: true,
      placement: "center" as Placement | "auto" | "center",
    },
    {
      target: "#presetSection",
      content: "Presets allow you to save a mod list so you can load it later.",
    },
    {
      target: "#createOrSelectPreset",
      content: (
        <>
          <p>
            Type in this textbox to create a new preset, or use the dropdown button to select an older preset.
          </p>
          <p className="mt-2">
            You can hold Shift while selecting a preset to create a union of selected mods between the
            currently enabled mods and the mods enabled in the preset. (basically add a preset)
          </p>
          <p className="mt-2">
            You can hold Ctrl while selecting a preset to uncheck any currently selected mods that are enabled
            in that preset. (basically subtract a preset)
          </p>
        </>
      ),
    },
    {
      target: "#replacePreset",
      content: "Select a preset you want to replace with the current selection of mods.",
    },
    {
      target: "#deletePreset",
      content: "Select a preset you'd like to delete.",
    },

    {
      target: "#sortHeader",
      content: (
        <>
          <p>Mods have priority based on their order, by default this is based on the name of the packs.</p>
          <p className="mt-2">
            You usually don't want to manually change order since modders already name their packs to
            accomplish this automatically, such as when they put exclamation marks at the start of the pack
            name.
          </p>
        </>
      ),
    },
    {
      target: "#sortHeader",
      content: (
        <>
          <p>
            You can right click on the Order header to reset order to default, and left click to sort mods by
            mod order.
          </p>
        </>
      ),
    },
    {
      target: "#sortHeader",
      content: (
        <>
          <p>
            <FontAwesomeIcon icon={faGrip} /> Using the grip icon you can drag individual mods to change their
            order.
          </p>
          <p className="mt-2">
            The grip is visible when hovering over a mod, and only when all the mods are sorted by order!
          </p>
          <p className="mt-2">
            When a mod is manually reordered its order number will be colored red. You can right click on that
            mod's order number to reset it.
          </p>
        </>
      ),
    },
    {
      target: "#enabledHeader",
      content: (
        <>
          <p>Left click to sort by enabled mods.</p>
          <p className="mt-2">You can right click this header to enable or disable all mods.</p>
          <p className="mt-2">If a mod checkbox is purple it means a mod is always enabled.</p>
        </>
      ),
    },
    {
      target: "#playGame",
      isFixed: true,
      placement: "left" as Placement | "auto" | "center",
      content: (
        <>
          <p>Start the game with the selected mods.</p>
        </>
      ),
    },
    {
      target: "#continueGame",
      isFixed: true,
      placement: "left" as Placement | "auto" | "center",
      content: (
        <>
          <p>Continue the latest save with the selected mods.</p>
        </>
      ),
    },
    {
      target: "#showSaves",
      isFixed: true,
      placement: "left" as Placement | "auto" | "center",
      content: (
        <>
          <p>Show all the game saves to select from.</p>
        </>
      ),
    },
  ]);
  for (const step of steps) {
    step.disableBeacon = true;
  }

  const onJoyrideStateChange = useCallback((data: CallBackProps) => {
    console.log(data);
    if (data.action === "reset" || data.action === "skip") {
      dispatch(setIsOnboardingToRun(false));
      dispatch(setWasOnboardingEverRun(true));
    }
  }, []);

  return (
    <>
      {toRun && (
        <Joyride
          showSkipButton={true}
          disableScrolling={true}
          continuous={true}
          disableOverlayClose={true}
          steps={steps}
          run={toRun}
          callback={onJoyrideStateChange}
        ></Joyride>
      )}
    </>
  );
});
export default Onboarding;
