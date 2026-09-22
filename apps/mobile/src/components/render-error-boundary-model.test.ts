import { describe, expect, it } from "vite-plus/test";

import {
  boundaryResetFromProps,
  failedBoundaryState,
  healthyBoundaryState,
  inspectorResetKeys,
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

describe("inspectorResetKeys", () => {
  it("does not reset when the same owner rebuilds its render callback", () => {
    // ThreadRouteScreen rebuilds the inspector callback on unrelated updates
    // (active-turn churn). Keyed on the callback, a persistently crashing
    // inspector would reset, re-throw, and re-record on every such update.
    const renderOne = () => null;
    const renderTwo = () => null;
    const [firstKey] = inspectorResetKeys("thread:env1:t1:files", renderOne);
    const [secondKey] = inspectorResetKeys("thread:env1:t1:files", renderTwo);
    expect(Object.is(firstKey, secondKey)).toBe(true);
  });

  it("resets when the inspected content identity changes", () => {
    const render = () => null;
    expect(inspectorResetKeys("thread:env1:t1:files", render)).not.toEqual(
      inspectorResetKeys("thread:env1:t2:files", render),
    );
    expect(inspectorResetKeys("thread:env1:t1:git", render)).not.toEqual(
      inspectorResetKeys("thread:env1:t1:files", render),
    );
  });

  it("falls back to the callback when no identity is registered", () => {
    const render = () => null;
    expect(inspectorResetKeys(undefined, render)).toEqual([render]);
  });
});

describe("screenFallbackExit", () => {
  it("offers Go back when a previous route exists", () => {
    expect(screenFallbackExit({ canGoBack: true, routeName: "SettingsSheet" })).toBe("go-back");
    expect(screenFallbackExit({ canGoBack: true, routeName: "Home" })).toBe("go-back");
  });

  it("offers Settings when the crashing route is the only route", () => {
    // Cold launch straight into a broken Home: no back gesture, and the
    // Settings sheet is outside the failed subtree and always reachable.
    expect(screenFallbackExit({ canGoBack: false, routeName: "Home" })).toBe("open-settings");
  });

  it("offers Home when the Settings sheet itself is the cold-launch crash", () => {
    // "Open settings" on a broken, already-focused SettingsSheet navigates to
    // the broken route — the exit must replace the stack with Home instead.
    expect(screenFallbackExit({ canGoBack: false, routeName: "SettingsSheet" })).toBe("go-home");
  });
});
