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
  /** React's component stack, when the runtime provides one; shown on copy. */
  readonly componentStack?: string | undefined;
  readonly resetKeys?: ReadonlyArray<unknown> | undefined;
}

/** Returned by getDerivedStateFromError; omitting other keys keeps them through the setState merge. */
export function failedBoundaryState(error: unknown): Pick<BoundaryState, "failed" | "error"> {
  return { failed: true, error };
}

export function healthyBoundaryState(
  resetKeys?: ReadonlyArray<unknown> | undefined,
): BoundaryState {
  return { failed: false, error: undefined, componentStack: undefined, resetKeys };
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
 * show the recorded diagnostics, so it offers Settings instead. When the
 * broken route IS the Settings sheet itself, navigating to it would land back
 * on the crash, so the only safe exit is replacing the stack with Home.
 */
export type ScreenFallbackExit = "go-back" | "open-settings" | "go-home";

export function screenFallbackExit(args: {
  readonly canGoBack: boolean;
  readonly routeName: string;
}): ScreenFallbackExit {
  if (args.canGoBack) return "go-back";
  if (args.routeName === "SettingsSheet") return "go-home";
  return "open-settings";
}

/**
 * Reset signature for the inspector boundary. The registrant's stable
 * content identity (owner + content the user perceives, e.g. route thread +
 * inspector mode) wins over the render callback: registrants like
 * ThreadRouteScreen rebuild the callback on unrelated updates (active-turn
 * churn), so keying on it would reset — re-throw, and re-record — a
 * persistently crashing inspector on every such update, spamming the bounded
 * diagnostics log. Without an identity there is nothing better than the
 * callback itself.
 */
export function inspectorResetKeys(
  contentIdentity: string | undefined,
  render: (() => unknown) | undefined,
): ReadonlyArray<unknown> {
  return contentIdentity !== undefined ? [contentIdentity] : [render];
}

/**
 * Identity builders for the known registrants. The rule each encodes: the
 * identity changes exactly when the content the user perceives changes —
 * selecting a healthy section out of a crashed inspector must reset, while
 * unrelated route state churn must not.
 */
export function reviewInspectorIdentity(sectionId: string | undefined): string {
  return `review:changed-files:${sectionId ?? "none"}`;
}

/**
 * Files content is workspace-scoped: the same relative path in another
 * environment or another thread/worktree is different content, so both the
 * environment and the thread-or-cwd are part of the identity.
 */
export function filesInspectorIdentity(args: {
  readonly environmentId: string | null | undefined;
  readonly threadOrWorkspace: string | null | undefined;
  readonly relativePath: string | null;
}): string {
  return `files:${args.environmentId ?? "none"}:${args.threadOrWorkspace ?? "none"}:${args.relativePath ?? "tree"}`;
}
