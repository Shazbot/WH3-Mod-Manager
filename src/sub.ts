import * as steamworks from "steamworks.js";
import * as fs from "fs";

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
if (process.argv[3] == "getItems") {
  console.log("getItems");
  const ids = process.argv[4].split(",").map((id) => BigInt(id));
  const client = steamworks.init(Number(process.argv[2]));

  if (!process.send) {
    process.exit();
  }

  client.workshop
    .getItems(ids)
    .then((data) => {
      if (process.send)
        process.send(
          data.items
            .filter((data) => data)
            .map(
              (data) =>
                data && {
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
                }
            )
        );
      setTimeout(() => {
        process.exit();
      }, 200);
    })
    .catch((e) => {
      fs.appendFileSync("sublog.txt", "ERROR:");
      fs.appendFileSync("sublog.txt", e.toString());
      process.exit();
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
