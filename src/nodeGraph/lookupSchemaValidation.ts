interface SchemaReferenceField {
  is_reference?: string[] | null;
}

interface LookupSchemaReferenceValidationInput {
  lookupField: SchemaReferenceField;
  indexedField?: SchemaReferenceField;
  sourceTableName: string;
  lookupColumn: string;
  indexedTableName: string;
  indexJoinColumn: string;
}

export interface LookupSchemaReferenceValidation {
  hasValidReference: boolean;
  lookupHasReferences: boolean;
  lookupReferencesIndexedTable: boolean;
  lookupReferencedColumns: string[];
}

const getReferencePairs = (field?: SchemaReferenceField) => {
  const references = Array.isArray(field?.is_reference) ? field.is_reference : [];
  const pairs: Array<{ table: string; column: string }> = [];

  for (let index = 0; index + 1 < references.length; index += 2) {
    pairs.push({
      table: references[index],
      column: references[index + 1],
    });
  }

  return pairs;
};

export const validateLookupSchemaReference = ({
  lookupField,
  indexedField,
  sourceTableName,
  lookupColumn,
  indexedTableName,
  indexJoinColumn,
}: LookupSchemaReferenceValidationInput): LookupSchemaReferenceValidation => {
  const lookupReferences = getReferencePairs(lookupField);
  const indexedReferences = getReferencePairs(indexedField);
  const referencesToIndexedTable = lookupReferences.filter(
    (reference) => reference.table === indexedTableName,
  );

  const hasForwardReference = referencesToIndexedTable.some(
    (reference) => reference.column === indexJoinColumn,
  );
  const hasReverseReference = indexedReferences.some(
    (reference) => reference.table === sourceTableName && reference.column === lookupColumn,
  );

  return {
    hasValidReference: hasForwardReference || hasReverseReference,
    lookupHasReferences: lookupReferences.length > 0,
    lookupReferencesIndexedTable: referencesToIndexedTable.length > 0,
    lookupReferencedColumns: referencesToIndexedTable.map((reference) => reference.column),
  };
};
