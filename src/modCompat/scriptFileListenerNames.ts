import bs from "binary-search";
import appData from "../appData";
import { DBFileName, ScriptListener, PackName, ScriptListenerCollision, Pack } from "../packFileTypes";
import { collator } from "../utility/packFileSorting";

export const packToScriptFilesWithListeners: Record<string, Record<DBFileName, ScriptListener[]>> = {};

export const emptyPackToScriptFilesWithListeners = () => {
  for (const packName of Object.keys(packToScriptFilesWithListeners)) {
    delete packToScriptFilesWithListeners[packName];
  }
};

export function processDuplicateListenerNamesInSameTable(
  packFileName: string,
  scriptListeners: ScriptListener[],
  packName: string,
  scriptListenerCollisions: Record<PackName, ScriptListenerCollision[]>
) {
  // compare for duplicate keys in the same pack
  for (let i = 0; i < scriptListeners.length - 1; i++) {
    if (scriptListeners[i].value == scriptListeners[i + 1].value) {
      const newScriptListenerCollision = {
        packFileName: packFileName,
        value: scriptListeners[i],
        valueTwo: scriptListeners[i + 1],
        firstPackName: packName,
      } as ScriptListenerCollision;
      if (
        !scriptListenerCollisions[packName].find(
          (collision) =>
            collision.value == newScriptListenerCollision.value &&
            collision.packFileName == newScriptListenerCollision.packFileName &&
            collision.firstPackName == newScriptListenerCollision.firstPackName
        )
      ) {
        scriptListenerCollisions[packName].push(newScriptListenerCollision);
      }
    }
  }
}

export function processPackToScriptFilesWithListeners() {
  const packToScriptFilesWithListenersSortedKeys = Object.keys(packToScriptFilesWithListeners);
  packToScriptFilesWithListenersSortedKeys.sort((a, b) => collator.compare(a, b));

  const scriptListenerCollisions: Record<PackName, ScriptListenerCollision[]> = {};
  for (let packOneIndex = 0; packOneIndex < packToScriptFilesWithListenersSortedKeys.length; packOneIndex++) {
    const packName = packToScriptFilesWithListenersSortedKeys[packOneIndex];
    scriptListenerCollisions[packName] = scriptListenerCollisions[packName] || [];
    for (const [scriptFileName, scriptListeners] of Object.entries(
      packToScriptFilesWithListeners[packName]
    )) {
      processDuplicateListenerNamesInSameTable(
        scriptFileName,
        scriptListeners,
        packName,
        scriptListenerCollisions
      );

      for (
        let packTwoIndex = packOneIndex + 1;
        packTwoIndex < packToScriptFilesWithListenersSortedKeys.length;
        packTwoIndex++
      ) {
        const packTWoName = packToScriptFilesWithListenersSortedKeys[packTwoIndex];
        scriptListenerCollisions[packTWoName] = scriptListenerCollisions[packTWoName] || [];

        const scriptListenersInPackTwo = packToScriptFilesWithListeners[packTWoName][scriptFileName];
        if (scriptListenersInPackTwo) {
          const scriptListenersToSearch =
            scriptListeners.length < scriptListenersInPackTwo.length
              ? scriptListeners
              : scriptListenersInPackTwo;
          const scriptListenersToSearchOther =
            scriptListeners.length < scriptListenersInPackTwo.length
              ? scriptListenersInPackTwo
              : scriptListeners;

          for (let i = 0; i < scriptListenersToSearch.length; i++) {
            // if it's a duplicates value skip it
            if (
              i + 1 < scriptListenersToSearch.length &&
              scriptListenersToSearch[i].value == scriptListenersToSearch[i + 1].value
            )
              continue;

            const keyValuesOtherIndex = bs(
              scriptListenersToSearchOther,
              scriptListenersToSearch[i],
              (a: ScriptListener, b: ScriptListener) => collator.compare(a.value, b.value)
            );
            if (keyValuesOtherIndex > -1) {
              const newScriptListenerCollision = {
                packFileName: scriptFileName,
                value: scriptListenersToSearch[i],
                valueTwo: scriptListenersToSearchOther[i],
                firstPackName: packName,
                secondPackName: packTWoName,
              } as ScriptListenerCollision;
              if (
                !scriptListenerCollisions[packName].find(
                  (collision) =>
                    collision.value == newScriptListenerCollision.value &&
                    collision.packFileName == newScriptListenerCollision.packFileName &&
                    collision.firstPackName == newScriptListenerCollision.firstPackName &&
                    collision.secondPackName == newScriptListenerCollision.secondPackName
                )
              ) {
                scriptListenerCollisions[packName].push(newScriptListenerCollision);
                scriptListenerCollisions[packTWoName].push(newScriptListenerCollision);
              }
            }
          }
        }
      }
    }
  }

  return scriptListenerCollisions;
}

export function appendToAddListenerRegistry(pack: Pack, packFileName: string, scriptText: string) {
  if (appData.currentGame != "wh3") return;

  const matchListenerName = /core:add_listener\s*\(\s*['"]\s*([^'"]+)\s*['"]\s*,/g;

  const listenerNames = [...scriptText.matchAll(matchListenerName)];

  if (listenerNames.length == 0) return;

  for (const listenerName of listenerNames) {
    if (!listenerName) continue;
    if (!listenerName[1]) continue;
    if (listenerName.index == undefined) return;
    packToScriptFilesWithListeners[pack.name] = packToScriptFilesWithListeners[pack.name] || {};
    packToScriptFilesWithListeners[pack.name][packFileName] =
      packToScriptFilesWithListeners[pack.name][packFileName] || [];

    if (
      packToScriptFilesWithListeners[pack.name][packFileName].find(
        (listener) => listener.value == listenerName[0] && listener.position == listenerName.index
      )
    )
      continue;

    // console.log(
    //   `found ${listenerName[1]} in ${packFileName} in ${pack.name}, position ${listenerName.index}`
    // );
    packToScriptFilesWithListeners[pack.name][packFileName].push({
      value: listenerName[1],
      packFileName: packFileName,
      packName: pack.name,
      position: listenerName.index,
    });
  }
}
