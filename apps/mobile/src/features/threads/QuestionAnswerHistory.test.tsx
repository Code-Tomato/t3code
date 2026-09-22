import { ApprovalRequestId, EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => import("../../testing/react-native-test-host"));

// The attachment url seam: real `useAssetUrl` resolves asynchronously against
// a live environment, so tests drive resolution from this map instead.
const { assetUrlsByAttachmentId } = vi.hoisted(() => ({
  assetUrlsByAttachmentId: new Map<string, string>(),
}));
vi.mock("../../state/assets", () => ({
  useAssetUrl: (_environmentId: unknown, resource: { attachmentId: string }) =>
    assetUrlsByAttachmentId.get(resource.attachmentId) ?? null,
}));

import { openedUrls } from "../../testing/react-native-test-host";
import { QuestionAnswerHistory } from "./QuestionAnswerHistory";

const environmentId = EnvironmentId.make("environment-local");

const answer = {
  requestId: ApprovalRequestId.make("question-request"),
  answers: { text: "Text-only answer" },
  questionTextById: { file: "Provide a spec", image: "Provide a screenshot" },
  attachmentsByQuestionId: {
    file: [
      {
        type: "file" as const,
        id: "spec",
        name: "spec.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
      },
    ],
    image: [
      {
        type: "image" as const,
        id: "shot",
        name: "shot.png",
        mimeType: "image/png",
        sizeBytes: 4,
      },
    ],
  },
};

function element() {
  return <QuestionAnswerHistory environmentId={environmentId} answer={answer} />;
}

function attachmentRow(root: ReactTestRenderer["root"], name: string) {
  return root.findAll(
    (node) => node.type === "pressable" && node.props.accessibilityLabel === name,
  )[0]!;
}

function visibleText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : visibleText(child)))
    .join(" ");
}

let renderer: ReactTestRenderer;

function createInAct() {
  let created: ReactTestRenderer | undefined;
  act(() => {
    created = create(element());
  });
  return created!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  vi.unstubAllGlobals();
  openedUrls.length = 0;
  assetUrlsByAttachmentId.clear();
});

describe("QuestionAnswerHistory", () => {
  it("renders each question once even when its id appears in answers, questions, and attachments", () => {
    renderer = createInAct();
    const rows = renderer.root.findAll((node) => node.type === "pressable");
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual(["spec.txt", "shot.png"]);

    const text = visibleText(renderer.root);
    expect(text.match(/Provide a spec/g)).toHaveLength(1);
    expect(text.match(/Provide a screenshot/g)).toHaveLength(1);
    expect(text).toContain("Text-only answer");
  });

  it("opens the resolved attachment url when the row is pressed", () => {
    assetUrlsByAttachmentId.set("spec", "t3://attachment/spec");
    renderer = createInAct();
    act(() => attachmentRow(renderer.root, "spec.txt").props.onPress());
    expect(openedUrls).toEqual(["t3://attachment/spec"]);
  });

  it("ignores presses while the attachment url is unresolved", () => {
    renderer = createInAct();
    const row = attachmentRow(renderer.root, "spec.txt");
    expect(row.props.disabled).toBe(true);
    act(() => row.props.onPress?.());
    expect(openedUrls).toEqual([]);
  });

  it("gains the image preview and an active press once the url resolves", () => {
    renderer = createInAct();
    expect(renderer.root.findAllByType("image")).toHaveLength(0);
    act(() => attachmentRow(renderer.root, "shot.png").props.onPress?.());
    expect(openedUrls).toEqual([]);

    assetUrlsByAttachmentId.set("shot", "t3://attachment/shot");
    act(() => renderer.update(element()));

    const preview = renderer.root.findAllByType("image");
    expect(preview).toHaveLength(1);
    expect(preview[0]!.props.source).toEqual({ uri: "t3://attachment/shot" });
    act(() => attachmentRow(renderer.root, "shot.png").props.onPress());
    expect(openedUrls).toEqual(["t3://attachment/shot"]);
  });
});
