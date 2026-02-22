const toLengthEncodedSegment = (value: string) => `${value.length}:${value}`;

export const buildStringArraySignature = (values: readonly string[]) => {
  let signature = `${values.length}`;
  for (const value of values) {
    signature += `|${toLengthEncodedSegment(value)}`;
  }
  return signature;
};

export const buildStringRecordSignature = (record: Record<string, string>) => {
  const keys = Object.keys(record).sort();
  let signature = `${keys.length}`;
  for (const key of keys) {
    signature += `|${toLengthEncodedSegment(key)}=${toLengthEncodedSegment(record[key] ?? "")}`;
  }
  return signature;
};

export const areStringArraysEqual = (left: readonly string[], right: readonly string[]) => {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }

  return true;
};

export const areCustomizableModsEqual = (
  left: Record<string, string[]>,
  right: Record<string, string[]>,
) => {
  if (left === right) return true;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (let i = 0; i < leftKeys.length; i += 1) {
    const leftKey = leftKeys[i];
    const rightKey = rightKeys[i];
    if (leftKey !== rightKey) {
      return false;
    }

    const leftTables = left[leftKey] ?? [];
    const rightTables = right[rightKey] ?? [];
    if (!areStringArraysEqual(leftTables, rightTables)) {
      return false;
    }
  }

  return true;
};

export const buildCustomizableModsSignature = (customizableMods: Record<string, string[]>) => {
  const paths = Object.keys(customizableMods).sort();
  let signature = `${paths.length}`;

  for (const path of paths) {
    signature += `|${toLengthEncodedSegment(path)}|${buildStringArraySignature(customizableMods[path] ?? [])}`;
  }

  return signature;
};

const stableStringifyInternal = (value: unknown, seen: WeakSet<object>): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyInternal(item, seen)).join(",")}]`;
  }

  if (seen.has(value)) {
    return '"[Circular]"';
  }

  seen.add(value);
  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  const serializedObject = `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringifyInternal(objectValue[key], seen)}`)
    .join(",")}}`;
  seen.delete(value);

  return serializedObject;
};

export const stableStringify = (value: unknown) => {
  return stableStringifyInternal(value, new WeakSet<object>());
};
