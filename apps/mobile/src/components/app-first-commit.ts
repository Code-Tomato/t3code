/**
 * Whether the app's root tree has ever completed a React commit.
 *
 * Why this exists: expo-updates 57 disarms its OTA startup-error recovery at
 * RN's CONTENT_APPEARED marker, which fires when the first native view is
 * added to the root view — i.e. when ANY commit has painted, not when the
 * Home screen specifically has. The Home first-paint fatal valve is only
 * equivalent to the pre-boundary behavior while nothing has painted; once
 * any frame exists, a rethrow is just a crash with no recovery tasks left,
 * so the valve must disarm itself. This flag flips false→true exactly once,
 * inside the first successful commit (the sentinel's layout effect is part
 * of that commit), which is the same commit CONTENT_APPEARED rides on.
 */
let appRootCommitted = false;

export function markAppRootCommitted(): void {
  appRootCommitted = true;
}

export function hasAppRootCommitted(): boolean {
  return appRootCommitted;
}

/** Test-only: reset the latch between cases. */
export function resetAppRootCommitted(): void {
  appRootCommitted = false;
}
