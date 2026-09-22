import { describe, expect, it } from "vite-plus/test";

import {
  boundaryResetFromProps,
  failedBoundaryState,
  healthyBoundaryState,
  screenFallbackExit,
} from "./render-error-boundary-model";

describe("failedBoundaryState", () => {
  it("marks a failure for falsy throws, which the thrown value alone could not signal", () => {
    for (const thrown of [undefined, null, "", 0, false]) {
      const state = failedBoundaryState(thrown);
      expect(state.failed).toBe(true);
      expect(state.error).toBe(thrown);
    }
  });

  it("omits resetKeys so the setState merge keeps the tracked keys", () => {
    // Carrying an explicit `resetKeys: undefined` through would look like
    // changed props on the next render and instantly auto-retry a crash loop.
    expect("resetKeys" in failedBoundaryState(new Error("boom"))).toBe(false);
  });
});

describe("boundaryResetFromProps", () => {
  it("clears a failure only when the tracked inputs actually changed", () => {
    const failed = { ...healthyBoundaryState(["thread:1"]), ...failedBoundaryState("boom") };
    expect(boundaryResetFromProps(["thread:1"], failed)).toBeNull();
    expect(boundaryResetFromProps(["thread:2"], failed)).toEqual({
      failed: false,
      error: undefined,
      resetKeys: ["thread:2"],
    });
    expect(boundaryResetFromProps(["thread:1", "extra"], failed)).not.toBeNull();
  });

  it("treats unchanged absence of resetKeys as stable, not as a change", () => {
    const failed = { ...healthyBoundaryState(undefined), ...failedBoundaryState("boom") };
    expect(boundaryResetFromProps(undefined, failed)).toBeNull();
  });

  it("retrying a boundary returns to healthy while keeping the tracked keys", () => {
    const failed = { ...healthyBoundaryState(["thread:1"]), ...failedBoundaryState("boom") };
    const retried = healthyBoundaryState(failed.resetKeys);
    expect(retried.failed).toBe(false);
    expect(boundaryResetFromProps(["thread:1"], retried)).toBeNull();
  });
});

describe("screenFallbackExit", () => {
  it("offers Go back when a previous route exists", () => {
    expect(screenFallbackExit(true)).toBe("go-back");
  });

  it("offers Settings when the crashing route is the only route", () => {
    // Cold launch straight into a broken Home: no back gesture, and the
    // Settings sheet is outside the failed subtree and always reachable.
    expect(screenFallbackExit(false)).toBe("open-settings");
  });
});
