export type EsfScalar = boolean | number | string | Buffer;

export type EsfValueType =
  | "bool"
  | "i32"
  | "u32"
  | "i64"
  | "u64"
  | "f32"
  | "f64"
  | "string"
  | "bytes";

export interface EsfValue {
  type: EsfValueType;
  value: EsfScalar;
}

export interface EsfRecordNode {
  kind: "record";
  name: string;
  children: EsfNode[];
}

export interface EsfArrayNode {
  kind: "array";
  name: string;
  children: EsfNode[];
}

export interface EsfValueNode {
  kind: "value";
  name: string;
  value: EsfValue;
}

export type EsfNode = EsfRecordNode | EsfArrayNode | EsfValueNode;

export interface EsfHeader {
  codecId: number;
  unknown1: number;
  creationDate: number;
  recordNamesOffset: number;
  fileSize: number;
}

export type EsfStringTableKind = "record_name" | "utf16" | "utf8";

export interface EsfStringEntry {
  id: number;
  text: string;
  offset: number;
  length: number;
  table: EsfStringTableKind;
}

export interface EsfMetadata {
  recordNames: string[];
  utf8ById: Map<number, string>;
  utf16ById: Map<number, string>;
}

export interface EsfDocument {
  header: EsfHeader;
  root: EsfNode;
  stringTable: EsfStringEntry[];
  metadata?: EsfMetadata;
}

export interface RegionSummary {
  key: string;
  id: number | null;
  path: string | null;
}
