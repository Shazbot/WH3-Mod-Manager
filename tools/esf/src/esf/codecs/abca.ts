import { EsfDocument } from "../EsfTypes";
import { parseCaabStringTables } from "./caabBinary";
import { buildEsfDocument } from "./document";

export function parseAbcaDocument(buffer: Buffer): EsfDocument {
  return buildEsfDocument(buffer, parseCaabStringTables);
}
