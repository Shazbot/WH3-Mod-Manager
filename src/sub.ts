import * as steamworks from "steamworks.js";

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

  ids.forEach((id) => client.workshop.download(BigInt(id), true));
  setTimeout(() => {
    process.exit();
  }, 300);
}
if (process.argv[3] == "unsubscribe") {
  console.log("unsubscribe");
  const id = process.argv[4];
  const client = steamworks.init(Number(process.argv[2]));

  client.workshop.unsubscribe(BigInt(id));
  setTimeout(() => {
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
          data
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

  idsThatNeedUpdates.forEach((id) => {
    client.workshop.download(BigInt(id), true);
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

  const promises = [
    client.workshop.updateItem(BigInt(id), { contentPath: path }).then(() => {
      client.workshop.download(BigInt(id), true);
    }),
  ];

  Promise.allSettled(promises).then(() => {
    if (process.send) process.send(path);
    process.exit();
  });
}
if (process.argv[3] == "sub") {
  console.log("SUB");
  const ids = process.argv[4].split(";"); //"2856936614";
  const client = steamworks.init(Number(process.argv[2]));

  const promises = ids.map((id) => client.workshop.subscribe(BigInt(id)));

  Promise.allSettled(promises).then(() => {
    setTimeout(() => {
      process.exit();
    }, 200);
  });
}
