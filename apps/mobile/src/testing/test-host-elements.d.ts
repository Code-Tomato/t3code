/**
 * Host-element vocabulary created by the test hosts (`react-native-test-host`,
 * `reanimated-test-host`) and the module mocks in component tests. react-test-
 * renderer renders these as plain host elements, so tests query the tree by
 * these names and JSX in a test may use them directly. Declaring them keeps
 * typecheck honest without teaching app code about the test tree.
 */
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      view: Record<string, unknown>;
      text: Record<string, unknown>;
      "text-input": Record<string, unknown>;
      image: Record<string, unknown>;
      "scroll-view": Record<string, unknown>;
      "flat-list": Record<string, unknown>;
      pressable: Record<string, unknown>;
      "animated-view": Record<string, unknown>;
      "animated-text": Record<string, unknown>;
      // Stand-ins installed by per-test vi.mock of native/third-party modules.
      "expo-image": Record<string, unknown>;
      "symbol-view": Record<string, unknown>;
      "masked-view": Record<string, unknown>;
      "legend-list": Record<string, unknown>;
      svg: Record<string, unknown>;
      "svg-defs": Record<string, unknown>;
      "svg-linear-gradient": Record<string, unknown>;
      "svg-rect": Record<string, unknown>;
      "svg-stop": Record<string, unknown>;
      "t3-wordmark": Record<string, unknown>;
    }
  }
}

export {};
