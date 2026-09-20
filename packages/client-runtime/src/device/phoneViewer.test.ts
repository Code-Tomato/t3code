import type { PerspectiveCamera, Scene, Object3D } from "three";
import { afterEach, expect, it, vi } from "vite-plus/test";

const gpu = vi.hoisted(() => ({
  instances: [] as {
    blank: boolean;
    allocations: number;
    disposed: boolean;
    size: { width: number; height: number; pixelRatio: number };
    frames: {
      scene: Scene;
      phone: Object3D | undefined;
      yaw: number | undefined;
      cameraZ: number;
    }[];
  }[],
}));

vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  return {
    ...actual,
    WebGLRenderer: class {
      outputColorSpace = "";
      state: (typeof gpu.instances)[number] = {
        blank: true,
        allocations: 0,
        disposed: false,
        size: { width: 0, height: 0, pixelRatio: 1 },
        frames: [],
      };
      constructor() {
        gpu.instances.push(this.state);
      }
      setDrawingBufferSize(width: number, height: number, pixelRatio: number) {
        this.state.size = { width, height, pixelRatio };
        this.state.allocations++;
        this.state.blank = true;
      }
      setSize(width: number, height: number) {
        this.setDrawingBufferSize(width, height, this.state.size.pixelRatio);
      }
      setPixelRatio(pixelRatio: number) {
        this.setDrawingBufferSize(this.state.size.width, this.state.size.height, pixelRatio);
      }
      render(scene: Scene, camera: PerspectiveCamera) {
        const phone = scene.children.find((child) => child.type === "Group");
        this.state.frames.push({
          scene,
          phone,
          yaw: phone?.rotation.y,
          cameraZ: camera.position.z,
        });
        this.state.blank = false;
      }
      dispose() {
        this.state.disposed = true;
      }
      forceContextLoss() {}
    },
  };
});

import { createPhoneViewer } from "./phoneViewer.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  gpu.instances.length = 0;
});

function fixture() {
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  const canvas = Object.assign(new EventTarget(), { width: 0, height: 0 }) as HTMLCanvasElement;
  const source = { width: 1206, height: 2622 } as HTMLCanvasElement;
  const onUnavailable = vi.fn();
  const viewer = createPhoneViewer({ canvas, source, onUnavailable });
  const draw = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback(0));
  };
  viewer.resize(400, 700, 2);
  draw();
  return { viewer, draw, pending, source, onUnavailable, state: gpu.instances[0]! };
}

it("retains the drawn phone until resize and redraw commit together, without replacing scene or pose", () => {
  const { viewer, draw, pending, source, state, onUnavailable } = fixture();
  viewer.orbit(0.08, 0.04);
  viewer.zoomBy(0.2);
  draw();
  const previous = state.frames.at(-1)!;
  const allocations = state.allocations;
  viewer.resize(500, 700, 2);
  viewer.resize(450, 700, 2);
  viewer.frameUpdated();
  // ResizeObserver runs after rAF. A cleared buffer here would reach the browser's next paint.
  expect(state.blank).toBe(false);
  expect(state.allocations).toBe(allocations);
  expect(pending.size).toBe(1);
  draw();
  expect(state.size).toEqual({ width: 450, height: 700, pixelRatio: 2 });
  expect(state.blank).toBe(false);
  expect(state.allocations).toBe(allocations + 1);
  expect(state.frames.at(-1)?.scene).toBe(previous.scene);
  expect(state.frames.at(-1)?.phone).toBe(previous.phone);
  expect(state.frames.at(-1)?.yaw).toBe(previous.yaw);
  viewer.resize(400, 700, 2);
  draw();
  expect(state.frames.at(-1)?.cameraZ).toBeCloseTo(previous.cameraZ);
  expect(source).toMatchObject({ width: 1206, height: 2622 });
  expect(gpu.instances).toHaveLength(1);
  expect(onUnavailable).not.toHaveBeenCalled();
  viewer.dispose();
});

it("ignores redundant and invalid sizes and combines a DPR change into one allocation and draw", () => {
  const { viewer, draw, pending, state } = fixture();
  const allocations = state.allocations;
  viewer.resize(400, 700, 2);
  viewer.resize(400, 700, 5);
  viewer.resize(0, 700, 2);
  viewer.resize(NaN, 700, 2);
  expect(pending.size).toBe(0);
  viewer.resize(400, 700, 1);
  expect(state.blank).toBe(false);
  draw();
  expect(state.size.pixelRatio).toBe(1);
  expect(state.allocations).toBe(allocations + 1);
  viewer.resize(450, 700, 1);
  viewer.dispose();
  draw();
  expect(state.allocations).toBe(allocations + 1);
  expect(state.disposed).toBe(true);
});
