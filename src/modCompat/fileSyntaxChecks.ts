import { XMLParser, XMLValidator } from "fast-xml-parser";
import * as parser from "luaparse";
import { DBFileName, FileAnalysisError, Pack, PackedFile } from "../packFileTypes";
import { appendToFileToFileRegistry } from "./fileToFileReferences";

export const packFileAnalysisErrors: Record<string, Record<DBFileName, FileAnalysisError[]>> = {};

export const emptyPackFileAnalysisErrors = () => {
  for (const packName of Object.keys(packFileAnalysisErrors)) {
    delete packFileAnalysisErrors[packName];
  }
};

let xmlParserAttributesCache: string[] = [];
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeValueProcessor: (attrName, attrValue, jPath) => {
    if (attrName == "model" || attrName == "definition") {
      xmlParserAttributesCache.push(attrValue);
    }
    return attrValue;
  },
});

export function appendScriptToFileChecksRegistry(pack: Pack, packFile: PackedFile) {
  if (!packFile.text) return;

  try {
    parser.parse(packFile.text, { luaVersion: "5.2" });
  } catch (e) {
    console.log("FAILED PARSING SCRIPT", packFile.name);
    console.log("pack name:", pack.name);
    console.log(e);

    if (e instanceof Error) {
      const error = {
        msg: e.message,
        packName: pack.name,
        packFileName: packFile.name,
      } as FileAnalysisError;

      packFileAnalysisErrors[pack.name] = packFileAnalysisErrors[pack.name] || {};
      packFileAnalysisErrors[pack.name][packFile.name] =
        packFileAnalysisErrors[pack.name][packFile.name] || [];

      if (
        packFileAnalysisErrors[pack.name][packFile.name].find(
          (existingError) =>
            existingError.msg == existingError.msg &&
            existingError.packName == existingError.packName &&
            existingError.packFileName == existingError.packFileName
        )
      )
        return;

      packFileAnalysisErrors[pack.name][packFile.name].push(error);
    }
  }
}

export function appendToFileChecksRegistry(pack: Pack, packFile: PackedFile) {
  if (!packFile.text) return;
  let error = null;

  try {
    if (packFile.name.endsWith(".variantmeshdefinition")) {
      try {
        xmlParserAttributesCache = [];
        xmlParser.parse(packFile.text, true);
        appendToFileToFileRegistry(pack, packFile, xmlParserAttributesCache);
        return;
      } catch (e) {
        /* run it inside XMLValidator.validate */
      }
    }

    const result = XMLValidator.validate(packFile.text, {
      allowBooleanAttributes: true,
    });
    if (result != true) {
      if (result.err.msg != "Multiple possible root nodes found.") {
        console.log("FAILED PARSING XML", packFile.name);
        console.log("pack name:", pack.name);
        console.log(result.err);
        error = {
          msg: result.err.msg,
          lineNum: result.err.line,
          colNum: result.err.col,
          packName: pack.name,
          packFileName: packFile.name,
        } as FileAnalysisError;
      }
      // console.log(packFile.text);
    } else {
      // appendToFileToFileRegistry(pack, packFile, result);
    }
  } catch (e) {
    console.log(e);
    if (e instanceof SyntaxError) {
      error = {
        msg: e.message,
        packName: pack.name,
        packFileName: packFile.name,
      } as FileAnalysisError;
    }
    console.log("XMLValidator error when reading", pack.name, packFile.name);
    console.log(e);
  }

  if (!error) return;
  const packFileName = packFile.name;

  packFileAnalysisErrors[pack.name] = packFileAnalysisErrors[pack.name] || {};
  packFileAnalysisErrors[pack.name][packFileName] = packFileAnalysisErrors[pack.name][packFileName] || [];

  if (
    packFileAnalysisErrors[pack.name][packFileName].find(
      (existingError) =>
        existingError.msg == existingError.msg &&
        existingError.packName == existingError.packName &&
        existingError.packFileName == existingError.packFileName
    )
  )
    return;

  // console.log(
  //   `found ${listenerName[1]} in ${packFileName} in ${pack.name}, position ${listenerName.index}`
  // );
  packFileAnalysisErrors[pack.name][packFileName].push(error);
}
