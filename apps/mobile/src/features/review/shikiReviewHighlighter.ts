import { getFiletypeFromFileName } from "@pierre/diffs/utils/getFiletypeFromFileName";
import * as Schema from "effect/Schema";

import {
  createShikiHighlighter,
  isShikiGrammarLoadable,
  resolveShikiGrammarName,
  resolveShikiHighlighterEnginePreference,
  type ShikiHighlighterHandle,
} from "../../lib/shikiHighlighter";
import { createIncrementalSnippet } from "./incrementalSnippet";
import type { ReviewRenderableLineRow } from "./reviewModel";
import { applyDiffRangesToTokens, computeWordAltDiffRanges } from "./reviewWordDiffs";

export type ReviewDiffTheme = "light" | "dark";

export class ReviewHighlighterEngineInitializationError extends Schema.TaggedError<ReviewHighlighterEngineInitializationError>()(
  "ReviewHighlighterEngineInitializationError",
  {
    preferredEngine: Schema.Literals(["native", "javascript"]),
    attemptedEngine: Schema.Literals(["native", "javascript"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to initialize the ${this.attemptedEngine} review highlighter with ${this.preferredEngine} preferred.`;
  }
}

export interface ReviewHighlightedToken {
  content: string;
  readonly color: string | null;
  readonly fontStyle: number | null;
  readonly diffHighlight?: boolean;
}

const SHIKI_THEME_NAME_BY_SCHEME = {
  light: "github-light-default",
  dark: "github-dark-default",
} as const;
const REVIEW_HIGHLIGHTER_ENGINE_ENV_VALUE =
  process.env.EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE ??
  (process.env.NODE_ENV === "test" ? "javascript" : "native");
const REVIEW_HIGHLIGHTER_ENGINE_PREFERENCE = resolveShikiHighlighterEnginePreference(
  REVIEW_HIGHLIGHTER_ENGINE_ENV_VALUE,
);
const REVIEW_HIGHLIGHT_CHUNK_LINE_THRESHOLD = 8;
const REVIEW_HIGHLIGHT_CHUNK_SIZE = 200;
const REVIEW_TOKENIZE_MAX_LINE_LENGTH = 1_000;

let highlighterPromise: Promise<ShikiHighlighterHandle> | null = null;
let highlighterHandle: ShikiHighlighterHandle | null = null;

function isReviewHighlighterDebugLoggingEnabled(): boolean {
  return typeof __DEV__ !== "undefined" ? __DEV__ : false;
}

function logReviewHighlighterDiagnostic(message: string, details?: Record<string, unknown>): void {
  if (!isReviewHighlighterDebugLoggingEnabled()) {
    return;
  }

  if (details) {
    console.log(`[review-highlighter] ${message}`, details);
    return;
  }

  console.log(`[review-highlighter] ${message}`);
}

function stripTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function joinPatchLines(lines: ReadonlyArray<string>): string {
  return lines.map(stripTrailingNewline).join("\n");
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Themes are only needed once a highlight is actually requested. */
function loadReviewThemes() {
  return Promise.all([
    import("@shikijs/themes/github-light-default").then((theme) => theme.default),
    import("@shikijs/themes/github-dark-default").then((theme) => theme.default),
  ]);
}

function getHighlighter(): Promise<ShikiHighlighterHandle> {
  if (!highlighterPromise) {
    highlighterPromise = createShikiHighlighter({
      themes: loadReviewThemes,
      preferredEngine: REVIEW_HIGHLIGHTER_ENGINE_PREFERENCE,
      createInitializationError: ({ preferredEngine, attemptedEngine, cause }) =>
        new ReviewHighlighterEngineInitializationError({
          preferredEngine,
          attemptedEngine,
          cause,
        }),
      debugLog: logReviewHighlighterDiagnostic,
    }).then(
      (handle) => {
        highlighterHandle = handle;
        return handle;
      },
      (error) => {
        highlighterPromise = null;
        throw error;
      },
    );
  }

  return highlighterPromise;
}

/**
 * Grammar name for a path, or `text` when nothing can highlight it. Loading the
 * grammar is the caller's job; `text` needs none.
 */
function resolveGrammarNameFromPath(path: string, languageHint: string | null): string {
  const filetype = languageHint ?? getFiletypeFromFileName(path);
  if (!filetype) {
    return "text";
  }

  const grammarName = resolveShikiGrammarName(filetype);
  return isShikiGrammarLoadable(grammarName) ? grammarName : "text";
}

/**
 * Grammar that is already registered, or `null` when resolving the language
 * would have to await the highlighter, and `text` when nothing can highlight it.
 */
function resolveLoadedLanguageFromPath(
  path: string,
  languageHint: string | null = null,
): string | null {
  const grammarName = resolveGrammarNameFromPath(path, languageHint);
  if (grammarName === "text") {
    return "text";
  }

  return highlighterHandle?.loadedGrammars.has(grammarName) ? grammarName : null;
}

async function resolveLanguageFromPath(
  path: string,
  languageHint: string | null = null,
): Promise<string> {
  const grammarName = resolveGrammarNameFromPath(path, languageHint);
  if (grammarName === "text") {
    return "text";
  }

  const highlighter = await getHighlighter();
  return (await highlighter.ensureGrammar(grammarName)) ? grammarName : "text";
}

type RawHighlightedLine = ReadonlyArray<{ content: string; color?: string; fontStyle?: number }>;
const normalizedLines = new WeakMap<RawHighlightedLine, ReadonlyArray<ReviewHighlightedToken>>();

function normalizeHighlightedLines(
  tokenLines: ReadonlyArray<RawHighlightedLine>,
): ReadonlyArray<ReadonlyArray<ReviewHighlightedToken>> {
  return tokenLines.map((line) => {
    const cached = normalizedLines.get(line);
    if (cached) return cached;
    const normalized = line.map((token) => ({
      content: token.content,
      color: token.color ?? null,
      fontStyle: token.fontStyle ?? null,
    }));
    normalizedLines.set(line, normalized);
    return normalized;
  });
}

function applyWordAltDiffHighlightsToSelectedLines(input: {
  readonly lines: ReadonlyArray<ReviewRenderableLineRow>;
  readonly tokenMap: Record<string, ReadonlyArray<ReviewHighlightedToken>>;
}): Record<string, ReadonlyArray<ReviewHighlightedToken>> {
  const additionLineByTokenIndex = new Map<number, ReviewRenderableLineRow>();
  const deletionLineByTokenIndex = new Map<number, ReviewRenderableLineRow>();

  input.lines.forEach((line) => {
    if (line.change === "add" && line.additionTokenIndex !== null) {
      additionLineByTokenIndex.set(line.additionTokenIndex, line);
    }
    if (line.change === "delete" && line.deletionTokenIndex !== null) {
      deletionLineByTokenIndex.set(line.deletionTokenIndex, line);
    }
  });

  const nextTokenMap = { ...input.tokenMap };
  const processedPairs = new Set<string>();

  input.lines.forEach((line) => {
    if (line.change === "context" || !line.comparison) {
      return;
    }

    const pairedDeletionLine =
      line.change === "delete"
        ? line
        : line.comparison.change === "delete"
          ? deletionLineByTokenIndex.get(line.comparison.tokenIndex)
          : undefined;
    const pairedAdditionLine =
      line.change === "add"
        ? line
        : line.comparison.change === "add"
          ? additionLineByTokenIndex.get(line.comparison.tokenIndex)
          : undefined;

    if (
      !pairedDeletionLine ||
      !pairedAdditionLine ||
      pairedDeletionLine.deletionTokenIndex === null ||
      pairedAdditionLine.additionTokenIndex === null
    ) {
      return;
    }

    const pairKey = `${pairedDeletionLine.deletionTokenIndex}:${pairedAdditionLine.additionTokenIndex}`;
    if (processedPairs.has(pairKey)) {
      return;
    }
    processedPairs.add(pairKey);

    const ranges = computeWordAltDiffRanges({
      deletionLine: pairedDeletionLine.content,
      additionLine: pairedAdditionLine.content,
    });

    if (ranges.deletion.length > 0) {
      nextTokenMap[pairedDeletionLine.id] = applyDiffRangesToTokens(
        nextTokenMap[pairedDeletionLine.id] ?? [],
        ranges.deletion,
      );
    }
    if (ranges.addition.length > 0) {
      nextTokenMap[pairedAdditionLine.id] = applyDiffRangesToTokens(
        nextTokenMap[pairedAdditionLine.id] ?? [],
        ranges.addition,
      );
    }
  });

  return nextTokenMap;
}

async function highlightLines(
  code: string,
  language: string,
  theme: string,
): Promise<ReadonlyArray<ReadonlyArray<ReviewHighlightedToken>>> {
  if (code.length === 0) {
    return [];
  }

  const highlighter = await getHighlighter();
  const sourceLines = code.split("\n");
  const highlightedLines: Array<ReadonlyArray<ReviewHighlightedToken>> = [];
  const shortLineBatch: string[] = [];

  const flushShortLineBatch = async (): Promise<void> => {
    if (shortLineBatch.length === 0) {
      return;
    }

    const tokenLines = highlighter.core.codeToTokensBase(shortLineBatch.join("\n"), {
      lang: language,
      theme,
    });
    highlightedLines.push(...normalizeHighlightedLines(tokenLines));
    shortLineBatch.length = 0;
  };

  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = sourceLines[lineIndex] ?? "";

    if (line.length > REVIEW_TOKENIZE_MAX_LINE_LENGTH) {
      await flushShortLineBatch();
      highlightedLines.push([{ content: line, color: null, fontStyle: null }]);
    } else {
      shortLineBatch.push(line);
    }

    if (shortLineBatch.length >= REVIEW_HIGHLIGHT_CHUNK_SIZE) {
      await flushShortLineBatch();
    }

    if (
      sourceLines.length > REVIEW_HIGHLIGHT_CHUNK_LINE_THRESHOLD &&
      lineIndex + 1 < sourceLines.length &&
      (shortLineBatch.length === 0 || line.length > REVIEW_TOKENIZE_MAX_LINE_LENGTH)
    ) {
      await waitForNextFrame();
    }
  }

  await flushShortLineBatch();

  return highlightedLines;
}

const snippetSessions = new WeakMap<
  object,
  { language: string; theme: string; highlight: ReturnType<typeof createIncrementalSnippet> }
>();

export async function highlightCodeSnippet(input: {
  readonly session?: object;
  readonly code: string;
  readonly language?: string | null;
  readonly theme: ReviewDiffTheme;
}): Promise<ReadonlyArray<ReadonlyArray<ReviewHighlightedToken>>> {
  const languageHint = input.language?.trim() || "text";
  const language = await resolveLanguageFromPath(`snippet.${languageHint}`, languageHint);
  const theme = SHIKI_THEME_NAME_BY_SCHEME[input.theme];
  // Bound retained text and preserve the existing plain-text/long-line fallback.
  if (
    !input.session ||
    language === "text" ||
    input.code.length === 0 ||
    input.code.length > 100_000 ||
    input.code.includes("\r") ||
    input.code.split("\n").some((line) => line.length > REVIEW_TOKENIZE_MAX_LINE_LENGTH)
  ) {
    if (input.session) snippetSessions.delete(input.session);
    return highlightLines(input.code, language, theme);
  }
  const highlighter = await getHighlighter();
  let session = snippetSessions.get(input.session);
  if (!session || session.language !== language || session.theme !== theme) {
    session = {
      language,
      theme,
      highlight: createIncrementalSnippet(highlighter.core, language, theme),
    };
    snippetSessions.set(input.session, session);
  }
  return normalizeHighlightedLines(await session.highlight(input.code));
}

highlightCodeSnippet.read = (input: Parameters<typeof highlightCodeSnippet>[0]) => {
  if (!input.session || !input.code || input.code.length > 100_000 || input.code.includes("\r"))
    return undefined;
  const session = snippetSessions.get(input.session);
  const hint = input.language?.trim() || "text";
  const language = resolveLoadedLanguageFromPath(`snippet.${hint}`, hint);
  if (
    !session ||
    session.language !== language ||
    session.theme !== SHIKI_THEME_NAME_BY_SCHEME[input.theme] ||
    input.code.split("\n").some((line) => line.length > REVIEW_TOKENIZE_MAX_LINE_LENGTH)
  )
    return undefined;
  const tokens = session.highlight.read(input.code);
  return tokens ? normalizeHighlightedLines(tokens) : undefined;
};

export async function highlightSourceFile(input: {
  readonly path: string;
  readonly contents: string;
  readonly theme: ReviewDiffTheme;
}): Promise<ReadonlyArray<ReadonlyArray<ReviewHighlightedToken>>> {
  const language = await resolveLanguageFromPath(input.path);
  return highlightLines(input.contents, language, SHIKI_THEME_NAME_BY_SCHEME[input.theme]);
}

export async function highlightReviewSelectedLines(input: {
  readonly filePath: string;
  readonly lines: ReadonlyArray<ReviewRenderableLineRow>;
  readonly theme: ReviewDiffTheme;
  readonly languageHint?: string | null;
}): Promise<Record<string, ReadonlyArray<ReviewHighlightedToken>>> {
  if (input.lines.length === 0) {
    return {};
  }

  const loadedLanguage = resolveLoadedLanguageFromPath(input.filePath, input.languageHint ?? null);
  const language =
    loadedLanguage ?? (await resolveLanguageFromPath(input.filePath, input.languageHint ?? null));
  const shikiTheme = SHIKI_THEME_NAME_BY_SCHEME[input.theme];
  const additionLikeLines: string[] = [];
  const deletionLines: string[] = [];
  for (const line of input.lines) {
    if (line.change === "delete") {
      deletionLines.push(`${line.content}\n`);
    } else {
      additionLikeLines.push(`${line.content}\n`);
    }
  }
  const [additionTokens, deletionTokens] = await Promise.all([
    highlightLines(joinPatchLines(additionLikeLines), language, shikiTheme),
    highlightLines(joinPatchLines(deletionLines), language, shikiTheme),
  ]);

  const tokenMap: Record<string, ReadonlyArray<ReviewHighlightedToken>> = {};
  let additionIndex = 0;
  let deletionIndex = 0;

  input.lines.forEach((line) => {
    if (line.change === "delete") {
      tokenMap[line.id] = deletionTokens[deletionIndex] ?? [];
      deletionIndex += 1;
      return;
    }

    tokenMap[line.id] = additionTokens[additionIndex] ?? [];
    additionIndex += 1;
  });

  return applyWordAltDiffHighlightsToSelectedLines({
    lines: input.lines,
    tokenMap,
  });
}
