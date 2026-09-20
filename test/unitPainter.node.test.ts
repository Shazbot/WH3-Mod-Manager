import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { createUnitPainterSession, type UnitPainterBrushSettings } from "../src/visuals/unitPainter";

const WIDTH = 32;
const HEIGHT = 32;

const makeTexture = (pixel?: { x: number; y: number; r: number; g: number; b: number }) => {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  if (pixel) {
    const offset = (pixel.y * WIDTH + pixel.x) * 4;
    data[offset] = pixel.r;
    data[offset + 1] = pixel.g;
    data[offset + 2] = pixel.b;
  }

  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.flipY = false;
  texture.userData.wh3SourceVirtualPath = "variantmeshes\\unit\\body_base_colour.dds";
  texture.needsUpdate = true;
  return texture;
};

const makePainter = (texture = makeTexture()) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0.25, 0.25, 0,
        0.5, 0.25, 0,
        0.25, 0.5, 0,
        0.52, 0.25, 0,
        0.77, 0.25, 0,
        0.52, 0.5, 0,
      ],
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      [
        0.25, 0.25,
        0.5, 0.25,
        0.25, 0.5,
        0.52, 0.25,
        0.77, 0.25,
        0.52, 0.5,
      ],
      2,
    ),
  );

  const material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);

  const session = createUnitPainterSession(mesh);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(0, 0, 2);
  camera.updateMatrixWorld(true);

  const intersection = {
    distance: 2,
    point: new THREE.Vector3(0.46, 0.28, 0),
    object: mesh,
    uv: new THREE.Vector2(0.46, 0.28),
    face: {
      a: 0,
      b: 1,
      c: 2,
      normal: new THREE.Vector3(0, 0, 1),
      materialIndex: 0,
    },
    faceIndex: 0,
  } as THREE.Intersection<THREE.Object3D>;

  return { session, material, mesh, geometry, camera, intersection };
};

const getPixel = (material: THREE.MeshBasicMaterial, x: number, y: number) => {
  const texture = material.map as THREE.DataTexture;
  const data = (texture.image as { data: Uint8Array }).data;
  const offset = (y * WIDTH + x) * 4;
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
};

const paint = (
  painter: ReturnType<typeof makePainter>,
  settings: Partial<UnitPainterBrushSettings> = {},
) => {
  painter.session.beginStroke();
  painter.session.paintIntersection(
    painter.intersection,
    {
      radiusPx: 100,
      opacity: 1,
      hardness: 1,
      mode: "paint",
      color: { r: 255, g: 0, b: 0 },
      ...settings,
    },
    painter.camera,
    100,
  );
  painter.session.endStroke();
};

describe("unit painter", () => {
  it("restricts a brush stamp to the UV island under the cursor", () => {
    const painter = makePainter();
    try {
      paint(painter);

      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);
      // This texel is inside the second UV triangle and inside the brush circle,
      // but the second triangle is a disconnected UV island.
      expect(getPixel(painter.material, 17, 8)).toEqual([0, 0, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("samples the current editable BaseColour for the eyedropper", () => {
    const painter = makePainter(makeTexture({ x: 14, y: 8, r: 12, g: 34, b: 56 }));
    try {
      expect(painter.session.sampleIntersection(painter.intersection)).toEqual({ r: 12, g: 34, b: 56 });
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("uses opacity and preserves stroke undo/redo", () => {
    const painter = makePainter();
    try {
      paint(painter, { opacity: 0.5 });
      expect(getPixel(painter.material, 14, 8)[0]).toBe(128);
      expect(painter.session.canUndo).toBe(true);

      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 0, 255]);
      expect(painter.session.canRedo).toBe(true);

      expect(painter.session.redo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)[0]).toBe(128);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("hardness controls edge falloff", () => {
    const soft = makePainter();
    const hard = makePainter();
    try {
      paint(soft, { hardness: 0 });
      paint(hard, { hardness: 1 });

      // x=17 is deliberately outside the selected island, so compare a texel
      // near the brush edge that still belongs to the selected triangle.
      const softEdge = getPixel(soft.material, 12, 10)[0];
      const hardEdge = getPixel(hard.material, 12, 10)[0];
      expect(hardEdge).toBeGreaterThanOrEqual(softEdge);
      expect(hardEdge).toBe(255);
      expect(softEdge).toBeLessThan(255);
    } finally {
      soft.session.dispose();
      hard.session.dispose();
      soft.geometry.dispose();
      hard.geometry.dispose();
      soft.material.dispose();
      hard.material.dispose();
    }
  });
});
