import { act } from "react";
import { View } from "react-native";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * Proof that the mobile component-test pattern (react-test-renderer + host
 * mocks, node environment, `vp test`) reaches the high-churn work-log file:
 * `thread-work-log.tsx` changes almost daily and its reasoning-row disclosure
 * is exactly the kind of mount-gating/toggle behavior a static-markup render
 * cannot cover. The mocks below only stand in for native/runtime boundaries
 * (react-native, reanimated, haptics, list, svg, symbol views, asset urls);
 * the component under test and its pure helpers run for real.
 */
vi.mock("react-native", () => import("../../testing/react-native-test-host"));
vi.mock("react-native-reanimated", () => import("../../testing/reanimated-test-host"));

const { selectionAsync } = vi.hoisted(() => ({ selectionAsync: vi.fn(() => Promise.resolve()) }));
vi.mock("expo-haptics", () => ({ selectionAsync }));
vi.mock("expo-image", () => ({ Image: "expo-image" }));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: "symbol-view" }));
vi.mock("@expo/ui/community/masked-view", () => ({ MaskedView: "masked-view" }));
vi.mock("@legendapp/list/reanimated", () => ({ AnimatedLegendList: "legend-list" }));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
vi.mock("react-native-svg", () => ({
  default: "svg",
  Defs: "svg-defs",
  LinearGradient: "svg-linear-gradient",
  Rect: "svg-rect",
  Stop: "svg-stop",
}));
vi.mock("../../components/T3Wordmark", () => ({ T3Wordmark: "t3-wordmark" }));
vi.mock("../../state/assets", () => ({ useAssetUrl: () => null }));

import { deriveThreadWorkLogSizing } from "../../lib/layout";
import { ThreadReasoningRow } from "./thread-work-log";

const rowSizing = deriveThreadWorkLogSizing({ baseFontSize: 14, fontScale: 1 });

function element(props: { expanded: boolean; onToggle: () => void }) {
  return (
    <ThreadReasoningRow
      rowSizing={rowSizing}
      iconSubtleColor="#888888"
      expanded={props.expanded}
      label="Thinking"
      streaming={false}
      onToggle={props.onToggle}
    >
      <View accessibilityLabel="trace-body">reasoning trace body</View>
    </ThreadReasoningRow>
  );
}

function header(root: ReactTestRenderer["root"]): ReactTestInstance {
  return root.findAll((node) => node.type === "pressable")[0]!;
}

function traceBodies(root: ReactTestRenderer["root"]) {
  return root.findAll(
    (node) => node.type === "view" && node.props.accessibilityLabel === "trace-body",
  );
}

let renderer: ReactTestRenderer;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  vi.unstubAllGlobals();
  selectionAsync.mockClear();
});

function createInAct(props: { expanded: boolean; onToggle: () => void }) {
  let created: ReactTestRenderer | undefined;
  act(() => {
    created = create(element(props));
  });
  return created!;
}

describe("ThreadReasoningRow", () => {
  it("keeps the collapsed trace body unmounted and expands through onToggle", () => {
    let expanded = false;
    const onToggle = vi.fn(() => {
      expanded = !expanded;
    });
    renderer = createInAct({ expanded, onToggle });

    expect(header(renderer.root).props.accessibilityState).toEqual({ expanded: false });
    expect(traceBodies(renderer.root)).toHaveLength(0);

    act(() => header(renderer.root).props.onPress());
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(selectionAsync).toHaveBeenCalledTimes(1);

    act(() => renderer.update(element({ expanded, onToggle })));
    expect(header(renderer.root).props.accessibilityState).toEqual({ expanded: true });
    expect(traceBodies(renderer.root)).toHaveLength(1);

    act(() => header(renderer.root).props.onPress());
    act(() => renderer.update(element({ expanded, onToggle })));
    expect(traceBodies(renderer.root)).toHaveLength(0);
  });

  it("hides the trace body again when the row collapses from above", () => {
    // `expanded` lives on the feed, so the row must obey prop-driven collapse
    // without its own press being involved.
    renderer = createInAct({ expanded: true, onToggle: () => {} });
    expect(traceBodies(renderer.root)).toHaveLength(1);
    act(() => renderer.update(element({ expanded: false, onToggle: () => {} })));
    expect(traceBodies(renderer.root)).toHaveLength(0);
  });
});
