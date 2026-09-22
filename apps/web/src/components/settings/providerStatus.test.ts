import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getProviderSummary, getProviderVersionAdvisoryPresentation } from "./providerStatus";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated", label: "ChatGPT" },
  checkedAt: "2026-08-23T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

describe("getProviderSummary", () => {
  it("reports ready providers with unknown authentication as available", () => {
    expect(getProviderSummary({ ...provider, auth: { status: "unknown" } })).toEqual({
      headline: "Available",
      detail: null,
    });
  });

  it("does not hide a provider error behind a previous authenticated state", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "error",
        message: "The provider process failed to start.",
      }),
    ).toEqual({
      headline: "Unavailable",
      detail: "The provider process failed to start.",
    });
  });

  it("does not hide a provider warning behind an authenticated state", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "warning",
        message: "The provider version is unsupported.",
      }),
    ).toEqual({
      headline: "Needs attention",
      detail: "The provider version is unsupported.",
    });
  });

  it("keeps authentication failures actionable when their provider status is error", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Run codex login.",
      }),
    ).toEqual({
      headline: "Not authenticated",
      detail: "Run codex login.",
    });
  });

  it("treats a disabled provider status as disabled even before its enabled flag updates", () => {
    expect(getProviderSummary({ ...provider, status: "disabled" }).headline).toBe("Disabled");
  });
});

describe("getProviderVersionAdvisoryPresentation", () => {
  const advisory: NonNullable<ServerProvider["versionAdvisory"]> = {
    status: "current",
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    updateCommand: "npm install -g tool@latest",
    canUpdate: true,
    checkedAt: null,
    message: null,
  };

  it("offers the recommended version instead of latest when latest is broken", () => {
    expect(
      getProviderVersionAdvisoryPresentation({
        versionAdvisory: advisory,
        compatibility: { status: "broken", message: null, recommendedVersion: "0.9.0" },
      }),
    ).toEqual({
      title: "Known broken version",
      detail: "Install v0.9.0 for full support.",
      updateCommand: null,
      emphasis: "strong",
      targetVersion: "0.9.0",
    });
  });

  it("stays quiet for a current, supported provider", () => {
    expect(
      getProviderVersionAdvisoryPresentation({
        versionAdvisory: advisory,
        compatibility: { status: "supported", message: null, recommendedVersion: null },
      }),
    ).toBeNull();
  });
});
