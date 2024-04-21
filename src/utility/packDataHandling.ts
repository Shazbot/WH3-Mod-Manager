import { LocVersion } from "../schema";
import { PackedFile, AmendedSchemaField, SCHEMA_FIELD_TYPE, DBVersion } from "../packFileTypes";

export const isSchemaFieldNumber = (fieldType: SCHEMA_FIELD_TYPE) => {
  return (
    fieldType === "I16" ||
    fieldType === "I32" ||
    fieldType === "I64" ||
    fieldType === "F32" ||
    fieldType === "F64"
  );
};

export const isSchemaFieldNumberInteger = (fieldType: SCHEMA_FIELD_TYPE) => {
  return fieldType === "I16" || fieldType === "I32" || fieldType === "I64";
};

const addToLocTreeNode = (leafNode: TreeNode, subKeys: string[], value: string) => {
  if (subKeys.length == 0) {
    leafNode.value = value;
    return;
  }
  let leaf = leafNode.children.find((child) => child.key == subKeys[0]);
  if (!leaf) {
    leaf = {
      children: [],
      key: subKeys[0],
    };
    leafNode.children.push(leaf);
  }
  addToLocTreeNode(leaf, subKeys.slice(1), value);
};

const addToLocTree = (locTree: Tree, key: string, value: string) => {
  const subKeys = key.split("_");
  let leaf = locTree.node.children.find((child) => child.key == subKeys[0]);
  if (!leaf) {
    leaf = {
      children: [],
      key: subKeys[0],
    };
    locTree.node.children.push(leaf);
  }
  addToLocTreeNode(leaf, subKeys.slice(1), value);
};

export const getLocsTree = (packData: PackViewData) => {
  const locPFs = Object.values(packData.packedFiles).filter((pF) => pF.name.endsWith(".loc"));
  const data = getPlainPackData(locPFs, LocVersion);
  const locTree = { node: { children: [], key: "" } } as Tree;
  for (const rows of Object.values(data)) {
    for (const row of rows) {
      const [locKey, locValue] = [row[0] as string, row[1] as string];
      if (locKey != "") addToLocTree(locTree, locKey, locValue);
    }
  }

  return locTree;
};

const getTreeNodeForLoc = (leaf: TreeNode, locs: string[]): TreeNode | undefined => {
  if (locs.length == 0) return;

  for (const child of leaf.children) {
    if (child.key == locs[0]) {
      if (locs.length == 1) {
        return child;
      }
      return getTreeNodeForLoc(child, locs.slice(1));
    }
  }
};

export const getLocFromTree = (tree: Tree, locPrefix: string, loc: string) => {
  const node = getTreeNodeForLoc(tree.node, `${locPrefix}_${loc}`.split("_"));
  if (node) return node.value;
};

const getPlainPackData = (
  packedFiles: PackedFile[],
  schema: DBVersion,
  rowFilter?: (row: PlainPackDataTypes[]) => boolean
) => {
  const packFilePathToData = {} as Record<string, PlainPackFileData>;
  for (const packFile of packedFiles) {
    const chunkedTable =
      (packFile.schemaFields &&
        packFile.schemaFields.reduce<AmendedSchemaField[][]>((resultArray, item, index) => {
          const chunkIndex = Math.floor(index / schema.fields.length);

          if (!resultArray[chunkIndex]) {
            resultArray[chunkIndex] = []; // start a new chunk
          }

          resultArray[chunkIndex].push(item as AmendedSchemaField);

          return resultArray;
        }, [])) ||
      [];

    let data = chunkedTable.map((row) =>
      row.map((cell) => {
        if (cell.type == "Boolean") {
          return cell.resolvedKeyValue != "0";
        }
        if (cell.type == "OptionalStringU8" && cell.resolvedKeyValue == "0") {
          return "";
        }
        return cell.resolvedKeyValue;
      })
    );

    if (rowFilter) {
      data = data.filter((row) => rowFilter(row));
    }

    packFilePathToData[packFile.name] = data;
  }

  return packFilePathToData;
};

const getPackTableData = (
  packedFilePath: string,
  packData: PackViewData,
  rowFilter?: (row: PlainPackDataTypes[]) => boolean
) => {
  console.log("getPackTableData packedFilePath:", packedFilePath);

  const packedFiles: PackedFile[] = [];
  const packFile = packData.packedFiles[packedFilePath];
  if (!packFile) {
    // check case where we have just the pack file name as instead of full path (e.g. 'data.pack')
    for (const [iterPackedFilePath, iterPackedFile] of Object.entries(packData.packedFiles)) {
      // console.log(iterPackedFilePath);
      if (iterPackedFilePath.startsWith(packedFilePath)) {
        // console.log("found a match");
        packedFiles.push(iterPackedFile);
      }
    }

    if (packedFiles.length == 0) return;
  } else {
    packedFiles.push(packFile);
  }
  const currentSchema = packedFiles[0].tableSchema;

  // console.log("PACKFILE IS ", packFile);
  // console.log("CURRENT SCHEMA IS ", currentSchema);

  if (!currentSchema) {
    console.log("NO current schema");
    return;
  }

  return getPlainPackData(packedFiles, currentSchema, rowFilter);
};

export default getPackTableData;
