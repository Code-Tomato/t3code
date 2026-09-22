import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as RelayEnvironmentDiscovery from "../relay/discovery.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { createAttachmentEnvironmentAtoms } from "./attachments.ts";
import { createFilesystemEnvironmentAtoms } from "./filesystem.ts";
import { createOrchestrationEnvironmentAtoms } from "./orchestration.ts";
import { createRelayEnvironmentDiscoveryAtoms } from "./relayDiscovery.ts";
import { createReviewEnvironmentAtoms } from "./review.ts";
import { createSourceControlEnvironmentAtoms } from "./sourceControl.ts";
import { createTerminalEnvironmentAtoms } from "./terminal.ts";
import { createVcsEnvironmentAtoms } from "./vcs.ts";
import { createVcsActionManager } from "./vcsAction.ts";

/**
 * Instantiates every state domain whose only platform input is the client's
 * connection atom runtime. Web and mobile previously carried byte-identical
 * instantiation shims for all of these; one shared list keeps the two bridge
 * sets from drifting apart. Domains needing more than the runtime (threads,
 * shell, server, ...) stay as per-client bridges.
 */
export function createClientStateBridges<R, E>(input: {
  readonly runtime: Atom.AtomRuntime<
    | EnvironmentRegistry
    | EnvironmentCacheStore
    | RelayEnvironmentDiscovery.RelayEnvironmentDiscovery
    | R,
    E
  >;
}) {
  const runtime = input.runtime;
  return {
    attachmentEnvironment: createAttachmentEnvironmentAtoms(runtime),
    filesystemEnvironment: createFilesystemEnvironmentAtoms(runtime),
    orchestrationEnvironment: createOrchestrationEnvironmentAtoms(runtime),
    relayEnvironmentDiscovery: createRelayEnvironmentDiscoveryAtoms(runtime),
    reviewEnvironment: createReviewEnvironmentAtoms(runtime),
    sourceControlEnvironment: createSourceControlEnvironmentAtoms(runtime),
    terminalEnvironment: createTerminalEnvironmentAtoms(runtime),
    vcsEnvironment: createVcsEnvironmentAtoms(runtime),
    vcsActionManager: createVcsActionManager(runtime),
  };
}
