import * as semver from "semver";
import { parseJsonWithoutDuplicateKeys } from "./json";
import { validateNativePatchStructure } from "./schemaValidation";

export const NATIVE_PATCH_LOADER_VERSION = "2.1.0";
export type NativePatchFailurePolicy = "abort" | "warn" | "silent";
export type NativePatchSkippedPackage = { packageId: string; policy: "warn" | "silent"; message: string };
export const NATIVE_PATCH_CAPABILITIES = [
  "blocks.v1",
  "fixups.v1",
  "win64-unwind.v1",
  "startup-activation.v1",
  "signatures.v2",
] as const;
export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_MANIFEST_BYTES = 64 * 1024 * 1024;
export const MAX_BLOCK_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_PAYLOAD_BYTES = 512 * 1024 * 1024;
export const MAX_NATIVE_PATCH_PACKAGES = 256;

export type NativePatchAddressReference =
  | { module: "game"; rva: string }
  | { block: string; offset: number }
  | { symbol: string }
  | { signature: string; offset?: number }
  | {
      relative: {
        from: NativePatchAddressReference;
        kind: "rel8" | "rel32";
        operand_offset: number;
        instruction_end_offset: number;
      };
    };
export type NativePatchBlock = {
  id: string;
  size: number;
  alignment: number;
  protection: "rx" | "r" | "rw";
  source:
    | { file: string; sha256: string }
    | { base64: string; sha256: string }
    | { hex: string; sha256?: string }
    | { zero: true };
};
export type NativePatchManifest = {
  format: "wh3-native-patch";
  format_version: 1 | 2;
  on_failure?: NativePatchFailurePolicy;
  package: { id: string; version: string; name: string; description?: string };
  requires_loader: { min_version: string; capabilities: string[] };
  target: { id: "game"; filename: "Warhammer3.exe"; sha256?: string; machine: "amd64" };
  lifecycle: { apply: "startup"; before: "game_initialization"; change: "restart"; lifetime: "process" };
  allocation_policy: {
    type: "module_window";
    module: "game";
    min_rva: "after_image" | string;
    max_rva_exclusive: string;
  };
  requires: Array<{ id: string; version: string }>;
  conflicts: string[];
  claims: Array<{ domain: string; key: string; name?: string }>;
  blocks: NativePatchBlock[];
  symbols: Record<string, NativePatchAddressReference>;
  signatures?: Array<{ id: string; module: "game"; pattern: string; scope: "executable" | "readable" }>;
  guards: Array<{ id: string; at: NativePatchAddressReference; expected: string }>;
  writes: Array<{ id: string; at: NativePatchAddressReference; expected: string; bytes: string }>;
  fixups: Array<Record<string, any>>;
  runtime_functions: Array<{
    begin: NativePatchAddressReference;
    end: NativePatchAddressReference;
    unwind: NativePatchAddressReference;
  }>;
  parameters: Array<Record<string, any>>;
  assets: Array<{ id: string; virtual_path: string; sha256: string; type: "pack_entry"; required: true }>;
};

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isPlainObject = (value: unknown): value is Record<string, any> => isObject(value);
const exactKeys = (value: Record<string, unknown>, required: string[], optional: string[], where: string) => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) throw new Error(`${where}: missing required field '${key}'`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${where}: unknown field '${key}'`);
};
const object = (value: unknown, where: string): Record<string, any> => {
  if (!isPlainObject(value)) throw new Error(`${where}: expected an object`);
  return value;
};
const array = (value: unknown, where: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${where}: expected an array`);
  return value;
};
const string = (value: unknown, where: string, nonEmpty = true): string => {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) throw new Error(`${where}: expected a string`);
  return value;
};
const integer = (value: unknown, where: string, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${where}: expected a safe integer between ${min} and ${max}`);
  }
  return value as number;
};
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const id = (value: unknown, where: string): string => {
  const result = string(value, where);
  if (!idPattern.test(result)) throw new Error(`${where}: invalid ASCII identifier '${result}'`);
  return result;
};
const sha256 = (value: unknown, where: string): string => {
  const result = string(value, where);
  if (!/^[a-fA-F0-9]{64}$/.test(result)) throw new Error(`${where}: expected a SHA-256 hex digest`);
  return result.toLowerCase();
};
const hexBytes = (value: unknown, where: string, allowEmpty = false): Buffer => {
  const text = string(value, where, !allowEmpty);
  if (text.length % 2 !== 0 || !/^[a-fA-F0-9]*$/.test(text) || (!allowEmpty && text.length === 0)) {
    throw new Error(`${where}: expected contiguous even-length hexadecimal bytes`);
  }
  return Buffer.from(text, "hex");
};
const pathValue = (value: unknown, where: string): string => {
  const text = string(value, where);
  if (text.includes("\0") || text.startsWith("/") || text.startsWith("\\") || /^[A-Za-z]:/.test(text)) {
    throw new Error(`${where}: path must be relative to the feature manifest`);
  }
  const pieces = text.replace(/\\/g, "/").split("/");
  if (pieces.some((piece) => piece === ".." || piece === "")) {
    throw new Error(`${where}: path contains an empty or traversal component`);
  }
  return pieces.filter((piece) => piece !== ".").join("/");
};
const rva = (value: unknown, where: string): string => {
  const text = string(value, where);
  if (!/^0x[0-9a-fA-F]+$/.test(text)) throw new Error(`${where}: expected an RVA like 0x1234`);
  const number = BigInt(text);
  if (number > 0xffffffffffffffffn) throw new Error(`${where}: RVA exceeds 64-bit range`);
  return `0x${number.toString(16)}`;
};
const safeStringArray = (value: unknown, where: string, identifiers = false): string[] => {
  const result = array(value, where).map((entry, index) => {
    const current = string(entry, `${where}[${index}]`);
    return identifiers ? id(current, `${where}[${index}]`) : current;
  });
  if (new Set(result).size !== result.length) throw new Error(`${where}: duplicate values are not allowed`);
  return result;
};

const validateAddressReference = (value: unknown, where: string, version: 1 | 2): NativePatchAddressReference => {
  const ref = object(value, where);
  if ("module" in ref) {
    exactKeys(ref, ["module", "rva"], [], where);
    if (ref.module !== "game") throw new Error(`${where}.module: only the 'game' module is supported`);
    rva(ref.rva, `${where}.rva`);
  } else if ("block" in ref) {
    exactKeys(ref, ["block", "offset"], [], where);
    id(ref.block, `${where}.block`);
    integer(ref.offset, `${where}.offset`);
  } else if ("symbol" in ref) {
    exactKeys(ref, ["symbol"], [], where);
    id(ref.symbol, `${where}.symbol`);
  } else if ("signature" in ref) {
    if (version < 2) throw new Error(`${where}: signature references require format version 2`);
    exactKeys(ref, ["signature"], ["offset"], where);
    id(ref.signature, `${where}.signature`);
    if ("offset" in ref) integer(ref.offset, `${where}.offset`, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  } else if ("relative" in ref) {
    if (version < 2) throw new Error(`${where}: derived references require format version 2`);
    exactKeys(ref, ["relative"], [], where);
    const relative = object(ref.relative, `${where}.relative`);
    exactKeys(relative, ["from", "kind", "operand_offset", "instruction_end_offset"], [], `${where}.relative`);
    validateAddressReference(relative.from, `${where}.relative.from`, version);
    if (relative.kind !== "rel8" && relative.kind !== "rel32") {
      throw new Error(`${where}.relative.kind: expected rel8 or rel32`);
    }
    const width = relative.kind === "rel8" ? 1 : 4;
    const operandOffset = integer(relative.operand_offset, `${where}.relative.operand_offset`, 0, 1024 * 1024);
    const endOffset = integer(
      relative.instruction_end_offset,
      `${where}.relative.instruction_end_offset`,
      1,
      1024 * 1024,
    );
    if (operandOffset + width > endOffset) {
      throw new Error(`${where}.relative: operand must end at or before instruction_end_offset`);
    }
  } else {
    throw new Error(`${where}: expected exactly one module, block, symbol, signature, or relative reference`);
  }
  return ref as NativePatchAddressReference;
};

const validateLifecycle = (value: unknown) => {
  const lifecycle = object(value, "lifecycle");
  exactKeys(lifecycle, ["apply", "before", "change", "lifetime"], [], "lifecycle");
  if (
    lifecycle.apply !== "startup" ||
    lifecycle.before !== "game_initialization" ||
    lifecycle.change !== "restart" ||
    lifecycle.lifetime !== "process"
  ) {
    throw new Error("lifecycle must be startup/game_initialization/restart/process");
  }
};

const validateBlocks = (value: unknown) => {
  const blocks = array(value, "blocks").map((raw, index) => {
    const where = `blocks[${index}]`;
    const block = object(raw, where);
    exactKeys(block, ["id", "size", "alignment", "protection", "source"], [], where);
    id(block.id, `${where}.id`);
    integer(block.size, `${where}.size`, 1, MAX_BLOCK_BYTES);
    const alignment = integer(block.alignment, `${where}.alignment`, 1, 1024 * 1024);
    if ((alignment & (alignment - 1)) !== 0) throw new Error(`${where}.alignment: expected a power of two`);
    if (!["rx", "r", "rw"].includes(block.protection)) throw new Error(`${where}.protection: expected rx, r, or rw`);
    const source = object(block.source, `${where}.source`);
    const sourceKinds = ["file", "base64", "hex", "zero"].filter((key) => key in source);
    if (sourceKinds.length !== 1)
      throw new Error(`${where}.source: exactly one of file, base64, hex, or zero is required`);
    const kind = sourceKinds[0];
    exactKeys(source, [kind], kind === "zero" ? [] : ["sha256"], `${where}.source`);
    if (kind === "file") {
      pathValue(source.file, `${where}.source.file`);
      sha256(source.sha256, `${where}.source.sha256`);
    } else if (kind === "base64") {
      string(source.base64, `${where}.source.base64`, false);
      sha256(source.sha256, `${where}.source.sha256`);
    } else if (kind === "hex") {
      hexBytes(source.hex, `${where}.source.hex`, true);
      if ("sha256" in source) sha256(source.sha256, `${where}.source.sha256`);
    } else if (source.zero !== true) {
      throw new Error(`${where}.source.zero: expected true`);
    }
    return block;
  });
  const ids = blocks.map((block) => block.id);
  if (new Set(ids).size !== ids.length) throw new Error("blocks: duplicate block IDs are not allowed");
  return blocks;
};

const validateSignatures = (value: unknown, version: 1 | 2) => {
  if (version === 1) {
    if (value !== undefined) throw new Error("signatures are not supported in format version 1");
    return undefined;
  }
  const signatures = array(value, "signatures").map((raw, index) => {
    const where = `signatures[${index}]`;
    const signature = object(raw, where);
    exactKeys(signature, ["id", "module", "pattern"], ["scope"], where);
    id(signature.id, `${where}.id`);
    if (signature.module !== "game") throw new Error(`${where}.module: only the game module is supported`);
    const pattern = string(signature.pattern, `${where}.pattern`);
    const tokens = pattern.split(" ");
    if (tokens.length === 0 || tokens.some((token) => !/^(?:[a-fA-F0-9]{2}|\?\?)$/.test(token))) {
      throw new Error(`${where}.pattern: use space-separated byte pairs or ?? wildcards`);
    }
    if (tokens.every((token) => token === "??"))
      throw new Error(`${where}.pattern: at least one fixed byte is required`);
    const scope = signature.scope ?? "executable";
    if (scope !== "executable" && scope !== "readable") {
      throw new Error(`${where}.scope: expected executable or readable`);
    }
    signature.scope = scope;
    return signature;
  });
  const ids = signatures.map((signature) => signature.id);
  if (new Set(ids).size !== ids.length) throw new Error("signatures: duplicate IDs are not allowed");
  return signatures;
};

const validateSymbols = (value: unknown, version: 1 | 2): Record<string, NativePatchAddressReference> => {
  const symbols = object(value, "symbols");
  const result: Record<string, NativePatchAddressReference> = Object.create(null);
  for (const [name, reference] of Object.entries(symbols)) {
    id(name, `symbols key '${name}'`);
    result[name] = validateAddressReference(reference, `symbols.${name}`, version);
    if (version === 1 && ("symbol" in result[name] || "signature" in result[name] || "relative" in result[name])) {
      throw new Error(`symbols.${name}: format version 1 symbols may reference only game module or block addresses`);
    }
  }
  return result;
};

const validateGuardsAndWrites = (root: Record<string, any>, version: 1 | 2) => {
  const guards = array(root.guards, "guards").map((raw, index) => {
    const where = `guards[${index}]`;
    const guard = object(raw, where);
    exactKeys(guard, ["id", "at", "expected"], [], where);
    id(guard.id, `${where}.id`);
    validateAddressReference(guard.at, `${where}.at`, version);
    hexBytes(guard.expected, `${where}.expected`);
    return guard;
  });
  const writes = array(root.writes, "writes").map((raw, index) => {
    const where = `writes[${index}]`;
    const write = object(raw, where);
    exactKeys(write, ["id", "at", "expected", "bytes"], [], where);
    id(write.id, `${where}.id`);
    validateAddressReference(write.at, `${where}.at`, version);
    const expected = hexBytes(write.expected, `${where}.expected`);
    const bytes = hexBytes(write.bytes, `${where}.bytes`);
    if (expected.length !== bytes.length) throw new Error(`${where}: expected and bytes lengths must match`);
    return write;
  });
  if (new Set(guards.map((guard) => guard.id)).size !== guards.length)
    throw new Error("guards: duplicate IDs are not allowed");
  if (new Set(writes.map((write) => write.id)).size !== writes.length)
    throw new Error("writes: duplicate IDs are not allowed");
};

const isModuleReference = (
  reference: NativePatchAddressReference,
  symbols: Record<string, NativePatchAddressReference>,
  active: Set<string> = new Set(),
): boolean => {
  if ("module" in reference || "signature" in reference) return true;
  if ("block" in reference) return false;
  if ("symbol" in reference) {
    if (active.has(reference.symbol)) throw new Error(`symbols: cycle detected at '${reference.symbol}'`);
    const target = symbols[reference.symbol];
    if (!target) throw new Error(`symbols: unknown symbol '${reference.symbol}'`);
    active.add(reference.symbol);
    const result = isModuleReference(target, symbols, active);
    active.delete(reference.symbol);
    return result;
  }
  return isModuleReference(reference.relative.from, symbols, active);
};

const validateFixups = (value: unknown, version: 1 | 2) => {
  const fixups = array(value, "fixups").map((raw, index) => {
    const where = `fixups[${index}]`;
    const fixup = object(raw, where);
    const fields = ["kind", "at", "target", "addend"];
    if (fixup.kind === "rel8" || fixup.kind === "rel32") fields.push("relative_to");
    else if (fixup.kind === "rva32") fields.push("base");
    else if (fixup.kind !== "abs64") throw new Error(`${where}.kind: unsupported fixup kind`);
    exactKeys(fixup, fields, [], where);
    const at = object(fixup.at, `${where}.at`);
    if ("block" in at) {
      exactKeys(at, ["block", "offset"], [], `${where}.at`);
      id(at.block, `${where}.at.block`);
      integer(at.offset, `${where}.at.offset`);
    } else if ("write" in at) {
      exactKeys(at, ["write", "offset"], [], `${where}.at`);
      id(at.write, `${where}.at.write`);
      integer(at.offset, `${where}.at.offset`);
    } else throw new Error(`${where}.at: expected block or write field location`);
    validateAddressReference(fixup.target, `${where}.target`, version);
    integer(fixup.addend, `${where}.addend`, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    if ("relative_to" in fixup) {
      const relativeTo = object(fixup.relative_to, `${where}.relative_to`);
      if ("write" in relativeTo) {
        exactKeys(relativeTo, ["write", "offset"], [], `${where}.relative_to`);
        id(relativeTo.write, `${where}.relative_to.write`);
        integer(relativeTo.offset, `${where}.relative_to.offset`);
      } else validateAddressReference(relativeTo, `${where}.relative_to`, version);
    }
    if ("base" in fixup) validateAddressReference(fixup.base, `${where}.base`, version);
    return fixup;
  });
  return fixups;
};

const validateRuntimeFunctions = (value: unknown, version: 1 | 2) =>
  array(value, "runtime_functions").map((raw, index) => {
    const where = `runtime_functions[${index}]`;
    const item = object(raw, where);
    exactKeys(item, ["begin", "end", "unwind"], [], where);
    validateAddressReference(item.begin, `${where}.begin`, version);
    validateAddressReference(item.end, `${where}.end`, version);
    validateAddressReference(item.unwind, `${where}.unwind`, version);
    return item;
  });

const validateParameters = (value: unknown) =>
  array(value, "parameters").map((raw, index) => {
    const where = `parameters[${index}]`;
    const parameter = object(raw, where);
    id(parameter.id, `${where}.id`);
    if (parameter.type === "bool") {
      exactKeys(parameter, ["id", "type", "default", "at"], [], where);
      if (typeof parameter.default !== "boolean") throw new Error(`${where}.default: expected a boolean`);
      const at = object(parameter.at, `${where}.at`);
      exactKeys(at, ["block", "offset"], [], `${where}.at`);
      id(at.block, `${where}.at.block`);
      integer(at.offset, `${where}.at.offset`);
    } else if (["u32", "i32", "f32"].includes(parameter.type)) {
      exactKeys(parameter, ["id", "type", "default", "min", "max", "at"], [], where);
      for (const key of ["default", "min", "max"]) {
        if (typeof parameter[key] !== "number" || !Number.isFinite(parameter[key])) {
          throw new Error(`${where}.${key}: expected a finite number`);
        }
      }
      if (!(parameter.min <= parameter.default && parameter.default <= parameter.max)) {
        throw new Error(`${where}: default must be between min and max`);
      }
      if (
        parameter.type === "f32" &&
        [parameter.min, parameter.max, parameter.default].some((value) => !Number.isFinite(Math.fround(value)))
      ) {
        throw new Error(`${where}: f32 values must remain finite when encoded as float32`);
      }
      if (
        parameter.type === "u32" &&
        (parameter.min < 0 ||
          parameter.max > 0xffffffff ||
          ![parameter.min, parameter.max, parameter.default].every(Number.isInteger))
      ) {
        throw new Error(`${where}: u32 values must be integral and within the unsigned 32-bit range`);
      }
      if (
        parameter.type === "i32" &&
        (parameter.min < -0x80000000 ||
          parameter.max > 0x7fffffff ||
          ![parameter.min, parameter.max, parameter.default].every(Number.isInteger))
      ) {
        throw new Error(`${where}: i32 values must be integral and within the signed 32-bit range`);
      }
      const at = object(parameter.at, `${where}.at`);
      exactKeys(at, ["block", "offset"], [], `${where}.at`);
      id(at.block, `${where}.at.block`);
      integer(at.offset, `${where}.at.offset`);
    } else if (parameter.type === "ascii_key_list") {
      exactKeys(parameter, ["id", "type", "default", "capacity", "max_key_bytes", "count_at", "entries_at"], [], where);
      const values = array(parameter.default, `${where}.default`).map((value, itemIndex) =>
        string(value, `${where}.default[${itemIndex}]`),
      );
      if (values.some((key) => !/^[A-Za-z0-9_]+$/.test(key)))
        throw new Error(`${where}.default: keys must be nonempty ASCII identifiers`);
      const uniqueValues = [...new Set(values)];
      integer(parameter.capacity, `${where}.capacity`, 1, 1024 * 1024);
      integer(parameter.max_key_bytes, `${where}.max_key_bytes`, 1, 1024 * 1024);
      if (
        uniqueValues.length > parameter.capacity ||
        uniqueValues.some((key) => Buffer.byteLength(key, "ascii") > parameter.max_key_bytes)
      ) {
        throw new Error(`${where}.default: list exceeds the declared capacity or key width`);
      }
      parameter.default = uniqueValues;
      for (const key of ["count_at", "entries_at"]) {
        const at = object(parameter[key], `${where}.${key}`);
        exactKeys(at, ["block", "offset"], [], `${where}.${key}`);
        id(at.block, `${where}.${key}.block`);
        integer(at.offset, `${where}.${key}.offset`);
      }
    } else throw new Error(`${where}.type: unsupported parameter type`);
    return parameter;
  });

const validateAssets = (value: unknown) =>
  array(value, "assets").map((raw, index) => {
    const where = `assets[${index}]`;
    const asset = object(raw, where);
    exactKeys(asset, ["id", "virtual_path", "sha256", "type", "required"], [], where);
    id(asset.id, `${where}.id`);
    pathValue(asset.virtual_path, `${where}.virtual_path`);
    sha256(asset.sha256, `${where}.sha256`);
    if (asset.type !== "pack_entry" || asset.required !== true)
      throw new Error(`${where}: only required pack_entry assets are supported`);
    return asset;
  });

/** Structural plus semantic validation for format versions 1 and 2. Payload bytes are verified by the planner. */
export const parseAndValidateNativePatchManifest = (bytes: Buffer): NativePatchManifest => {
  if (bytes.length > MAX_MANIFEST_BYTES) throw new Error(`manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("manifest is not valid UTF-8");
  }
  const root = object(parseJsonWithoutDuplicateKeys(source), "manifest");
  exactKeys(
    root,
    [
      "format",
      "format_version",
      "package",
      "requires_loader",
      "target",
      "lifecycle",
      "allocation_policy",
      "requires",
      "conflicts",
      "claims",
      "blocks",
      "symbols",
      "guards",
      "writes",
      "fixups",
      "runtime_functions",
    ],
    ["parameters", "assets", "validation", "extensions", "signatures", "on_failure"],
    "manifest",
  );
  if (root.format !== "wh3-native-patch") throw new Error("format must be 'wh3-native-patch'");
  if (root.format_version !== 1 && root.format_version !== 2)
    throw new Error("unsupported format_version; supported versions are 1 and 2");
  const version = root.format_version as 1 | 2;
  validateNativePatchStructure(root, version);
  if (root.on_failure !== undefined && !["abort", "warn", "silent"].includes(root.on_failure)) {
    throw new Error("on_failure must be 'abort', 'warn', or 'silent'");
  }

  const packageData = object(root.package, "package");
  exactKeys(packageData, ["id", "version", "name"], ["description"], "package");
  id(packageData.id, "package.id");
  const packageVersion = string(packageData.version, "package.version");
  if (!semver.valid(packageVersion, { loose: false }))
    throw new Error("package.version must be a valid SemVer version");
  string(packageData.name, "package.name");
  if ("description" in packageData) string(packageData.description, "package.description", false);

  const loader = object(root.requires_loader, "requires_loader");
  exactKeys(loader, ["min_version", "capabilities"], [], "requires_loader");
  const minLoader = string(loader.min_version, "requires_loader.min_version");
  if (!semver.valid(minLoader, { loose: false }) || !semver.gte(NATIVE_PATCH_LOADER_VERSION, minLoader)) {
    throw new Error(
      `requires_loader.min_version ${minLoader} is not supported by loader ${NATIVE_PATCH_LOADER_VERSION}`,
    );
  }
  const capabilities = safeStringArray(loader.capabilities, "requires_loader.capabilities", true);
  for (const capability of capabilities) {
    if (!(NATIVE_PATCH_CAPABILITIES as readonly string[]).includes(capability)) {
      throw new Error(`requires_loader.capabilities: unsupported capability '${capability}'`);
    }
  }

  const target = object(root.target, "target");
  exactKeys(target, ["id", "filename", "machine"], version === 1 ? ["sha256"] : ["sha256"], "target");
  if (target.id !== "game" || target.filename !== "Warhammer3.exe" || target.machine !== "amd64") {
    throw new Error("target must identify the x64 Warhammer3.exe game module");
  }
  if (version === 1 && !("sha256" in target)) throw new Error("target.sha256 is required in format version 1");
  if ("sha256" in target) target.sha256 = sha256(target.sha256, "target.sha256");

  validateLifecycle(root.lifecycle);
  const allocation = object(root.allocation_policy, "allocation_policy");
  exactKeys(allocation, ["type", "module", "min_rva", "max_rva_exclusive"], [], "allocation_policy");
  if (allocation.type !== "module_window" || allocation.module !== "game")
    throw new Error("allocation_policy must use a game module_window");
  if (allocation.min_rva !== "after_image") throw new Error("allocation_policy.min_rva must be 'after_image'");
  allocation.max_rva_exclusive = rva(allocation.max_rva_exclusive, "allocation_policy.max_rva_exclusive");
  if (BigInt(allocation.max_rva_exclusive) !== 0x80000000n)
    throw new Error("allocation_policy.max_rva_exclusive must be 0x80000000");

  const requires = array(root.requires, "requires").map((raw, index) => {
    const where = `requires[${index}]`;
    const dependency = object(raw, where);
    exactKeys(dependency, ["id", "version"], [], where);
    id(dependency.id, `${where}.id`);
    string(dependency.version, `${where}.version`);
    if (!semver.valid(dependency.version, { loose: false })) throw new Error(`${where}.version must be valid SemVer`);
    return dependency;
  });
  if (new Set(requires.map((dependency) => dependency.id)).size !== requires.length)
    throw new Error("requires: duplicate package IDs are not allowed");
  const conflicts = safeStringArray(root.conflicts, "conflicts", true);
  const claims = array(root.claims, "claims").map((raw, index) => {
    const where = `claims[${index}]`;
    const claim = object(raw, where);
    exactKeys(claim, ["domain", "key"], ["name"], where);
    id(claim.domain, `${where}.domain`);
    string(claim.key, `${where}.key`);
    if ("name" in claim) string(claim.name, `${where}.name`, false);
    return claim;
  });
  const claimKeys = claims.map((claim) => `${claim.domain}\0${claim.key}`);
  if (new Set(claimKeys).size !== claimKeys.length)
    throw new Error("claims: duplicate (domain, key) pairs are not allowed");

  root.blocks = validateBlocks(root.blocks);
  root.signatures = validateSignatures(root.signatures, version);
  root.symbols = validateSymbols(root.symbols, version);
  validateGuardsAndWrites(root, version);
  for (const [kind, operations] of [
    ["guards", root.guards],
    ["writes", root.writes],
  ] as const) {
    for (const [index, operation] of operations.entries()) {
      if (!isModuleReference(operation.at, root.symbols)) {
        throw new Error(`${kind}[${index}].at must resolve to a game-module address`);
      }
    }
  }
  root.fixups = validateFixups(root.fixups, version);
  root.runtime_functions = validateRuntimeFunctions(root.runtime_functions, version);
  root.parameters = validateParameters(root.parameters ?? []);
  root.assets = validateAssets(root.assets ?? []);
  const usesV2Address = (reference: any, activeSymbols = new Set<string>()): boolean => {
    if ("signature" in reference || "relative" in reference) return true;
    if ("symbol" in reference) {
      if (activeSymbols.has(reference.symbol)) return false;
      const symbolReference = root.symbols[reference.symbol];
      if (!symbolReference) return false;
      activeSymbols.add(reference.symbol);
      const result = usesV2Address(symbolReference, activeSymbols);
      activeSymbols.delete(reference.symbol);
      return result;
    }
    return false;
  };
  const refsToCheck = [
    ...Object.values(root.symbols),
    ...root.guards.map((guard: any) => guard.at),
    ...root.writes.map((write: any) => write.at),
    ...root.fixups.flatMap((fixup: any) => [fixup.target, fixup.relative_to, fixup.base].filter(Boolean)),
    ...root.runtime_functions.flatMap((item: any) => [item.begin, item.end, item.unwind]),
  ];
  if (
    (root.signatures?.length ?? 0) > 0 ||
    refsToCheck.some((reference: any) => reference && usesV2Address(reference))
  ) {
    if (!capabilities.includes("signatures.v2")) {
      throw new Error(
        "requires_loader.capabilities must include 'signatures.v2' when using signatures or derived references",
      );
    }
  }
  if (new Set(root.parameters.map((parameter: any) => parameter.id)).size !== root.parameters.length) {
    throw new Error("parameters: duplicate IDs are not allowed");
  }
  if (new Set(root.assets.map((asset: any) => asset.id)).size !== root.assets.length) {
    throw new Error("assets: duplicate IDs are not allowed");
  }
  if (root.validation !== undefined) {
    const validation = object(root.validation, "validation");
    exactKeys(
      validation,
      [],
      ["offline_behavior", "in_game_behavior", "runtime_delivery", "limitations"],
      "validation",
    );
    for (const [key, value] of Object.entries(validation)) string(value, `validation.${key}`, false);
  }
  if (root.extensions !== undefined) object(root.extensions, "extensions");

  return root as NativePatchManifest;
};

export const normalizeNativePatchPath = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "");
