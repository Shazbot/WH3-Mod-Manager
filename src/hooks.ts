import { useCallback, useLayoutEffect, useRef } from "react";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "./store";

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

// Returns a function that keeps the same identity for the component's lifetime but always calls the latest `fn`.
// Use it for event handlers passed to memoized children whose inputs change on every render. Don't call the
// returned function during render: it sees the previous render's `fn` until layout effects run.
export function useEventCallback<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });
  return useCallback((...args: Args) => fnRef.current(...args), []);
}
