import { Component, type ComponentType, type ReactNode } from "react";
import { View } from "react-native";

import { SymbolView } from "./AppSymbol";
import { AppText as Text } from "./AppText";
import { MaterialButton } from "./MaterialButton";
import { tryCopyTextWithHaptic } from "../lib/copyTextWithHaptic";
import { recordRenderError } from "../features/diagnostics/render-error-log";
import {
  boundaryResetFromProps,
  failedBoundaryState,
  healthyBoundaryState,
  type BoundaryState,
} from "./render-error-boundary-model";

interface RenderErrorBoundaryProps {
  readonly children: ReactNode;
  /** Where the error was caught, recorded into the diagnostics render-error log. */
  readonly scope: string;
  /** Changed inputs reset a failed subtree without remounting the boundary. */
  readonly resetKeys?: ReadonlyArray<unknown> | undefined;
  /** Subject noun for the default fallback's headline, e.g. "The conversation". */
  readonly subject?: string;
  /**
   * Recovery UI override, rendered as its own component so it can use hooks
   * (e.g. navigation) even though the boundary itself is a class.
   */
  readonly fallback?: ComponentType<RenderFallbackProps> | undefined;
}

export interface RenderFallbackProps {
  readonly error: unknown;
  readonly retry: () => void;
}

type RenderErrorBoundaryState = BoundaryState;

/**
 * Catches render errors in one subtree, records them for diagnostics, and
 * shows an in-session recovery UI instead of letting the app die. Retrying
 * unmounts the failed subtree and mounts a fresh one; changed `resetKeys`
 * (e.g. a thread switch) clear the failure on their own.
 *
 * Failure is tracked by a dedicated flag, not the thrown value, so
 * `throw undefined`/`null`/`""` still render the fallback.
 *
 * A caught error never reaches the global fatal handler, so expo-updates'
 * ErrorRecovery startup log stays exclusively for process-ending fatals —
 * `recordRenderError` is the sole report path here. Once a boundary recovers,
 * the throw stops bubbling, so only the innermost boundary records it.
 */
export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  override state = healthyBoundaryState(this.props.resetKeys);

  // A changed thread/environment underneath a persistent boundary is new input:
  // retry without waiting for the user to press Try again.
  static getDerivedStateFromProps(
    { resetKeys }: RenderErrorBoundaryProps,
    state: RenderErrorBoundaryState,
  ) {
    return boundaryResetFromProps(resetKeys, state);
  }

  static getDerivedStateFromError(error: unknown) {
    return failedBoundaryState(error);
  }

  override componentDidCatch(error: unknown, info: { componentStack?: string }) {
    recordRenderError(error, this.props.scope, { componentStack: info.componentStack });
  }

  private readonly retry = () => {
    this.setState(healthyBoundaryState(this.state.resetKeys));
  };

  override render() {
    if (this.state.failed) {
      if (this.props.fallback) {
        const Fallback = this.props.fallback;
        return <Fallback error={this.state.error} retry={this.retry} />;
      }
      return (
        <RenderFailureView
          subject={this.props.subject}
          error={this.state.error}
          retry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * The recovery UI itself: retry, copy diagnostics, and (where navigation gives
 * a way out) go back. It renders without a connection — recovery must work the
 * same locally and over a tunnel, where the crash itself may have arrived with
 * remote data.
 */
export function RenderFailureView(props: {
  readonly subject?: string;
  readonly error: unknown;
  readonly retry: () => void;
  readonly onGoBack?: (() => void) | undefined;
  /** Escape exit for a cold-launch crash where there is no route to go back to. */
  readonly onOpenSettings?: (() => void) | undefined;
}) {
  const message =
    props.error instanceof Error ? props.error.message || props.error.name : String(props.error);
  const copy = async () => {
    const detail = props.error instanceof Error ? (props.error.stack ?? message) : message;
    await tryCopyTextWithHaptic(detail, { target: "render error details" });
  };
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8 py-10">
      <SymbolView
        name="exclamationmark.triangle"
        size={30}
        tintColorClassName="accent-icon"
        type="monochrome"
        weight="regular"
      />
      <View className="items-center gap-2">
        <Text className="text-center text-xl font-t3-bold text-foreground">
          {props.subject ?? "This screen"} couldn’t be displayed
        </Text>
        <Text className="text-center font-sans text-sm leading-relaxed text-foreground-muted">
          Try again to re-render it. If it keeps happening, copy the details — they help us fix it.
        </Text>
        <Text
          selectable
          className="text-center font-mono text-xs leading-snug text-danger-foreground"
        >
          {message.slice(0, 300)}
        </Text>
      </View>
      <View className="w-full max-w-xs items-stretch gap-2">
        <MaterialButton label="Try again" onPress={props.retry} tone="primary" fullWidth />
        <MaterialButton label="Copy details" onPress={() => void copy()} fullWidth />
        {props.onGoBack ? (
          <MaterialButton label="Go back" onPress={props.onGoBack} tone="text" fullWidth />
        ) : null}
        {props.onOpenSettings ? (
          <MaterialButton
            label="Open settings"
            onPress={props.onOpenSettings}
            tone="text"
            fullWidth
          />
        ) : null}
      </View>
    </View>
  );
}
