import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  createUnitPainterSession,
  getUnitPainterBrushSpacing,
  mirrorPointAcrossObjectLocalX,
  mirrorRayAcrossObjectLocalX,
  sampleUnitPainterStrokeSegment,
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

  it("exposes editable texture data and UV wireframe segments for the texture painter", () => {
    const painter = makePainter();
    try {
      const views = painter.session.textureViews;
      expect(views).toHaveLength(1);
      expect(views[0].width).toBe(WIDTH);
      expect(views[0].height).toBe(HEIGHT);
      expect(views[0].data).toBe((painter.material.map as THREE.DataTexture).image.data);
      expect(views[0].uvSegments.length).toBeGreaterThan(0);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("paints directly in texture coordinates with the same undo history", () => {
    const painter = makePainter();
    try {
      const textureId = painter.session.textureViews[0].id;
      painter.session.beginStroke();
      const result = painter.session.paintTexturePoint(
        textureId,
        2.5,
        2.5,
        1,
        {
          radiusPx: 12,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 80, g: 120, b: 200 },
        },
      );
      expect(result?.changed).toBe(true);
      expect(painter.session.endStroke()).toBe(true);
      expect(getPixel(painter.material, 2, 2)).toEqual([80, 120, 200, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 2, 2)).toEqual([0, 0, 0, 255]);
      expect(painter.session.redo()).toBe(true);
      expect(getPixel(painter.material, 2, 2)).toEqual([80, 120, 200, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("selects materials and UV islands directly from texture coordinates", () => {
    const painter = makePainter();
    try {
      const textureId = painter.session.textureViews[0].id;
      const island = painter.session.selectTexturePoint(textureId, 14.5, 8.5, "island");
      expect(island?.textureId).toBe(textureId);
      expect(island?.hasUvIsland).toBe(true);

      const material = painter.session.selectTexturePoint(textureId, 20.5, 8.5, "material");
      expect(material?.textureId).toBe(textureId);
      expect(material?.materialName).toBeTruthy();

      expect(painter.session.selectTexturePoint(textureId, 2.5, 2.5, "island")).toBeUndefined();
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("streams dirty rectangles while 3D painting for a live split texture view", () => {
    const painter = makePainter();
    try {
      const events: Array<{ textureId: string; minX: number; minY: number; maxX: number; maxY: number }> = [];
      const unsubscribe = painter.session.subscribeTextureChanges((textureId, dirty) => {
        events.push({ textureId, ...dirty });
      });

      paint(painter, { color: { r: 90, g: 120, b: 210 } });
      unsubscribe();

      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.textureId === painter.session.textureViews[0].id)).toBe(true);
      expect(events.some((event) =>
        event.minX <= 14 && event.maxX >= 14 && event.minY <= 8 && event.maxY >= 8
      )).toBe(true);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("pads scoped texture painting into unused texels without bleeding into neighboring UV islands", () => {
    const painter = makePainter();
    try {
      const selection = painter.session.selectIntersection(painter.intersection);
      expect(selection?.hasUvIsland).toBe(true);
      const textureId = selection!.textureId;
      const settings: UnitPainterBrushSettings = {
        radiusPx: 12,
        opacity: 1,
        hardness: 1,
        mode: "paint",
        color: { r: 255, g: 80, b: 20 },
      };

      painter.session.beginStroke();
      const withoutPadding = painter.session.paintTexturePoint(
        textureId,
        7.4,
        8.5,
        1,
        settings,
        "island",
        0,
      );
      expect(withoutPadding?.changed).toBe(false);
      expect(painter.session.endStroke()).toBe(false);
      expect(getPixel(painter.material, 7, 8)).toEqual([0, 0, 0, 255]);

      painter.session.beginStroke();
      const withPadding = painter.session.paintTexturePoint(
        textureId,
        7.4,
        8.5,
        1,
        settings,
        "island",
        2,
      );
      expect(withPadding?.changed).toBe(true);
      expect(painter.session.endStroke()).toBe(true);
      expect(getPixel(painter.material, 7, 8)).toEqual([255, 80, 20, 255]);

      painter.session.beginStroke();
      painter.session.paintTexturePoint(
        textureId,
        17.5,
        8.5,
        1,
        settings,
        "island",
        8,
      );
      painter.session.endStroke();

      // x=17 belongs to the second disconnected island. Padding from the first
      // island may fill atlas gutter texels nearby, but never UV-covered texels.
      expect(getPixel(painter.material, 17, 8)).toEqual([0, 0, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("clips direct texture painting to the selected UV island when requested", () => {
    const painter = makePainter();
    try {
      const selection = painter.session.selectIntersection(painter.intersection);
      expect(selection?.hasUvIsland).toBe(true);
      const textureId = selection!.textureId;
      const settings: UnitPainterBrushSettings = {
        radiusPx: 12,
        opacity: 1,
        hardness: 1,
        mode: "paint",
        color: { r: 255, g: 0, b: 0 },
      };

      painter.session.beginStroke();
      const outside = painter.session.paintTexturePoint(textureId, 20.5, 8.5, 1, settings, "island");
      expect(outside?.changed).toBe(false);
      const inside = painter.session.paintTexturePoint(textureId, 14.5, 8.5, 1, settings, "island");
      expect(inside?.changed).toBe(true);
      expect(painter.session.endStroke()).toBe(true);

      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([0, 0, 0, 255]);
      const selectedView = painter.session.textureViews.find((view) => view.id === textureId);
      expect(selectedView?.selectedUvSegments.length).toBeGreaterThan(0);
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


  it("returns exact material and UV-island triangle surfaces for highlighting", () => {
    const painter = makePainter();
    try {
      const material = painter.session.getIntersectionSurfaceHighlight(painter.intersection, "material");
      expect(material?.scope).toBe("material");
      expect(material?.materialIndex).toBe(0);
      expect(material?.indices).toEqual([0, 1, 2, 3, 4, 5]);

      const island = painter.session.getIntersectionSurfaceHighlight(painter.intersection, "island");
      expect(island?.scope).toBe("island");
      expect(island?.indices).toEqual([0, 1, 2]);
      expect(island?.islandId).toBeDefined();

      const secondIsland = {
        ...painter.intersection,
        face: {
          a: 3,
          b: 4,
          c: 5,
          normal: new THREE.Vector3(0, 0, 1),
          materialIndex: 0,
        },
        faceIndex: 1,
      } as THREE.Intersection<THREE.Object3D>;
      const second = painter.session.getIntersectionSurfaceHighlight(secondIsland, "island");
      expect(second?.indices).toEqual([3, 4, 5]);
      expect(second?.key).not.toBe(island?.key);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("uses the locked painter selection when resolving highlight scope", () => {
    const painter = makePainter();
    try {
      expect(painter.session.selectIntersection(painter.intersection)).toBeDefined();
      expect(painter.session.getSelectionSurfaceHighlight("material")?.indices).toEqual([0, 1, 2, 3, 4, 5]);
      expect(painter.session.getSelectionSurfaceHighlight("island")?.indices).toEqual([0, 1, 2]);

      painter.session.clearSelection();
      expect(painter.session.getSelectionSurfaceHighlight("material")).toBeUndefined();
      expect(painter.session.getSelectionSurfaceHighlight("island")).toBeUndefined();
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


  it("restores painted pixels toward the original BaseColour and keeps undo intact", () => {
    const painter = makePainter(makeTexture({ x: 14, y: 8, r: 40, g: 80, b: 120 }));
    try {
      paint(painter, { mode: "paint", color: { r: 240, g: 20, b: 10 } });
      expect(getPixel(painter.material, 14, 8)).toEqual([240, 20, 10, 255]);

      paint(painter, { mode: "restore", opacity: 0.5 });
      expect(getPixel(painter.material, 14, 8)).toEqual([140, 50, 65, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([240, 20, 10, 255]);

      paint(painter, { mode: "restore", opacity: 1 });
      expect(getPixel(painter.material, 14, 8)).toEqual([40, 80, 120, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("keeps brush stamp spacing uniform across irregular pointer-event segments", () => {
    const spacing = getUnitPainterBrushSpacing(20);
    expect(spacing).toBe(7);

    let x = 0;
    let carried = 0;
    const samples: number[] = [];
    for (const nextX of [3, 17, 19, 44, 70]) {
      const result = sampleUnitPainterStrokeSegment(x, 0, nextX, 0, spacing, carried);
      samples.push(...result.samples.map((sample) => sample.x));
      carried = result.distanceSinceLastStamp;
      x = nextX;
    }

    expect(samples).toHaveLength(10);
    samples.forEach((sample, index) => expect(sample).toBeCloseTo((index + 1) * 7, 6));
    expect(carried).toBeCloseTo(0, 6);
  });

  it("produces the same straight-line stamp positions regardless of pointer-event frequency", () => {
    const spacing = 8;
    const collect = (events: number[]) => {
      let previous = 0;
      let carried = 0;
      const samples: number[] = [];
      for (const next of events) {
        const result = sampleUnitPainterStrokeSegment(previous, 0, next, 0, spacing, carried);
        samples.push(...result.samples.map((sample) => sample.x));
        carried = result.distanceSinceLastStamp;
        previous = next;
      }
      return { samples, carried };
    };

    const sparse = collect([64]);
    const noisy = collect([1, 7, 9, 14, 21, 22, 38, 41, 63, 64]);
    expect(noisy.samples).toEqual(sparse.samples);
    expect(noisy.carried).toBeCloseTo(sparse.carried, 6);
  });


  it("coalesces GPU update ranges across adjacent touched layer tiles", () => {
    const painter = makePainter();
    try {
      const internal = painter.session as unknown as {
        getTouchedTileUpdateRanges: (target: {
          width: number;
          height: number;
          touchedLayerTiles: Set<number>;
        }) => Array<{ start: number; count: number }>;
      };

      // 128x128 is a 2x2 tile grid. The two top tiles cover complete rows,
      // so those 64 rows collapse into one contiguous range. The bottom-left
      // tile remains one range per row because the right half is untouched.
      const ranges = internal.getTouchedTileUpdateRanges({
        width: 128,
        height: 128,
        touchedLayerTiles: new Set([0, 1, 2]),
      });

      // The first lower-left half-row begins immediately after the 64 complete
      // top rows, so it coalesces into that first contiguous byte range.
      expect(ranges).toHaveLength(64);
      expect(ranges[0]).toEqual({ start: 0, count: (128 * 64 + 64) * 4 });
      expect(ranges[1]).toEqual({ start: 128 * 65 * 4, count: 64 * 4 });
      expect(ranges.at(-1)).toEqual({ start: 128 * 127 * 4, count: 64 * 4 });
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("uses sparse GPU ranges for layer recomposition after the initial texture upload", () => {
    const painter = makePainter();
    try {
      paint(painter, { color: { r: 220, g: 30, b: 10 } });

      const internal = painter.session as unknown as {
        targetsByEditableTexture: Map<
          THREE.Texture,
          {
            editable: THREE.DataTexture;
            fullUploadPending: boolean;
            touchedLayerTiles: Set<number>;
          }
        >;
      };
      const target = [...internal.targetsByEditableTexture.values()][0];
      expect(target.touchedLayerTiles.size).toBeGreaterThan(0);

      // Vitest has no renderer to consume the initial DataTexture upload, so
      // emulate Three having completed it before testing the structural update.
      target.fullUploadPending = false;
      target.editable.clearUpdateRanges();

      expect(painter.session.setLayerOpacity(painter.session.activeLayerId, 0.5)).toBe(true);

      expect(target.fullUploadPending).toBe(false);
      expect(target.editable.updateRanges.length).toBeGreaterThan(0);
      expect(target.editable.updateRanges).toEqual([
        { start: 0, count: WIDTH * HEIGHT * 4 },
      ]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("stores cached material masks as sparse 64x64 bitset tiles", () => {
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

      const internal = painter.session as unknown as {
        uvMaskCacheBytes: number;
        uvMaskCacheLru: Map<number, {
          mask: { tiles: Map<number, Uint8Array>; byteSize: number };
        }>;
      };
      const masks = [...internal.uvMaskCacheLru.values()].map((entry) => entry.mask);
      expect(masks.length).toBeGreaterThan(0);
      expect(masks.every((mask) =>
        [...mask.tiles.values()].every((tile) => tile.byteLength === (64 * 64) / 8),
      )).toBe(true);
      expect(masks.every((mask) => mask.byteSize === mask.tiles.size * ((64 * 64) / 8))).toBe(true);
      expect(internal.uvMaskCacheBytes).toBe(
        masks.reduce((total, mask) => total + mask.byteSize, 0),
      );
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("evicts least-recently-used mask entries when the cache exceeds its byte budget", () => {
    const painter = makePainter();
    try {
      type FakeMask = {
        width: number;
        height: number;
        tiles: Map<number, Uint8Array>;
        byteSize: number;
      };
      type Cached = { cacheId: number; mask: FakeMask };
      const internal = painter.session as unknown as {
        uvMaskCacheBytes: number;
        uvMaskCacheLru: Map<number, unknown>;
        cacheUvMask: (cache: Map<string, Cached>, key: string, mask: FakeMask) => FakeMask;
        getCachedUvMask: (cache: Map<string, Cached>, key: string) => FakeMask | undefined;
      };
      const cache = new Map<string, Cached>();
      const makeMask = (byteSize: number): FakeMask => ({
        width: 1,
        height: 1,
        tiles: new Map(),
        byteSize,
      });
      const halfBudget = 16 * 1024 * 1024;

      internal.cacheUvMask(cache, "first", makeMask(halfBudget));
      internal.cacheUvMask(cache, "second", makeMask(halfBudget));
      expect(internal.getCachedUvMask(cache, "first")).toBeDefined();
      internal.cacheUvMask(cache, "third", makeMask(halfBudget));

      expect(cache.has("first")).toBe(true);
      expect(cache.has("second")).toBe(false);
      expect(cache.has("third")).toBe(true);
      expect(internal.uvMaskCacheBytes).toBe(32 * 1024 * 1024);
      expect(internal.uvMaskCacheLru.size).toBe(2);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("allocates layer pixels lazily in tiles and releases an emptied tile", () => {
    const painter = makePainter();
    try {
      const internal = painter.session as unknown as {
        activePaintLayerId: string;
        paintLayers: Array<{
          id: string;
          textures: Map<unknown, { tiles: Map<number, unknown> }>;
        }>;
        targetsByEditableTexture: Map<unknown, { touchedLayerTiles: Set<number> }>;
      };
      const getActiveTileCount = () => {
        const active = internal.paintLayers.find((layer) => layer.id === internal.activePaintLayerId);
        return [...(active?.textures.values() ?? [])].reduce(
          (count, texture) => count + texture.tiles.size,
          0,
        );
      };
      const getTouchedTileCount = () =>
        [...internal.targetsByEditableTexture.values()].reduce(
          (count, target) => count + target.touchedLayerTiles.size,
          0,
        );

      expect(getActiveTileCount()).toBe(0);
      expect(getTouchedTileCount()).toBe(0);
      paint(painter, { mode: "paint", color: { r: 255, g: 0, b: 0 } });
      expect(getActiveTileCount()).toBe(1);
      expect(getTouchedTileCount()).toBe(1);

      paint(painter, { mode: "restore", opacity: 1 });
      expect(getActiveTileCount()).toBe(0);
      expect(getTouchedTileCount()).toBe(0);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 0, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(getActiveTileCount()).toBe(1);
      expect(getTouchedTileCount()).toBe(1);
      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("prunes stale touched tiles after deleting the last painted layer and restores them on undo", () => {
    const painter = makePainter();
    try {
      paint(painter, { color: { r: 180, g: 30, b: 20 } });
      const paintedLayerId = painter.session.activeLayerId;
      expect(painter.session.addLayer("Empty")).toBeDefined();
      expect(painter.session.setActiveLayer(paintedLayerId)).toBe(true);

      const internal = painter.session as unknown as {
        targetsByEditableTexture: Map<unknown, { touchedLayerTiles: Set<number> }>;
      };
      const target = [...internal.targetsByEditableTexture.values()][0];
      expect(target.touchedLayerTiles.size).toBe(1);

      expect(painter.session.deleteActiveLayer()).toBe(true);
      expect(target.touchedLayerTiles.size).toBe(0);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 0, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(target.touchedLayerTiles.size).toBe(1);
      expect(getPixel(painter.material, 14, 8)).toEqual([180, 30, 20, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("composites paint layers in order and respects layer opacity and visibility", () => {
    const painter = makePainter();
    try {
      paint(painter, { color: { r: 255, g: 0, b: 0 } });
      const lowerLayerId = painter.session.activeLayerId;
      const upperLayerId = painter.session.addLayer("Blue");
      expect(upperLayerId).toBeDefined();
      paint(painter, { color: { r: 0, g: 0, b: 255 } });
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 255, 255]);

      expect(painter.session.setLayerOpacity(upperLayerId!, 0.5)).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([128, 0, 128, 255]);

      expect(painter.session.setLayerVisible(upperLayerId!, false)).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([128, 0, 128, 255]);
      expect(painter.session.setActiveLayer(lowerLayerId)).toBe(true);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("restore erases only the active layer and reveals the layer below", () => {
    const painter = makePainter();
    try {
      paint(painter, { color: { r: 255, g: 0, b: 0 } });
      painter.session.addLayer("Blue");
      paint(painter, { color: { r: 0, g: 0, b: 255 } });
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 255, 255]);

      paint(painter, { mode: "restore", opacity: 1 });
      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 255, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("reorders, deletes, and restores layers through undo/redo", () => {
    const painter = makePainter();
    try {
      paint(painter, { color: { r: 255, g: 0, b: 0 } });
      const blueId = painter.session.addLayer("Blue");
      expect(blueId).toBeDefined();
      paint(painter, { color: { r: 0, g: 0, b: 255 } });
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 255, 255]);

      expect(painter.session.moveLayer(blueId!, -1)).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);
      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 255, 255]);

      expect(painter.session.deleteActiveLayer()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);
      expect(painter.session.undo()).toBe(true);
      expect(painter.session.activeLayerId).toBe(blueId!);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 255, 255]);
      expect(painter.session.redo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("clear layer removes only active-layer paint and is undoable", () => {
    const painter = makePainter();
    try {
      paint(painter, { color: { r: 255, g: 0, b: 0 } });
      painter.session.addLayer("Blue");
      paint(painter, { color: { r: 0, g: 0, b: 255 } });
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 255, 255]);

      expect(painter.session.reset()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([255, 0, 0, 255]);
      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 255, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("exports and reloads the complete layer stack as a clean project state", () => {
    const source = makePainter();
    const reopened = makePainter();
    try {
      paint(source, { color: { r: 200, g: 10, b: 20 } });
      const topId = source.session.addLayer("Highlights");
      expect(topId).toBeDefined();
      paint(source, { color: { r: 20, g: 220, b: 40 }, opacity: 0.75 });
      expect(source.session.setLayerOpacity(topId!, 0.6)).toBe(true);
      expect(source.session.renameLayer(topId!, "Green highlights")).toBe(true);

      const state = source.session.exportProjectState();
      expect(state.layers.flatMap((layer) => layer.textures).every((texture) =>
        texture.tiles.every((tile) => tile.rgbaBytes.length === 64 * 64 * 4),
      )).toBe(true);
      expect(state.layers.flatMap((layer) => layer.textures).some((texture) => texture.tiles.length > 0)).toBe(true);
      reopened.session.loadProjectLayers(state);

      expect(reopened.session.layers).toEqual(source.session.layers);
      expect(reopened.session.activeLayerId).toBe(source.session.activeLayerId);
      expect(getPixel(reopened.material, 14, 8)).toEqual(getPixel(source.material, 14, 8));
      expect(reopened.session.hasUnsavedChanges).toBe(false);
      expect(reopened.session.canUndo).toBe(false);

      paint(reopened, { mode: "restore", opacity: 1 });
      expect(reopened.session.hasUnsavedChanges).toBe(true);
    } finally {
      source.session.dispose();
      reopened.session.dispose();
      source.geometry.dispose();
      reopened.geometry.dispose();
      source.material.dispose();
      reopened.material.dispose();
    }
  });

  it("evicts oldest undo entries when retained history exceeds the byte budget", () => {
    const painter = makePainter();
    try {
      const internal = painter.session as unknown as {
        history: Array<{ byteSize: number; marker?: string }>;
        retainedHistoryBytes: number;
        trimHistoryToBudget: () => void;
      };
      const mib = 1024 * 1024;
      internal.history.splice(
        0,
        internal.history.length,
        { byteSize: 40 * mib, marker: "oldest" },
        { byteSize: 40 * mib, marker: "middle" },
        { byteSize: 40 * mib, marker: "newest" },
      );
      internal.retainedHistoryBytes = 120 * mib;

      internal.trimHistoryToBudget();

      expect(internal.history.map((entry) => entry.marker)).toEqual(["middle", "newest"]);
      expect(internal.retainedHistoryBytes).toBe(80 * mib);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("keeps one oversized latest undo entry and does not double-count undo/redo moves", () => {
    const painter = makePainter();
    try {
      const internal = painter.session as unknown as {
        history: Array<{ byteSize: number; marker?: string }>;
        redoHistory: Array<{ byteSize: number; marker?: string }>;
        retainedHistoryBytes: number;
        trimHistoryToBudget: () => void;
      };
      const mib = 1024 * 1024;
      internal.history.splice(0, internal.history.length, { byteSize: 120 * mib, marker: "latest" });
      internal.redoHistory.length = 0;
      internal.retainedHistoryBytes = 120 * mib;

      internal.trimHistoryToBudget();

      expect(internal.history).toHaveLength(1);
      expect(internal.retainedHistoryBytes).toBe(120 * mib);

      // Real undo/redo should move a retained entry without changing accounted bytes.
      internal.history.length = 0;
      internal.retainedHistoryBytes = 0;
      paint(painter, { color: { r: 10, g: 20, b: 30 } });
      const retained = internal.retainedHistoryBytes;
      expect(retained).toBeGreaterThan(0);
      expect(painter.session.undo()).toBe(true);
      expect(internal.retainedHistoryBytes).toBe(retained);
      expect(painter.session.redo()).toBe(true);
      expect(internal.retainedHistoryBytes).toBe(retained);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("tracks layer metadata edits in the saved-state undo model", () => {
    const painter = makePainter();
    try {
      painter.session.markSaved();
      const layerId = painter.session.activeLayerId;
      expect(painter.session.renameLayer(layerId, "Armor")).toBe(true);
      expect(painter.session.hasUnsavedChanges).toBe(true);
      expect(painter.session.undo()).toBe(true);
      expect(painter.session.hasUnsavedChanges).toBe(false);
      expect(painter.session.layers[0].name).toBe("Paint 1");
      expect(painter.session.redo()).toBe(true);
      expect(painter.session.layers[0].name).toBe("Armor");
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });


  it("merge down preserves the current two-layer appearance and is undoable", () => {
    const painter = makePainter();
    try {
      paint(painter, { color: { r: 255, g: 0, b: 0 } });
      painter.session.addLayer("Blue");
      paint(painter, { color: { r: 0, g: 0, b: 255 } });
      expect(painter.session.setLayerOpacity(painter.session.activeLayerId, 0.5)).toBe(true);
      const beforeMerge = getPixel(painter.material, 14, 8);

      expect(painter.session.mergeActiveLayerDown()).toBe(true);
      expect(painter.session.layers).toHaveLength(1);
      expect(getPixel(painter.material, 14, 8)).toEqual(beforeMerge);

      expect(painter.session.undo()).toBe(true);
      expect(painter.session.layers).toHaveLength(2);
      expect(getPixel(painter.material, 14, 8)).toEqual(beforeMerge);

      expect(painter.session.redo()).toBe(true);
      expect(painter.session.layers).toHaveLength(1);
      expect(getPixel(painter.material, 14, 8)).toEqual(beforeMerge);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

});
