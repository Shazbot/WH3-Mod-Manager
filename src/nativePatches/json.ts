/** JSON parser used for patch manifests. Unlike JSON.parse, it rejects duplicate object keys. */
export const parseJsonWithoutDuplicateKeys = (source: string): unknown => {
  let index = 0;
  const fail = (message: string): never => {
    throw new Error(`Invalid JSON at character ${index}: ${message}`);
  };
  const whitespace = () => {
    while (index < source.length && "\t\n\r ".includes(source[index])) index++;
  };
  const parseString = (): string => {
    if (source[index] !== '"') return fail("expected a string");
    const start = index++;
    while (index < source.length) {
      const char = source[index++];
      if (char === '"') {
        try {
          return JSON.parse(source.slice(start, index)) as string;
        } catch {
          return fail("invalid string escape");
        }
      }
      if (char === "\\") {
        if (index >= source.length) return fail("unterminated escape");
        index++;
      } else if (char.charCodeAt(0) < 0x20) {
        return fail("unescaped control character in string");
      }
    }
    return fail("unterminated string");
  };
  const parseValue = (depth: number): unknown => {
    if (depth > 64) return fail("maximum nesting depth exceeded");
    whitespace();
    const char = source[index];
    if (char === '"') return parseString();
    if (char === "{") {
      index++;
      whitespace();
      const result: Record<string, unknown> = Object.create(null);
      const keys = new Set<string>();
      if (source[index] === "}") {
        index++;
        return result;
      }
      for (;;) {
        whitespace();
        const key = parseString();
        if (keys.has(key)) return fail(`duplicate object key ${JSON.stringify(key)}`);
        keys.add(key);
        whitespace();
        if (source[index++] !== ":") return fail("expected ':' after object key");
        result[key] = parseValue(depth + 1);
        whitespace();
        const delimiter = source[index++];
        if (delimiter === "}") return result;
        if (delimiter !== ",") return fail("expected ',' or '}' in object");
      }
    }
    if (char === "[") {
      index++;
      whitespace();
      const result: unknown[] = [];
      if (source[index] === "]") {
        index++;
        return result;
      }
      for (;;) {
        result.push(parseValue(depth + 1));
        whitespace();
        const delimiter = source[index++];
        if (delimiter === "]") return result;
        if (delimiter !== ",") return fail("expected ',' or ']' in array");
      }
    }
    for (const [literal, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (source.startsWith(literal, index)) {
        index += literal.length;
        return value;
      }
    }
    const number = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) {
      index += number[0].length;
      const parsed = Number(number[0]);
      if (!Number.isFinite(parsed)) return fail("number is not finite");
      return parsed;
    }
    return fail("expected a JSON value");
  };

  const value = parseValue(0);
  whitespace();
  if (index !== source.length) fail("unexpected trailing input");
  return value;
};
