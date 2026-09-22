import {
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  type ProjectScopedServerSettingKey,
} from "@t3tools/contracts";

import type { ScopedSettingsTarget } from "./scopedSettings";
import {
  SETTINGS_SECTION_LABELS,
  settingsSearchItem,
  type SettingsSearchItemId,
} from "./settingsSearch";

export function projectGroupTitleNeedsUpdate(
  memberTitles: ReadonlyArray<string>,
  nextTitle: string,
  wasEdited: boolean,
): boolean {
  return wasEdited && memberTitles.some((title) => title !== nextTitle);
}

/**
 * The row that edits each project-overridable setting. `null` keys already
 * have a control on the Project page (New threads, Actions). A new scopable
 * key fails the build until it has an entry here.
 */
const PROJECT_OVERRIDE_ROWS = {
  worktreeCleanup: "storage-worktrees",
  defaultModelSelection: null,
  defaultRuntimeMode: null,
  defaultThreadEnvMode: null,
  newWorktreesStartFromOrigin: "start-from-origin",
  worktreeSubmodules: null,
  defaultAutoPull: "automatic-pull",
  defaultProjectScripts: null,
  enableAgentBrowserAccess: "agent-browser-access",
  enableAgentDeviceAccess: "agent-device-access",
  textGenerationModelSelection: "text-generation-model",
  sourceControlWriterModelSelection: "source-control-writer-model",
  sourceControlWritingStyle: "source-control-writing-style",
  pullRequestMergeMethod: "pull-request-merge-method",
  sidebarAutoSettleOnMerge: "auto-settle-merged-threads",
  sidebarAutoSettleAfterDays: "auto-settle-inactive-threads",
  continueThreadsAfterServerUpdate: "continue-threads-after-server-update",
  responseStreamingMode: "response-streaming",
} as const satisfies Record<ProjectScopedServerSettingKey, SettingsSearchItemId | null>;

const SECTION_ORDER: readonly string[] = Object.keys(SETTINGS_SECTION_LABELS);

/**
 * Settings the Project page lists under Overrides: overridden on at least one
 * selected checkout and edited on another page. Sorted in sidebar order.
 */
export function listedProjectOverrides(targets: readonly Pick<ScopedSettingsTarget, "sources">[]) {
  return PROJECT_SCOPED_SERVER_SETTING_KEYS.flatMap((key) => {
    const itemId = PROJECT_OVERRIDE_ROWS[key];
    return itemId !== null && targets.some((target) => target.sources[key] === "project")
      ? [{ key, item: settingsSearchItem(itemId) }]
      : [];
  }).toSorted(
    (left, right) => SECTION_ORDER.indexOf(left.item.to) - SECTION_ORDER.indexOf(right.item.to),
  );
}
