import { EnvironmentId } from "@t3tools/contracts";

import type { RelayEnvironmentView } from "../connection/useConnectionController";
import type { ConnectedEnvironmentSummary } from "../../state/remote-runtime-types";

// Fictional placeholder endpoints for the showcase; they use RFC 2606 reserved
// domains and an RFC 5737 documentation address so nothing can point at a
// real host, including inside a viewer's own tailnet or LAN.
const SHOWCASE_LOCAL_ENVIRONMENT_DISPLAY_URLS: Readonly<Record<string, string>> = {
  "Moonbase Terminal": "https://moonbase.tailnet.example/",
  "Suspense Station": "https://suspense-vps.hel1.example/",
  "Kernel Cabin": "http://192.0.2.5:3773/",
};

export function applyShowcaseLocalEnvironmentDisplayUrls(
  environments: ReadonlyArray<ConnectedEnvironmentSummary>,
): ReadonlyArray<ConnectedEnvironmentSummary> {
  return environments.map((environment) => ({
    ...environment,
    displayUrl:
      SHOWCASE_LOCAL_ENVIRONMENT_DISPLAY_URLS[environment.environmentLabel] ??
      environment.displayUrl,
  }));
}

export function resolveShowcaseEnvironmentUpdateDisplayUrl(input: {
  readonly actualDisplayUrl: string;
  readonly presentedDisplayUrl: string;
  readonly submittedDisplayUrl: string;
}): string {
  return input.submittedDisplayUrl === input.presentedDisplayUrl
    ? input.actualDisplayUrl
    : input.submittedDisplayUrl;
}

const pocketPiId = EnvironmentId.make("showcase-pocket-pi");
const pocketPiEndpoint = {
  httpBaseUrl: "https://pocket-pi.example",
  wsBaseUrl: "wss://pocket-pi.example",
  providerKind: "t3_relay" as const,
};

export const SHOWCASE_CONNECTED_CLOUD_ENVIRONMENTS: ReadonlyArray<ConnectedEnvironmentSummary> = [
  {
    environmentId: EnvironmentId.make("showcase-aurora-gpu"),
    environmentLabel: "Aurora GPU Pod",
    displayUrl: "https://aurora-gpu.example",
    isRelayManaged: true,
    isEnabled: true,
    connectionState: "connected",
    connectionError: null,
    connectionErrorTraceId: null,
  },
];

export const SHOWCASE_AVAILABLE_CLOUD_ENVIRONMENTS: ReadonlyArray<RelayEnvironmentView> = [
  {
    environment: {
      environmentId: pocketPiId,
      label: "Pocket Pi",
      endpoint: pocketPiEndpoint,
      linkedAt: "2026-07-16T08:00:00.000Z",
    },
    availability: "online",
    status: {
      environmentId: pocketPiId,
      endpoint: pocketPiEndpoint,
      status: "online",
      checkedAt: "2026-07-16T08:41:00.000Z",
    },
    error: null,
    traceId: null,
  },
];
