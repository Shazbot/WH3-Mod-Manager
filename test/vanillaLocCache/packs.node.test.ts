import { describe, expect, it } from "vitest";

import { getVanillaLocalisationPackNames } from "../../src/vanillaLocCache/packs";

/**
 * The localisation packs WH3 ships, as listed by the game manifest, in an order that is not the
 * answer. Note the game's own codes: German is `ge`, Spanish `sp`, Korean `kr`.
 */
const packNames = [
  "data.pack",
  "local_ge.pack",
  "db.pack",
  "local_fr.pack",
  "local_en.pack",
  "models.pack",
  "local_zh.pack",
];

describe("vanilla localisation packs", () => {
  it("takes only the local packs, ignoring everything that carries no locs", () => {
    expect(getVanillaLocalisationPackNames(packNames, "en")).toEqual(["local_en.pack"]);
  });

  it("puts the player's language after English so it overrides it", () => {
    expect(getVanillaLocalisationPackNames(packNames, "fr")).toEqual([
      "local_en.pack",
      "local_fr.pack",
    ]);
  });

  it("does not list English twice when English is the player's language", () => {
    expect(getVanillaLocalisationPackNames(packNames, "en")).toEqual(["local_en.pack"]);
    expect(getVanillaLocalisationPackNames(packNames, undefined)).toEqual(["local_en.pack"]);
  });

  it("falls back to English alone when the language ships no pack", () => {
    // The app's language codes are not always the game's - "de" has no pack, "ge" is the German one.
    expect(getVanillaLocalisationPackNames(packNames, "de")).toEqual(["local_en.pack"]);
  });

  it("sorts a language's packs so a suffixed one wins, for versions that ship several", () => {
    // WH3 ships one English pack today, but has shipped suffixed ones, and set order is not stable.
    const withSuffixed = [...packNames, "local_en_3.pack"];
    expect(getVanillaLocalisationPackNames(withSuffixed, "en")).toEqual([
      "local_en.pack",
      "local_en_3.pack",
    ]);
  });

  it("is stable regardless of the order the pack names arrive in", () => {
    expect(getVanillaLocalisationPackNames([...packNames].reverse(), "fr")).toEqual(
      getVanillaLocalisationPackNames(packNames, "fr"),
    );
  });
});
