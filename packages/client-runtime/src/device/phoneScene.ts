import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Plane,
  Raycaster,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  type Camera,
  type Texture,
} from "three";
import type { DeviceScreenSize } from "./stream.ts";

const SCREEN_HEIGHT = 2.2;
const BORDER = 0.055;

function roundedPath(width: number, height: number, radius: number, path = new Shape()) {
  const x = -width / 2;
  const y = -height / 2;
  path.moveTo(x + radius, y);
  path.lineTo(x + width - radius, y);
  path.quadraticCurveTo(x + width, y, x + width, y + radius);
  path.lineTo(x + width, y + height - radius);
  path.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  path.lineTo(x + radius, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - radius);
  path.lineTo(x, y + radius);
  path.quadraticCurveTo(x, y, x + radius, y);
  return path;
}

/** Display orientation is independent of orbit. Texture coordinates stay in raw framebuffer space. */
export function phoneDisplayLayout(
  screen: DeviceScreenSize | null,
  rawWidth: number,
  rawHeight: number,
) {
  const width = rawWidth || screen?.width || 900;
  const height = rawHeight || screen?.height || 1950;
  const landscape =
    screen?.orientation === "landscape_left" || screen?.orientation === "landscape_right";
  const rotation =
    screen?.orientation === "landscape_left"
      ? -Math.PI / 2
      : screen?.orientation === "landscape_right"
        ? Math.PI / 2
        : screen?.orientation === "portrait_upside_down"
          ? Math.PI
          : 0;
  return {
    aspect: Math.min(width, height) / Math.max(width, height),
    rotation,
    landscape,
    rawLandscape: width > height,
  };
}

