import type { Node, XYPosition } from "@xyflow/react";

import type { DBVersion } from "../packFileTypes";
import type {
  AddNewColumnNodeData,
  AggregateNestedNodeData,
  AllEnabledModsNodeData,
  AppendTextNodeData,
  ColumnSelectionDropdownNodeData,
  ColumnSelectionNodeData,
  CustomRowsInputNodeData,
  CustomSchemaNodeData,
  DeduplicateNodeData,
  DumpToTSVNodeData,
  ExtractTableNodeData,
  FilterNodeData,
  FlattenNestedNodeData,
  GenerateRowsNodeData,
  GetCounterColumnNodeData,
  GroupByColumnsNodeData,
  GroupByNodeData,
  GroupedColumnsToTextNodeData,
  IndexTableNodeData,
  LookupNodeData,
  MathCeilNodeData,
  MathMaxNodeData,
  MergeChangesNodeData,
  MultiFilterNodeData,
  NumericAdjustmentNodeData,
  PackFilesDropdownNodeData,
  PackFilesNodeData,
  ReadTSVFromPackNodeData,
  ReferenceTableLookupNodeData,
  ReverseReferenceLookupNodeData,
  SaveChangesNodeData,
  TableSelectionDropdownNodeData,
  TableSelectionNodeData,
  TextJoinNodeData,
  TextSurroundNodeData,
} from "./nodes/types";

interface NodeTypeSectionDefinition {
  titleKey: string;
  titleFallback: string;
  nodes: FlowNodeType[];
}

export interface NodeTypeSection {
  title: string;
  nodes: { type: FlowNodeType; label: string; description: string }[];
}

export interface DraggableNodeData {
  type: FlowNodeType;
  label: string;
  description: string;
}

export interface NodeFactoryContext {
  nodeId: string;
  position: XYPosition;
  label: string;
  sortedTableNames: string[];
  DBNameToDBVersions?: Record<string, DBVersion[]>;
}

interface NodeDefinition {
  type: FlowNodeType;
  labelKey: string;
  labelFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  createData: (context: NodeFactoryContext) => Record<string, unknown>;
}

const createDefaultNodeStyle = () => ({
  border: "2px solid #3b82f6",
  borderRadius: "8px",
  padding: "10px",
  background: "#374151",
  color: "#ffffff",
});

const createNodeDefinition = <TNodeData extends Record<string, unknown>>(definition: {
  type: FlowNodeType;
  labelKey: string;
  labelFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  createData: (context: NodeFactoryContext) => TNodeData;
}): NodeDefinition => definition;

const createOutputTable = (index: number, existingTableName = "") => ({
  handleId: `output-table${index}`,
  name: `Table ${index}`,
  existingTableName,
  columnMapping: [],
});

