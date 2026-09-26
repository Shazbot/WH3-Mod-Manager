import { describe, expect, it } from "vitest";

import { validateLookupSchemaReference } from "../../src/nodeGraph/lookupSchemaValidation";

describe("lookup schema reference validation", () => {
  it("accepts a reference from the source lookup field to the indexed join field", () => {
    const result = validateLookupSchemaReference({
      lookupField: { is_reference: ["indexed_tables", "id"] },
      indexedField: { is_reference: null },
      sourceTableName: "source_tables",
      lookupColumn: "indexed_id",
      indexedTableName: "indexed_tables",
      indexJoinColumn: "id",
    });

    expect(result.hasValidReference).toBe(true);
  });

  it("accepts a reverse reference from the indexed join field to the source lookup field", () => {
    const result = validateLookupSchemaReference({
      lookupField: { is_reference: null },
      indexedField: { is_reference: ["agent_subtypes_tables", "key"] },
      sourceTableName: "agent_subtypes_tables",
      lookupColumn: "key",
      indexedTableName: "unique_agents_tables",
      indexJoinColumn: "agent_subtype",
    });

    expect(result).toEqual({
      hasValidReference: true,
      lookupHasReferences: false,
      lookupReferencesIndexedTable: false,
      lookupReferencedColumns: [],
    });
  });

  it("rejects unrelated references while preserving source warning details", () => {
    const result = validateLookupSchemaReference({
      lookupField: { is_reference: ["indexed_tables", "other_id"] },
      indexedField: { is_reference: ["other_tables", "key"] },
      sourceTableName: "source_tables",
      lookupColumn: "indexed_id",
      indexedTableName: "indexed_tables",
      indexJoinColumn: "id",
    });

    expect(result).toEqual({
      hasValidReference: false,
      lookupHasReferences: true,
      lookupReferencesIndexedTable: true,
      lookupReferencedColumns: ["other_id"],
    });
  });
});
