import { EsfDocument } from "../EsfTypes";
import { parseCbabStringTables } from "./caabBinary";
import { buildEsfDocument } from "./document";

export function parseCbabDocument(buffer: Buffer): EsfDocument {
  return buildEsfDocument(buffer, parseCbabStringTables);
}
