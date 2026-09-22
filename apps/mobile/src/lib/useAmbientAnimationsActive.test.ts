import { describe, expect, it, vi } from "vite-plus/test";

// The hook module subscribes to platform APIs at mount; this test only
// exercises the pure gate, so stub the runtime imports.
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: vi.fn() },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: vi.fn(),
  },
}));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));

import { ambientAnimationsEnabledFrom } from "./useAmbientAnimationsActive";

describe("ambientAnimationsEnabledFrom", () => {
  const enabled = {
    appState: "active" as const,
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
});
