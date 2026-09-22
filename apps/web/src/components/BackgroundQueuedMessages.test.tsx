import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useComposerDraftStore } from "../composerDraftStore";
import { useQueuedMessageStore } from "../queuedMessageStore";
import { BackgroundQueuedMessages } from "./BackgroundQueuedMessages";

const io = vi.hoisted(() => ({
  threads: new Map<string, unknown>(),
  prepare: vi.fn(),
  start: vi.fn(),
  connected: true,
}));
vi.mock("../state/entities", () => ({
  useThread: (ref: { threadId: string }) => io.threads.get(ref.threadId),
  useServerConfigs: () => new Map([[EnvironmentId.make("env"), {}]]),
}));
vi.mock("../state/threads", () => ({ useEnvironmentThread: () => ({ status: "live" }) }));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      {
        environmentId: EnvironmentId.make("env"),
        connection: { phase: io.connected ? "connected" : "reconnecting" },
      },
    ],
  }),
}));
vi.mock("../hooks/useSettings", () => ({ useClientSettingsHydrated: () => true }));
vi.mock("../lib/sendBackgroundQueuedMessage", () => ({
  sendBackgroundQueuedMessage: async (...args: unknown[]) => io.start(...args),
}));

const ref = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("a"));
const key = scopedThreadKey(ref);
let root: ReactTestRenderer | undefined;
const render = async (activeThreadKey: string | null) => {
  await act(async () => {
    const element = <BackgroundQueuedMessages activeThreadKey={activeThreadKey} />;
    if (root) root.update(element);
    else root = create(element);
  });
};
function enqueue(prompt = "follow up") {
  return useQueuedMessageStore.getState().enqueue(key, {
    prompt,
    images: [],
    files: [],
    terminalContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    submissionIntent: "foreground",
    queuedAfterToolActivityId: null,
    createdAt: "2026-09-22T00:00:00Z",
    sendOptions: {
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      promptEffort: null,
    },
  });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useQueuedMessageStore.setState({ queuesByThreadKey: {}, drainGeneration: 0 });
  io.connected = true;
  io.threads.set("a", { session: { status: "running" }, activities: [] });
  io.start.mockReset().mockImplementation(async (_ref, message, _options, canSend) => {
    if (!canSend()) return false;
    return Boolean(useQueuedMessageStore.getState().take(key, message.id, null));
  });
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
});
describe("background queued messages", () => {
  it("sends a completed thread's queue after navigating away, without selecting it again", async () => {
    enqueue();
    await render(key);
    await render("another-thread");
    expect(io.start).not.toHaveBeenCalled();
    io.threads.set("a", { session: { status: "ready" }, activities: [] });
    await render("another-thread");
    expect(io.start).toHaveBeenCalledOnce();
    expect(io.start.mock.calls[0]?.[0]).toEqual(ref);
    expect(useQueuedMessageStore.getState().queuesByThreadKey[key]).toBeUndefined();
  });
  it("leaves selected and disconnected threads to wait", async () => {
    enqueue();
    io.threads.set("a", { session: { status: "ready" }, activities: [] });
    await render(key);
    expect(io.start).not.toHaveBeenCalled();
    io.connected = false;
    await render(null);
    expect(io.start).not.toHaveBeenCalled();
    io.connected = true;
    await render(null);
    expect(io.start).toHaveBeenCalledOnce();
  });
  it("advances after a text-only turn even when there is no new tool activity", async () => {
    enqueue("first");
    enqueue("second");
    io.threads.set("a", { session: { status: "ready" }, activities: [] });
    await render(null);
    expect(io.start).toHaveBeenCalledOnce();
    io.threads.set("a", { session: { status: "running" }, activities: [] });
    await render(null);
    expect(io.start).toHaveBeenCalledOnce();
    io.threads.set("a", { session: { status: "ready" }, activities: [] });
    await render(null);
    expect(io.start).toHaveBeenCalledTimes(2);
  });
  it("waits for checkpoint rewind to finish", async () => {
    enqueue();
    useComposerDraftStore.setState({ rewindingThreadKeys: new Set([key]) });
    io.threads.set("a", { session: { status: "ready" }, activities: [] });
    await render(null);
    expect(io.start).not.toHaveBeenCalled();
    await act(() => {
      useComposerDraftStore.setState({ rewindingThreadKeys: new Set() });
    });
    expect(io.start).toHaveBeenCalledOnce();
  });
  it.each(["approval.requested", "user-input.requested"])(
    "waits for %s to resolve",
    async (kind) => {
      enqueue();
      io.threads.set("a", {
        session: { status: "ready" },
        activities: [
          {
            id: "request",
            kind,
            createdAt: "2026-09-22T00:00:00Z",
            payload: {
              requestId: "req-1",
              questions: [
                {
                  id: "q1",
                  header: "name",
                  question: "name?",
                  options: [],
                  allowCustomAnswer: true,
                  multiSelect: false,
                },
              ],
            },
          },
        ],
      });
      await render(null);
      expect(io.start).not.toHaveBeenCalled();
      io.threads.set("a", { session: { status: "ready" }, activities: [] });
      await render(null);
      expect(io.start).toHaveBeenCalledOnce();
    },
  );
  it("does not miss a boundary that arrives while dispatch is awaiting its receipt", async () => {
    enqueue("first");
    enqueue("second");
    let release!: () => void;
    const receipt = new Promise<void>((resolve) => {
      release = resolve;
    });
    io.start.mockImplementationOnce(async (_ref, message) => {
      useQueuedMessageStore.getState().take(key, message.id, null);
      await receipt;
      return true;
    });
    io.threads.set("a", {
      session: { status: "ready" },
      activities: [],
      latestTurn: { turnId: "old" },
    });
    await render(null);
    io.threads.set("a", {
      session: { status: "ready" },
      activities: [],
      latestTurn: { turnId: "new" },
    });
    await render(null);
    await act(async () => release());
    expect(io.start).toHaveBeenCalledTimes(2);
  });
  it("does not send a held message", async () => {
    const message = enqueue();
    useQueuedMessageStore.getState().holdAtFront(key, message);
    io.threads.set("a", { session: { status: "ready" }, activities: [] });
    await render(null);
    expect(io.start).not.toHaveBeenCalled();
  });
});
