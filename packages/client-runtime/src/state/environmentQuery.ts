import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { ClientPlatform } from "./runtime.ts";

/**
 * Both clients render environment queries through the same view shape; the
 * shared fallback atom is the only place the platform identity is observable,
 * so each client passes its own label when creating its bridge.
 */

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  /** Timestamp carried by the underlying successful `AsyncResult`, if any. */
  readonly dataUpdatedAt: number | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly refresh: () => void;
}

export function formatEnvironmentQueryError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The environment request failed.";
}

export function createEnvironmentQueryBridge(platform: ClientPlatform) {
  // Stand-in read while no environment is selected, keeping hook call order
  // stable for callers that pass a `null` atom.
  const emptyAtom = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
    Atom.withLabel(`${platform}-environment-query:empty`),
  );

  return {
    emptyAtom,
    toView<A, E>(input: {
      readonly result: AsyncResult.AsyncResult<A, E>;
      readonly hasAtom: boolean;
      readonly refresh: () => void;
    }): EnvironmentQueryView<A> {
      const { result, hasAtom, refresh } = input;
      return {
        data: Option.getOrNull(AsyncResult.value(result)),
        dataUpdatedAt: result._tag === "Success" ? result.timestamp : null,
        error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
        isPending: hasAtom && result.waiting,
        isSuccess: result._tag === "Success",
        refresh,
      };
    },
  };
}
