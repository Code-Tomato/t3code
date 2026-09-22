/**
 * Pure state model for `RenderErrorBoundary`, kept separate from the RN view
 * so the failure bookkeeping is directly testable.
 *
 * The failure signal is a dedicated `failed` flag, never the thrown value:
 * `throw undefined` / `throw null` / `throw ""` must still fail the boundary,
 * so the value itself can't double as the sentinel.
 */
export interface BoundaryState {
  readonly failed: boolean;
  readonly error: unknown;
  readonly resetKeys?: ReadonlyArray<unknown> | undefined;
}

/** Returned by getDerivedStateFromError; omitting `resetKeys` keeps the tracked ones through the merge. */
export function failedBoundaryState(error: unknown): Pick<BoundaryState, "failed" | "error"> {
  return { failed: true, error };
}

export function healthyBoundaryState(
  resetKeys?: ReadonlyArray<unknown> | undefined,
): BoundaryState {
  return { failed: false, error: undefined, resetKeys };
}

/**
 * `getDerivedStateFromProps` logic: changed `resetKeys` (e.g. a thread switch
 * under a persistent boundary) clear a failure without waiting for user
 * action; unchanged keys leave the current state untouched.
 */
export function boundaryResetFromProps(
  resetKeys: ReadonlyArray<unknown> | undefined,
  state: BoundaryState,
): BoundaryState | null {
  if (
    resetKeys?.length !== state.resetKeys?.length ||
    resetKeys?.some((key, index) => !Object.is(key, state.resetKeys?.[index]))
  ) {
    return healthyBoundaryState(resetKeys);
  }
  return null;
}

/**
 * Which exit the screen-level fallback offers: normally Go back, but when the
 * crashing route is the only route (cold launch on Home), there is no previous
 * route and no back gesture — the fallback must still lead somewhere that can
 * show the recorded diagnostics, so it offers Settings instead.
 */
export type ScreenFallbackExit = "go-back" | "open-settings";

export function screenFallbackExit(canGoBack: boolean): ScreenFallbackExit {
  return canGoBack ? "go-back" : "open-settings";
}
