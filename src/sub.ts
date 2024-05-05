import * as steamworks from "@ai-zen/steamworks.js";

if (process.argv[3] == "justRun") {
  console.log("justRun");
  steamworks.init(Number(process.argv[2]));
  setTimeout(() => {
    process.exit();
  }, 200);
}
if (process.argv[3] == "download") {
  console.log("download");
  const ids = process.argv[4].split(";"); //"2856936614";
  const client = steamworks.init(Number(process.argv[2]));

  ids.forEach(async (id) => {
    try {
      const success = client.workshop.download(BigInt(id), true);
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
                }
            )
        );
      setTimeout(() => {
        process.exit();
      }, 200);
    })
    .catch(() => {
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
    client.workshop.download(BigInt(id), true);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  const timeoutValue = (idsThatNeedUpdates.length > 0 && 200) || 0;
  setTimeout(() => {
    process.exit();
  }, timeoutValue);
}
if (process.argv[3] == "update") {
  console.log("update");
  const id = process.argv[4]; //"2856936614";
  const path = process.argv[5]; //"2856936614";
  const client = steamworks.init(Number(process.argv[2]));

  console.log(id);
  console.log(path);

  client.workshop.updateItemWithCallback(
    BigInt(id),
    { contentPath: path },
    Number(process.argv[2]),
    (data) => {
      if (process.send)
        process.send({
          type: "success",
          itemId: Number(data.itemId),
          needsToAcceptAgreement: data.needsToAcceptAgreement,
        });
      client.workshop.download(BigInt(id), true);
      setTimeout(() => {
        process.exit();
      }, 300);
    },
    (err) => {
      if (process.send) process.send({ type: "error", err });
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
          });
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
