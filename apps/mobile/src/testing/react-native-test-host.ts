import { createElement, type ReactNode } from "react";

/**
 * A `react-native` module replacement for component tests that run under
 * `vp test` (vitest, node environment) with react-test-renderer, mirroring the
 * web app's component-test pattern. The real react-native module cannot load
 * in node — it needs the Metro/babel toolchain and a native runtime — so a
 * test swaps this module in with
 * `vi.mock("react-native", () => import("../../testing/react-native-test-host"))`.
 *
 * Primitives render as named host elements ("view", "text", "pressable", …) so
 * tests query the react-test-renderer tree by type and invoke event props
 * inside `act`. This mirrors the platform, not the styling: layout, styles,
 * and uniwind classNames are opaque pass-through props here. Deliberate
 * behavior differences worth knowing:
 *
 * - `Pressable` drops press handlers when `disabled`, so tests exercise the
 *   platform gate rather than only the component's own guard.
 * - Children must be nodes; the render-prop children form is not supported.
 *
 * Keep this minimal and add primitives only as the component under test
 * genuinely needs them — an import list here is a scope signal, not a catalog.
 */

export const View = "view";
export const Text = "text";
export const TextInput = "text-input";
export const Image = "image";
export const ScrollView = "scroll-view";
export const FlatList = "flat-list";

type PressableProps = {
  readonly children?: ReactNode;
  readonly disabled?: boolean | undefined;
  readonly onPress?: (() => void) | undefined;
  readonly onLongPress?: (() => void) | undefined;
  readonly [prop: string]: unknown;
};

export function Pressable({ children, disabled, onPress, onLongPress, ...rest }: PressableProps) {
  return createElement(
    "pressable",
    {
      ...rest,
      disabled: disabled === true || undefined,
      onPress: disabled ? undefined : onPress,
      onLongPress: disabled ? undefined : onLongPress,
    },
    children,
  );
}

/**
 * `Linking.openURL` records urls in `openedUrls` instead of resolving them.
 * Tests assert on the recorded urls; nothing here depends on vitest so the
 * host stays usable with plain spies too.
 */
export const openedUrls: string[] = [];
export const Linking = {
  openURL(url: string) {
    openedUrls.push(url);
    return Promise.resolve();
  },
  canOpenURL: () => Promise.resolve(true),
  addEventListener: () => ({ remove() {} }),
};

export const Platform = {
  OS: "ios" as const,
  isPad: false,
  isTV: false,
  select: <T>(specifics: { ios?: T; android?: T; default?: T }): T | undefined =>
    specifics.ios ?? specifics.default,
};

export const StyleSheet = {
  create: <T extends object>(styles: T) => styles,
  flatten: (style: unknown) => style,
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: {},
};

export const AccessibilityInfo = {
  isReduceMotionEnabled: () => Promise.resolve(false),
  isScreenReaderEnabled: () => Promise.resolve(false),
  addEventListener: () => ({ remove() {} }),
};

export const AppState = {
  currentState: "active",
  addEventListener: () => ({ remove() {} }),
};

export const useWindowDimensions = () => ({ width: 390, height: 844, scale: 2, fontScale: 1 });
