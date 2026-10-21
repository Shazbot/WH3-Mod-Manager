import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import enTranslation from "../locales/en/translation.json";

/**
 * The English file is the key list the renderer sends to the main process (`staticTextIds`) and the
 * source other languages fall back to, so a key used by the optimizer UI or main-process messages
 * that is missing there shows up as the raw key.
 */
const root = path.join(__dirname, "..", "src");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const isOptimizerKey = (key: string) => /optimiz|workshopGameStart|CompressWorkshop|compressWorkshop/i.test(key);

describe("optimizer localization keys", () => {
  it("has every key the optimizer UI and messages use in the English file", () => {
    const keys = new Set<string>();
    for (const file of [
      "components/WorkshopGameStartProgress.tsx",
      "components/OptionsDrawer.tsx",
      "components/ModDropdownOptions.tsx",
    ]) {
      for (const match of read(file).matchAll(/localized\.(\w+)/g)) if (isOptimizerKey(match[1])) keys.add(match[1]);
    }
    for (const match of read("ipcMainListeners.ts").matchAll(/i18n\.t\(\s*"(\w+)"/g)) {
      if (isOptimizerKey(match[1])) keys.add(match[1]);
    }
    for (const match of read("components/WorkshopGameStartProgress.tsx").matchAll(/"(workshopGameStart\w+)"/g)) {
      keys.add(match[1]);
    }
    keys.add("showOptimizerReport");

    // Plural keys exist as key_one / key_other.
    const missing = [...keys].filter(
      (key) => !(key in enTranslation) && !(`${key}_one` in enTranslation && `${key}_other` in enTranslation),
    );
    expect(missing).toEqual([]);
    expect(keys.size).toBeGreaterThan(15);
  });
});