/** An original procedural phone body. It makes no claim to reproduce a particular hardware model. */
export function createPhoneScene(texture: Texture, layout: ReturnType<typeof phoneDisplayLayout>) {
  const { aspect, rawLandscape, rotation } = layout;
  const root = new Group();
  const orientation = new Group();
  root.add(orientation);
  const screenWidth = SCREEN_HEIGHT * aspect;
  const width = screenWidth + BORDER * 2;
  const height = SCREEN_HEIGHT + BORDER * 2;
  const metal = new MeshStandardMaterial({ color: 0xb5bcc7, metalness: 0.88, roughness: 0.27 });
  const glass = new MeshPhysicalMaterial({
    color: 0x141820,
    metalness: 0.15,
    roughness: 0.2,
    clearcoat: 1,
  });
  const backMaterial = new MeshStandardMaterial({
    color: 0x424b5d,
    metalness: 0.45,
    roughness: 0.32,
  });
  const lensMaterial = new MeshPhysicalMaterial({
    color: 0x071326,
    metalness: 0.6,
    roughness: 0.12,
    clearcoat: 1,
  });
  const materials = [metal, glass, backMaterial, lensMaterial];

  const body = new Mesh(
    new ExtrudeGeometry(roundedPath(width, height, 0.15), {
      depth: 0.085,
      bevelEnabled: true,
      bevelSize: 0.012,
      bevelThickness: 0.012,
      bevelSegments: 3,
      steps: 1,
      curveSegments: 12,
    }),
    metal,
  );
  body.position.z = -0.06;
  orientation.add(body);
  const face = new Mesh(
    new ShapeGeometry(roundedPath(width - 0.014, height - 0.014, 0.14), 16),
    glass,
  );
  face.position.z = 0.04;
  orientation.add(face);
  const back = new Mesh(
    new ShapeGeometry(roundedPath(width - 0.012, height - 0.012, 0.14), 16),
    backMaterial,
  );
  back.rotation.y = Math.PI;
  back.position.z = -0.075;
  orientation.add(back);

  const screenGeometry = new ShapeGeometry(roundedPath(screenWidth, SCREEN_HEIGHT, 0.105), 20);
  const position = screenGeometry.getAttribute("position");
  const uv = screenGeometry.getAttribute("uv");
  for (let i = 0; i < position.count; i++) {
    const u = (position.getX(i) + screenWidth / 2) / screenWidth;
    const v = (position.getY(i) + SCREEN_HEIGHT / 2) / SCREEN_HEIGHT;
    // Landscape framebuffers already contain the OS rotation. Rotate their UVs back onto the portrait body.
    uv.setXY(
      i,
      rawLandscape ? (rotation > 0 ? 1 - v : v) : u,
      rawLandscape ? (rotation > 0 ? u : 1 - u) : v,
    );
  }
  const screenMaterial = new MeshBasicMaterial({ map: texture, toneMapped: false });
  const display = new Mesh(screenGeometry, screenMaterial);
  display.position.z = 0.043;
  orientation.add(display);

  for (const [x, y, length] of [
    [width / 2 + 0.015, 0.35, 0.3],
    [-width / 2 - 0.015, 0.48, 0.18],
    [-width / 2 - 0.015, 0.22, 0.18],
  ]) {
    const button = new Mesh(new BoxGeometry(0.026, length, 0.055), metal);
    button.position.set(x!, y!, -0.01);
    orientation.add(button);
  }
  const cameraPlate = new Mesh(
    new ExtrudeGeometry(roundedPath(0.39, 0.44, 0.095), {
      depth: 0.025,
      bevelEnabled: true,
      bevelSize: 0.009,
      bevelThickness: 0.007,
      bevelSegments: 2,
    }),
    backMaterial,
  );
  cameraPlate.position.set(-width / 2 + 0.25, height / 2 - 0.29, -0.1);
  cameraPlate.rotation.y = Math.PI;
  orientation.add(cameraPlate);
  for (const [x, y] of [
    [-0.08, 0.095],
    [0.08, -0.095],
  ]) {
    const ring = new Mesh(new CylinderGeometry(0.082, 0.082, 0.025, 32), metal);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cameraPlate.position.x + x!, cameraPlate.position.y + y!, -0.143);
    orientation.add(ring);
    const lens = new Mesh(new CircleGeometry(0.068, 32), lensMaterial);
    lens.rotation.y = Math.PI;
    lens.position.set(ring.position.x, ring.position.y, -0.158);
    orientation.add(lens);
  }
  const flash = new Mesh(new CircleGeometry(0.022, 20), new MeshBasicMaterial({ color: 0xf2ead6 }));
  flash.position.set(cameraPlate.position.x + 0.085, cameraPlate.position.y + 0.11, -0.139);
  flash.rotation.y = Math.PI;
  orientation.add(flash);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const local = new Vector3();
  const plane = new Plane(new Vector3(0, 0, 1), -display.position.z);
  return {
    root,
    orientation,
    width,
    height,
    /** New touches must hit the visible display. Captured drags project onto its plane and clamp at the edge. */
    screenPoint(x: number, y: number, camera: Camera, captured = false) {
      root.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      pointer.set(x * 2 - 1, 1 - y * 2);
      raycaster.setFromCamera(pointer, camera);
      if (!captured) {
        const hit = raycaster.intersectObject(display, false)[0];
        if (!hit) return null;
        local.copy(hit.point);
        orientation.worldToLocal(local);
      } else {
        const ray = raycaster.ray.clone().applyMatrix4(orientation.matrixWorld.clone().invert());
        if (!ray.intersectPlane(plane, local)) return null;
      }
      const u = Math.min(1, Math.max(0, (local.x + screenWidth / 2) / screenWidth));
      const v = Math.min(1, Math.max(0, (local.y + SCREEN_HEIGHT / 2) / SCREEN_HEIGHT));
      // Return displayed coordinates; the transport performs the raw iOS orientation mapping once.
      if (rotation === -Math.PI / 2) return { x: v, y: u };
      if (rotation === Math.PI / 2) return { x: 1 - v, y: 1 - u };
      if (rotation === Math.PI) return { x: 1 - u, y: v };
      return { x: u, y: 1 - v };
    },
    dispose() {
      root.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
      for (const material of materials) material.dispose();
      screenMaterial.dispose();
      flash.material.dispose();
    },
  };
}
