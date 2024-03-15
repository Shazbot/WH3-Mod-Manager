import { Toast } from "flowbite-react";
import React, { memo, useCallback, useContext, useEffect, useState } from "react";
import { HiCheck, HiOutlineInformationCircle, HiX } from "react-icons/hi";
import { useAppDispatch, useAppSelector } from "../hooks";
import hash from "object-hash";
import { setToastDismissed } from "../appSlice";
import localizationContext from "../localizationContext";

const anyToastToShow = (toasts: Toast[]) => {
  return toasts.some((toast) => Date.now() - toast.startTime < (toast.duration ?? 5000));
};

const unexpiredToasts = (toasts: Toast[]) => {
  return toasts.filter((toast) => Date.now() - toast.startTime < (toast.duration ?? 5000));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getTestToasts = () => [
  {
    type: "info",
    messages: ["Game still closing 1, retrying..."],
    startTime: Date.now(),
  } as Toast,
  {
    type: "success",
    messages: ["Game still closing 2, retrying..."],
    startTime: Date.now(),
  } as Toast,
  {
    type: "warning",
    messages: ["Game still closing 3, retrying..."],
    startTime: Date.now(),
  } as Toast,
];

export const toastTypeToReactNode = (toast: Toast) => {
  switch (toast.type) {
    case "info":
      return <HiOutlineInformationCircle className="h-5 w-5" />;
    case "success":
      return <HiCheck className="h-5 w-5" />;
    case "warning":
      return <HiX className="h-5 w-5" />;
  }
};

export const toastTypeToBackgroundColor = (toast: Toast) => {
  switch (toast.type) {
    case "info":
      return "bg-blue-600";
    case "success":
      return "bg-green-800";
    case "warning":
      return "bg-red-600";
  }
};

export const Toasts = memo(() => {
  const dispatch = useAppDispatch();
  const localized: Record<string, string> = useContext(localizationContext);

  const onToastClicked = useCallback((toast: Toast) => {
    dispatch(setToastDismissed(toast));
  }, []);

  // const toasts = getTestToasts();
  const toasts = useAppSelector((state) => state.app.toasts);

  const [isShown, setIsShown] = useState(true);
  if (!isShown && anyToastToShow(toasts)) setIsShown(true);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isShown && !anyToastToShow(toasts)) {
        setIsShown(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isShown]);

  return (
    (isShown && (
      <div className={"dark fixed w-96 mx-auto left-[1%] bottom-[1%] z-[100]"}>
        {unexpiredToasts(toasts).map((toast) => (
          <Toast key={hash(toast)}>
            <div
              className={
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-green-500 dark:text-gray-300 " +
                toastTypeToBackgroundColor(toast)
              }
            >
              {toastTypeToReactNode(toast)}
            </div>
            <div className="ml-3 text-sm font-normal dark:text-gray-300">
              {toast.messages.map((message, i) => {
                const localizedMessage = message.startsWith("loc:")
                  ? localized[message.substring(4)]
                  : message;
                return <p key={i}>{localizedMessage}</p>;
              })}
            </div>
            <Toast.Toggle onClick={() => onToastClicked(toast)} />
          </Toast>
        ))}
      </div>
    )) || <></>
  );
});
