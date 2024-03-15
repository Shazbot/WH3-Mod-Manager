import { Button, Toast } from "flowbite-react";
import React, { memo, useCallback, useContext } from "react";
import localizationContext from "../localizationContext";

interface UpdateNotificationProps {
  downloadURL: string;
  releaseNotesURL: string;
}

export const UpdateNotification = memo(({ downloadURL, releaseNotesURL }: UpdateNotificationProps) => {
  const onDownloadClick = useCallback(() => {
    window.open(downloadURL);
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
          <div className="flex gap-2">
            <div className="w-full">
              <Button size="xs" onClick={onDownloadClick}>
                {localized.download}
              </Button>
            </div>
          </div>
        </div>
        <Toast.Toggle />
      </div>
    </Toast>
  );
});
