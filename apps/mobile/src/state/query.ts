import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentQueryBridge,
  formatEnvironmentQueryError,
  type EnvironmentQueryView,
} from "@t3tools/client-runtime/state/environment-query";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

export { formatEnvironmentQueryError };
export type { EnvironmentQueryView };

const queryBridge = createEnvironmentQueryBridge("mobile");

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = atom ?? queryBridge.emptyAtom;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  return queryBridge.toView({ result, hasAtom: atom !== null, refresh });
}
