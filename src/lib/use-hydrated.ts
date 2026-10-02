import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False during server render and hydration, true afterwards. Used to hold back
 * output that depends on the viewer's clock or time zone.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