const nodeDefinitions: Record<FlowNodeType, NodeDefinition> = {
  allenabledmods: createNodeDefinition<AllEnabledModsNodeData>({
    type: "allenabledmods",
    labelKey: "nodeEditorNodeAllEnabledModsLabel",
    labelFallback: "All Enabled Mods",
    descriptionKey: "nodeEditorNodeAllEnabledModsDescription",
    descriptionFallback: "Outputs all currently enabled mods as PackFiles",
    createData: ({ label }) => ({
      label,
      type: "allenabledmods",
      outputType: "PackFiles",
      includeBaseGame: true,
    }),
  }),
  packfilesdropdown: createNodeDefinition<PackFilesDropdownNodeData>({
    type: "packfilesdropdown",
    labelKey: "nodeEditorNodePackFilesDropdownLabel",
    labelFallback: "Pack Dropdown Input",
    descriptionKey: "nodeEditorNodePackFilesDropdownDescription",
    descriptionFallback: "Node with dropdown for pack selection",
    createData: ({ label }) => ({
      label,
      type: "packfilesdropdown",
      selectedPack: "",
      outputType: "PackFiles",
      useCurrentPack: false,
    }),
  }),
  packedfiles: createNodeDefinition<PackFilesNodeData>({
    type: "packedfiles",
    labelKey: "nodeEditorNodePackFilesTextboxLabel",
    labelFallback: "Pack Textbox Input",
    descriptionKey: "nodeEditorNodePackFilesTextboxDescription",
    descriptionFallback: "Node with textbox that outputs PackFiles",
    createData: ({ label }) => ({
      label,
      type: "packedfiles",
      textValue: "",
      outputType: "PackFiles",
      useCurrentPack: false,
    }),
  }),
  referencelookup: createNodeDefinition<ReferenceTableLookupNodeData>({
    type: "referencelookup",
    labelKey: "nodeEditorNodeReferenceLookupLabel",
    labelFallback: "Reference Lookup",
    descriptionKey: "nodeEditorNodeReferenceLookupDescription",
    descriptionFallback: "Lookup rows in referenced tables based on input table references",
    createData: ({ label, DBNameToDBVersions }) => ({
      label,
      type: "referencelookup",
      selectedReferenceTable: "",
      inputType: "TableSelection",
      outputType: "TableSelection",
      referenceTableNames: [],
      columnNames: [],
      DBNameToDBVersions: DBNameToDBVersions ?? {},
      includeBaseGame: true,
    }),
  }),
  reversereferencelookup: createNodeDefinition<ReverseReferenceLookupNodeData>({
    type: "reversereferencelookup",
    labelKey: "nodeEditorNodeReverseReferenceLookupLabel",
    labelFallback: "Reverse Reference Lookup",
    descriptionKey: "nodeEditorNodeReverseReferenceLookupDescription",
    descriptionFallback: "Find rows in tables that reference the input table",
    createData: ({ label, DBNameToDBVersions }) => ({
      label,
      type: "reversereferencelookup",
      selectedReverseTable: "",
      inputType: "TableSelection",
      outputType: "TableSelection",
      reverseTableNames: [],
      columnNames: [],
      DBNameToDBVersions: DBNameToDBVersions ?? {},
      includeBaseGame: true,
    }),
  }),
  tableselectiondropdown: createNodeDefinition<TableSelectionDropdownNodeData>({
    type: "tableselectiondropdown",
    labelKey: "nodeEditorNodeTableDropdownLabel",
    labelFallback: "Table Dropdown Input",
    descriptionKey: "nodeEditorNodeTableDropdownDescription",
    descriptionFallback: "Node with dropdown for table selection",
    createData: ({ label, sortedTableNames }) => ({
      label,
      type: "tableselectiondropdown",
      selectedTable: "",
      inputType: "PackFiles",
      outputType: "TableSelection",
      tableNames: sortedTableNames,
    }),
  }),
  tableselection: createNodeDefinition<TableSelectionNodeData>({
    type: "tableselection",
    labelKey: "nodeEditorNodeTableTextboxLabel",
    labelFallback: "Table Textbox Input",
    descriptionKey: "nodeEditorNodeTableTextboxDescription",
    descriptionFallback: "Accepts PackFiles input, outputs TableSelection",
    createData: ({ label }) => ({
      label,
      type: "tableselection",
      textValue: "",
      inputType: "PackFiles",
      outputType: "TableSelection",
    }),
  }),
  deduplicate: createNodeDefinition<DeduplicateNodeData>({
    type: "deduplicate",
    labelKey: "nodeEditorNodeDeduplicateRowsLabel",
    labelFallback: "Deduplicate Rows",
    descriptionKey: "nodeEditorNodeDeduplicateRowsDescription",
    descriptionFallback: "Remove duplicate rows",
    createData: ({ label }) => ({
      label,
      type: "deduplicate",
      dedupeByColumns: [],
      dedupeAgainstVanilla: false,
      inputType: "TableSelection",
      outputType: "TableSelection",
      columnNames: [],
    }),
  }),
  filter: createNodeDefinition<FilterNodeData>({
    type: "filter",
    labelKey: "nodeEditorNodeFilterLabel",
    labelFallback: "Filter",
    descriptionKey: "nodeEditorNodeFilterDescription",
    descriptionFallback: "Filter table rows with AND/OR conditions",
    createData: ({ label, DBNameToDBVersions }) => ({
      label,
      type: "filter",
      filters: [{ column: "", value: "", not: false, operator: "AND" }],
      inputType: "TableSelection",
      outputType: "TableSelection",
      columnNames: [],
      DBNameToDBVersions: DBNameToDBVersions ?? {},
    }),
  }),
  multifilter: createNodeDefinition<MultiFilterNodeData>({
    type: "multifilter",
    labelKey: "nodeEditorNodeMultiFilterLabel",
    labelFallback: "Multi-Filter",
    descriptionKey: "nodeEditorNodeMultiFilterDescription",
    descriptionFallback: "Split table rows by column values into multiple outputs",
    createData: ({ label, DBNameToDBVersions }) => ({
      label,
      type: "multifilter",
      selectedColumn: "",
      splitValues: [],
      inputType: "TableSelection",
      outputType: "TableSelection",
      columnNames: [],
      DBNameToDBVersions: DBNameToDBVersions ?? {},
    }),
  }),
  columnselectiondropdown: createNodeDefinition<ColumnSelectionDropdownNodeData>({
    type: "columnselectiondropdown",
    labelKey: "nodeEditorNodeColumnDropdownLabel",
    labelFallback: "Column Dropdown Input",
    descriptionKey: "nodeEditorNodeColumnDropdownDescription",
    descriptionFallback: "Node with dropdown for column selection",
    createData: ({ label, DBNameToDBVersions }) => ({
      label,
      type: "columnselectiondropdown",
      selectedColumn: "",
      inputType: "TableSelection",
      outputType: "ColumnSelection",
      columnNames: [],
      DBNameToDBVersions: DBNameToDBVersions ?? {},
    }),
  }),
  columnselection: createNodeDefinition<ColumnSelectionNodeData>({
    type: "columnselection",
    labelKey: "nodeEditorNodeColumnTextboxLabel",
    labelFallback: "Column Textbox Input",
    descriptionKey: "nodeEditorNodeColumnTextboxDescription",
    descriptionFallback: "Accepts TableSelection input, outputs ColumnSelection",
    createData: ({ label }) => ({
      label,
      type: "columnselection",
      textValue: "",
      inputType: "TableSelection",
      outputType: "ColumnSelection",
    }),
  }),
  numericadjustment: createNodeDefinition<NumericAdjustmentNodeData>({
    type: "numericadjustment",
    labelKey: "nodeEditorNodeNumericAdjustmentLabel",
    labelFallback: "Numeric Adjustment",
    descriptionKey: "nodeEditorNodeNumericAdjustmentDescription",
    descriptionFallback: "Accepts ColumnSelection input, outputs ChangedColumnSelection",
    createData: ({ label }) => ({
      label,
      type: "numericadjustment",
      textValue: "",
      inputType: "ColumnSelection",
      outputType: "ChangedColumnSelection",
    }),
  }),
  mathceil: createNodeDefinition<MathCeilNodeData>({
    type: "mathceil",
    labelKey: "nodeEditorNodeMathCeilLabel",
    labelFallback: "Math Ceil",
    descriptionKey: "nodeEditorNodeMathCeilDescription",
    descriptionFallback: "Accepts ChangedColumnSelection, applies Math.ceil() to round up",
    createData: ({ label }) => ({
      label,
      type: "mathceil",
      inputType: "ChangedColumnSelection",
      outputType: "ChangedColumnSelection",
    }),
  }),
  mathmax: createNodeDefinition<MathMaxNodeData>({
    type: "mathmax",
    labelKey: "nodeEditorNodeMathMaxLabel",
    labelFallback: "Math Max",
    descriptionKey: "nodeEditorNodeMathMaxDescription",
    descriptionFallback: "Accepts ChangedColumnSelection, applies Math.max(value, input)",
    createData: ({ label }) => ({
      label,
      type: "mathmax",
      textValue: "",
      inputType: "ChangedColumnSelection",
      outputType: "ChangedColumnSelection",
    }),
  }),
  mergechanges: createNodeDefinition<MergeChangesNodeData>({
    type: "mergechanges",
    labelKey: "nodeEditorNodeMergeChangesLabel",
    labelFallback: "Merge Changes",
    descriptionKey: "nodeEditorNodeMergeChangesDescription",
    descriptionFallback: "Merges multiple ChangedColumnSelection inputs into one output",
    createData: ({ label }) => ({
      label,
      type: "mergechanges",
      inputType: "ChangedColumnSelection",
      outputType: "ChangedColumnSelection",
      inputCount: 2,
    }),
  }),
  savechanges: createNodeDefinition<SaveChangesNodeData>({
    type: "savechanges",
    labelKey: "nodeEditorNodeSaveChangesLabel",
    labelFallback: "Save Changes",
    descriptionKey: "nodeEditorNodeSaveChangesDescription",
    descriptionFallback: "Accepts ChangedColumnSelection input and saves the changes",
    createData: ({ label }) => ({
      label,
      type: "savechanges",
      textValue: "",
      packName: "",
      packedFileName: "",
      inputType: "ChangedColumnSelection",
    }),
  }),
  appendtext: createNodeDefinition<AppendTextNodeData>({
    type: "appendtext",
    labelKey: "nodeEditorNodeAppendTextLabel",
    labelFallback: "Append Text",
    descriptionKey: "nodeEditorNodeAppendTextDescription",
    descriptionFallback: "Accepts Text, Text Lines, or GroupedText, adds text before and after",
    createData: ({ label }) => ({
      label,
      type: "appendtext",
      beforeText: "",
      afterText: "",
      inputType: "Text",
      outputType: "Text",
    }),
  }),
  groupbycolumns: createNodeDefinition<GroupByColumnsNodeData>({
    type: "groupbycolumns",
    labelKey: "nodeEditorNodeGroupByColumnsForTextLabel",
    labelFallback: "Group By Columns (For Text)",
    descriptionKey: "nodeEditorNodeGroupByColumnsForTextDescription",
    descriptionFallback: "Accepts TableSelection, two column dropdowns, outputs GroupedText",
    createData: ({ label, DBNameToDBVersions }) => ({
      label,
      type: "groupbycolumns",
      selectedColumn1: "",
      selectedColumn2: "",
      inputType: "TableSelection",
      outputType: "GroupedText",
      columnNames: [],
      DBNameToDBVersions: DBNameToDBVersions ?? {},
    }),
  }),
  groupedcolumnstotext: createNodeDefinition<GroupedColumnsToTextNodeData>({
    type: "groupedcolumnstotext",
    labelKey: "nodeEditorNodeGroupedColumnsToTextLabel",
    labelFallback: "Grouped Columns to Text",
    descriptionKey: "nodeEditorNodeGroupedColumnsToTextDescription",
    descriptionFallback: "Formats GroupedText using pattern and join separator",
    createData: ({ label }) => ({
      label,
      type: "groupedcolumnstotext",
      pattern: "{0}: {1}",
      joinSeparator: "\\n",
      inputType: "GroupedText",
      outputType: "Text",
    }),
  }),
  textjoin: createNodeDefinition<TextJoinNodeData>({
    type: "textjoin",
    labelKey: "nodeEditorNodeTextJoinLabel",
    labelFallback: "Text Join",
    descriptionKey: "nodeEditorNodeTextJoinDescription",
    descriptionFallback: "Accepts Text Lines input, outputs joined Text",
    createData: ({ label }) => ({
      label,
      type: "textjoin",
      textValue: "",
      inputType: "Text Lines",
      outputType: "Text",
    }),
  }),
  textsurround: createNodeDefinition<TextSurroundNodeData>({
    type: "textsurround",
    labelKey: "nodeEditorNodeTextSurroundLabel",
    labelFallback: "Text Surround",
    descriptionKey: "nodeEditorNodeTextSurroundDescription",
    descriptionFallback: "Accepts Text or Text Lines, outputs same type with surrounding text",
    createData: ({ label }) => ({
      label,
      type: "textsurround",
      textValue: "",
      inputType: "Text",
      outputType: "Text",
    }),
  }),
  addnewcolumn: createNodeDefinition<AddNewColumnNodeData>({
    type: "addnewcolumn",
    labelKey: "nodeEditorNodeAddNewColumnLabel",
    labelFallback: "Add New Column",
    descriptionKey: "nodeEditorNodeAddNewColumnDescription",
    descriptionFallback: "Add transformed columns while preserving all original columns",
    createData: ({ label }) => ({
      label,
      type: "addnewcolumn",
      transformations: [],
      inputType: "TableSelection",
      outputType: "TableSelection",
      columnNames: [],
      connectedTableName: "",
      DBNameToDBVersions: {},
    }),
  }),
  aggregatenested: createNodeDefinition<AggregateNestedNodeData>({
    type: "aggregatenested",
    labelKey: "nodeEditorNodeAggregateNestedLabel",
    labelFallback: "Aggregate Nested",
    descriptionKey: "nodeEditorNodeAggregateNestedDescription",
    descriptionFallback: "Performs aggregations (min/max/sum/avg/count) on nested arrays",
    createData: ({ label }) => ({
      label,
      type: "aggregatenested",
      aggregateColumn: "",
      aggregateType: "min",
      inputType: "NestedTableSelection",
      outputType: "NestedTableSelection",
      columnNames: [],
      connectedTableName: "",
      filterColumn: "",
      filterOperator: "equals",
      filterValue: "",
      DBNameToDBVersions: {},
    }),
  }),
  dumptotsv: createNodeDefinition<DumpToTSVNodeData>({
    type: "dumptotsv",
    labelKey: "nodeEditorNodeDumpToTSVLabel",
    labelFallback: "Dump to TSV",
    descriptionKey: "nodeEditorNodeDumpToTSVDescription",
    descriptionFallback: "Exports table data to a TSV file for inspection",
    createData: ({ label }) => ({
      label,
      type: "dumptotsv",
      openInWindows: false,
      filename: "",
      inputType: "TableSelection",
    }),
  }),
  extracttable: createNodeDefinition<ExtractTableNodeData>({
    type: "extracttable",
    labelKey: "nodeEditorNodeExtractTableLabel",
    labelFallback: "Extract Table",
    descriptionKey: "nodeEditorNodeExtractTableDescription",
    descriptionFallback: "Filters columns by prefix and removes prefix",
    createData: ({ label }) => ({
      label,
      type: "extracttable",
      tablePrefix: "",
      inputType: "TableSelection",
      outputType: "TableSelection",
      tablePrefixes: [],
      columnNames: [],
      connectedTableName: "",
      DBNameToDBVersions: {},
    }),
  }),
  flattennested: createNodeDefinition<FlattenNestedNodeData>({
    type: "flattennested",
    labelKey: "nodeEditorNodeFlattenNestedLabel",
    labelFallback: "Flatten Nested",
    descriptionKey: "nodeEditorNodeFlattenNestedDescription",
    descriptionFallback: "Expands nested table selections into flat rows",
    createData: ({ label }) => ({
      label,
      type: "flattennested",
      inputType: "NestedTableSelection",
      outputType: "TableSelection",
      columnNames: [],
      connectedTableName: "",
      DBNameToDBVersions: {},
    }),
  }),
  generaterows: createNodeDefinition<GenerateRowsNodeData>({
    type: "generaterows",
    labelKey: "nodeEditorNodeGenerateRowsLabel",
    labelFallback: "Generate Rows",
    descriptionKey: "nodeEditorNodeGenerateRowsDescription",
    descriptionFallback: "Creates new table rows with transformations and multiple outputs",
    createData: ({ label }) => ({
      label,
      type: "generaterows",
      sourceColumns: [],
      transformations: [],
      outputTables: [createOutputTable(1)],
      inputType: "TableSelection",
      outputType: "TableSelection",
      outputCount: 1,
      columnNames: [],
      connectedTableName: "",
      DBNameToDBVersions: {},
    }),
  }),
  getcountercolumn: createNodeDefinition<GetCounterColumnNodeData>({
    type: "getcountercolumn",
    labelKey: "nodeEditorNodeGetCounterColumnLabel",
    labelFallback: "Get Counter Column",
    descriptionKey: "nodeEditorNodeGetCounterColumnDescription",
    descriptionFallback: "Collects numeric column values across tables from pack files",
    createData: ({ label, sortedTableNames, DBNameToDBVersions }) => ({
      label,
      type: "getcountercolumn",
      selectedTable: "",
      selectedColumn: "",
      newColumnName: "",
      inputType: "PackFiles",
      outputType: "TableSelection",
      tableNames: sortedTableNames,
      columnNames: [],
      DBNameToDBVersions: DBNameToDBVersions ?? {},
    }),
  }),
  groupby: createNodeDefinition<GroupByNodeData>({
    type: "groupby",
    labelKey: "nodeEditorNodeGroupByLabel",
    labelFallback: "Group By",
    descriptionKey: "nodeEditorNodeGroupByDescription",
    descriptionFallback: "Groups rows by columns and performs aggregations (SQL-like GROUP BY)",
    createData: ({ label }) => ({
      label,
      type: "groupby",
      groupByColumns: [],
      aggregations: [],
      inputType: "TableSelection",
      outputType: "TableSelection",
      columnNames: [],
    }),
  }),
  indextable: createNodeDefinition<IndexTableNodeData>({
    type: "indextable",
    labelKey: "nodeEditorNodeIndexTableLabel",
    labelFallback: "Index Table",
    descriptionKey: "nodeEditorNodeIndexTableDescription",
    descriptionFallback: "Creates indexed version of table by key column(s) for fast lookups",
    createData: ({ label }) => ({
      label,
      type: "indextable",
      indexColumns: [],
      inputType: "TableSelection",
      outputType: "IndexedTable",
      columnNames: [],
      connectedTableName: "",
      DBNameToDBVersions: {},
    }),
  }),
  lookup: createNodeDefinition<LookupNodeData>({
    type: "lookup",
    labelKey: "nodeEditorNodeLookupJoinLabel",
    labelFallback: "Lookup (Join)",
    descriptionKey: "nodeEditorNodeLookupJoinDescription",
    descriptionFallback: "Performs lookups/joins using indexed tables (inner/left/nested)",
    createData: ({ label }) => ({
      label,
      type: "lookup",
      lookupColumn: "",
      joinType: "inner",
      inputType: "TableSelection",
      indexedInputType: "IndexedTable",
      outputType: "TableSelection",
      columnNames: [],
      connectedTableName: "",
      indexedTableColumns: [],
      indexedTableName: "",
      DBNameToDBVersions: {},
      inputCount: 2,
    }),
  }),
  customrowsinput: createNodeDefinition<CustomRowsInputNodeData>({
    type: "customrowsinput",
    labelKey: "nodeEditorNodeCustomRowsInputLabel",
    labelFallback: "Custom Rows Input",
    descriptionKey: "nodeEditorNodeCustomRowsInputDescription",
    descriptionFallback: "Manually input table rows with custom schema",
    createData: ({ label }) => ({
      label,
      type: "customrowsinput",
      customRows: [],
      schemaColumns: [],
      tableName: "",
      inputType: "CustomSchema",
      outputType: "TableSelection",
    }),
  }),
  customschema: createNodeDefinition<CustomSchemaNodeData>({
    type: "customschema",
    labelKey: "nodeEditorNodeCustomSchemaLabel",
    labelFallback: "Custom Schema",
    descriptionKey: "nodeEditorNodeCustomSchemaDescription",
    descriptionFallback: "Define custom table schema with column names and types",
    createData: ({ label }) => ({
      label,
      type: "customschema",
      schemaColumns: [],
      outputType: "CustomSchema",
    }),
  }),
  generaterowsschema: createNodeDefinition<GenerateRowsNodeData>({
    type: "generaterowsschema",
    labelKey: "nodeEditorNodeGenerateRowsSchemaLabel",
    labelFallback: "Generate Rows (Schema)",
    descriptionKey: "nodeEditorNodeGenerateRowsSchemaDescription",
    descriptionFallback: "Generate rows using custom schema with counter range",
    createData: ({ label }) => ({
      label,
      type: "generaterowsschema",
      sourceColumns: [],
      transformations: [],
      outputTables: [createOutputTable(1, "__custom_schema__")],
      inputType: "CustomSchema",
      outputType: "TableSelection",
      outputCount: 1,
      columnNames: [],
      connectedTableName: "",
      DBNameToDBVersions: {},
      customSchemaColumns: [],
      customSchemaData: null,
    }),
  }),
  readtsvfrompack: createNodeDefinition<ReadTSVFromPackNodeData>({
    type: "readtsvfrompack",
    labelKey: "nodeEditorNodeReadTSVFromPackLabel",
    labelFallback: "Read TSV From Pack",
    descriptionKey: "nodeEditorNodeReadTSVFromPackDescription",
    descriptionFallback: "Reads TSV file from pack using custom schema",
    createData: ({ label }) => ({
      label,
      type: "readtsvfrompack",
      tsvFileName: "",
      tableName: "",
      schemaColumns: [],
      inputType: "CustomSchema",
      outputType: "TableSelection",
    }),
  }),
};

