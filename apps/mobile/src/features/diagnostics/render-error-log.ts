/**
 * In-memory log of render errors the app caught and recovered from during the
 * current session.
 *
 * This deliberately does NOT feed the expo-updates crash log the Diagnostics
 * screen reads: `crash-log-model.ts` captures only ErrorRecovery fatals that
 * took the process down at startup. A caught render error never reaches the
 * global fatal handler, so it could never appear there — recording it here is
 * the only way to surface it, and routing it anywhere else would double-report
 * what the startup log already owns.
 *
 * There is no dedupe by error identity on purpose: a cached error re-thrown on
 * retry is a fresh incident worth recording again, and the same throw seen by
 * nested boundaries leaves one row per scope, which reads as the bubble path.
 */
export interface RenderErrorRecord {
  readonly timestamp: number;
  /** Where it was caught, e.g. `screen:Thread` or `thread-feed`. */
  readonly scope: string;
  readonly message: string;
  /** Message + stack (+ component stack when the runtime provides one). */
  readonly detail: string;
}

const MAX_RECORDS = 20;
let records: RenderErrorRecord[] = [];
const listeners = new Set<() => void>();

/**
 * `useSyncExternalStore` pair. The records array is replaced (never mutated)
 * on every write, so `getRenderErrorRecords` is a stable snapshot getter: the
 * Diagnostics screen sees a crash recorded by another route while it is open.
 */
export function subscribeToRenderErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function describeRenderError(error: unknown): string {
  if (error instanceof Error) {
    return safeString(error.message) || error.name;
  }
  return safeString(error);
}

// A hostile `toString`/`Symbol.toPrimitive` must not turn error reporting — or
// the recovery view that renders the message — into a second crash.
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * Record a caught render error. Every boundary that catches a throw records it
 * against its own scope, so one crash can produce one row per scope it bubbled
 * through — a useful trail, and the opposite of suppressing a cached error
 * that legitimately throws again after a retry.
 */
export function recordRenderError(
  error: unknown,
  scope: string,
  options: { readonly componentStack?: string | undefined; readonly timestamp?: number } = {},
): void {
  const message = describeRenderError(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const detail = [
    message,
    stack !== undefined && stack !== null ? stack : "",
    options.componentStack !== undefined && options.componentStack !== null
      ? `Component stack:${options.componentStack}`
      : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
  records = [
    { timestamp: options.timestamp ?? Date.now(), scope, message, detail },
    ...records,
  ].slice(0, MAX_RECORDS);
  for (const listener of listeners) listener();
}

/** Newest first, as stored. */
export function getRenderErrorRecords(): ReadonlyArray<RenderErrorRecord> {
  return records;
}

export function clearRenderErrorRecords(): void {
  records = [];
  for (const listener of listeners) listener();
}

/** The report a user pastes into an issue, mirroring the startup crash report. */
export function formatRenderErrorReport(
  input: ReadonlyArray<RenderErrorRecord>,
  app: { readonly version: string; readonly build: string },
): string {
  const header = `T3 Code ${app.version} (${app.build}) — recovered render errors`;
  if (input.length === 0) return `${header}\nNo recovered render errors this session.`;
  return [
    header,
    ...input.map(
      (record) =>
        `\n--- ${new Date(record.timestamp).toISOString()} [${record.scope}] ---\n${record.detail}`,
    ),
  ].join("\n");
}
