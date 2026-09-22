import type { HighlighterCore, LanguageRegistration, ThemeInput } from "@shikijs/core";

/**
 * Shared Shiki bootstrap for the mobile client.
 *
 * Thread markdown, source files and native review diffs all need a highlighter,
 * so engine selection and grammar loading live here once.
 *
 * Everything heavy is imported lazily on purpose. A grammar module is 3KB-200KB
 * of TextMate JSON, Expo builds with `inlineRequires: false`, and every screen
 * is statically reachable from `App.tsx`, so a static grammar import would be
 * evaluated during app startup for a screen the user may never open. The
 * highlighter itself is created on first highlight instead.
 */

export type ShikiHighlighterEngine = "native" | "javascript";

/** Parse an engine override (`js`/`javascript`/`native`); anything else keeps the native default. */
export function resolveShikiHighlighterEnginePreference(
  value: string | undefined,
): ShikiHighlighterEngine {
  switch (value) {
    case "js":
    case "javascript":
      return "javascript";
    case "native":
      return "native";
    default:
      return "native";
  }
}

export interface ShikiHighlighterInitializationFailure {
  readonly preferredEngine: ShikiHighlighterEngine;
  readonly attemptedEngine: ShikiHighlighterEngine;
  readonly cause: unknown;
}

export interface ShikiHighlighterHandle {
  readonly engine: ShikiHighlighterEngine;
  readonly core: HighlighterCore;
  /** Grammar names registered on this core, for callers that must decide synchronously. */
  readonly loadedGrammars: ReadonlySet<string>;
  /** Register a grammar on this core. Resolves false when the grammar is unknown or failed to load. */
  readonly ensureGrammar: (grammarName: string) => Promise<boolean>;
}

type GrammarModule = { default: LanguageRegistration | LanguageRegistration[] };

/**
 * Grammar name to grammar module. Keyed by the name Shiki registers, so a
 * language id that only exists as an alias (`svg`) never reaches this map.
 */
