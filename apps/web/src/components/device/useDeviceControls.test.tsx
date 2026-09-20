import { EnvironmentId, type DeviceDetail, type DeviceSummary } from "@t3tools/contracts";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useDeviceControls, type DeviceControls } from "./useDeviceControls";

type Result = { _tag: "Success"; value: DeviceDetail } | { _tag: "Failure"; cause: unknown };
const { read, action } = vi.hoisted(() => ({
  read: vi.fn<() => Promise<Result>>(),
  action: vi.fn<() => Promise<Result>>(),
}));
vi.mock("~/state/device", () => ({ deviceEnvironment: { detail: "detail", action: "action" } }));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "detail" ? read : action),
}));
vi.mock("~/state/query", () => ({ formatEnvironmentQueryError: () => "Device action failed" }));
vi.mock("./deviceHubApi", () => ({ subscribeDeviceForeground: vi.fn(() => () => {}) }));

const device: DeviceSummary = {
  hostId: "remote",
  id: "phone",
  name: "Phone",
  platform: "ios",
  version: "iOS",
  booted: true,
  physical: false,
};
const snapshot = (appearance: "light" | "dark"): Result => ({
  _tag: "Success",
  value: {
    hostId: "remote",
    deviceId: "phone",
    settings: { appearance },
    foregroundApp: null,
    readAt: "2026-09-20T00:00:00Z",
  },
});
function deferred() {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let renderer: ReactTestRenderer | undefined;
let controls: DeviceControls;
function Probe({ visible }: { visible: boolean }) {
  const next = useDeviceControls({
    environmentId: EnvironmentId.make("environment"),
    device,
    access: null,
    visible,
  });
  useEffect(() => {
    controls = next;
  }, [next]);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  read.mockReset();
  action.mockReset();
  read.mockResolvedValue(snapshot("light"));
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    renderer = create(<Probe visible />);
  });
}

it("serializes rapid actions and retains confirmed settings while pending or after failure", async () => {
  await mount();
  const response = deferred();
  action.mockReturnValueOnce(response.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = controls.act({ type: "setAppearance", value: "dark" });
    await controls.act({ type: "setAppearance", value: "light" });
  });
  expect(action).toHaveBeenCalledOnce();
  expect(controls.disabled).toBe(true);
  expect(controls.detail?.settings.appearance).toBe("light");
  await act(async () => {
    response.resolve(snapshot("dark"));
    await pending;
  });
  expect(controls.detail?.settings.appearance).toBe("dark");
  action.mockResolvedValueOnce({ _tag: "Failure", cause: "offline" });
  await act(async () => controls.act({ type: "setAppearance", value: "light" }));
  expect(controls.detail?.settings.appearance).toBe("dark");
  expect(controls.error).toBe("Device action failed");
  expect(controls.disabled).toBe(false);
});

it("discards action results from an earlier visible session", async () => {
  await mount();
  const response = deferred();
  action.mockReturnValueOnce(response.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = controls.act({ type: "setAppearance", value: "dark" });
  });
  await act(async () => renderer!.update(<Probe visible={false} />));
  expect(controls.disabled).toBe(true);
  await act(async () => renderer!.update(<Probe visible />));
  await act(async () => {
    response.resolve(snapshot("dark"));
    await pending;
  });
  expect(controls.detail?.settings.appearance).toBe("light");
});

it("does not let an older refresh overwrite a newer confirmed action", async () => {
  await mount();
  await act(async () => renderer!.update(<Probe visible={false} />));
  const refresh = deferred();
  read.mockReturnValueOnce(refresh.promise);
  await act(async () => renderer!.update(<Probe visible />));
  action.mockResolvedValueOnce(snapshot("dark"));
  await act(async () => controls.act({ type: "setAppearance", value: "dark" }));
  await act(async () => {
    refresh.resolve(snapshot("light"));
    await refresh.promise;
  });
  expect(controls.detail?.settings.appearance).toBe("dark");
});
