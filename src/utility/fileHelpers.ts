import * as fs from "fs";

export async function tryOpenFile(path: string) {
  const fd = fs.openSync(path, "r+");
  fs.closeSync(fd);
}
