import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  getProviderStatusBannerKey,
  getProviderStatusMessage,
  ProviderStatusBanner,
  shouldShowProviderStatusBanner,
} from "./ProviderStatusBanner";

function warningProvider(): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "warning",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-23T12:00:00.000Z",
    message: "Provider is temporarily degraded.",
    models: [],
    slashCommands: [],
    skills: [],
  };
}

describe("ProviderStatusBanner", () => {
  it("warns about an unsupported version on a ready provider until it changes version", () => {
    const status: ServerProvider = {
      ...warningProvider(),
      status: "ready",
      compatibility: { status: "unsupported", message: "Update Codex.", recommendedVersion: null },
    };
    const key = getProviderStatusBannerKey(status);
    expect(key).not.toBeNull();
    expect(shouldShowProviderStatusBanner(status, key)).toBe(false);
    // Updating to another still-unsupported version asks again.
    expect(shouldShowProviderStatusBanner({ ...status, version: "1.0.1" }, key)).toBe(true);
    // Limited support is shown in settings only.
    expect(
      getProviderStatusBannerKey({
        ...status,
        compatibility: { status: "graceful", message: null, recommendedVersion: null },
      }),
    ).toBeNull();
  });

  it("waits for an Antigravity auth result before showing a sign-in warning", () => {
    const status: ServerProvider = {
      ...warningProvider(),
      instanceId: ProviderInstanceId.make("google_work"),
      driver: ProviderDriverKind.make("antigravity"),
      auth: { status: "unknown" },
      message: "Antigravity is installed. Google account access is not checked yet.",
    };

    expect(shouldShowProviderStatusBanner(status, null)).toBe(false);
    expect(
      shouldShowProviderStatusBanner(
        {
          ...status,
          auth: { status: "unauthenticated" },
          message: "Sign in with Google to use Antigravity.",
        },
        null,
      ),
    ).toBe(true);
  });

  it("shows Antigravity installation and startup failures before auth is checked", () => {
    const status: ServerProvider = {
      ...warningProvider(),
      driver: ProviderDriverKind.make("antigravity"),
      auth: { status: "unknown" },
    };

    expect(shouldShowProviderStatusBanner({ ...status, installed: false }, null)).toBe(true);
    expect(shouldShowProviderStatusBanner({ ...status, status: "error" }, null)).toBe(true);
    expect(
      shouldShowProviderStatusBanner({ ...status, driver: ProviderDriverKind.make("codex") }, null),
    ).toBe(true);
  });

  it("stays hidden after its current warning is dismissed", () => {
    const status = warningProvider();

    expect(shouldShowProviderStatusBanner(status, null)).toBe(true);
    expect(shouldShowProviderStatusBanner(status, getProviderStatusBannerKey(status))).toBe(false);
  });

  it("renders an accessible dismiss control for provider warnings", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner status={warningProvider()} onDismiss={() => {}} />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="Dismiss Codex provider warning"');
  });

  it("labels error dismiss controls with the correct severity", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner
        status={{ ...warningProvider(), status: "error" }}
        onDismiss={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Dismiss Codex provider error"');
  });
});

describe("getProviderStatusMessage", () => {
  it("preserves the environment's authentication error", () => {
    const message = "SUBSCRIPTION_REQUIRED: This Google account cannot use Antigravity.";
    expect(
      getProviderStatusMessage({
        ...warningProvider(),
        driver: ProviderDriverKind.make("antigravity"),
        status: "error",
        auth: { status: "unauthenticated" },
        message,
      }),
    ).toBe(message);
  });

  it("points a signed-out Antigravity account to Google sign-in without a CLI command", () => {
    expect(
      getProviderStatusMessage({
        ...warningProvider(),
        driver: ProviderDriverKind.make("antigravity"),
        status: "error",
        auth: { status: "unauthenticated" },
        message: "",
      }),
    ).toBe("Open provider setup to sign in with Google.");
  });

  it("requires installation on the environment before sign-in", () => {
    expect(
      getProviderStatusMessage({
        ...warningProvider(),
        driver: ProviderDriverKind.make("antigravity"),
        displayName: "Google work account",
        installed: false,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "",
      }),
    ).toBe("Open provider setup to install Antigravity on this environment.");
  });

  it("keeps CLI sign-in advice for a provider without integrated setup", () => {
    expect(
      getProviderStatusMessage({
        ...warningProvider(),
        status: "error",
        auth: { status: "unauthenticated" },
        message: "",
      }),
    ).toBe("Sign in via the CLI to authenticate again.");
  });
});
