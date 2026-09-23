import { describe, expect, it } from "vite-plus/test";

import {
  boundaryResetFromProps,
  failedBoundaryState,
  healthyBoundaryState,
  inspectorResetKeys,
  screenFallbackExit,
  shouldRethrowAsFatal,
  threadFeedResetKeys,
  workspaceInspectorContentIdentity,
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

  it("resets a crashed review inspector on new section, thread, or worktree", () => {
    const render = () => null;
    const crashed = inspectorResetKeys(
      workspaceInspectorContentIdentity({
        source: "review",
        workspaceKey: "env1|t1",
        cwd: "/wt/a",
        contentId: "section-a",
      }),
      render,
    );
    // Same content, rebuilt callback: still no reset (covered above).
    // New section, same section id in another thread, or a moved worktree
    // are all new content and must clear the crashed fallback.
    const switched = [{ contentId: "section-b" }, { workspaceKey: "env1|t2" }, { cwd: "/wt/b" }];
    for (const change of switched) {
      expect(
        inspectorResetKeys(
          workspaceInspectorContentIdentity({
            source: "review",
            workspaceKey: "env1|t1",
            cwd: "/wt/a",
            contentId: "section-a",
            ...change,
          }),
          render,
        ),
      ).not.toEqual(crashed);
    }
  });

  it("resets a crashed files inspector when the worktree moves under a stable thread", () => {
    const render = () => null;
    const base = {
      source: "files" as const,
      workspaceKey: "env1|t1",
      cwd: "/wt/a",
      contentId: "src/a.ts",
    };
    const crashed = inspectorResetKeys(workspaceInspectorContentIdentity(base), render);
    // threadId present but cwd changed: the audited collision.
    expect(
      inspectorResetKeys(workspaceInspectorContentIdentity({ ...base, cwd: "/wt/b" }), render),
    ).not.toEqual(crashed);
    expect(
      inspectorResetKeys(
        workspaceInspectorContentIdentity({ ...base, workspaceKey: "env1|t2" }),
        render,
      ),
    ).not.toEqual(crashed);
    // Same content → same identity: unrelated callback rebuilds still do not reset.
    expect(inspectorResetKeys(workspaceInspectorContentIdentity({ ...base }), render)).toEqual(
      crashed,
    );
  });

  it("resets a crashed thread inspector when the inspected cwd changes", () => {
    const render = () => null;
    const base = {
      source: "thread" as const,
      workspaceKey: "env1|t1",
      cwd: "/wt/a",
      contentId: "files",
    };
    const crashed = inspectorResetKeys(workspaceInspectorContentIdentity(base), render);
    // Same thread and mode, worktree moved: workspace-bound content changed.
    expect(
      inspectorResetKeys(workspaceInspectorContentIdentity({ ...base, cwd: "/wt/b" }), render),
    ).not.toEqual(crashed);
    // Sources stay distinct even with otherwise identical parts.
    expect(
      inspectorResetKeys(workspaceInspectorContentIdentity({ ...base, source: "files" }), render),
    ).not.toEqual(crashed);
  });
  it("cannot collide on delimiter-joined parts", () => {
    const render = () => null;
    const a = workspaceInspectorContentIdentity({
      source: "files",
      workspaceKey: "env1|t1",
      cwd: "/repo:a",
      contentId: "b",
    });
    const b = workspaceInspectorContentIdentity({
      source: "files",
      workspaceKey: "env1|t1",
      cwd: "/repo",
      contentId: "a:b",
    });
    expect(a).not.toBe(b);
    // Absent and the literal string "none" are different facts.
    expect(
      workspaceInspectorContentIdentity({
        source: "review",
        workspaceKey: "w",
        cwd: null,
        contentId: null,
      }),
    ).not.toBe(
      workspaceInspectorContentIdentity({
        source: "review",
        workspaceKey: "w",
        cwd: null,
        contentId: "none",
      }),
    );
    expect(inspectorResetKeys(a, render)).not.toEqual(inspectorResetKeys(b, render));
  });
});

describe("threadFeedResetKeys", () => {
  it("treats a same-thread worktree move as new content", () => {
    expect(threadFeedResetKeys("env1|t1", "/wt/a")).not.toEqual(
      threadFeedResetKeys("env1|t1", "/wt/b"),
    );
    expect(threadFeedResetKeys("env1|t1", "/wt/a")).toEqual(
      threadFeedResetKeys("env1|t1", "/wt/a"),
    );
    expect(threadFeedResetKeys("env1|t1", null)).toEqual(threadFeedResetKeys("env1|t1", undefined));
  });
});

describe("shouldRethrowAsFatal", () => {
  it("keeps a never-painted Home crash fatal so OTA rollback can run", () => {
    // Bad-OTA cold launch: Home throws before ever committing healthy
    // children — that is exactly the failure expo-updates' rollback exists
    // for, so it must not be swallowed into a fallback.
    expect(shouldRethrowAsFatal({ fatalIfFirstPaintFails: true, childCommitted: false })).toBe(
      true,
    );
  });

  it("recovers in-session failures after the first successful paint", () => {
    expect(shouldRethrowAsFatal({ fatalIfFirstPaintFails: true, childCommitted: true })).toBe(
      false,
    );
  });

  it("never rethrows for screens without the cold-launch valve", () => {
    expect(shouldRethrowAsFatal({ fatalIfFirstPaintFails: false, childCommitted: false })).toBe(
      false,
    );
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
