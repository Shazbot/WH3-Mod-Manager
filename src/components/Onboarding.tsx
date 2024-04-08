import React, { memo, useCallback, useContext, useMemo } from "react";
import Joyride, { Placement, CallBackProps } from "react-joyride";
import { faGrip } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppDispatch, useAppSelector } from "../hooks";
import { setIsOnboardingToRun, setWasOnboardingEverRun } from "../appSlice";
import localizationContext from "../localizationContext";

const Onboarding = memo(() => {
  const dispatch = useAppDispatch();
  const isOnboardingToRun = useAppSelector((state) => state.app.isOnboardingToRun);

  const isSetAppFolderPathsDone = useAppSelector((state) => state.app.isSetAppFolderPathsDone);
  const appFolderPaths = useAppSelector((state) => state.app.appFolderPaths);
  const isAnyPathEmpty = appFolderPaths.contentFolder == "" || appFolderPaths.gamePath == "";

  const toRun = !(isSetAppFolderPathsDone && isAnyPathEmpty) && isOnboardingToRun;

  const localized: Record<string, string> = useContext(localizationContext);

  const steps = useMemo(
    () =>
      [
        {
          target: "body",
          content: <span className="font-medium">{localized.onbWelcome}</span>,
          disableBeacon: true,
          placement: "center" as Placement | "auto" | "center",
        },
        {
          target: "#presetSection",
          content: <span className="font-medium">{localized.onbPresets}</span>,
        },
        {
          target: "#createOrSelectPreset",
          content: (
            <span className="font-medium">
              <p>{localized.onbPresets1}</p>
              <p className="mt-2">{localized.onbPresets2}</p>
              <p className="mt-2">{localized.onbPresets3}</p>
            </span>
          ),
        },
        {
          target: "#replacePreset",
          content: <span className="font-medium">{localized.onbReplacePreset}</span>,
        },
        {
          target: "#deletePreset",
          content: <span className="font-medium">{localized.onbDeletePreset}</span>,
        },

        {
          target: "#sortHeader",
          content: (
            <span className="font-medium">
              <p>{localized.onbSorting1}</p>
              <p className="mt-2">{localized.onbSorting2}</p>
            </span>
          ),
        },
        {
          target: "#sortHeader",
          content: (
            <span className="font-medium">
              <p>{localized.onbSorting3}</p>
            </span>
          ),
        },
        {
          target: "#sortHeader",
          content: (
            <span className="font-medium">
              <p>
                <FontAwesomeIcon icon={faGrip} /> {localized.onbSorting4}
              </p>
              <p className="mt-2">{localized.onbSorting5}</p>
              <p className="mt-2">{localized.onbSorting6}</p>
            </span>
          ),
        },
        {
          target: "#enabledHeader",
          content: (
            <span className="font-medium">
              <p>{localized.onbSorting7}</p>
              <p className="mt-2">{localized.onbSorting8}</p>
              <p className="mt-2">{localized.onbSorting9}</p>
            </span>
          ),
        },
        {
          target: "#playGame",
          isFixed: true,
          placement: "left" as Placement | "auto" | "center",
          content: (
            <span className="font-medium">
              <p>{localized.onbPlay}</p>
            </span>
          ),
        },
        {
          target: "#continueGame",
          isFixed: true,
          placement: "left" as Placement | "auto" | "center",
          content: (
            <span className="font-medium">
              <p>{localized.onbContinue}</p>
            </span>
          ),
        },
        {
          target: "#showSaves",
          isFixed: true,
          placement: "left" as Placement | "auto" | "center",
          content: (
            <span className="font-medium">
              <p>{localized.onbSaves}</p>
            </span>
          ),
        },
      ].map((step) => {
        step.disableBeacon = true;
        return step;
      }),
    [localized]
  );

  const onJoyrideStateChange = useCallback((data: CallBackProps) => {
    console.log("joyride:", data.action);
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
