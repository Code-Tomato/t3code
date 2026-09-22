import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { BackgroundQueuedMessages } from "../components/BackgroundQueuedMessages";
import { EnvironmentId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useQueuedMessageStore, type QueuedMessageSendOptions } from "../queuedMessageStore";
import { sendBackgroundQueuedMessage } from "./sendBackgroundQueuedMessage";

const io = vi.hoisted(() => ({
  run: vi.fn(),
  upload: vi.fn(),
  release: vi.fn(),
  toast: vi.fn(),
  config: {},
  threads: new Map<string, unknown>(),
}));
vi.mock("@t3tools/client-runtime/state/runtime", async (load) => ({
  ...(await load<typeof import("@t3tools/client-runtime/state/runtime")>()),
  runAtomCommand: (...args: unknown[]) => io.run(...args),
}));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => new Map([["env-a", io.config]]) },
}));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: {} }));
vi.mock("../state/threads", () => ({
  useEnvironmentThread: () => ({ status: "live" }),
  threadEnvironment: {
    updateMetadata: "metadata",
    setRuntimeMode: "runtime",
    setInteractionMode: "interaction",
    startTurn: "start",
  },
}));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [{ environmentId: "env-a", connection: { phase: "connected" } }],
  }),
}));
vi.mock("../hooks/useSettings", () => ({ useClientSettingsHydrated: () => true }));
vi.mock("../state/entities", () => ({
  useThread: (ref: { threadId: string }) => io.threads.get(ref.threadId),
  useServerConfigs: () => new Map([["env-a", io.config]]),
  readThreadShell: () => ({ runtimeMode: "full-access", interactionMode: "default" }),
}));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: (...args: unknown[]) => io.toast(...args) },
}));
vi.mock("./attachmentUploadQueue", () => ({
  startAttachmentUpload: vi.fn(),
  awaitAttachmentUploads: (...args: unknown[]) => io.upload(...args),
  getUploadedAttachments: () => [
    { type: "image", id: "uploaded-image", name: "test.png", mimeType: "image/png", sizeBytes: 4 },
  ],
  releaseDraftAttachments: (...args: unknown[]) => io.release(...args),
}));
const ref = scopeThreadRef(EnvironmentId.make("env-a"), ThreadId.make("thread-a"));
const key = scopedThreadKey(ref);
const options: QueuedMessageSendOptions = {
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  promptEffort: null,
};
function enqueue() {
  return useQueuedMessageStore.getState().enqueue(key, {
    prompt: "follow up",
    images: [],
    files: [],
    terminalContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    submissionIntent: "foreground",
    queuedAfterToolActivityId: null,
    createdAt: "2026-09-22T00:00:00Z",
    sendOptions: options,
  });
}
const startCalls = () => io.run.mock.calls.filter((call) => call[1] === "start");
beforeEach(() => {
  useQueuedMessageStore.setState({ queuesByThreadKey: {}, drainGeneration: 0 });
  io.run.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  io.upload.mockReset().mockResolvedValue(undefined);
  io.release.mockReset();
  io.toast.mockReset();
  io.config = {
    providers: [
      { instanceId: "codex", driver: "codex", enabled: true, installed: true, status: "ready" },
    ],
    environment: { capabilities: { attachmentUploads: true, inlineMessageContext: true } },
  };
});
describe("background queued send", () => {
  it("runs the mounted processor through preparation and dispatch after navigating away", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    enqueue();
    io.threads.set("thread-a", { session: { status: "running" }, activities: [] });
    let root!: ReactTestRenderer;
    await act(() => {
      root = create(createElement(BackgroundQueuedMessages, { activeThreadKey: key }));
    });
    try {
      await act(() =>
        root.update(createElement(BackgroundQueuedMessages, { activeThreadKey: "thread-b" })),
      );
      expect(startCalls()).toHaveLength(0);
      io.threads.set("thread-a", { session: { status: "ready" }, activities: [] });
      await act(() =>
        root.update(createElement(BackgroundQueuedMessages, { activeThreadKey: "thread-b" })),
      );
      expect(startCalls()).toHaveLength(1);
      expect(startCalls()[0]?.[2]).toMatchObject({
        environmentId: "env-a",
        input: { threadId: "thread-a", message: { text: "follow up" } },
      });
      expect(useQueuedMessageStore.getState().queuesByThreadKey[key]).toBeUndefined();
    } finally {
      await act(() => root.unmount());
    }
  });
  it("dispatches to the original environment/thread with the queued model and modes", async () => {
    const message = enqueue();
    expect(
      await sendBackgroundQueuedMessage(
        ref,
        message,
        options,
        () => true,
        () => "tool-2",
      ),
    ).toBe(true);
    expect(startCalls()).toHaveLength(1);
    expect(startCalls()[0]?.[2]).toMatchObject({
      environmentId: "env-a",
      input: {
        threadId: "thread-a",
        modelSelection: options.modelSelection,
        runtimeMode: options.runtimeMode,
        interactionMode: options.interactionMode,
        message: { text: "follow up", attachments: [] },
      },
    });
    expect(useQueuedMessageStore.getState().queuesByThreadKey[key]).toBeUndefined();
  });
  it("does not dispatch or resurrect a message cancelled during preparation", async () => {
    const message = enqueue();
    io.run.mockImplementation(async (_registry, command) => {
      if (command === "metadata") useQueuedMessageStore.getState().drain(key);
      return { _tag: "Success", value: undefined };
    });
    expect(
      await sendBackgroundQueuedMessage(
        ref,
        message,
        options,
        () => true,
        () => null,
      ),
    ).toBe(false);
    expect(startCalls()).toHaveLength(0);
    expect(useQueuedMessageStore.getState().queuesByThreadKey[key]).toBeUndefined();
  });
  it("rechecks approvals and connection gates after async preparation", async () => {
    const message = enqueue();
    let allowed = true;
    io.run.mockImplementation(async () => {
      allowed = false;
      return { _tag: "Success", value: undefined };
    });
    expect(
      await sendBackgroundQueuedMessage(
        ref,
        message,
        options,
        () => allowed,
        () => null,
      ),
    ).toBe(false);
    expect(startCalls()).toHaveLength(0);
    expect(useQueuedMessageStore.getState().queuesByThreadKey[key]).toHaveLength(1);
  });
  it("holds failures at the head without losing the following message", async () => {
    const message = enqueue();
    const second = enqueue();
    io.run.mockRejectedValue(new Error("offline"));
    expect(
      await sendBackgroundQueuedMessage(
        ref,
        message,
        options,
        () => true,
        () => null,
      ),
    ).toBe(false);
    expect(useQueuedMessageStore.getState().queuesByThreadKey[key]).toEqual([
      { ...message, holdUntilUserAction: true },
      second,
    ]);
    expect(io.toast).toHaveBeenCalledOnce();
  });
  it("does not send a message held while preparation was pending", async () => {
    const message = enqueue();
    io.run.mockImplementation(async () => {
      useQueuedMessageStore.getState().holdAtFront(key, message);
      return { _tag: "Success", value: undefined };
    });
    expect(
      await sendBackgroundQueuedMessage(
        ref,
        message,
        options,
        () => true,
        () => null,
      ),
    ).toBe(false);
    expect(startCalls()).toHaveLength(0);
  });
  it("preserves uploaded image references and review context", async () => {
    const message = enqueue();
    message.images.push({
      type: "image",
      id: "local-image",
      name: "test.png",
      mimeType: "image/png",
      sizeBytes: 4,
      previewUrl: "blob:test",
      file: new File(["test"], "test.png", { type: "image/png" }),
    });
    message.reviewComments.push({
      id: "review",
      sectionId: "s",
      sectionTitle: "Review",
      filePath: "a.ts",
      startIndex: 0,
      endIndex: 0,
      rangeLabel: "L1",
      text: "check this branch",
      diff: "",
    });
    expect(
      await sendBackgroundQueuedMessage(
        ref,
        message,
        options,
        () => true,
        () => null,
      ),
    ).toBe(true);
    expect(startCalls()[0]?.[2]).toMatchObject({
      input: {
        message: {
          attachments: [{ id: "uploaded-image" }],
          context: {
            records: expect.arrayContaining([
              expect.objectContaining({
                kind: "review-comment",
                contextId: "review-comment_review",
                text: "check this branch",
              }),
              expect.objectContaining({
                kind: "image",
                contextId: "image_local-image",
                attachmentId: "uploaded-image",
              }),
            ]),
          },
        },
      },
    });
    expect(io.release).toHaveBeenCalledWith(message.images);
  });
  it("keeps an uploading message cancellable and never starts a turn after Stop", async () => {
    const message = enqueue();
    message.images.push({
      type: "image",
      id: "local-image",
      name: "test.png",
      mimeType: "image/png",
      sizeBytes: 4,
      previewUrl: "blob:test",
      file: new File(["test"], "test.png", { type: "image/png" }),
    });
    let release!: () => void;
    io.upload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const sending = sendBackgroundQueuedMessage(
      ref,
      message,
      options,
      () => true,
      () => null,
    );
    expect(useQueuedMessageStore.getState().drain(key)).toEqual([message]);
    release();
    expect(await sending).toBe(false);
    expect(startCalls()).toHaveLength(0);
    expect(useQueuedMessageStore.getState().queuesByThreadKey[key]).toBeUndefined();
  });
  it("has only one dispatch winner if two preparations race", async () => {
    const message = enqueue();
    const results = await Promise.all([
      sendBackgroundQueuedMessage(
        ref,
        message,
        options,
        () => true,
        () => null,
      ),
      sendBackgroundQueuedMessage(
        ref,
        message,
        options,
        () => true,
        () => null,
      ),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(startCalls()).toHaveLength(1);
  });
});
