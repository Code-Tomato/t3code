import * as NodeFS from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const nativeEngine = vi.hoisted(() => ({ available: true }));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

// Stand in for the on-device regex engine so engine selection is exercised
// without an iOS or Android runtime.
vi.mock("react-native-shiki-engine", async () => {
  const { createJavaScriptRegexEngine } = await import("@shikijs/engine-javascript");
  return {
    isNativeEngineAvailable: () => nativeEngine.available,
    createNativeEngine: () => createJavaScriptRegexEngine(),
  };
});

import {
  createShikiHighlighter,
  isShikiGrammarLoadable,
  resolveShikiGrammarName,
  resolveShikiHighlighterEnginePreference,
} from "./shikiHighlighter";

function createHighlighter(preferredEngine?: "native" | "javascript") {
  return createShikiHighlighter({
    themes: async () => {
      const { default: theme } = await import("@shikijs/themes/github-dark-default");
      return [theme];
    },
    ...(preferredEngine ? { preferredEngine } : {}),
    createInitializationError: ({ preferredEngine, attemptedEngine, cause }) =>
      new Error(`${preferredEngine}/${attemptedEngine}`, { cause }),
  });
}

function highlightTypescript(highlighter: Awaited<ReturnType<typeof createHighlighter>>) {
  const tokens = highlighter.core.codeToTokensBase("const answer: number = 42;", {
    lang: "typescript",
    theme: "github-dark-default",
  });
  return {
    text: tokens
      .flat()
      .map((token) => token.content)
      .join(""),
    lines: tokens.length,
  };
}

beforeEach(() => {
  nativeEngine.available = true;
});

describe("resolveShikiHighlighterEnginePreference", () => {
  it("defaults unset and invalid values to native", () => {
    expect(resolveShikiHighlighterEnginePreference(undefined)).toBe("native");
    expect(resolveShikiHighlighterEnginePreference("bogus")).toBe("native");
    expect(resolveShikiHighlighterEnginePreference("native")).toBe("native");
  });

  it("accepts javascript overrides", () => {
    expect(resolveShikiHighlighterEnginePreference("javascript")).toBe("javascript");
    expect(resolveShikiHighlighterEnginePreference("js")).toBe("javascript");
  });
});

describe("resolveShikiGrammarName", () => {
  it("folds filetype ids onto grammar names", () => {
    expect(resolveShikiGrammarName("ts")).toBe("typescript");
    expect(resolveShikiGrammarName("TSX")).toBe("tsx");
    expect(resolveShikiGrammarName("zsh")).toBe("bash");
    expect(resolveShikiGrammarName("objc")).toBe("objective-c");
  });

  it("maps filetypes that only have another language's grammar", () => {
    expect(resolveShikiGrammarName("svg")).toBe("xml");
    expect(isShikiGrammarLoadable("svg")).toBe(false);
    expect(isShikiGrammarLoadable("xml")).toBe(true);
  });

  it("leaves plain-language and unknown ids without a grammar", () => {
    expect(resolveShikiGrammarName("plaintext")).toBe("text");
    expect(isShikiGrammarLoadable("text")).toBe(false);
    expect(resolveShikiGrammarName("made-up-language")).toBe("made-up-language");
    expect(isShikiGrammarLoadable("made-up-language")).toBe(false);
  });
});

describe("createShikiHighlighter", () => {
  it("uses the native engine when it is available", async () => {
    const highlighter = await createHighlighter();

    expect(highlighter.engine).toBe("native");
    await expect(highlighter.ensureGrammar("typescript")).resolves.toBe(true);
    expect(highlightTypescript(highlighter)).toEqual({
      text: "const answer: number = 42;",
      lines: 1,
    });
  });

  it("falls back to the javascript engine when the native engine is unavailable", async () => {
    nativeEngine.available = false;

    const highlighter = await createHighlighter();

    expect(highlighter.engine).toBe("javascript");
    await expect(highlighter.ensureGrammar("typescript")).resolves.toBe(true);
    expect(highlightTypescript(highlighter).lines).toBe(1);
  });

  it("registers grammars on demand and reports unknown ones", async () => {
    const highlighter = await createHighlighter("javascript");

    expect(highlighter.loadedGrammars).toEqual(new Set(["text"]));
    await expect(highlighter.ensureGrammar("python")).resolves.toBe(true);
    expect(highlighter.loadedGrammars.has("python")).toBe(true);
    await expect(highlighter.ensureGrammar("made-up-language")).resolves.toBe(false);
  });

  it("loads a grammar once for concurrent requests", async () => {
    const highlighter = await createHighlighter("javascript");

    const results = await Promise.all([
      highlighter.ensureGrammar("typescript"),
      highlighter.ensureGrammar("typescript"),
      highlighter.ensureGrammar("typescript"),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(highlightTypescript(highlighter).lines).toBe(1);
  });
});

// Startup budget guard. Expo builds with `inlineRequires: false` and every screen
// is reachable from App.tsx, so a value import of a grammar (~3KB-200KB each), a
// theme, or the Shiki runtime is evaluated during cold launch. `import type` is
// erased and stays fine.
const staticShikiImport =
  /^import\s+(?!type\b)[^;]*?from\s+["']@shikijs\/(?:langs|themes|core|engine-javascript)/gm;

describe.each([
  "../features/review/shikiReviewHighlighter.ts",
  "../features/diffs/nativeReviewDiffHighlighter.ts",
])("%s", (sourcePath) => {
  it("loads Shiki and its grammars lazily", () => {
    const source = NodeFS.readFileSync(new URL(sourcePath, import.meta.url), "utf8");

    expect(source.match(staticShikiImport) ?? []).toEqual([]);
  });
});
