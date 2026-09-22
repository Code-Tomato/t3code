import { useIsFocused } from "@react-navigation/native";
import { useSyncExternalStore } from "react";
import { AccessibilityInfo, AppState, type AppStateStatus } from "react-native";

export type AmbientPlatformSignals = {
  readonly appState: AppStateStatus;
  /** `null` until the platform reports; unreported counts as reduced motion. */
  readonly reduceMotionEnabled: boolean | null;
};

export type AmbientAnimationSignals = AmbientPlatformSignals & {
  readonly screenIsFocused: boolean;
};

export function withAppState(
  signals: AmbientPlatformSignals,
  appState: AppStateStatus,
): AmbientPlatformSignals {
  return signals.appState === appState ? signals : { ...signals, appState };
}

/**
 * Folds one reduce-motion report into the signals. `fromEvent: false` is the
 * one-shot `isReduceMotionEnabled()` read taken at first subscription; it may
 * resolve long after a `reduceMotionChanged` event has already arrived, so it
 * only lands while the platform value is still unknown. Events always win.
 */
export function withReduceMotionReport(
  signals: AmbientPlatformSignals,
  reported: boolean,
  fromEvent: boolean,
): AmbientPlatformSignals {
  if (!fromEvent && signals.reduceMotionEnabled !== null) return signals;
  if (signals.reduceMotionEnabled === reported) return signals;
  return { ...signals, reduceMotionEnabled: reported };
}

/**
 * Ambient (indefinite, looping) animations only earn their GPU cost while the
 * app is foregrounded, the rendering screen is focused, and the user has not
 * asked for reduced motion. "inactive" and "unknown" app states (e.g. the app
 * switcher, a system overlay) do not count as foreground, and an unreported
 * reduce-motion setting keeps loops parked. Mirrors the pattern in
 * `thread-work-log.tsx`.
 */
export function ambientAnimationsEnabledFrom(signals: AmbientAnimationSignals): boolean {
  return (
    signals.appState === "active" &&
    signals.screenIsFocused &&
    signals.reduceMotionEnabled === false
  );
}

let platformSignals: AmbientPlatformSignals = {
  appState: AppState.currentState,
  reduceMotionEnabled: null,
};
const storeListeners = new Set<() => void>();
let platformSubscriptions: readonly { remove(): void }[] | undefined;

function report(mutate: (signals: AmbientPlatformSignals) => AmbientPlatformSignals) {
  const next = mutate(platformSignals);
  if (next === platformSignals) return;
  platformSignals = next;
  for (const listener of storeListeners) listener();
}

// One AppState/AccessibilityInfo subscription shared by every consumer, so
// lists of status dots do not each install their own native listeners. The
// subscriptions stay attached after the last consumer unmounts; two native
// listeners for the app lifetime is the bound.
function subscribeToPlatformSignals(onChange: () => void): () => void {
  if (!platformSubscriptions) {
    platformSubscriptions = [
      AppState.addEventListener("change", (appState) => {
        report((signals) => withAppState(signals, appState));
      }),
      AccessibilityInfo.addEventListener("reduceMotionChanged", (reduceMotionEnabled) => {
        report((signals) => withReduceMotionReport(signals, reduceMotionEnabled, true));
      }),
    ];
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotionEnabled) => {
      report((signals) => withReduceMotionReport(signals, reduceMotionEnabled, false));
    });
  }
  storeListeners.add(onChange);
  return () => {
    storeListeners.delete(onChange);
  };
}

function getPlatformSignalsSnapshot(): AmbientPlatformSignals {
  return platformSignals;
}

/**
 * Tracks the platform half of `ambientAnimationsEnabledFrom`; combine with
 * screen focus at the call site. Callers gate their `withRepeat` loops on the
 * result so loops never run offscreen, and pass `ReduceMotion.Never` to the
 * animations that do run, since reduced motion is handled here rather than
 * per-animation.
 */
export function useAmbientAnimationsEnabled(): boolean {
  const screenIsFocused = useIsFocused();
  const signals = useSyncExternalStore(
    subscribeToPlatformSignals,
    getPlatformSignalsSnapshot,
    getPlatformSignalsSnapshot,
  );
  return ambientAnimationsEnabledFrom({ ...signals, screenIsFocused });
}
