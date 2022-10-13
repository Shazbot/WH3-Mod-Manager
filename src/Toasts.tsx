import { Toast } from "flowbite-react";
import React, { useEffect, useState } from "react";
import { HiCheck } from "react-icons/hi";
import { useAppSelector } from "./hooks";

export function Toasts() {
  const newMergedPacks = [...useAppSelector((state) => state.app.newMergedPacks)].sort(
    (firstPack, secondPack) => secondPack.creationTime - firstPack.creationTime
  );
  const latestPack = newMergedPacks[0];

  const [isShown, setIsShown] = useState(true);
  if (latestPack && !isShown && Date.now() - latestPack.creationTime < 5000) setIsShown(true);

  useEffect(() => {
    setInterval(() => {
      if (isShown && latestPack && Date.now() - latestPack.creationTime > 5000) {
        setIsShown(false);
      }
    }, 500);
  });

  return (
    latestPack &&
    isShown && (
      <div className={"dark fixed w-96 mx-auto left-[1%] bottom-[1%] z-50"}>
        <Toast>
          <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-500 dark:bg-green-800 dark:text-green-200">
            <HiCheck className="h-5 w-5" />
          </div>
          <div className="ml-3 text-sm font-normal">
            <p>Created merged pack:</p>
            <p>{latestPack.path.split("\\").pop().split("/").pop()}</p>
          </div>
          <Toast.Toggle />
        </Toast>
      </div>
    )
  );
}
