import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  clearRenderErrorRecords,
  describeRenderError,
  formatRenderErrorReport,
  getRenderErrorRecords,
  recordRenderError,
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
