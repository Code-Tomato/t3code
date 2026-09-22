import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { applyClaudePromptEffortPrefix } from "@t3tools/shared/model";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { readThreadShell } from "../state/entities";
import {
  useQueuedMessageStore,
  type QueuedComposerMessage,
  type QueuedMessageSendOptions,
} from "../queuedMessageStore";
import {
  deriveComposerSendState,
  getAntigravitySendBlockReason,
  readFileAsDataUrl,
} from "../components/ChatView.logic";
import { getComposerSubmissionValidationMessage } from "../components/chat/composerSubmission";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "../components/chat/composerPromptHistory";
import { fileAttachmentCapabilityBlockReason } from "../components/chat/composerAttachmentFiles";
import { toastManager } from "../components/ui/toast";
import { buildMessageContext, terminalContextReference } from "./composerContextRecords";
import { removeInlineContextReference } from "./composerContextReferences";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseDraftAttachments,
  startAttachmentUpload,
} from "./attachmentUploadQueue";
import { newMessageId } from "./utils";

/** Uploads stay cancellable. Taking the intent commits it before persistent thread updates. */
export async function sendBackgroundQueuedMessage(
  ref: ScopedThreadRef,
  message: QueuedComposerMessage,
  options: QueuedMessageSendOptions,
  canSend: () => boolean,
  latestToolActivityId: () => string | null,
): Promise<boolean> {
  const key = scopedThreadKey(ref);
  const stillQueued = () =>
    useQueuedMessageStore
      .getState()
      .queuesByThreadKey[key]?.some((entry) => entry.id === message.id) === true;
  const readConfig = () => appAtomRegistry.get(environmentServerConfigsAtom).get(ref.environmentId);
  const readyToSend = () => {
    const state = useQueuedMessageStore.getState();
    const head = state.queuesByThreadKey[key]?.[0];
    const ownsIntent = taken
      ? state.backgroundSendsByThreadKey[key]?.cancelled === false
      : head?.id === message.id;
    const provider = readConfig()?.providers.find(
      (entry) => entry.instanceId === options.modelSelection.instanceId,
    );
    const blockReason = getAntigravitySendBlockReason(provider, options.modelSelection.model);
    if (blockReason) throw new Error(blockReason);
    return (
      canSend() &&
      ownsIntent &&
      !(head?.id === message.id && head.holdUntilUserAction) &&
      provider?.enabled === true &&
      provider.installed &&
      provider.availability !== "unavailable" &&
      provider.status === "ready"
    );
  };
  const attachments = [...message.images, ...message.files];
  let taken = false;
  try {
    const config = readConfig();
    const provider = config?.providers.find(
      (entry) => entry.instanceId === options.modelSelection?.instanceId,
    );
    if (
      !canSend() ||
      !stillQueued() ||
      !config ||
      !provider?.enabled ||
      !provider.installed ||
      provider.availability === "unavailable" ||
      provider.status !== "ready"
    )
      return false;
    const providerBlockReason = getAntigravitySendBlockReason(
      provider,
      options.modelSelection?.model ?? "",
    );
    if (providerBlockReason) throw new Error(providerBlockReason);
    const { sendableTerminalContexts, hasSendableContent } = deriveComposerSendState({
      prompt: message.prompt,
      imageCount: attachments.length,
      terminalContexts: message.terminalContexts,
      elementContextCount: message.previewAnnotations.length + message.reviewComments.length,
    });
    if (!hasSendableContent) {
      useQueuedMessageStore.getState().remove(key, message.id);
      return false;
    }
    const prompt = message.terminalContexts
      .filter((context) => !sendableTerminalContexts.includes(context))
      .reduce(
        (text, context) =>
          removeInlineContextReference(text, terminalContextReference(context).contextId).prompt,
        message.prompt,
      )
      .trim();
    const text = applyClaudePromptEffortPrefix(
      prompt || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
      options.promptEffort,
    );
    const validation = getComposerSubmissionValidationMessage({
      prompt: message.prompt,
      providerInput: text,
      submissionTarget: "provider-turn",
    });
    if (validation) throw new Error(validation);
    const checkFiles = () => {
      const current = readConfig();
      const reason = fileAttachmentCapabilityBlockReason({
        files: message.files,
        attachmentUploadsCapabilityKnown: current !== undefined,
        supportsAttachmentUploads: current?.environment.capabilities.attachmentUploads === true,
        maxFileAttachmentBytes:
          current?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
      });
      if (reason) throw new Error(reason);
    };
    checkFiles();
    const upload = config.environment.capabilities.attachmentUploads === true;
    if (upload && attachments.length > 0) {
      for (const attachment of attachments)
        startAttachmentUpload({
          environmentId: ref.environmentId,
          image: attachment,
          draftTarget: ref,
        });
      await awaitAttachmentUploads(attachments.map((attachment) => attachment.id));
    }
    const wireAttachments = await Promise.all(
      attachments.map(async (attachment) => {
        if (upload) {
          const uploaded = getUploadedAttachments({
            environmentId: ref.environmentId,
            images: [attachment],
          })?.[0];
          if (!uploaded) throw new Error("Retry or remove failed uploads before sending.");
          return uploaded;
        }
        if (attachment.type !== "image")
          throw new Error("This server does not support file attachments.");
        return {
          type: "image" as const,
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          dataUrl: await readFileAsDataUrl(attachment.file),
          ...(attachment.source ? { source: attachment.source } : {}),
        };
      }),
    );
    checkFiles();
    if (!readyToSend()) return false;
    const shell = readThreadShell(ref);
    if (!shell) return false;
    // Claim before mutating settings. A queued Cancel can only win before this
    // point; Stop can still cancel the owned send through its in-flight marker.
    if (!useQueuedMessageStore.getState().take(key, message.id, latestToolActivityId(), true))
      return false;
    taken = true;
    const stopIfBlocked = () => {
      if (readyToSend()) return false;
      useQueuedMessageStore.getState().holdAtFront(key, message);
      return true;
    };
    const createdAt = new Date().toISOString();
    if (options.modelSelection) {
      const result = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.updateMetadata,
        {
          environmentId: ref.environmentId,
          input: { threadId: ref.threadId, modelSelection: options.modelSelection },
        },
        { reportFailure: false },
      );
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    }
    if (stopIfBlocked()) return false;
    if (options.runtimeMode && options.runtimeMode !== shell.runtimeMode) {
      const result = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.setRuntimeMode,
        {
          environmentId: ref.environmentId,
          input: { threadId: ref.threadId, runtimeMode: options.runtimeMode, createdAt },
        },
        { reportFailure: false },
      );
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    }
    if (stopIfBlocked()) return false;
    if (options.interactionMode && options.interactionMode !== shell.interactionMode) {
      const result = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.setInteractionMode,
        {
          environmentId: ref.environmentId,
          input: { threadId: ref.threadId, interactionMode: options.interactionMode, createdAt },
        },
        { reportFailure: false },
      );
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    }
    checkFiles();
    if (stopIfBlocked()) return false;
    const context = buildMessageContext({
      terminalContexts: sendableTerminalContexts,
      previewAnnotations: message.previewAnnotations,
      reviewComments: message.reviewComments,
      attachments: attachments.map((attachment, index) => ({
        attachment,
        attachmentId: wireAttachments[index]?.id ?? attachment.id,
      })),
    });
    const inlineContext = readConfig()?.environment.capabilities.inlineMessageContext === true;
    const result = await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.startTurn,
      {
        environmentId: ref.environmentId,
        input: {
          threadId: ref.threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text:
              context && !inlineContext
                ? serializeLegacyContextMessage({ text, records: context.records })
                : text,
            attachments: wireAttachments,
            ...(context && inlineContext ? { context } : {}),
          },
          modelSelection: options.modelSelection,
          runtimeMode: options.runtimeMode,
          interactionMode: options.interactionMode,
          createdAt,
        },
      },
      { reportFailure: false },
    );
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    if (upload) releaseDraftAttachments(attachments);
    return true;
  } catch (error) {
    // A cancelled preparation must not resurrect a message the user removed.
    if (taken || stillQueued()) {
      useQueuedMessageStore.getState().holdAtFront(key, message);
      toastManager.add({
        type: "error",
        title: "Queued message not sent",
        description:
          error instanceof Error ? error.message : "Open the thread to retry the queued message.",
      });
    }
    return false;
  } finally {
    if (taken) useQueuedMessageStore.getState().finishBackgroundSend(key);
  }
}
