import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  clearRenderErrorRecords,
  describeRenderError,
  formatRenderErrorReport,
  getRenderErrorRecords,
  readErrorStack,
  recordRenderError,
  subscribeToRenderErrors,
} from "./render-error-log";

beforeEach(() => {
  clearRenderErrorRecords();
});

describe("recordRenderError", () => {
  it("records the message, stack, scope, and timestamp, newest first", () => {
    const first = new Error("first broke");
    const second = new Error("second broke");
    recordRenderError(first, "thread-feed", { timestamp: 100 });
    recordRenderError(second, "screen:Thread", { timestamp: 200 });

    const records = getRenderErrorRecords();
    expect(records.map((record) => record.message)).toEqual(["second broke", "first broke"]);
    expect(records[0]?.scope).toBe("screen:Thread");
    expect(records[1]?.detail).toContain("first broke");
    expect(records[1]?.detail).toContain("Error: first broke");
  });

  it("records a cached error again when a retry re-throws the same object", () => {
    // A module-level or memoized Error keeps its identity across re-throws.
    // Identity-based dedupe would silently swallow every crash after the
    // first, which is exactly the report the retry most needs.
    const cached = new Error("deterministically broken");
    recordRenderError(cached, "thread-feed", { timestamp: 100 });
    recordRenderError(cached, "thread-feed", { timestamp: 200 });
    const records = getRenderErrorRecords();
    expect(records).toHaveLength(2);
    expect(records[0]?.timestamp).toBe(200);
  });

  it("keeps same-millisecond catches distinct for list identity", () => {
    recordRenderError(new Error("a"), "screen:Thread", { timestamp: 100 });
    recordRenderError(new Error("b"), "screen:Thread", { timestamp: 100 });
    const [newest, oldest] = getRenderErrorRecords();
    expect(newest?.id).not.toBe(oldest?.id);
  });

  it("keeps the newest records when the log overflows", () => {
    for (let index = 0; index < 25; index += 1) {
      recordRenderError(new Error(`error ${index}`), "screen:Home", { timestamp: index });
    }
    const records = getRenderErrorRecords();
    expect(records).toHaveLength(20);
    expect(records[0]?.message).toBe("error 24");
    expect(records[19]?.message).toBe("error 5");
  });

  it("appends the component stack when the runtime provides one", () => {
    recordRenderError(new Error("bad render"), "thread-feed", {
      componentStack: "\n    in ThreadFeed\n    in View",
    });
    expect(getRenderErrorRecords()[0]?.detail).toContain("Component stack:\n    in ThreadFeed");
  });
});

describe("describeRenderError", () => {
  it("falls back to the error name when the message is empty", () => {
    expect(describeRenderError(new TypeError(""))).toBe("TypeError");
  });

  it("stringifies non-error throws", () => {
    expect(describeRenderError("boom")).toBe("boom");
    const thrown = { toString: () => "custom" };
    expect(describeRenderError(thrown)).toBe("custom");
  });

  it("survives hostile throws whose toString rethrows", () => {
    // Reporting and the recovery view must never become the second crash.
    const thrown = {
      toString() {
        throw new Error("nope");
      },
    };
    expect(() => describeRenderError(thrown)).not.toThrow();
    expect(describeRenderError(thrown)).toBe("[object Object]");
  });

  it("falls back to a constant when even the fallback stringify rethrows", () => {
    const hostile = {
      toString() {
        throw new Error("nope");
      },
      get [Symbol.toStringTag]() {
        throw new Error("also nope");
      },
    };
    expect(() => describeRenderError(hostile)).not.toThrow();
    expect(describeRenderError(hostile)).toBe("[unstringifiable value]");
  });

  it("survives Error objects whose message/name/stack getters throw", () => {
    // All three are read inside componentDidCatch's record path; a throw from
    // any of them would defeat the recovery it is part of.
    const hostile = new Error("base");
    const explode = () => {
      throw new Error("getter");
    };
    Object.defineProperty(hostile, "message", { get: explode });
    Object.defineProperty(hostile, "name", { get: explode });
    Object.defineProperty(hostile, "stack", { get: explode });

    expect(() => recordRenderError(hostile, "thread-feed")).not.toThrow();
    expect(() => readErrorStack(hostile)).not.toThrow();
    expect(readErrorStack(hostile)).toBeUndefined();
    const record = getRenderErrorRecords()[0];
    expect(record?.message).toBe("Error");
    expect(record?.detail).toBe("Error");
  });

  it("survives throws where even instanceof Error rethrows", () => {
    // instanceof walks the prototype chain; a Proxy with a throwing
    // getPrototypeOf trap must not break the record path either.
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new TypeError("no proto");
        },
      },
    );
    expect(() => describeRenderError(hostile)).not.toThrow();
    expect(() => recordRenderError(hostile, "screen:Thread")).not.toThrow();
    expect(() => readErrorStack(hostile)).not.toThrow();
    expect(readErrorStack(hostile)).toBeUndefined();
    expect(getRenderErrorRecords()[0]?.message).toBe("[object Object]");
  });

  it("keeps ordinary Error fields when the getters behave", () => {
    const error = new Error("plain failure");
    expect(describeRenderError(error)).toBe("plain failure");
    expect(readErrorStack(error)).toContain("plain failure");
  });
});

describe("subscribeToRenderErrors", () => {
  it("notifies listeners and hands them a new snapshot on every write", () => {
    const before = getRenderErrorRecords();
    let notified = 0;
    const unsubscribe = subscribeToRenderErrors(() => {
      notified += 1;
    });

    recordRenderError(new Error("crash while diagnostics is open"), "screen:Thread");
    expect(notified).toBe(1);
    const after = getRenderErrorRecords();
    expect(after).not.toBe(before);
    expect(after[0]?.message).toBe("crash while diagnostics is open");

    unsubscribe();
    recordRenderError(new Error("after unsubscribe"), "screen:Thread");
    expect(notified).toBe(1);
  });

  it("notifies on clear so a mounted view cannot show stale rows", () => {
    recordRenderError(new Error("something"), "screen:Thread");
    let notified = 0;
    const unsubscribe = subscribeToRenderErrors(() => {
      notified += 1;
    });
    clearRenderErrorRecords();
    expect(notified).toBe(1);
    expect(getRenderErrorRecords()).toHaveLength(0);
    unsubscribe();
  });
});

describe("formatRenderErrorReport", () => {
  it("labels an empty session without pretending a crash happened", () => {
    const report = formatRenderErrorReport([], { version: "1.2.3", build: "45" });
    expect(report).toContain("T3 Code 1.2.3 (45)");
    expect(report).toContain("No recovered render errors this session.");
  });

  it("renders one section per record with scope and detail", () => {
    recordRenderError(new Error("feed exploded"), "thread-feed", { timestamp: 1789277752000 });
    const report = formatRenderErrorReport(getRenderErrorRecords(), {
      version: "1.2.3",
      build: "45",
    });
    expect(report).toContain("recovered render errors");
    expect(report).toContain("2026-09-13T05:35:52.000Z [thread-feed]");
    expect(report).toContain("feed exploded");
  });
});
