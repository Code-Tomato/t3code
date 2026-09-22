"use strict";

const path = require("node:path");

/**
 * `@/…` names a file under `apps/mobile/src` so a deep feature folder can reach
 * shared code without climbing four directories. The mapping is declared in three
 * places that all have to agree: `paths` in `tsconfig.json` (typecheck),
 * `resolve.alias` in the root `vite.config.ts` (tests), and here, because Metro
 * reads nothing from tsconfig and otherwise cannot bundle the specifier at all on
 * iOS or Android.
 *
 * Aliased requests are handed to Metro's own default resolver as an absolute path
 * rather than resolved by hand, which keeps every behavior a relative import has:
 * platform suffixes (`.ios.tsx`, `.android.tsx`, `.native.ts`), `index` files and
 * assets.
 *
 * @typedef {object} MetroResolution
 * @property {string} type
 * @property {string} [filePath]
 *
 * @typedef {object} MetroResolveContext
 * @property {(context: MetroResolveContext, moduleName: string, platform: string | null) => MetroResolution} resolveRequest
 */

const SOURCE_ALIAS_PREFIX = "@/";

/**
 * @param {string} mobileSrcRootPath
 * @returns {(context: MetroResolveContext, moduleName: string, platform: string | null) => MetroResolution}
 */
function createSourceAliasResolver(mobileSrcRootPath) {
  return function resolveSourceAlias(context, moduleName, platform) {
    const delegatedModuleName = moduleName.startsWith(SOURCE_ALIAS_PREFIX)
      ? path.resolve(mobileSrcRootPath, moduleName.slice(SOURCE_ALIAS_PREFIX.length))
      : moduleName;
    // Metro passes its own default resolver as `context.resolveRequest` so that a
    // custom resolver can delegate to it.
    return context.resolveRequest(context, delegatedModuleName, platform);
  };
}

module.exports = { createSourceAliasResolver };
