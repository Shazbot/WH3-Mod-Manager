import * as fs from "fs/promises";

export async function tryOpenFile(path: string) {
  await (await fs.open(path, "r+")).close();
}
