import * as fs from "fs";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const makeSearchPattern = (searchTerm: string): RegExp => {
  try {
    return new RegExp(searchTerm, "i");
  } catch {
    // Match the literal text when the user entered an invalid regular expression.
    return new RegExp(escapeRegExp(searchTerm), "i");
  }
};

/** Searches the encodings used by pack text without relying on PowerShell. */
export const packFileContains = async (filePath: string, searchTerm: string): Promise<boolean> => {
  const contents = await fs.promises.readFile(filePath);
  const pattern = makeSearchPattern(searchTerm);
  return [contents.toString("utf8"), contents.toString("utf16le")].some((text) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
};
