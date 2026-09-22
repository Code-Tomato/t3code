/**
 * Provider compatibility: which installed provider versions this T3 Code
 * build works with, read from the `compatibility` section of the model
 * manifest so a bad provider release can be flagged without shipping T3 Code.
 *
 * Each driver lists policies. The first policy whose `t3Code` range matches
 * this build applies, and the first of its `ranges` that matches the installed
 * version gives the status. No match means no verdict, never a guess.
 */
import {
  ProviderReleaseVersion,
  ServerProviderCompatibilityStatus,
  TrimmedNonEmptyString,
  type ServerProvider,
  type ServerProviderCompatibility,
} from "@t3tools/contracts";
import { satisfiesSemverRange } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

import packageJson from "../../package.json" with { type: "json" };

const COMPARATOR = /^(\^|>=|>|<=|<|=)?v?\d+(\.\d+){0,2}$/;

/** True when `satisfiesSemverRange` understands every comparator in `range`.
 * Anything else would silently never match, so the manifest rejects it. */
export function isSupportedSemverRange(range: string): boolean {
  return range.split("||").every((group) => {
    const comparators = group.trim().split(/\s+/).filter(Boolean);
    return comparators.length > 0 && comparators.every((comparator) => COMPARATOR.test(comparator));
  });
}

const SemverRange = TrimmedNonEmptyString.check(
  Schema.makeFilter(isSupportedSemverRange, {
    expected: "a range of ^, >=, >, <=, <, = comparators joined by spaces or ||",
  }),
);

const CompatibilityPolicy = Schema.Struct({
  /** T3 Code versions this policy describes; absent matches every build. */
  t3Code: Schema.optional(SemverRange),
  ranges: Schema.Array(
    Schema.Struct({
      range: SemverRange,
      status: ServerProviderCompatibilityStatus,
      message: Schema.optional(TrimmedNonEmptyString),
    }),
  ),
  /** Pin offered instead of "update to latest", for when latest is the problem. */
  recommendedVersion: Schema.optional(ProviderReleaseVersion),
});

export const ManifestCompatibility = Schema.Record(
  Schema.String,
  Schema.Array(CompatibilityPolicy),
);
export type ManifestCompatibility = typeof ManifestCompatibility.Type;

const DEFAULT_MESSAGES: Record<ServerProviderCompatibility["status"], string | null> = {
  supported: null,
  graceful: "This version works, but some features are unavailable. Update for full support.",
  unsupported: "This version is older than T3 Code supports. Update to avoid errors.",
  broken: "This version is known not to work with T3 Code.",
};

export function evaluateProviderCompatibility(input: {
  readonly compatibility: ManifestCompatibility | undefined;
  readonly driver: string;
  readonly version: string | null;
  readonly t3CodeVersion?: string;
}): ServerProviderCompatibility | undefined {
  // Source builds of some CLIs (Codex) report 0.0.0; that says nothing about
  // which APIs they have.
  if (!input.version || input.version === "0.0.0") return undefined;
  const t3CodeVersion = input.t3CodeVersion ?? packageJson.version;
  const policy = input.compatibility?.[input.driver]?.find(
    (candidate) =>
      candidate.t3Code === undefined || satisfiesSemverRange(t3CodeVersion, candidate.t3Code),
  );
  const match = policy?.ranges.find((entry) =>
    satisfiesSemverRange(input.version as string, entry.range),
  );
  if (!policy || !match) return undefined;
  const recommendedVersion =
    match.status !== "supported" &&
    policy.recommendedVersion !== undefined &&
    policy.recommendedVersion !== input.version
      ? policy.recommendedVersion
      : null;
  return {
    status: match.status,
    message: match.message ?? DEFAULT_MESSAGES[match.status],
    recommendedVersion,
  };
}

/**
 * Replace a snapshot's verdict with one computed from its current version.
 * Only a problem is attached; a supported provider carries nothing.
 */
export function withProviderCompatibility(
  provider: ServerProvider,
  compatibility: ManifestCompatibility | undefined,
  t3CodeVersion?: string,
): ServerProvider {
  const { compatibility: _previous, ...rest } = provider;
  const next = provider.installed
    ? evaluateProviderCompatibility({
        compatibility,
        driver: provider.driver,
        version: provider.version,
        ...(t3CodeVersion ? { t3CodeVersion } : {}),
      })
    : undefined;
  return next && next.status !== "supported" ? { ...rest, compatibility: next } : rest;
}
