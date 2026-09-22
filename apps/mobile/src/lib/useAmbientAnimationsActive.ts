import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState, type AppStateStatus } from "react-native";

export type AmbientAnimationSignals = {
  readonly appState: AppStateStatus;
  readonly screenIsFocused: boolean;
  readonly reduceMotionEnabled: boolean;
};

/**
 * Ambient (indefinite, looping) animations only earn their GPU cost while the
 * app is foregrounded, the rendering screen is focused, and the user has not
 * asked for reduced motion. "inactive" and "unknown" app states (e.g. the app
 * switcher, a system overlay) do not count as foreground.
 */
export function ambientAnimationsEnabledFrom(signals: AmbientAnimationSignals): boolean {
  return signals.appState === "active" && signals.screenIsFocused && !signals.reduceMotionEnabled;
}

/**
 * Tracks the three signals behind `ambientAnimationsEnabledFrom`. Callers gate
 * their `withRepeat` loops on the result so loops never run offscreen, and
 * pass `ReduceMotion.Never` to the animations that do run, since reduced
 * motion is handled here rather than per-animation. Mirrors the pattern in
 * `thread-work-log.tsx`.
 */
export function useAmbientAnimationsEnabled(): boolean {
  // Default to "do not animate" so nothing loops before the platform reports
  // its reduced-motion setting.
  const [signals, setSignals] = useState<Omit<AmbientAnimationSignals, "screenIsFocused">>({
    appState: AppState.currentState,
    reduceMotionEnabled: true,
  });
  const screenIsFocused = useIsFocused();

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (appState) => {
      setSignals((current) => (current.appState === appState ? current : { ...current, appState }));
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotionEnabled) => {
      setSignals((current) =>
        current.reduceMotionEnabled === reduceMotionEnabled
          ? current
          : { ...current, reduceMotionEnabled },
      );
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (reduceMotionEnabled) => {
        setSignals((current) =>
          current.reduceMotionEnabled === reduceMotionEnabled
            ? current
            : { ...current, reduceMotionEnabled },
        );
      },
    );
    return () => subscription.remove();
  }, []);

  return ambientAnimationsEnabledFrom({ ...signals, screenIsFocused });
}
