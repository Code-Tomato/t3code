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
const recordedErrors = new WeakSet<object>();
let records: RenderErrorRecord[] = [];

export function describeRenderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim().length > 0 ? error.message : error.name;
  }
  return String(error);
}

/**
 * Record a caught render error. Returns false when this exact error object was
 * already recorded (a boundary further up the tree saw the same throw), which
 * is how ancestors stay silent while still resetting their subtree.
 */
export function recordRenderError(
  error: unknown,
  scope: string,
  options: { readonly componentStack?: string | undefined; readonly timestamp?: number } = {},
): boolean {
  const message = describeRenderError(error);
  if (typeof error === "object" && error !== null) {
    if (recordedErrors.has(error)) return false;
    recordedErrors.add(error);
  }
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
  return true;
}

/** Newest first, as stored. */
export function getRenderErrorRecords(): ReadonlyArray<RenderErrorRecord> {
  return records;
}

export function clearRenderErrorRecords(): void {
  records = [];
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
