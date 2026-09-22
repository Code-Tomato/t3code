import { describe, expect, it } from "vite-plus/test";

import { cn as resolveThroughAlias } from "@/lib/cn";
import { cn as resolveRelatively } from "./cn";

/**
 * `@/…` is declared once per resolver that has to know it: `paths` in tsconfig.json
 * (typecheck), `resolve.alias` in the root vite config (this harness), and the Metro
 * resolver in metro.config.js (iOS and Android, covered by ../../metro-src-alias.test.ts).
 *
 * The mapping being present is not enough. If two of them point at different files, the
 * app silently loads a second copy of a module with its own state, so the check here is
 * identity rather than existence.
 */
describe("@/ import alias", () => {
  it("resolves to the same module a relative import reaches", () => {
    expect(resolveThroughAlias).toBe(resolveRelatively);
  });
});
