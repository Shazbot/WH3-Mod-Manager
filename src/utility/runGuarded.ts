// Runs work with try/catch/finally handled here rather than in a component. React Compiler skips any component that
// has try/finally, a throw inside try, or optional chaining inside try, so component handlers pass their work in as
// a callback, where those are fine. Without onError an error is rethrown, as a plain try/finally would.
type GuardHandlers = { onError?: (error: unknown) => void; onFinally?: () => void };

export async function runGuarded<T>(work: () => Promise<T>, handlers: GuardHandlers): Promise<T | undefined> {
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

// The synchronous form, for callbacks such as FileReader.onload.
export function runGuardedSync<T>(work: () => T, handlers: GuardHandlers): T | undefined {
  try {
    return work();
  } catch (error) {
    if (!handlers.onError) throw error;
    handlers.onError(error);
    return undefined;
  } finally {
    handlers.onFinally?.();
  }
}