const nodeTypeSectionDefinitionsInput: NodeTypeSectionDefinition[] = [
  {
    titleKey: "nodeEditorSectionPackFiles",
    titleFallback: "Pack Files",
    nodes: ["allenabledmods", "packfilesdropdown", "packedfiles"],
  },
  {
    titleKey: "nodeEditorSectionTableSelection",
    titleFallback: "Table Selection",
    nodes: ["referencelookup", "reversereferencelookup", "tableselectiondropdown", "tableselection"],
  },
  {
    titleKey: "nodeEditorSectionTableRowsFiltering",
    titleFallback: "Table Rows Filtering",
    nodes: ["deduplicate", "filter", "multifilter"],
  },
  {
    titleKey: "nodeEditorSectionColumnSelection",
    titleFallback: "Column Selection",
    nodes: ["columnselectiondropdown", "columnselection"],
  },
  {
    titleKey: "nodeEditorSectionProcessing",
    titleFallback: "Processing",
    nodes: ["numericadjustment", "mathceil", "mathmax", "mergechanges", "savechanges"],
  },
  {
    titleKey: "nodeEditorSectionText",
    titleFallback: "Text",
    nodes: ["appendtext", "groupbycolumns", "groupedcolumnstotext", "textjoin", "textsurround"],
  },
  {
    titleKey: "nodeEditorSectionTableOperations",
    titleFallback: "Table Operations",
    nodes: [
      "addnewcolumn",
      "aggregatenested",
      "dumptotsv",
      "extracttable",
      "flattennested",
      "generaterows",
      "getcountercolumn",
      "groupby",
      "indextable",
      "lookup",
    ],
  },
  {
    titleKey: "nodeEditorSectionCustomTables",
    titleFallback: "Custom Tables",
    nodes: ["customrowsinput", "customschema", "generaterowsschema", "readtsvfrompack"],
  },
];

