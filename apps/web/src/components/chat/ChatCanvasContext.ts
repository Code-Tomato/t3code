import { createContext, useContext } from "react";
import type { ChatCanvasPreview, resolveChatCanvasLayout } from "./chatCanvasLayout";

export const ChatCanvasContext = createContext<{
  container: { width: number; height: number };
  layout: ReturnType<typeof resolveChatCanvasLayout>;
  previewKey: string | null;
  reportPreview: (preview: ChatCanvasPreview) => void;
  clearPreview: (key: string) => void;
  registerTimeline: (element: HTMLElement | null) => void;
} | null>(null);

export const useChatCanvas = () => useContext(ChatCanvasContext);