const grammarLoaders: Record<string, () => Promise<GrammarModule>> = {
  astro: () => import("@shikijs/langs/astro"),
  bash: () => import("@shikijs/langs/bash"),
  c: () => import("@shikijs/langs/c"),
  clojure: () => import("@shikijs/langs/clojure"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  cmake: () => import("@shikijs/langs/cmake"),
  dart: () => import("@shikijs/langs/dart"),
  diff: () => import("@shikijs/langs/diff"),
  docker: () => import("@shikijs/langs/docker"),
  elixir: () => import("@shikijs/langs/elixir"),
  erlang: () => import("@shikijs/langs/erlang"),
  fish: () => import("@shikijs/langs/fish"),
  fsharp: () => import("@shikijs/langs/fsharp"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  groovy: () => import("@shikijs/langs/groovy"),
  haskell: () => import("@shikijs/langs/haskell"),
  hcl: () => import("@shikijs/langs/hcl"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  less: () => import("@shikijs/langs/less"),
  lua: () => import("@shikijs/langs/lua"),
  makefile: () => import("@shikijs/langs/makefile"),
  markdown: () => import("@shikijs/langs/markdown"),
  mdx: () => import("@shikijs/langs/mdx"),
  nim: () => import("@shikijs/langs/nim"),
  nix: () => import("@shikijs/langs/nix"),
  "objective-c": () => import("@shikijs/langs/objective-c"),
  ocaml: () => import("@shikijs/langs/ocaml"),
  perl: () => import("@shikijs/langs/perl"),
  php: () => import("@shikijs/langs/php"),
  powershell: () => import("@shikijs/langs/powershell"),
  prisma: () => import("@shikijs/langs/prisma"),
  python: () => import("@shikijs/langs/python"),
  r: () => import("@shikijs/langs/r"),
  regex: () => import("@shikijs/langs/regex"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scala: () => import("@shikijs/langs/scala"),
  scss: () => import("@shikijs/langs/scss"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  svelte: () => import("@shikijs/langs/svelte"),
  swift: () => import("@shikijs/langs/swift"),
  tex: () => import("@shikijs/langs/tex"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  viml: () => import("@shikijs/langs/viml"),
  vue: () => import("@shikijs/langs/vue"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
  zig: () => import("@shikijs/langs/zig"),
};

/** Filetype ids that have no grammar module of their own. */
const grammarAliases: Record<string, string> = {
  "c++": "cpp",
  "c#": "csharp",
  "obj-c": "objective-c",
  objc: "objective-c",
  objectivec: "objective-c",
  clj: "clojure",
  cjs: "javascript",
  cs: "csharp",
  dockerfile: "docker",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  fs: "fsharp",
  hs: "haskell",
  js: "javascript",
  make: "makefile",
  md: "markdown",
  mjs: "javascript",
  ml: "ocaml",
  mts: "typescript",
  cts: "typescript",
  plain: "text",
  plaintext: "text",
  ps1: "powershell",
  pwsh: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "shellscript",
  svg: "xml",
  tf: "hcl",
  ts: "typescript",
  txt: "text",
  vim: "viml",
  yml: "yaml",
  zsh: "bash",
};

/** Map a filetype id, extension or alias onto a Shiki grammar name. */
export function resolveShikiGrammarName(languageOrFiletype: string): string {
  const normalized = languageOrFiletype.trim().toLowerCase();
  return grammarAliases[normalized] ?? normalized;
}

export function isShikiGrammarLoadable(grammarName: string): boolean {
  return grammarName in grammarLoaders;
}

export interface CreateShikiHighlighterInput {
  /** Deferred so theme modules stay out of the startup graph as well. */
  readonly themes: () => Promise<readonly ThemeInput[]>;
  /** Engine to try first. Falls back to the JavaScript regex engine. */
  readonly preferredEngine?: ShikiHighlighterEngine;
  readonly createInitializationError: (failure: ShikiHighlighterInitializationFailure) => Error;
  readonly onNativeEngineUnavailable?: (error: unknown) => void;
  readonly debugLog?: (message: string, details?: Record<string, unknown>) => void;
}

export function createShikiHighlighter(
  input: CreateShikiHighlighterInput,
): Promise<ShikiHighlighterHandle> {
  return createHighlighter(input);
}

function createHandle(
  core: HighlighterCore,
  engine: ShikiHighlighterEngine,
): ShikiHighlighterHandle {
  // `text` is Shiki's plain-language sentinel and never needs a grammar.
  const loadedGrammars = new Set<string>(["text"]);
  const loadingPromises = new Map<string, Promise<boolean>>();

  const ensureGrammar = async (grammarName: string): Promise<boolean> => {
    if (loadedGrammars.has(grammarName)) {
      return true;
    }

    const inFlight = loadingPromises.get(grammarName);
    if (inFlight) {
      return inFlight;
    }

    const loadGrammar = grammarLoaders[grammarName];
    if (!loadGrammar) {
      return false;
    }

    const loadingPromise = (async () => {
      try {
        const grammarModule = await loadGrammar();
        await core.loadLanguage(grammarModule.default);
        loadedGrammars.add(grammarName);
        return true;
      } catch {
        return false;
      } finally {
        loadingPromises.delete(grammarName);
      }
    })();

    loadingPromises.set(grammarName, loadingPromise);
    return loadingPromise;
  };

  return { engine, core, loadedGrammars, ensureGrammar };
}

async function createHighlighter(
  input: CreateShikiHighlighterInput,
): Promise<ShikiHighlighterHandle> {
  const preferredEngine = input.preferredEngine ?? "native";
  const debugLog = input.debugLog ?? (() => {});
  const { createHighlighterCore } = await import("@shikijs/core");
  const themes = [...(await input.themes())];
  let nativeEngineFailure: unknown;

  debugLog("initializing", { preferredEngine });

  if (preferredEngine !== "javascript") {
    try {
      const nativeEngineModule = await import("react-native-shiki-engine");
      if (nativeEngineModule.isNativeEngineAvailable()) {
        debugLog("creating native regex engine");
        const core = await createHighlighterCore({
          themes,
          langs: [],
          engine: nativeEngineModule.createNativeEngine(),
        });
        debugLog("using native engine");
        return createHandle(core, "native");
      }
      debugLog("checked native engine availability", { nativeEngineAvailable: false });
      nativeEngineFailure = new Error(
        "The native Shiki regex engine is unavailable in this build.",
      );
      input.onNativeEngineUnavailable?.(nativeEngineFailure);
    } catch (error) {
      nativeEngineFailure = error;
      debugLog("native engine initialization failed; falling back to javascript", { error });
      input.onNativeEngineUnavailable?.(error);
    }
  } else {
    debugLog("skipping native engine probe", { reason: "preference-forced-javascript" });
  }

  try {
    const { createJavaScriptRegexEngine } = await import("@shikijs/engine-javascript");
    const core = await createHighlighterCore({
      themes,
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
    debugLog("using javascript engine", { preferredEngine });
    return createHandle(core, "javascript");
  } catch (cause) {
    if (nativeEngineFailure === undefined) {
      throw input.createInitializationError({
        preferredEngine,
        attemptedEngine: "javascript",
        cause,
      });
    }
    throw input.createInitializationError({
      preferredEngine,
      attemptedEngine: "javascript",
      cause: new AggregateError(
        [
          input.createInitializationError({
            preferredEngine,
            attemptedEngine: "native",
            cause: nativeEngineFailure,
          }),
          cause,
        ],
        "Native and JavaScript highlighter initialization failed.",
        { cause: nativeEngineFailure },
      ),
    });
  }
}