export const nodeTypeSectionDefinitions = nodeTypeSectionDefinitionsInput.map((section) => ({
  titleKey: section.titleKey,
  titleFallback: section.titleFallback,
  nodes: section.nodes.map((type) => {
    const definition = nodeDefinitions[type];
    return {
      type,
      labelKey: definition.labelKey,
      labelFallback: definition.labelFallback,
      descriptionKey: definition.descriptionKey,
      descriptionFallback: definition.descriptionFallback,
    };
  }),
}));

export const getNodeDefinition = (type: FlowNodeType) => nodeDefinitions[type];

export const isRegisteredNodeType = (type: string): type is FlowNodeType => type in nodeDefinitions;

export const createNodeFromDefinition = (
  nodeType: FlowNodeType,
  context: NodeFactoryContext,
): Node => {
  const definition = getNodeDefinition(nodeType);

  return {
    id: context.nodeId,
    type: definition.type,
    position: context.position,
    data: definition.createData(context),
  };
};

export const createFallbackNode = (
  type: string,
  context: Pick<NodeFactoryContext, "nodeId" | "position" | "label">,
): Node => ({
  id: context.nodeId,
  type: "default",
  position: context.position,
  data: {
    label: context.label,
    type,
  },
  style: createDefaultNodeStyle(),
});
