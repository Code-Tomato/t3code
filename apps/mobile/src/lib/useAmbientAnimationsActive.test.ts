import { describe, expect, it, vi } from "vite-plus/test";

// Controllable platform module: `currentState` can move between the module
// load and the first subscription to reproduce startup ordering races.
const platform = vi.hoisted(() => {
  const state = { appState: "active" };
  const changeListeners: ((nextAppState: string) => void)[] = [];
  return {
    state,
    changeListeners,
    AppState: {
      get currentState() {
        return state.appState;
      },
      addEventListener: (_type: string, handler: (nextAppState: string) => void) => {
        changeListeners.push(handler);
        return { remove: () => {} };
      },
    },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => {} }),
    },
  };
});
vi.mock("react-native", () => ({
  AppState: platform.AppState,
  AccessibilityInfo: platform.AccessibilityInfo,
}));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));

import {
  ambientAnimationsEnabledFrom,
  withAppState,
  withReduceMotionReport,
  type AmbientPlatformSignals,
} from "./useAmbientAnimationsActive";

describe("ambientAnimationsEnabledFrom", () => {
  const enabled: AmbientPlatformSignals & { screenIsFocused: boolean } = {
    appState: "active",
    screenIsFocused: true,
    reduceMotionEnabled: false,
  };

  it("enables ambient loops only in the fully foregrounded, focused, full-motion case", () => {
    expect(ambientAnimationsEnabledFrom(enabled)).toBe(true);
  });

  it("treats non-active app states as offscreen, including the transient inactive state", () => {
    for (const appState of ["background", "inactive", "unknown"] as const) {
      expect(ambientAnimationsEnabledFrom({ ...enabled, appState })).toBe(false);
    }
  });

  it("parks loops while the rendering screen is unfocused", () => {
    expect(ambientAnimationsEnabledFrom({ ...enabled, screenIsFocused: false })).toBe(false);
  });

  it("parks loops when the user asked for reduced motion", () => {
    expect(ambientAnimationsEnabledFrom({ ...enabled, reduceMotionEnabled: true })).toBe(false);
  });

  it("parks loops while the platform has not reported its reduce-motion setting", () => {
    expect(ambientAnimationsEnabledFrom({ ...enabled, reduceMotionEnabled: null })).toBe(false);
  });
});

describe("withReduceMotionReport", () => {
  const unknown: AmbientPlatformSignals = { appState: "active", reduceMotionEnabled: null };

  it("applies the initial one-shot read while no event has arrived", () => {
    expect(withReduceMotionReport(unknown, false, false).reduceMotionEnabled).toBe(false);
  });

  it("ignores a late initial read after a change event has already arrived", () => {
    const afterEvent = withReduceMotionReport(unknown, true, true);
    // The isReduceMotionEnabled() promise resolving after the event must not
    // clobber the newer event value.
    expect(withReduceMotionReport(afterEvent, false, false)).toBe(afterEvent);
  });

  it("lets later events overwrite earlier reports", () => {
    const afterEvent = withReduceMotionReport(unknown, true, true);
    expect(withReduceMotionReport(afterEvent, false, true).reduceMotionEnabled).toBe(false);
  });

  it("keeps the snapshot identity when a report changes nothing", () => {
    const reported = withReduceMotionReport(unknown, true, true);
    expect(withReduceMotionReport(reported, true, true)).toBe(reported);
  });
});

describe("withAppState", () => {
  const signals: AmbientPlatformSignals = { appState: "active", reduceMotionEnabled: false };

  it("folds app-state transitions", () => {
    expect(withAppState(signals, "background").appState).toBe("background");
  });

  it("keeps the snapshot identity when the state is unchanged", () => {
    expect(withAppState(signals, "active")).toBe(signals);
  });
});

describe("first subscription", () => {
  it("reconciles a stale module-load snapshot with the current app state", async () => {
    platform.state.appState = "active";
    vi.resetModules();
    const mod = await import("./useAmbientAnimationsActive");
    expect(mod.getPlatformSignalsSnapshot().appState).toBe("active");

    // The app leaves the foreground before the first consumer mounts, so no
    // listener exists yet and the stored snapshot goes stale.
    platform.state.appState = "background";

    const unsubscribe = mod.subscribeToPlatformSignals(() => {});
    expect(mod.getPlatformSignalsSnapshot().appState).toBe("background");
    unsubscribe();
  });

  it("folds transitions delivered after the listener is registered", async () => {
    platform.state.appState = "active";
    vi.resetModules();
    const mod = await import("./useAmbientAnimationsActive");
    const unsubscribe = mod.subscribeToPlatformSignals(() => {});

    platform.state.appState = "inactive";
    for (const listener of platform.changeListeners) listener("inactive");

    expect(mod.getPlatformSignalsSnapshot().appState).toBe("inactive");
    unsubscribe();
  });
});
