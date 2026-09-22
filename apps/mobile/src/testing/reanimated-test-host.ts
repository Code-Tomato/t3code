import { useState } from "react";

/**
 * A `react-native-reanimated` module replacement for component tests
 * (`vp test`, node environment). Reanimated's real module requires the native
 * worklet runtime, so tests swap this in with
 * `vi.mock("react-native-reanimated", () => import("../../testing/reanimated-test-host"))`.
 *
 * Animations are inert: shared values are plain mutable boxes, timing helpers
 * pass their target through, and transition/entering descriptors are opaque
 * chainable objects. Components still see stable values across renders and
 * effects still run, so tests can assert on what a component *does* with
 * animation state (mount gating, toggles, labels) rather than on frames.
 */

type SharedValueBox<T> = { value: T };

export function useSharedValue<T>(initial: T): SharedValueBox<T> {
  // useState (not a ref) keeps the box stable across renders without a
  // ref-during-render warning; tests never re-run render for the same box.
  const [box] = useState<SharedValueBox<T>>(() => ({ value: initial }));
  return box;
}

export function useAnimatedStyle<T extends object>(build: () => T): T {
  return build();
}

export const withTiming = <T>(target: T) => target;
export const withSpring = <T>(target: T) => target;
export const withSequence = <T>(first: T, ..._rest: T[]) => first;
export const withDelay = <T>(_delay: number, animation: T) => animation;
export const withRepeat = <T>(animation: T) => animation;
export const withDecay = <T>(target: T) => target;
export const cancelAnimation = (_value: unknown) => {};

export const ReduceMotion = {
  System: "system",
  Always: "always",
  Never: "never",
} as const;

/** Chainable stand-in for `FadeIn.duration(…)`, `LinearTransition.duration(…)`, easing curves, etc. */
function chainable(): any {
  const proxy: any = new Proxy(function () {}, {
    get: () => proxy,
    apply: () => proxy,
  });
  return proxy;
}

export const Easing = chainable();
export const FadeIn = chainable();
export const FadeOut = chainable();
export const LinearTransition = chainable();
export const Layout = chainable();

const Animated = Object.assign({ View: "animated-view", Text: "animated-text" }, chainable());
export default Animated;
