import { DEFAULT_SERVER_SETTINGS, ProjectId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { describe, expect, it } from "vite-plus/test";

import { listedProjectOverrides, projectGroupTitleNeedsUpdate } from "./ProjectSettingsPanel.logic";

describe("projectGroupTitleNeedsUpdate", () => {
  it("updates divergent member titles even when the next title is the derived group label", () => {
    expect(
      projectGroupTitleNeedsUpdate(["local-title", "remote-title"], "Repository name", true),
    ).toBe(true);
  });

  it("skips an untouched blur when the derived label differs from member titles", () => {
    expect(projectGroupTitleNeedsUpdate(["repo-slug", "repo-slug"], "Repository Name", false)).toBe(
      false,
    );
  });

  it("skips an update when every member already has the next title", () => {
    expect(projectGroupTitleNeedsUpdate(["Shared name", "Shared name"], "Shared name", true)).toBe(
      false,
    );
  });
});

describe("listedProjectOverrides", () => {
  const projectId = ProjectId.make("project");
  const target = (overrides: object) =>
    resolveProjectSettings(
      {
        ...DEFAULT_SERVER_SETTINGS,
        projectSettingsOverrides: { [projectId]: overrides },
      },
      projectId,
    );

  it("lists overrides edited elsewhere in sidebar order, skipping rows the page already shows", () => {
    const listed = listedProjectOverrides([
      target({
        pullRequestMergeMethod: "squash",
        defaultModelSelection: null,
        worktreeCleanup: { mode: "off" },
        enableAgentBrowserAccess: true,
        defaultProjectScripts: [],
      }),
    ]);
    expect(listed.map(({ key, item }) => [key, item.to])).toEqual([
      ["enableAgentBrowserAccess", "/settings/integrations"],
      ["pullRequestMergeMethod", "/settings/source-control"],
      ["worktreeCleanup", "/settings/storage"],
    ]);
  });

  it("lists a key overridden on any selected checkout", () => {
    expect(
      listedProjectOverrides([target({}), target({ defaultAutoPull: true })]).map(({ key }) => key),
    ).toEqual(["defaultAutoPull"]);
    expect(listedProjectOverrides([target({})])).toEqual([]);
  });
});
