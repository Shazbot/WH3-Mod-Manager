import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import schemaV1 from "./schema-v1.json";
import schemaV2 from "./schema-v2.json";
import schemaV3 from "./schema-v3.json";

let validator: Ajv2020 | undefined;
const compiled: Partial<Record<1 | 2 | 3, ValidateFunction>> = {};

/** Compile only when a patch is discovered; ordinary launches do not compile schemas. */
export const validateNativePatchStructure = (value: unknown, version: 1 | 2 | 3): void => {
  validator ??= new Ajv2020({ allErrors: false, strict: true, ownProperties: true });
  const schema = version === 1 ? schemaV1 : version === 2 ? schemaV2 : schemaV3;
  const validate = (compiled[version] ??= validator.compile(schema));
  if (!validate(value)) {
    throw new Error(
      `Native patch schema validation failed: ${validator.errorsText(validate.errors?.slice(0, 8), {
        dataVar: "manifest",
        separator: "; ",
      })}`,
    );
  }
};
