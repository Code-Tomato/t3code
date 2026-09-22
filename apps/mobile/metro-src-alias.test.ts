import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { createSourceAliasResolver } from "./metro-src-alias";

const mobileRootPath = import.meta.dirname;
const mobileSrcRootPath = NodePath.join(mobileRootPath, "src");

// Metro hands its own default resolver to a custom resolver as `context.resolveRequest`,
// so the test drives the real one. It is reached through the metro install that
// `expo/metro-config` resolves to — the one the app bundles with — because metro-resolver
// is not a dependency of this workspace.
const requireFromExpoMetroConfig = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("expo/metro-config"),
);
type MetroResolveContext = Parameters<ReturnType<typeof createSourceAliasResolver>>[0];

const { resolve: resolveWithMetroDefaults } = requireFromExpoMetroConfig("metro-resolver") as {
  resolve: MetroResolveContext["resolveRequest"];
};

/** The pieces of Metro's resolution context the default resolver reads for a path import. */
const createMetroContext = (originModulePath: string) => ({
  originModulePath,
  resolveRequest: resolveWithMetroDefaults,
  allowHaste: false,
  assetExts: [] as string[],
  disableHierarchicalLookup: true,
  doesFileExist: (filePath: string) =>
    NodeFS.existsSync(filePath) && NodeFS.statSync(filePath).isFile(),
  fileSystemLookup: (targetPath: string) => {
    if (!NodeFS.existsSync(targetPath)) return { exists: false };
    const isDirectory = NodeFS.statSync(targetPath).isDirectory();
    return {
      exists: true,
      type: isDirectory ? ("d" as const) : ("f" as const),
      realPath: targetPath,
      files: isDirectory
        ? new Map(NodeFS.readdirSync(targetPath).map((name) => [name, true]))
        : undefined,
    };
  },
  getPackage: () => null,
  getPackageForModule: () => null,
  nodeModulesPaths: [] as string[],
  preferNativePlatform: true,
  resolveAsset: () => null,
  resolveHasteModule: () => null,
  resolveHastePackage: () => null,
  sourceExts: ["ts", "tsx", "js", "jsx", "json"],
  unstable_conditionNames: [] as string[],
  unstable_conditionsByPlatform: {},
  unstable_enablePackageExports: false,
  unstable_incrementalResolution: false,
});

/**
 * `AutoSettleDaysField` ships a plain, an `.ios.tsx` and an `.android.tsx` file, which
 * is exactly what makes this a real resolution test: the alias has to land on the same
 * file a relative import would pick on each platform, not merely on a file with that name.
 */
const aliasedComponent = "@/features/settings/components/AutoSettleDaysField";
const originModulePath = NodePath.join(
  mobileSrcRootPath,
  "features/settings/appearance/sections/TextAppearanceSection.tsx",
);

describe("metro @/ alias", () => {
  const resolveSourceAlias = createSourceAliasResolver(mobileSrcRootPath);

  it.each([
    ["ios", "AutoSettleDaysField.ios.tsx"],
    ["android", "AutoSettleDaysField.android.tsx"],
    // No platform: the same fallback a relative import gets, `.native` first then plain.
    [null, "AutoSettleDaysField.tsx"],
  ] as const)("resolves %s to %s", (platform, expectedFile) => {
    const context = createMetroContext(originModulePath);
    const resolution = resolveSourceAlias(context, aliasedComponent, platform);

    expect(resolution.type).toBe("sourceFile");
    expect(resolution.filePath).toBe(
      NodePath.join(mobileSrcRootPath, "features/settings/components", expectedFile),
    );
  });

  it("hands every other request to metro untouched", () => {
    const delegated: string[] = [];
    const context: MetroResolveContext = {
      resolveRequest: (_context, moduleName) => {
        delegated.push(moduleName);
        return { type: "empty" };
      },
    };

    for (const moduleName of [
      "@t3tools/contracts",
      "@react-navigation/native",
      "react-native",
      "../../../lib/cn",
    ]) {
      resolveSourceAlias(context, moduleName, "ios");
      expect(delegated.at(-1)).toBe(moduleName);
    }
  });
});
