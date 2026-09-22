import { createClientStateBridges } from "@t3tools/client-runtime/state/client-bridges";

import { connectionAtomRuntime } from "../connection/runtime";

export const {
  attachmentEnvironment,
  filesystemEnvironment,
  orchestrationEnvironment,
  relayEnvironmentDiscovery,
  reviewEnvironment,
  sourceControlEnvironment,
  terminalEnvironment,
  vcsEnvironment,
  vcsActionManager,
} = createClientStateBridges({ runtime: connectionAtomRuntime });
