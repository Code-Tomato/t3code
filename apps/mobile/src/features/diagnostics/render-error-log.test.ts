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
    expect(recordRenderError(first, "thread-feed", { timestamp: 100 })).toBe(true);
    expect(recordRenderError(second, "screen:Thread", { timestamp: 200 })).toBe(true);

    const records = getRenderErrorRecords();
    expect(records.map((record) => record.message)).toEqual(["second broke", "first broke"]);
    expect(records[0]?.scope).toBe("screen:Thread");
    expect(records[1]?.detail).toContain("first broke");
    expect(records[1]?.detail).toContain("Error: first broke");
  });

  it("records one throw once when several boundaries on the path catch it", () => {
    const error = new Error("bubble through everything");
    expect(recordRenderError(error, "thread-feed")).toBe(true);
    // The same object keeps bubbling; the outer screen boundary must not add
    // a second report of the identical crash.
    expect(recordRenderError(error, "screen:Thread")).toBe(false);
    expect(getRenderErrorRecords()).toHaveLength(1);

    // A fresh throw with the same message (e.g. after a failed retry) is a
    // distinct crash and is recorded.
    expect(recordRenderError(new Error("bubble through everything"), "thread-feed")).toBe(true);
    expect(getRenderErrorRecords()).toHaveLength(2);
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
