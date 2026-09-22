import { RegistryContext } from "@effect/atom-react";
import {
  type AtomCommand,
  type AtomCommandOptions,
  type AtomCommandResult,
  resolveAtomCommandOptions,
  runAtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useContext } from "react";

export function useAtomCommand<A, E, W>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W) => Promise<AtomCommandResult<A, E>> {
  const registry = useContext(RegistryContext);
  const { label, reportFailure, reportDefect } = resolveAtomCommandOptions(command, options);

  return useCallback(
    (value: W) => runAtomCommand(registry, command, value, { label, reportFailure, reportDefect }),
    [command, label, registry, reportDefect, reportFailure],
  );
}
