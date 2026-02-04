import * as steamworks from "./../steamworks";
import { workshop } from "../steamworks/client.d";
import * as fs from "fs";
import { string } from "ts-pattern/dist/patterns";

interface PlayerSteamIdStringInsteadOfBigInt {
  steamId64: string;
  steamId32: string;
  accountId: number;
}
interface WorkshopItemStatisticStringified {
  numSubscriptions: string;
  numFavorites: string;
  numFollowers: string;
  numUniqueSubscriptions: string;
  numUniqueFavorites: string;
  numUniqueFollowers: string;
  numUniqueWebsiteViews: string;
  reportScore: string;
  numSecondsPlayed: string;
  numPlaytimeSessions: string;
  numComments: string;
  numSecondsPlayedDuringTimePeriod: string;
  numPlaytimeSessionsDuringTimePeriod: string;
}

interface WorkshopItemStringInsteadOfBigInt {
  publishedFileId: string;
  creatorAppId?: number;
  consumerAppId?: number;
  title: string;
  description: string;
  owner: PlayerSteamIdStringInsteadOfBigInt;
  /** Time created in unix epoch seconds format */
  timeCreated: number;
  /** Time updated in unix epoch seconds format */
  timeUpdated: number;
  /** Time when the user added the published item to their list (not always applicable), provided in Unix epoch format (time since Jan 1st, 1970). */
  timeAddedToUserList: number;
  visibility: workshop.UgcItemVisibility;
  banned: boolean;
  acceptedForUse: boolean;
  tags: Array<string>;
  tagsTruncated: boolean;
  url: string;
  numUpvotes: number;
  numDownvotes: number;
  numChildren: number;
  previewUrl?: string;
  statistics: WorkshopItemStatisticStringified;
  children?: string[];
}

