// @effect-diagnostics nodeBuiltinImport:off
// Runs before any Effect runtime exists, so it stays on Node built-ins.
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

// Turns on Node's on-disk V8 code cache for every module loaded after this one,
// so later launches skip recompiling the large main and server bundles.
// boot.ts loads it for the main process, and the local backend gets it with
// `--require`. Linux uses the user's cache dir because /tmp is shared between
// users; the macOS and Windows temp dirs are already per user.
const cacheRoot =
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Loads before any Effect runtime.
  process.platform === "linux"
    ? process.env.XDG_CACHE_HOME || NodePath.join(NodeOS.homedir(), ".cache")
    : NodeOS.tmpdir();
NodeModule.enableCompileCache(NodePath.join(cacheRoot, "t3code", "compile-cache"));
