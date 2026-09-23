import {
  clampPreviewMiniPlayerPosition,
  resolvePreviewMiniPlayerFrame,
  type PreviewMiniPlayerFrame,
} from "../preview/previewMiniPlayerLayout";
import type {
  PreviewMiniPlayerPosition,
  PreviewMiniPlayerSize,
  PreviewMiniPlayerState,
} from "~/previewMiniPlayerStore";

export interface ChatCanvasPreview {
  readonly key: string;
  readonly width: number | null;
  readonly position: PreviewMiniPlayerPosition | null;
  readonly source: PreviewMiniPlayerSize;
  readonly lastInteraction?: PreviewMiniPlayerState["lastInteraction"];
}

const GAP = 12;

/** Pure geometry shared by the conversation, composer, and floating preview. */
export function resolveChatCanvasLayout({
  container,
  preview,
  padding = 20,
  maxChatWidth = 768,
  minChatWidth = 640,
  composerHeight = 0,
}: {
  container: PreviewMiniPlayerSize;
  preview: ChatCanvasPreview | null;
  padding?: number;
  maxChatWidth?: number;
  minChatWidth?: number;
  composerHeight?: number;
}) {
  const normalWidth = Math.max(0, Math.min(maxChatWidth, container.width - padding * 2));
  const normalLeft = (container.width - normalWidth) / 2;
  let chat = { left: normalLeft, width: normalWidth, insetStart: 0, insetEnd: 0 };
  let frame: PreviewMiniPlayerFrame | null = null;
  let overlapsChat = false;
  if (preview && container.width > 0 && container.height > 0) {
    frame = resolvePreviewMiniPlayerFrame({ ...preview, container });
    // Dragging stops at a readable chat lane on the left. Resizing can still
    // consume that space when the container requires message overlap.
    const minimumPreviewX =
      preview.lastInteraction === "resize" ? GAP : padding + minChatWidth + GAP;
    // New players start beside the composer, with the workspace card above them.
    if (preview.position === null) frame = { ...frame, y: container.height - frame.height - GAP };
    frame = {
      ...frame,
      ...clampPreviewMiniPlayerPosition(frame, container, frame, undefined, minimumPreviewX),
    };
    const normalRight = normalLeft + normalWidth;
    if (frame.x < normalRight + GAP) {
      const width = Math.min(maxChatWidth, frame.x - GAP - padding);
      if (width >= minChatWidth) {
        const left = Math.min(normalLeft, frame.x - GAP - width);
        chat = {
          left,
          width,
          insetStart: 0,
          insetEnd: Math.max(0, container.width - left * 2 - width),
        };
      } else overlapsChat = true;
    }
    if (overlapsChat) {
      const obstacles = {
        composer: { left: chat.left, right: chat.left + chat.width, height: composerHeight },
      };
      frame = resolvePreviewMiniPlayerFrame({ ...preview, container, obstacles });
      frame = {
        ...frame,
        ...clampPreviewMiniPlayerPosition(
          preview.position ?? { x: frame.x, y: container.height - frame.height - GAP },
          container,
          frame,
          obstacles,
          minimumPreviewX,
        ),
      };
    }
  }
  return { chat, frame, overlapsChat };
}
