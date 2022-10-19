import * as steamworks from "steamworks.js";

if (process.argv[2] == "justRun") {
  console.log("justRun");
  steamworks.init(1142710);
  setTimeout(() => {
    process.exit();
  }, 200);
}
if (process.argv[2] == "download") {
  console.log("download");
  const ids = process.argv[3].split(";"); //"2856936614";
  const client = steamworks.init(1142710);

  ids.forEach((id) => client.workshop.download(BigInt(id), true));
  process.exit();
}
if (process.argv[2] == "update") {
  console.log("update");
  const id = process.argv[3]; //"2856936614";
  const path = process.argv[4]; //"2856936614";
  const client = steamworks.init(1142710);

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
if (process.argv[2] == "sub") {
  console.log("SUB");
  const ids = process.argv[3].split(";"); //"2856936614";
  const client = steamworks.init(1142710);

  const promises = ids.map((id) => client.workshop.subscribe(BigInt(id)));

  Promise.allSettled(promises).then(() => {
    setTimeout(() => {
      process.exit();
    }, 200);
  });
}
