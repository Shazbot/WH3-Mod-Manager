import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  createUnitPainterSession,
  mirrorPointAcrossObjectLocalX,
  mirrorRayAcrossObjectLocalX,
  type UnitPainterBrushSettings,
} from "../src/visuals/unitPainter";

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

  it("fills only the selected UV island as one undoable operation", () => {
    const painter = makePainter();
    try {
      expect(painter.session.selectIntersection(painter.intersection)?.hasUvIsland).toBe(true);
      const changed = painter.session.fillSelection("island", {
        radiusPx: 1,
        opacity: 1,
        hardness: 1,
        mode: "paint",
        color: { r: 255, g: 0, b: 0 },
      });
      expect(changed).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([0, 0, 0, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("fills every UV island belonging to the selected material", () => {
    const painter = makePainter();
    try {
      painter.session.selectIntersection(painter.intersection);
      expect(
        painter.session.fillSelection("material", {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 0, g: 255, b: 0 },
        }),
      ).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 255, 0, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([0, 255, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("restricts brush painting to the selected material or UV island", () => {
    const painter = makePainter();
    try {
      painter.session.selectIntersection(painter.intersection);
      const secondIsland = {
        ...painter.intersection,
        point: new THREE.Vector3(0.7, 0.28, 0),
        uv: new THREE.Vector2(0.7, 0.28),
        face: {
          a: 3,
          b: 4,
          c: 5,
          normal: new THREE.Vector3(0, 0, 1),
          materialIndex: 0,
        },
        faceIndex: 1,
      } as THREE.Intersection<THREE.Object3D>;
      const settings: UnitPainterBrushSettings = {
        radiusPx: 100,
        opacity: 1,
        hardness: 1,
        mode: "paint",
        color: { r: 255, g: 0, b: 0 },
      };

      painter.session.beginStroke();
      expect(
        painter.session.paintIntersection(secondIsland, settings, painter.camera, 100, settings.radiusPx, "island"),
      ).toBe(false);
      expect(painter.session.endStroke()).toBe(false);
      expect(getPixel(painter.material, 20, 8)).toEqual([0, 0, 0, 255]);

      painter.session.beginStroke();
      expect(
        painter.session.paintIntersection(secondIsland, settings, painter.camera, 100, settings.radiusPx, "material"),
      ).toBe(true);
      expect(painter.session.endStroke()).toBe(true);
      expect(getPixel(painter.material, 20, 8)).toEqual([255, 0, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });


  it("mirrors points through the model-local X plane even when the model is transformed", () => {
    const root = new THREE.Object3D();
    root.position.set(3, -2, 5);
    root.rotation.set(0.2, 0.7, -0.1);
    root.scale.setScalar(1.5);
    root.updateMatrixWorld(true);

    const sourceLocal = new THREE.Vector3(2, 1, -3);
    const sourceWorld = root.localToWorld(sourceLocal.clone());
    const mirroredWorld = mirrorPointAcrossObjectLocalX(sourceWorld, root);
    const mirroredLocal = root.worldToLocal(mirroredWorld.clone());

    expect(mirroredLocal.x).toBeCloseTo(-2, 6);
    expect(mirroredLocal.y).toBeCloseTo(1, 6);
    expect(mirroredLocal.z).toBeCloseTo(-3, 6);
  });

  it("mirrors complete paint rays through the model-local X plane", () => {
    const root = new THREE.Object3D();
    root.position.set(-4, 3, 2);
    root.rotation.set(-0.15, 0.45, 0.25);
    root.updateMatrixWorld(true);

    const localOrigin = new THREE.Vector3(2, 1, 4);
    const localDirection = new THREE.Vector3(-0.3, 0.1, -1).normalize();
    const worldOrigin = root.localToWorld(localOrigin.clone());
    const worldDirection = localDirection.clone().transformDirection(root.matrixWorld);
    const mirrored = mirrorRayAcrossObjectLocalX(new THREE.Ray(worldOrigin, worldDirection), root);

    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const mirroredLocalOrigin = mirrored.origin.clone().applyMatrix4(inverse);
    const mirroredLocalDirection = mirrored.direction.clone().transformDirection(inverse);

    expect(mirroredLocalOrigin.x).toBeCloseTo(-localOrigin.x, 6);
    expect(mirroredLocalOrigin.y).toBeCloseTo(localOrigin.y, 6);
    expect(mirroredLocalOrigin.z).toBeCloseTo(localOrigin.z, 6);
    expect(mirroredLocalDirection.x).toBeCloseTo(-localDirection.x, 6);
    expect(mirroredLocalDirection.y).toBeCloseTo(localDirection.y, 6);
    expect(mirroredLocalDirection.z).toBeCloseTo(localDirection.z, 6);
  });


  it("leaves a ray on the local symmetry plane unchanged", () => {
    const root = new THREE.Object3D();
    root.position.set(2, 3, -1);
    root.rotation.set(0.1, -0.4, 0.2);
    root.updateMatrixWorld(true);

    const localOrigin = new THREE.Vector3(0, 1, 4);
    const localDirection = new THREE.Vector3(0, -0.2, -1).normalize();
    const worldOrigin = root.localToWorld(localOrigin.clone());
    const worldDirection = localDirection.clone().transformDirection(root.matrixWorld);
    const source = new THREE.Ray(worldOrigin, worldDirection);
    const mirrored = mirrorRayAcrossObjectLocalX(source, root);

    expect(mirrored.origin.distanceTo(source.origin)).toBeLessThan(1e-6);
    expect(mirrored.direction.distanceTo(source.direction)).toBeLessThan(1e-6);
  });


  it("resets only the selected UV island and keeps the reset undoable", () => {
    const painter = makePainter();
    try {
      painter.session.selectIntersection(painter.intersection);
      expect(
        painter.session.fillSelection("material", {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 255, g: 0, b: 0 },
        }),
      ).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([255, 0, 0, 255]);

      expect(painter.session.resetSelection("island")).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 0, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([255, 0, 0, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([255, 0, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("resets the full selected material to its original BaseColour", () => {
    const painter = makePainter();
    try {
      painter.session.selectIntersection(painter.intersection);
      expect(
        painter.session.fillSelection("material", {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 0, g: 255, b: 0 },
        }),
      ).toBe(true);
      expect(painter.session.resetSelection("material")).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 0, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([0, 0, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("tracks the exact saved edit state across undo and redo", () => {
    const painter = makePainter();
    try {
      expect(painter.session.hasUnsavedChanges).toBe(false);
      paint(painter);
      expect(painter.session.hasUnsavedChanges).toBe(true);

      painter.session.markSaved();
      expect(painter.session.hasUnsavedChanges).toBe(false);

      painter.session.selectIntersection(painter.intersection);
      expect(
        painter.session.fillSelection("island", {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 0, g: 255, b: 0 },
        }),
      ).toBe(true);
      expect(painter.session.hasUnsavedChanges).toBe(true);

      expect(painter.session.undo()).toBe(true);
      expect(painter.session.hasUnsavedChanges).toBe(false);

      expect(painter.session.redo()).toBe(true);
      expect(painter.session.hasUnsavedChanges).toBe(true);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });


  it("loads a saved painted texture as the clean editable state while keeping original reset data", () => {
    const painter = makePainter();
    try {
      const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
      for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
      const offset = (8 * WIDTH + 14) * 4;
      rgba[offset] = 91;
      rgba[offset + 1] = 42;
      rgba[offset + 2] = 17;

      painter.session.loadProjectTextures([{
        sourceVirtualPath: "variantmeshes\\unit\\body_base_colour.dds",
        width: WIDTH,
        height: HEIGHT,
        rgbaBytes: rgba,
      }]);
      expect(getPixel(painter.material, 14, 8)).toEqual([91, 42, 17, 255]);
      expect(painter.session.hasUnsavedChanges).toBe(false);
      expect(painter.session.canUndo).toBe(false);

      painter.session.selectIntersection(painter.intersection);
      expect(painter.session.resetSelection("island")).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 0, 255]);
      expect(painter.session.hasUnsavedChanges).toBe(true);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("rejects reopened painter data when its source texture dimensions changed", () => {
    const painter = makePainter();
    try {
      expect(() =>
        painter.session.loadProjectTextures([{
          sourceVirtualPath: "variantmeshes\\unit\\body_base_colour.dds",
          width: WIDTH * 2,
          height: HEIGHT,
          rgbaBytes: new Uint8Array(WIDTH * HEIGHT * 8),
        }]),
      ).toThrow(/changed size/i);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

});
