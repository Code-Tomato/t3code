import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import bundledManifest from "./model-manifest.json" with { type: "json" };
import {
  evaluateProviderCompatibility,
  ManifestCompatibility,
  withProviderCompatibility,
} from "./providerCompatibility.ts";

const decode = Schema.decodeUnknownSync(ManifestCompatibility);

const compatibility = decode({
  codex: [
    {
      t3Code: ">=0.1.0",
      ranges: [
        { range: "=0.200.0", status: "broken", message: "0.200.0 drops every turn." },
        { range: ">=0.141.0", status: "supported" },
        { range: "<0.141.0", status: "unsupported" },
      ],
      recommendedVersion: "0.199.0",
    },
    {
      ranges: [{ range: ">=0.100.0", status: "supported" }],
    },
  ],
});

const evaluate = (version: string | null, t3CodeVersion = "0.1.0") =>
  evaluateProviderCompatibility({ compatibility, driver: "codex", version, t3CodeVersion });

describe("evaluateProviderCompatibility", () => {
  it("uses the first matching range, so a known-bad release beats a broad supported range", () => {
    expect(evaluate("0.200.0")).toEqual({
      status: "broken",
      message: "0.200.0 drops every turn.",
      recommendedVersion: "0.199.0",
    });
    expect(evaluate("0.201.0")).toEqual({
      status: "supported",
      message: null,
      recommendedVersion: null,
    });
  });

  it("falls back to a default message and never recommends the installed version", () => {
    expect(evaluate("0.140.2")).toEqual({
      status: "unsupported",
      message: "This version is older than T3 Code supports. Update to avoid errors.",
      recommendedVersion: "0.199.0",
    });
    expect(
      evaluateProviderCompatibility({
        compatibility: decode({
          codex: [
            { ranges: [{ range: ">=1.0.0", status: "graceful" }], recommendedVersion: "1.0.0" },
          ],
        }),
        driver: "codex",
        version: "1.0.0",
      })?.recommendedVersion,
    ).toBeNull();
  });

  it("picks the policy for the running T3 Code version", () => {
    // Older builds fall through to the unconstrained policy.
    expect(evaluate("0.120.0", "0.0.9")?.status).toBe("supported");
    expect(evaluate("0.120.0", "0.1.0")?.status).toBe("unsupported");
  });

  it("gives no verdict without a usable version, a policy, or a matching range", () => {
    expect(evaluate(null)).toBeUndefined();
    // Source builds report 0.0.0.
    expect(evaluate("0.0.0")).toBeUndefined();
    expect(evaluate("0.50.0", "0.0.9")).toBeUndefined();
    expect(
      evaluateProviderCompatibility({ compatibility, driver: "cursor", version: "1.0.0" }),
    ).toBeUndefined();
    expect(
      evaluateProviderCompatibility({
        compatibility: undefined,
        driver: "codex",
        version: "1.0.0",
      }),
    ).toBeUndefined();
  });

  it("rejects range syntax the matcher cannot evaluate", () => {
    // `~` and `x` ranges would silently never match.
    expect(() =>
      decode({ codex: [{ ranges: [{ range: "~1.2.0", status: "supported" }] }] }),
    ).toThrow();
    expect(() =>
      decode({ codex: [{ ranges: [{ range: "1.x", status: "supported" }] }] }),
    ).toThrow();
    expect(() =>
      decode({
        codex: [
          { ranges: [{ range: ">=1.0.0", status: "supported" }], recommendedVersion: "latest" },
        ],
      }),
    ).toThrow();
  });

  it("classifies current releases with the bundled manifest", () => {
    const bundled = decode(bundledManifest.compatibility);
    const check = (driver: string, version: string) =>
      evaluateProviderCompatibility({ compatibility: bundled, driver, version })?.status;
    expect(check("claudeAgent", "2.1.280")).toBe("supported");
    expect(check("claudeAgent", "2.1.257")).toBe("graceful");
    expect(check("codex", "0.100.0")).toBeUndefined();
    expect(check("claudeAgent", "2.1.100")).toBe("unsupported");
  });
});

describe("withProviderCompatibility", () => {
  const provider: ServerProvider = {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "0.140.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-22T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };

  it("replaces a stale verdict after the provider changes version", () => {
    const apply = (next: ServerProvider) => withProviderCompatibility(next, compatibility, "0.1.0");
    const outdated = apply(provider);
    expect(outdated.compatibility?.status).toBe("unsupported");

    expect(apply({ ...outdated, version: "0.200.0" }).compatibility?.status).toBe("broken");
    expect(apply({ ...outdated, version: "0.201.0" })).not.toHaveProperty("compatibility");
    expect(apply({ ...outdated, installed: false })).not.toHaveProperty("compatibility");
  });
});
