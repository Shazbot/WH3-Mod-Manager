import { SCHEMA_FIELD_TYPE } from "../packFileTypes";

/**
 * Evaluates a simple arithmetic expression where `x` stands for the original value.
 *
 * Everything outside the arithmetic character set is stripped before evaluation, so the Function
 * constructor only ever sees digits and operators.
 */
export function evaluateFormula(formula: string, x: number): number {
  // Sanitize the formula - only allow safe mathematical operations
  const sanitized = formula
    .replace(/\s+/g, "") // Remove whitespace
    .replace(/\^/g, "**") // Convert ^ to ** for exponentiation
    .replace(/[^x0-9+\-*/().\s]/g, ""); // Remove any unsafe characters

  // Replace 'x' with the actual value
  const expression = sanitized.replace(/x/g, x.toString());

  // Validate that the expression only contains safe characters
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
    throw new Error("Invalid formula: contains unsafe characters");
  }

  try {
    // Use Function constructor for safe evaluation (better than eval)
    const result = new Function("return " + expression)();

    if (typeof result !== "number" || isNaN(result) || !isFinite(result)) {
      throw new Error("Formula evaluation resulted in invalid number");
    }

    return result;
  } catch (error) {
    throw new Error(`Formula evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

const integerFieldTypes: SCHEMA_FIELD_TYPE[] = ["I16", "I32", "I64"];
const floatFieldTypes: SCHEMA_FIELD_TYPE[] = ["F32", "F64"];

export const isNumericFieldType = (fieldType: SCHEMA_FIELD_TYPE): boolean =>
  integerFieldTypes.includes(fieldType) || floatFieldTypes.includes(fieldType);

/** True for a value that is already a plain number and so needs no evaluation. */
export const isPlainNumber = (value: string): boolean => value.trim() !== "" && !isNaN(Number(value));

/** Renders a formula result the way the column stores it: integer columns must not gain decimals. */
export const formatFormulaResult = (result: number, fieldType: SCHEMA_FIELD_TYPE): string =>
  integerFieldTypes.includes(fieldType) ? String(Math.round(result)) : String(result);
