import { describe, expect, it } from "vite-plus/test";
import { resolveChatCanvasLayout, type ChatCanvasPreview } from "./chatCanvasLayout";

const preview: ChatCanvasPreview = {
  key: "browser:one",
  width: 320,
  position: null,
  source: { width: 1600, height: 1000 },
};
const resolve = (width: number, player: ChatCanvasPreview | null = preview, height = 900) =>
  resolveChatCanvasLayout({ container: { width, height }, preview: player, composerHeight: 180 });
const expectClear = (result: ReturnType<typeof resolve>) => {
  const frame = result.frame!;
  const chat = result.chat;
  expect(frame.x + frame.width <= chat.left - 12 || frame.x >= chat.left + chat.width + 12).toBe(
    true,
  );
};

describe("chat canvas layout", () => {
  it("centers chat in the whole container without a preview", () => {
    expect(resolve(1344, null).chat).toEqual({ left: 288, width: 768, insetStart: 0, insetEnd: 0 });
    expect(resolve(390, null).chat).toEqual({ left: 20, width: 350, insetStart: 0, insetEnd: 0 });
  });
  it("does not move chat when a bottom-right preview fits in its margin", () => {
    const result = resolve(1600);
    expect(result.chat.insetEnd).toBe(0);
    expect(result.frame!.y + result.frame!.height).toBe(888);
    expectClear(result);
  });
  it("moves chat only as far as the preview requires", () => {
    const result = resolve(1344);
    expect(result.chat).toEqual({ left: 232, width: 768, insetStart: 0, insetEnd: 112 });
    expectClear(result);
  });
  it("shrinks chat modestly after using the left margin", () => {
    const result = resolve(1200, { ...preview, width: 480 });
    expect(result.chat.width).toBe(676);
    expect(result.chat.left).toBe(20);
    expectClear(result);
  });
  it("stops leftward dragging before the player can push chat to the right", () => {
    const centered = resolve(1344, null).chat;
    for (const x of [1100, 800, 672, 600, 400, 12, -100]) {
      const result = resolve(1344, { ...preview, position: { x, y: 500 } });
      expect(result.frame!.x).toBeGreaterThanOrEqual(672);
      expect(result.chat.left).toBeLessThanOrEqual(centered.left);
      expect(result.chat.insetStart).toBe(0);
      expect(result.chat.width).toBeGreaterThanOrEqual(640);
      expectClear(result);
    }
    expect(resolve(1344, { ...preview, position: { x: 12, y: 500 } }).frame!.x).toBe(672);
  });
  it("keeps a dragged player above the composer when no readable lane fits beside it", () => {
    const result = resolve(1000, { ...preview, position: { x: 12, y: 700 } });
    expect(result.chat).toEqual(resolve(1000, null).chat);
    expect(result.frame!.x).toBe(668);
    expect(result.frame!.y + result.frame!.height).toBeLessThanOrEqual(708);
  });
  it("allows message overlap on narrow screens while excluding the composer", () => {
    const result = resolve(1000);
    expect(result.overlapsChat).toBe(true);
    expect(result.chat.insetStart).toBe(0);
    expect(result.chat.insetEnd).toBe(0);
    expect(result.frame!.y + result.frame!.height).toBeLessThanOrEqual(900 - 180 - 12);
    expect(result.frame!.width / result.frame!.height).toBeCloseTo(1.6);
  });
  it("restores the preferred width when the container grows again", () => {
    const player = { ...preview, width: 480 };
    expect(resolve(1200, player).chat.width).toBeLessThan(768);
    expect(resolve(1800, player).chat.width).toBe(768);
    expect(player.width).toBe(480);
  });
  it("uses the same stable side-by-side frame even as the composer grows", () => {
    const result = resolve(1344);
    expect(
      resolveChatCanvasLayout({
        container: { width: 1344, height: 900 },
        preview,
        composerHeight: 400,
      }),
    ).toEqual(result);
  });
});
