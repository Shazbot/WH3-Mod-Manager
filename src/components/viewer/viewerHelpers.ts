import { DBVersion, SchemaField, AmendedSchemaField } from "@/src/packFileTypes";

export const chunkTableIntoRows = (schemaFields: SchemaField[], currentSchema: DBVersion) => {
  return (
    schemaFields.reduce<AmendedSchemaField[][]>((resultArray, item, index) => {
      const chunkIndex = Math.floor(index / currentSchema.fields.length);

      if (!resultArray[chunkIndex]) {
        resultArray[chunkIndex] = []; // start a new chunk
      }

      resultArray[chunkIndex].push(item as AmendedSchemaField);

      return resultArray;
    }, []) || []
  );
};

export const findNodeInTree = (
  tree: IViewerTreeNodeWithData | IViewerTreeNode,
  targetName: string
): IViewerTreeNodeWithData | IViewerTreeNode | null => {
  if (tree.name === targetName) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNodeInTree(child, targetName);
      if (found) return found;
    }
  }
  return null;
};
