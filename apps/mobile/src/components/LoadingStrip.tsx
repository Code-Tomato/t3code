import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useAmbientAnimationsEnabled } from "../lib/useAmbientAnimationsActive";

const INDICATOR_WIDTH_FRACTION = 0.3;
const MIN_INDICATOR_WIDTH = 48;

function LoadingStripFrame(props: {
  readonly children: React.ReactNode;
  readonly onLayout?: (width: number) => void;
}) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden"
      onLayout={
        props.onLayout
          ? (event) => {
              props.onLayout?.(event.nativeEvent.layout.width);
            }
          : undefined
      }
    >
      {props.children}
    </View>
  );
}

function IndeterminateLoadingStrip() {
  const [containerWidth, setContainerWidth] = useState(0);
  const animationsEnabled = useAmbientAnimationsEnabled();
  const travelProgress = useSharedValue(0);
  const indicatorWidth = Math.max(MIN_INDICATOR_WIDTH, containerWidth * INDICATOR_WIDTH_FRACTION);

  useEffect(() => {
    cancelAnimation(travelProgress);
    travelProgress.value = 0;
    if (!animationsEnabled || containerWidth <= 0) return;

    travelProgress.value = withRepeat(
      withTiming(1, {
        duration: 1100,
        easing: Easing.inOut(Easing.quad),
        reduceMotion: ReduceMotion.Never,
      }),
      -1,
      false,
      undefined,
      ReduceMotion.Never,
    );

    return () => {
      cancelAnimation(travelProgress);
    };
  }, [animationsEnabled, containerWidth, travelProgress]);

  const indicatorStyle = useAnimatedStyle(
    () => ({
      transform: [
        {
          translateX: (containerWidth + indicatorWidth) * travelProgress.value - indicatorWidth,
        },
      ],
      width: indicatorWidth,
    }),
    [containerWidth, indicatorWidth],
  );

  return (
    <LoadingStripFrame onLayout={setContainerWidth}>
      {animationsEnabled ? (
        <Animated.View className="h-full rounded-full bg-primary" style={indicatorStyle} />
      ) : (
        // Static stand-in so "still loading" stays legible when the loop is
        // parked (reduced motion, backgrounded, or unfocused screen).
        <View className="h-full w-full bg-primary opacity-40" />
      )}
    </LoadingStripFrame>
  );
}

export function LoadingStrip(props: { readonly progress?: number }) {
  if (props.progress === undefined) {
    return <IndeterminateLoadingStrip />;
  }

  const clampedProgress = Math.min(1, Math.max(0, props.progress));

  return (
    <LoadingStripFrame>
      <View
        className="h-full rounded-r-full bg-primary"
        style={{ width: `${clampedProgress * 100}%` }}
      />
    </LoadingStripFrame>
  );
}
