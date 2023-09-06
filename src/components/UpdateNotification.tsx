import { Button, Toast } from "flowbite-react";
import React, { memo, useCallback, useContext } from "react";
import localizationContext from "../localizationContext";

interface UpdateNotificationProps {
  downloadURL: string;
}

export const UpdateNotification = memo(({ downloadURL }: UpdateNotificationProps) => {
  const onDownloadClick = useCallback(() => {
    window.open(downloadURL);
  }, [downloadURL]);

  const localized: Record<string, string> = useContext(localizationContext);

  return (
    <Toast>
      <div className="flex !items-start">
        <div className="ml-3 text-sm font-normal">
          <span className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
            {localized.updateAvailable}
          </span>
          <div className="mb-2 text-sm font-normal">{localized.newVersionAvailable}</div>
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
