import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { createEnvironmentQueryBridge, formatEnvironmentQueryError } from "./environmentQuery.ts";

describe("createEnvironmentQueryBridge", () => {
  it("labels the fallback atom with the creating platform", () => {
    expect(createEnvironmentQueryBridge("mobile").emptyAtom.label?.[0]).toBe(
      "mobile-environment-query:empty",
    );
    expect(createEnvironmentQueryBridge("web").emptyAtom.label?.[0]).toBe(
      "web-environment-query:empty",
    );
  });

  it("maps a successful result into the shared view", () => {
    const bridge = createEnvironmentQueryBridge("web");
    const refresh = () => {};

    expect(bridge.toView({ result: AsyncResult.success("v"), hasAtom: true, refresh })).toEqual({
      data: "v",
      dataUpdatedAt: expect.any(Number),
      error: null,
      isPending: false,
      isSuccess: true,
      refresh,
    });
  });

  it("maps a failed result and never marks it pending without an atom", () => {
    const bridge = createEnvironmentQueryBridge("web");
    const refresh = () => {};
    const view = bridge.toView({
      result: AsyncResult.failure(Cause.fail(new Error("boom"))),
      hasAtom: false,
      refresh,
    });

    expect(view.data).toBeNull();
    expect(view.error).toBe("boom");
    expect(view.isSuccess).toBe(false);
    expect(view.isPending).toBe(false);
    expect(view.dataUpdatedAt).toBeNull();
  });

  it("marks a waiting result pending only while the caller has an atom", () => {
    const bridge = createEnvironmentQueryBridge("web");
    const refresh = () => {};
    const waiting = AsyncResult.initial(true);

    expect(bridge.toView({ result: waiting, hasAtom: true, refresh }).isPending).toBe(true);
    expect(bridge.toView({ result: waiting, hasAtom: false, refresh }).isPending).toBe(false);
  });
});

describe("formatEnvironmentQueryError", () => {
  it("prefers the squashed error message", () => {
    expect(formatEnvironmentQueryError(Cause.fail(new Error("boom")))).toBe("boom");
    expect(formatEnvironmentQueryError(Cause.die(new Error("defect")))).toBe("defect");
  });

  it("falls back for non-errors and blank messages", () => {
    const fallback = "The environment request failed.";

    expect(formatEnvironmentQueryError(Cause.fail("raw failure"))).toBe(fallback);
    expect(formatEnvironmentQueryError(Cause.fail(new Error("   ")))).toBe(fallback);
  });
});
