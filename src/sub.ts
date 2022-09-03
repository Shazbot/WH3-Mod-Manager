import * as steamworks from "steamworks.js";

const ids = process.argv[2].split(";"); //"2856936614";
const client = steamworks.init(1142710);

const promises = ids.map((id) =>
  client.workshop.subscribe(BigInt(id)).then(() => {
    client.workshop.download(BigInt(id), true);
  })
);

Promise.allSettled(promises).then(() => {
  process.exit();
});
