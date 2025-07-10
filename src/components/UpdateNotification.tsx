import { Button, Toast } from "flowbite-react";
import React, { memo, useCallback, useContext } from "react";
import localizationContext from "../localizationContext";
import { useDispatch } from "react-redux";
import { addToast } from "../appSlice";

interface UpdateNotificationProps {
  downloadURL: string;
  releaseNotesURL: string;
  setIsUpdateAvailable: React.Dispatch<React.SetStateAction<boolean>>;
}

export const UpdateNotification = memo(
  ({ downloadURL, releaseNotesURL, setIsUpdateAvailable }: UpdateNotificationProps) => {
    const dispatch = useDispatch();

    const onDownloadClick = useCallback(async () => {
      // window.open(downloadURL);

      setIsUpdateAvailable(false);

      dispatch(
        addToast({
          type: "info",
          messages: ["loc:downloadingUpdate"],
          startTime: Date.now(),
        })
      );
      await window.api?.downloadAndInstallUpdate(downloadURL);
    }, [downloadURL]);

    const onReleaseNotesClick = useCallback(() => {
      window.open(releaseNotesURL);
    }, [releaseNotesURL]);

    const localized: Record<string, string> = useContext(localizationContext);

    return (
      <Toast>
        <div className="flex !items-start">
          <div className="ml-3 text-sm font-normal">
            <span className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
              {localized.updateAvailable}
            </span>
            <div className="mb-4 text-sm font-normal">{localized.newVersionAvailable}</div>
            {releaseNotesURL && releaseNotesURL != "" && (
              <a
                onClick={onReleaseNotesClick}
                className="mb-4 block text-sm text-gray-900 dark:text-white dark:hover:text-blue-500 cursor-pointer"
              >
                {localized.releaseNotes}
              </a>
            )}
            <div className="flex gap-2 w-full">
              <Button size="sm" onClick={onDownloadClick}>
                {localized.download}
              </Button>
            </div>
          </div>
          <Toast.Toggle />
        </div>
      </Toast>
    );
  }
);
