import { RegistryContext } from "@effect/atom-react";
import {
  executeAtomQuery,
  type AtomQueryOptions,
  type AtomCommandResult,
  resolveAtomQueryOptions,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult, type Atom } from "effect/unstable/reactivity";
import { useCallback, useContext } from "react";

export function useAtomQueryRunner<T, A, E>(
  family: (target: T) => Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  options?: string | AtomQueryOptions,
): (target: T) => Promise<AtomCommandResult<A, E>> {
  const registry = useContext(RegistryContext);
  const { label, reportFailure, reportDefect, refresh } = resolveAtomQueryOptions(options);

  return useCallback(
    // An omitted label falls back to the target atom's own label inside `executeAtomQuery`.
    (target: T) =>
      executeAtomQuery(registry, family(target), {
        ...(label === undefined ? undefined : { label }),
        reportFailure,
        reportDefect,
        refresh,
      }),
    [family, label, registry, refresh, reportDefect, reportFailure],
  );
}
