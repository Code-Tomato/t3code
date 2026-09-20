import {
  AmbientLight,
  CanvasTexture,
  DirectionalLight,
  LinearFilter,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { createPhoneScene, phoneDisplayLayout } from "./phoneScene.ts";
import { createRenderScheduler } from "./renderScheduler.ts";
import { createPhonePose } from "./phonePose.ts";
import type { DeviceScreenSize } from "./stream.ts";
import { IOS_PHONE_SHAPE, type DeviceShapeProfile } from "./shapeProfile.ts";

export interface PhoneViewer {
  readonly frameUpdated: () => void;
  readonly setScreen: (screen: DeviceScreenSize | null, profile?: DeviceShapeProfile) => void;
  readonly resize: (width: number, height: number, pixelRatio: number) => void;
  readonly screenPoint: (
    x: number,
    y: number,
    captured?: boolean,
  ) => { x: number; y: number } | null;
  readonly orbit: (deltaX: number, deltaY: number) => void;
  readonly zoomBy: (logDelta: number) => void;
  readonly resetPose: () => void;
  readonly dispose: () => void;
}

/** Owns only presentation resources. The caller retains the decoded canvas and the stream connection. */
export function createPhoneViewer(options: {
  readonly canvas: HTMLCanvasElement;
  readonly source: HTMLCanvasElement;
  readonly onUnavailable: () => void;
  readonly profile?: DeviceShapeProfile;
}): PhoneViewer {
  const renderer = new WebGLRenderer({
    canvas: options.canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.outputColorSpace = SRGBColorSpace;
  const makeTexture = () => {
    const next = new CanvasTexture(options.source);
    next.colorSpace = SRGBColorSpace;
    next.minFilter = LinearFilter;
    next.magFilter = LinearFilter;
    next.generateMipmaps = false;
    return next;
  };
  let texture = makeTexture();
  let textureWidth = options.source.width;
  let textureHeight = options.source.height;
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 30);
  camera.position.z = 5.5;
  const ambient = new AmbientLight(0xffffff, 2.4);
  const key = new DirectionalLight(0xe4edff, 5);
  key.position.set(-3, 4, 5);
  const rim = new DirectionalLight(0xffffff, 4);
  rim.position.set(3, 1, -3);
  const fill = new DirectionalLight(0x9facd4, 2);
  fill.position.set(-2, -2, -4);
  scene.add(ambient, key, rim, fill);

  let screen: DeviceScreenSize | null = null;
  let layout = phoneDisplayLayout(screen, options.source.width, options.source.height);
  let profile = options.profile ?? IOS_PHONE_SHAPE;
  let phone = createPhoneScene(texture, layout, profile);
  scene.add(phone.root);
  let disposed = false;
  const pose = createPhonePose();
  let viewport = { width: 0, height: 0, pixelRatio: 1 };
  let drawingBuffer = { width: 0, height: 0, pixelRatio: 0 };

  const fit = () => {
    if (!viewport.width || !viewport.height) return;
    camera.aspect = viewport.width / viewport.height;
    const width = layout.landscape ? phone.height : phone.width;
    const height = layout.landscape ? phone.width : phone.height;
    const tangent = Math.tan((camera.fov * Math.PI) / 360);
    camera.position.z =
      (Math.max(height / (2 * tangent), width / (2 * tangent * camera.aspect)) * 1.22 + 0.18) /
      pose.zoom;
    camera.updateProjectionMatrix();
  };
  const applyPose = () => {
    phone.root.rotation.set(pose.pitch, pose.yaw, 0, "YXZ");
    phone.orientation.rotation.z = layout.rotation;
  };
  const scheduler = createRenderScheduler(() => {
    if (disposed || !viewport.width || !viewport.height) return;
    try {
      if (
        drawingBuffer.width !== viewport.width ||
        drawingBuffer.height !== viewport.height ||
        drawingBuffer.pixelRatio !== viewport.pixelRatio
      ) {
        // Canvas allocation clears the previous image. Commit it with the redraw,
        // rather than exposing an empty buffer between ResizeObserver and the next frame.
        renderer.setDrawingBufferSize(viewport.width, viewport.height, viewport.pixelRatio);
        drawingBuffer = viewport;
      }
      applyPose();
      renderer.render(scene, camera);
    } catch {
      options.onUnavailable();
    }
  });
  const updateLayout = (nextProfile = profile) => {
    const next = phoneDisplayLayout(screen, options.source.width, options.source.height);
    const resized =
      textureWidth !== options.source.width || textureHeight !== options.source.height;
    if (
      resized ||
      nextProfile !== profile ||
      next.aspect !== layout.aspect ||
      next.rawLandscape !== layout.rawLandscape ||
      next.rotation !== layout.rotation
    ) {
      scene.remove(phone.root);
      phone.dispose();
      // Three textures retain their uploaded dimensions. Rotation can change the native frame size.
      if (resized) {
        texture.dispose();
        texture = makeTexture();
        textureWidth = options.source.width;
        textureHeight = options.source.height;
      }
      layout = next;
      profile = nextProfile;
      phone = createPhoneScene(texture, layout, profile);
      scene.add(phone.root);
      fit();
    }
    applyPose();
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    options.onUnavailable();
  };
  options.canvas.addEventListener("webglcontextlost", contextLost);
  applyPose();
  return {
    frameUpdated() {
      if (disposed) return;
      updateLayout();
      texture.needsUpdate = true;
      scheduler.invalidate();
    },
    setScreen(next, nextProfile = profile) {
      if (disposed) return;
      screen = next;
      updateLayout(nextProfile);
      scheduler.invalidate();
    },
    resize(width, height, pixelRatio) {
      if (disposed) return;
      if (![width, height, pixelRatio].every(Number.isFinite) || width <= 0 || height <= 0) return;
      const ratio = Math.min(2, Math.max(1, pixelRatio));
      if (viewport.width === width && viewport.height === height && viewport.pixelRatio === ratio)
        return;
      viewport = { width, height, pixelRatio: ratio };
      fit();
      scheduler.invalidate();
    },
    screenPoint(x, y, captured = false) {
      if (disposed) return null;
      applyPose();
      return phone.screenPoint(x, y, camera, captured);
    },
    orbit(deltaX, deltaY) {
      if (disposed) return;
      pose.orbit(deltaX, deltaY);
      scheduler.invalidate();
    },
    zoomBy(logDelta) {
      if (disposed) return;
      pose.zoomBy(logDelta);
      fit();
      scheduler.invalidate();
    },
    resetPose() {
      if (disposed) return;
      pose.reset();
      fit();
      scheduler.invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scheduler.dispose();
      options.canvas.removeEventListener("webglcontextlost", contextLost);
      scene.remove(phone.root);
      phone.dispose();
      texture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