if (process.argv[3] == "justRun") {
  console.log("justRun");
  steamworks.init(Number(process.argv[2]));
  setTimeout(() => {
    process.exit();
  }, 200);
}
if (process.argv[3] == "getSubscribedIds") {
  console.log("getSubscribedIds");
  const client = steamworks.init(Number(process.argv[2]));

  try {
    const items = client.workshop.getSubscribedItems();
    if (process.send) process.send(items.map((item) => item.toString()));
  } catch (e) {
    /* empty */
  }
  setTimeout(() => {
    process.exit();
  }, 300);
}
if (process.argv[3] == "download") {
  console.log("download");
  const ids = process.argv[4].split(";"); //"2856936614";
  const client = steamworks.init(Number(process.argv[2]));

  ids.forEach(async (id) => {
    try {
      const success = client.workshop.download(BigInt(id), false);
      if (process.send) process.send("for id: " + success);
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (e) {
      /* empty */
    }
  });
  setTimeout(() => {
    process.exit();
  }, 300);
}
if (process.argv[3] == "unsubscribe") {
  console.log("unsubscribe");
  const ids = process.argv[4].split(";");
  const client = steamworks.init(Number(process.argv[2]));

  ids.forEach((id) => {
    try {
      client.workshop.unsubscribe(BigInt(id));
    } catch (e) {
      /* empty */
    }
  });
  setTimeout(() => {
    if (process.send) process.send("done");
    process.exit();
  }, 200);
}

const getAuthors = (
  client: Omit<steamworks.Client, "init" | "runCallbacks">,
  ids: bigint[],
  cb: (authorsMap: Map<string, string>) => void
) => {
  if (!process.send) {
    process.exit();
  }

  const authorsMap = new Map<string, string>();
  const unknownAuthors = [] as bigint[];

  for (const authorId of ids) {
    // Method 1: Use the convenience function (requests info and returns current name)
    const authorName = client.friends.getUserName(authorId);

    // If the name is "[unknown]", wait a bit for the download and try again
    if (authorName === "[unknown]") {
      unknownAuthors.push(authorId);
    } else {
      authorsMap.set(authorId.toString(), authorName);
    }
  }

  setTimeout(() => {
    for (const authorId of unknownAuthors) {
      const authorName = client.friends.getFriendPersonaName(authorId);
      authorsMap.set(authorId.toString(), authorName);
    }

    cb(authorsMap);
  }, 1500);
};
if (process.argv[3] == "getAuthors") {
  console.log("getAuthors");
  const ids = process.argv[4].split(",").map((id) => BigInt(id));
  const client = steamworks.init(Number(process.argv[2]));

  getAuthors(client, ids, (authorsMap) => {
    if (process.send) process.send(authorsMap);
    setTimeout(() => {
      process.exit();
    }, 200);
  });
}

const getDependencies = (
  client: Omit<steamworks.Client, "init" | "runCallbacks">,
  ids: bigint[],
  cb: (dependenciesMap: Map<string, string[]>) => void
) => {
  if (!process.send) {
    process.exit();
  }

  const dependenciesMap = new Map<string, string[]>();

  const promises = ids.map(
    (id) =>
      new Promise<void>((resolve, reject) => {
        client.workshop
          .getItemDependencies(id)
          .then((dependencyIds) => {
            dependenciesMap.set(
              id.toString(),
              dependencyIds.map((depId) => depId.toString())
            );
            resolve();
          })
          .catch((e) => {
            fs.appendFileSync("sublog.txt", "ERROR:");
            fs.appendFileSync("sublog.txt", e.toString());
          });
      })
  );

  Promise.allSettled(promises).then(() => {
    cb(dependenciesMap);
  });
};
if (process.argv[3] == "getDependencies") {
  console.log("getDependencies");
  const ids = process.argv[4].split(",").map((id) => BigInt(id));
  const client = steamworks.init(Number(process.argv[2]));

  getDependencies(client, ids, (dependenciesMap) => {
    if (process.send) process.send(dependenciesMap);
    setTimeout(() => {
      process.exit();
    }, 200);
  });
}

const getItems = (
  client: Omit<steamworks.Client, "init" | "runCallbacks">,
  ids: bigint[],
  cb: (data: WorkshopItemStringInsteadOfBigInt[]) => void
) => {
  if (!process.send) {
    process.exit();
  }

  client.workshop
    .getItems(ids)
    .then((data) => {
      const newData = data.items
        .filter((data) => data)
        .map(
          (data) =>
            data &&
            ({
              ...data,
              owner: { ...data.owner, steamId64: data?.owner.steamId64.toString() },
              publishedFileId: data.publishedFileId.toString(),
              statistics: {
                numSubscriptions: data.statistics.numSubscriptions
                  ? data.statistics.numSubscriptions.toString()
                  : "",
                numFavorites: data.statistics.numFavorites ? data.statistics.numFavorites.toString() : "",
                numFollowers: data.statistics.numFollowers ? data.statistics.numFollowers.toString() : "",
                numUniqueSubscriptions: data.statistics.numUniqueSubscriptions
                  ? data.statistics.numUniqueSubscriptions.toString()
                  : "",
                numUniqueFavorites: data.statistics.numUniqueFavorites
                  ? data.statistics.numUniqueFavorites.toString()
                  : "",
                numUniqueFollowers: data.statistics.numUniqueFollowers
                  ? data.statistics.numUniqueFollowers.toString()
                  : "",
                numUniqueWebsiteViews: data.statistics.numUniqueWebsiteViews
                  ? data.statistics.numUniqueWebsiteViews.toString()
                  : "",
                reportScore: data.statistics.reportScore ? data.statistics.reportScore.toString() : "",
                numSecondsPlayed: data.statistics.numSecondsPlayed
                  ? data.statistics.numSecondsPlayed.toString()
                  : "",
                numPlaytimeSessions: data.statistics.numPlaytimeSessions
                  ? data.statistics.numPlaytimeSessions.toString()
                  : "",
                numComments: data.statistics.numComments ? data.statistics.numComments.toString() : "",
                numSecondsPlayedDuringTimePeriod: data.statistics.numSecondsPlayedDuringTimePeriod
                  ? data.statistics.numSecondsPlayedDuringTimePeriod.toString()
                  : "",
                numPlaytimeSessionsDuringTimePeriod: data.statistics.numPlaytimeSessionsDuringTimePeriod
                  ? data.statistics.numPlaytimeSessionsDuringTimePeriod.toString()
                  : "",
              },
            } as WorkshopItemStringInsteadOfBigInt)
        ) as WorkshopItemStringInsteadOfBigInt[];
      cb(newData);
    })
    .catch((e) => {
      fs.appendFileSync("sublog.txt", "ERROR:");
      fs.appendFileSync("sublog.txt", e.toString());
      process.exit();
    });
};

if (process.argv[3] == "getModsData") {
  console.log("getModsData");
  const ids = process.argv[4].split(",").map((id) => BigInt(id));
  const client = steamworks.init(Number(process.argv[2]));

  getItems(client, ids, (data) => {
    getDependencies(client, ids, (dependenciesMap) => {
      const dedupedAuthorIds = Array.from(new Set(data.map((data) => data.owner.steamId64))).map((id) =>
        BigInt(id)
      );

      getAuthors(client, dedupedAuthorIds, (authorsMap) => {
        const modsData = {
          mods: data,
          dependencies: Object.fromEntries(dependenciesMap),
          authors: Object.fromEntries(authorsMap),
        };
        if (process.send) process.send(modsData);
        setTimeout(() => {
          process.exit();
        }, 200);
      });
    });
  });
}

if (process.argv[3] == "checkState") {
  console.log("checkState");
  const ids = process.argv[4].split(";"); //"2856936614";
  const client = steamworks.init(Number(process.argv[2]));

  const idsThatNeedUpdates = ids
    .map((id) => [id, client.workshop.state(BigInt(id))] as [string, number])
    .filter((num) => num[1] & 8)
    .map((num) => num[0]);

  idsThatNeedUpdates.forEach(async (id) => {
    client.workshop.download(BigInt(id), false);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  const timeoutValue = (idsThatNeedUpdates.length > 0 && 200) || 0;
  setTimeout(() => {
    process.exit();
  }, timeoutValue);
}
if (process.argv[3] == "getItems") {
  console.log("getItems");
  const ids = process.argv[4].split(",").map((id) => BigInt(id));
  const client = steamworks.init(Number(process.argv[2]));

  getItems(client, ids, (data) => {
    if (process.send) process.send(data);
    setTimeout(() => {
      process.exit();
    }, 200);
  });
}
if (process.argv[3] == "upload") {
  console.log("upload");
  const client = steamworks.init(Number(process.argv[2]));

  try {
    client.workshop.createItem(Number(process.argv[2])).then((data) => {
      if (process.send)
        process.send({
          type: "success",
          workshopId: data.itemId.toString(),
          needsToAcceptAgreement: data.needsToAcceptAgreement,
        } as ModUploadResponseSuccess);
      setTimeout(() => {
        process.exit();
      }, 300);
    });
  } catch (e) {
    if (process.send) process.send({ type: "error" } as ModUploadResponseError);
    setTimeout(() => {
      process.exit();
    }, 300);
    console.log(e);
  }
}
if (process.argv[3] == "update") {
  console.log("update");
  const id = process.argv[4]; //"2856936614";
  const path = process.argv[5]; //"2856936614";
  const previewPath = process.argv[6];
  const modTags = process.argv[7];
  const modTitle = process.argv.length > 8 && process.argv[8];
  const client = steamworks.init(Number(process.argv[2]));

  fs.appendFileSync("sublog.txt", modTags.toString());

  console.log(id);
  console.log(path);

  const updateData = { contentPath: path, previewPath, tags: modTags ? modTags.split(";") : ["mod"] } as {
    contentPath: string;
    previewPath: string;
    title?: string;
    tags: string[];
  };

  if (modTitle) {
    updateData.title = modTitle;
  }

  client.workshop.updateItemWithCallback(
    BigInt(id),
    updateData,
    Number(process.argv[2]),
    (data) => {
      if (process.send)
        process.send({
          type: "success",
          itemId: Number(data.itemId),
          needsToAcceptAgreement: data.needsToAcceptAgreement,
        } as ModUpdateResponseSuccess);
      client.workshop.download(BigInt(id), false);
      setTimeout(() => {
        process.exit();
      }, 300);
    },
    (err) => {
      if (process.send) process.send({ type: "error", err } as ModUpdateResponseError);
      setTimeout(() => {
        process.exit();
      }, 300);
    },
    (data) => {
      if (process.send) {
        if (data.status == 3)
          process.send({
            type: "progress",
            status: data.status,
            progress: Number(data.progress),
            total: Number(data.total),
          } as ModUpdateResponseProgress);
      }
    },
    100
  );
}
if (process.argv[3] == "sub") {
  console.log("SUB");
  const ids = process.argv[4].split(";"); //"2856936614";
  const client = steamworks.init(Number(process.argv[2]));

  const promises = ids.map((id) => client.workshop.subscribe(BigInt(id)));

  Promise.allSettled(promises).then(() => {
    setTimeout(() => {
      if (process.send) process.send("done");
      process.exit();
    }, 200);
  });
}

type ModUpdateResponse = {
  type: string;
};

type ModUpdateResponseSuccess = ModUpdateResponse & {
  type: "success";
  needsToAcceptAgreement: boolean;
};
type ModUpdateResponseError = ModUpdateResponse & {
  type: "error";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  err: any;
};
type ModUpdateResponseProgress = ModUpdateResponse & {
  type: "progress";
  progress: number;
  total: number;
};

type ModUploadResponseSuccess = ModUpdateResponse & {
  type: "success";
  workshopId: string;
  needsToAcceptAgreement: boolean;
};
type ModUploadResponseError = ModUpdateResponse & {
  type: "error";
};
