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
 * Reset keys for the thread feed boundary. The feed renders entries AND the
 * worktree setup card for a cwd, so a same-thread worktree move (cwd change
 * under a stable thread key) is new content and must clear a stale failure.
 */
export function threadFeedResetKeys(
  threadKey: string,
  cwd: string | null | undefined,
): ReadonlyArray<unknown> {
  return [threadKey, cwd ?? null];
}

/**
 * Cold-launch safety valve for the Home seam. A bad OTA that crashes Home
 * before it has ever painted would otherwise strand the user on the fallback
 * forever: the launch update check runs inside HomeRouteScreen's effect
 * (which never ran) and expo-updates' ErrorRecovery rollback only fires for
 * fatals. So a Home boundary that has never committed healthy children
 * rethrows — restoring the pre-boundary fatal path (ErrorRecovery rollback +
 * its startup crash log) — while any failure after the first successful
 * paint keeps in-session recovery. A fatal is deliberately NOT recorded in
 * the render-error log: ErrorRecovery already logs it and Diagnostics reads
 * that log, and recording both would double-report the same crash.
 */
export function shouldRethrowAsFatal(args: {
  readonly fatalIfFirstPaintFails: boolean;
  readonly childCommitted: boolean;
}): boolean {
  return args.fatalIfFirstPaintFails && !args.childCommitted;
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
 * Identity builder for the known registrants. The rule each encodes: the
 * identity changes exactly when the content the user perceives changes —
 * selecting a healthy section out of a crashed inspector must reset, while
 * unrelated route state churn must not.
 *
 * Every inspector's content is workspace-bound (a diff, a file tree, a thread
 * view), so all three parts ride the key: the route/thread the content
 * belongs to, the cwd it renders (a thread's worktree can move, and
 * same-id content recurs across workspaces), and the content selection
 * itself. Keying on any subset lets a crashed fallback persist over new,
 * healthy content.
 */
export function workspaceInspectorContentIdentity(args: {
  readonly source: "thread" | "review" | "files";
  readonly workspaceKey: string | null | undefined;
  readonly cwd: string | null | undefined;
  readonly contentId: string | null | undefined;
}): string {
  // JSON tuple, not ':'-joined: paths and ids contain ':' and users can
  // legitimately have a content id of "none", so delimiter joining (and
  // null-mapping to "none") can collide — and a collision re-arms the
  // failed-over-inspector bug this identity exists to prevent.
  return JSON.stringify([
    args.source,
    args.workspaceKey ?? null,
    args.cwd ?? null,
    args.contentId ?? null,
  ]);
}
