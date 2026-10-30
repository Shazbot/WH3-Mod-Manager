// Runs async work with try/catch/finally handled here rather than in a component. React Compiler skips any component
// that has try/finally, a throw inside try, or optional chaining inside try, so component handlers pass their work in
// as a callback, where those are fine. Without onError a rejection is rethrown, as a plain try/finally would.
export async function runGuarded<T>(
  work: () => Promise<T>,
  handlers: { onError?: (error: unknown) => void; onFinally?: () => void },
): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    if (!handlers.onError) throw error;
    handlers.onError(error);
    return undefined;
  } finally {
    handlers.onFinally?.();
  }
}

// The synchronous form of runGuarded, for callbacks such as FileReader.onload.
export function runGuardedSync<T>(work: () => T, onError: (error: unknown) => void): T | undefined {
  try {
    return work();
  } catch (error) {
    onError(error);
    return undefined;
  }
}
