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

  it("adds and toggles multiple UV-island selections", () => {
    const painter = makePainter();
    try {
      const textureId = painter.session.textureViews[0].id;

      expect(
        painter.session.selectTexturePoint(textureId, 14.5, 8.5, "island", "replace"),
      ).toBeDefined();
      expect(
        painter.session.selectTexturePoint(textureId, 20.5, 8.5, "island", "add"),
      ).toBeDefined();
      expect(painter.session.selectionCount).toBe(2);
      expect(painter.session.getTextureViews("island")[0].selectedUvTriangles).toHaveLength(12);

      expect(
        painter.session.selectTexturePoint(textureId, 14.5, 8.5, "island", "toggle"),
      ).toBeDefined();
      expect(painter.session.selectionCount).toBe(1);
      expect(painter.session.getTextureViews("island")[0].selectedUvTriangles).toHaveLength(6);

      expect(
        painter.session.selectTexturePoint(textureId, 20.5, 8.5, "island", "toggle"),
      ).toBeDefined();
      expect(painter.session.selectionCount).toBe(0);
      expect(painter.session.selectionInfo).toBeUndefined();
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("fills the union of multiple selected UV islands as one undoable operation", () => {
    const painter = makePainter();
    try {
      const textureId = painter.session.textureViews[0].id;
      painter.session.selectTexturePoint(textureId, 14.5, 8.5, "island", "replace");
      painter.session.selectTexturePoint(textureId, 20.5, 8.5, "island", "add");

      expect(
        painter.session.fillSelection("island", {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 220, g: 80, b: 40 },
        }),
      ).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([220, 80, 40, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([220, 80, 40, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([0, 0, 0, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([0, 0, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("uses the same add and toggle semantics for material selection", () => {
    const painter = makePainter();
    try {
      const textureId = painter.session.textureViews[0].id;

      painter.session.selectTexturePoint(textureId, 14.5, 8.5, "material", "replace");
      painter.session.selectTexturePoint(textureId, 20.5, 8.5, "material", "add");
      // Both triangles are the same mesh/material, so add must not duplicate it.
      expect(painter.session.selectionCount).toBe(1);

      painter.session.selectTexturePoint(textureId, 20.5, 8.5, "material", "toggle");
      expect(painter.session.selectionCount).toBe(0);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("selects matching visible colors into a frozen similar-color mask", () => {
    const texture = makeTexture();
    const image = texture.image as { data: Uint8Array };
    const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
      const offset = (y * WIDTH + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
    };
    setPixel(14, 8, 180, 40, 30);
    setPixel(20, 8, 180, 40, 30);
    setPixel(5, 5, 20, 90, 220);

    const painter = makePainter(texture);
    try {
      const textureId = painter.session.textureViews[0].id;
      expect(
        painter.session.selectSimilarTexturePoint(textureId, 14.5, 8.5, 0, "replace"),
      ).toBe(true);
      expect(painter.session.hasSimilarSelection).toBe(true);
      expect(painter.session.getTextureViews("similar")[0].selectedPixelMask).toBeDefined();

      expect(
        painter.session.fillSelection("similar", {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 10, g: 220, b: 80 },
        }),
      ).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([10, 220, 80, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([10, 220, 80, 255]);
      expect(getPixel(painter.material, 5, 5)).toEqual([20, 90, 220, 255]);

      // The selection is a snapshot: changing its colors does not change membership.
      expect(
        painter.session.fillSelection("similar", {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 240, g: 200, b: 20 },
        }),
      ).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([240, 200, 20, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([240, 200, 20, 255]);
      expect(getPixel(painter.material, 5, 5)).toEqual([20, 90, 220, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("adds and toggles similar-color masks with Shift/Ctrl semantics", () => {
    const texture = makeTexture();
    const image = texture.image as { data: Uint8Array };
    const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
      const offset = (y * WIDTH + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
    };
    setPixel(14, 8, 200, 30, 40);
    setPixel(20, 8, 200, 30, 40);
    setPixel(5, 5, 30, 80, 210);

    const painter = makePainter(texture);
    try {
      const textureId = painter.session.textureViews[0].id;
      expect(painter.session.selectSimilarTexturePoint(textureId, 14.5, 8.5, 0, "replace")).toBe(true);
      expect(painter.session.selectSimilarTexturePoint(textureId, 5.5, 5.5, 0, "add")).toBe(true);
      expect(painter.session.selectSimilarTexturePoint(textureId, 14.5, 8.5, 0, "toggle")).toBe(true);

      expect(
        painter.session.fillSelection("similar", {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 50, g: 220, b: 220 },
        }),
      ).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([200, 30, 40, 255]);
      expect(getPixel(painter.material, 20, 8)).toEqual([200, 30, 40, 255]);
      expect(getPixel(painter.material, 5, 5)).toEqual([50, 220, 220, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("keeps both halves of a vertical split and lets the active half switch", () => {
    const painter = makePainter();
    try {
      const textureId = painter.session.textureViews[0].id;
      painter.session.selectTexturePoint(textureId, 14.5, 8.5, "island", "replace");

      expect(painter.session.splitSelection("island", "vertical")).toBe(true);
      expect(painter.session.selectionPartitionInfo?.regions.map(({ label }) => label))
        .toEqual(["Left", "Right"]);
      expect(painter.session.selectionPartitionInfo?.regions[0].active).toBe(true);

      expect(
        painter.session.fillSelection("island", {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 220, g: 30, b: 30 },
        }),
      ).toBe(true);
      expect(getPixel(painter.material, 9, 9)).toEqual([220, 30, 30, 255]);
      expect(getPixel(painter.material, 13, 9)).toEqual([0, 0, 0, 255]);

      expect(painter.session.setSelectionPartitionRegion("right")).toBe(true);
      expect(
        painter.session.fillSelection("island", {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 30, g: 60, b: 220 },
        }),
      ).toBe(true);
      expect(getPixel(painter.material, 9, 9)).toEqual([220, 30, 30, 255]);
      expect(getPixel(painter.material, 13, 9)).toEqual([30, 60, 220, 255]);

      expect(painter.session.selectAllSelectionPartitionRegions()).toBe(true);
      expect(painter.session.selectionPartitionInfo?.allActive).toBe(true);
      expect(painter.session.getTextureViews("island")[0].selectedPixelMask).toBeDefined();

      expect(painter.session.removeSelectionPartition()).toBe(true);
      expect(painter.session.selectionPartitionInfo).toBeUndefined();
      expect(painter.session.getTextureViews("island")[0].selectedPixelMask).toBeUndefined();
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("partitions a selection into four persistent X regions", () => {
    const painter = makePainter();
    try {
      const textureId = painter.session.textureViews[0].id;
      // Default texture is uniformly black, so Similar at tolerance 0 selects the
      // full texture and guarantees all four geometric wedges are populated.
      expect(painter.session.selectSimilarTexturePoint(textureId, 1.5, 1.5, 0, "replace")).toBe(true);

      expect(painter.session.splitSelection("similar", "x")).toBe(true);
      expect(painter.session.selectionPartitionInfo?.regions.map(({ label }) => label))
        .toEqual(["Top", "Right", "Bottom", "Left"]);

      expect(painter.session.setSelectionPartitionRegion("right")).toBe(true);
      expect(painter.session.selectionPartitionInfo?.regions.find(({ id }) => id === "right")?.active)
        .toBe(true);
      expect(painter.session.setSelectionPartitionRegion("left", "add")).toBe(true);
      expect(
        painter.session.selectionPartitionInfo?.regions
          .filter(({ active }) => active)
          .map(({ id }) => id)
          .sort(),
      ).toEqual(["left", "right"]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("adds, tints, moves, and restores a decal layer", () => {
    const painter = makePainter();
    const sourceBytes = new Uint8Array(4 * 4 * 4);
    for (let index = 0; index < sourceBytes.length; index += 4) {
      sourceBytes[index] = 255;
      sourceBytes[index + 1] = 255;
      sourceBytes[index + 2] = 255;
      sourceBytes[index + 3] = 255;
    }

    try {
      const layerId = painter.session.addDecalLayerAtIntersection(painter.intersection, {
        name: "eagle.png",
        width: 4,
        height: 4,
        rgbaBytes: sourceBytes,
      });
      expect(layerId).toBeTruthy();
      expect(painter.session.activeDecalInfo?.sourceName).toBe("eagle.png");
      expect(painter.session.layers.at(-1)?.kind).toBe("decal");
      expect(getPixel(painter.material, 14, 9)).toEqual([255, 255, 255, 255]);
      // The decal rectangle reaches the adjacent second UV island, but placement
      // on face 0 must clip it to the first island only.
      expect(getPixel(painter.material, 17, 9)).toEqual([0, 0, 0, 255]);

      expect(
        painter.session.updateActiveDecal({
          tintEnabled: true,
          tint: { r: 220, g: 40, b: 30 },
        }),
      ).toBe(true);
      expect(getPixel(painter.material, 14, 9)).toEqual([220, 40, 30, 255]);
      expect(getPixel(painter.material, 17, 9)).toEqual([0, 0, 0, 255]);

      expect(painter.session.beginActiveDecalTransform()).toBe(true);
      const moved = {
        ...painter.intersection,
        uv: new THREE.Vector2(0.62, 0.32),
        face: {
          a: 3,
          b: 4,
          c: 5,
          normal: new THREE.Vector3(0, 0, 1),
          materialIndex: 0,
        },
        faceIndex: 1,
      } as THREE.Intersection<THREE.Object3D>;
      expect(painter.session.moveActiveDecalToIntersection(moved, true)).toBe(true);
      expect(painter.session.endActiveDecalTransform()).toBe(true);
      expect(painter.session.activeDecalInfo?.centerU).toBeCloseTo(0.62);
      expect(getPixel(painter.material, 14, 9)).toEqual([0, 0, 0, 255]);
      expect(getPixel(painter.material, 20, 10)).toEqual([220, 40, 30, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(painter.session.activeDecalInfo?.centerU).toBeCloseTo(0.46);
      expect(getPixel(painter.material, 14, 9)).toEqual([220, 40, 30, 255]);
      expect(getPixel(painter.material, 20, 10)).toEqual([0, 0, 0, 255]);
      expect(painter.session.redo()).toBe(true);
      expect(painter.session.activeDecalInfo?.centerU).toBeCloseTo(0.62);
      expect(getPixel(painter.material, 14, 9)).toEqual([0, 0, 0, 255]);
      expect(getPixel(painter.material, 20, 10)).toEqual([220, 40, 30, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("flips decal source sampling without changing its placement", () => {
    const painter = makePainter();
    const sourceBytes = new Uint8Array([
      255, 0, 0, 255,     0, 255, 0, 255,
      0, 0, 255, 255,     255, 255, 255, 255,
    ]);

    try {
      expect(
        painter.session.addDecalLayerAtIntersection(painter.intersection, {
          name: "quadrants.png",
          width: 2,
          height: 2,
          rgbaBytes: sourceBytes,
        }),
      ).toBeTruthy();

      const originalTop = getPixel(painter.material, 12, 8);
      const originalBottom = getPixel(painter.material, 12, 11);
      expect(originalTop[0]).toBeGreaterThan(originalTop[2]);
      expect(originalBottom[2]).toBeGreaterThan(originalBottom[0]);

      expect(painter.session.updateActiveDecal({ flipY: true })).toBe(true);
      const flippedTop = getPixel(painter.material, 12, 8);
      const flippedBottom = getPixel(painter.material, 12, 11);
      expect(flippedTop[2]).toBeGreaterThan(flippedTop[0]);
      expect(flippedBottom[0]).toBeGreaterThan(flippedBottom[2]);

      expect(painter.session.updateActiveDecal({ flipX: true, flipY: false })).toBe(true);
      const flippedLeft = getPixel(painter.material, 13, 8);
      const flippedRight = getPixel(painter.material, 15, 8);
      expect(flippedLeft[1]).toBeGreaterThan(flippedLeft[0]);
      expect(flippedRight[0]).toBeGreaterThan(flippedRight[1]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("reverses decal normal relief for negative strength", () => {
    const base = makeTexture();
    const normalData = new Uint8Array(WIDTH * HEIGHT * 4);
    for (let index = 0; index < normalData.length; index += 4) {
      normalData[index] = 128;
      normalData[index + 1] = 128;
      normalData[index + 2] = 255;
      normalData[index + 3] = 255;
    }
    const normal = new THREE.DataTexture(
      normalData,
      WIDTH,
      HEIGHT,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    normal.flipY = false;
    normal.userData.wh3SourceVirtualPath = "variantmeshes\\unit\\body_normal.dds";
    normal.needsUpdate = true;

    const painter = makePainter(base);
    (painter.material as THREE.MeshBasicMaterial & { normalMap?: THREE.Texture }).normalMap = normal;
    painter.session.dispose();
    const replacement = createUnitPainterSession(painter.mesh);

    const sourceBytes = new Uint8Array(4 * 4 * 4);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const offset = (y * 4 + x) * 4;
        sourceBytes[offset] = 255;
        sourceBytes[offset + 1] = 255;
        sourceBytes[offset + 2] = 255;
        sourceBytes[offset + 3] = Math.round((x / 3) * 255);
      }
    }

    try {
      expect(
        replacement.addDecalLayerAtIntersection(painter.intersection, {
          name: "gradient.png",
          width: 4,
          height: 4,
          rgbaBytes: sourceBytes,
        }),
      ).toBeTruthy();
      expect(replacement.updateActiveDecal({
        affectNormal: true,
        normalStrength: 2,
        normalHeightSource: "alpha",
      })).toBe(true);
      const positive = replacement.exportModifiedTextures().find((texture) =>
        texture.sourceVirtualPath === "variantmeshes\\unit\\body_normal.dds"
      )?.rgbaBytes;
      expect(positive).toBeDefined();

      expect(replacement.updateActiveDecal({ normalStrength: -2 })).toBe(true);
      const negative = replacement.exportModifiedTextures().find((texture) =>
        texture.sourceVirtualPath === "variantmeshes\\unit\\body_normal.dds"
      )?.rgbaBytes;
      expect(negative).toBeDefined();

      let foundOppositeSlope = false;
      for (let index = 0; index < normalData.length; index += 4) {
        for (const channel of [0, 1]) {
          const positiveDelta = positive![index + channel] - normalData[index + channel];
          const negativeDelta = negative![index + channel] - normalData[index + channel];
          if (positiveDelta * negativeDelta < 0) {
            foundOppositeSlope = true;
            break;
          }
        }
        if (foundOppositeSlope) break;
      }
      expect(foundOppositeSlope).toBe(true);
    } finally {
      replacement.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
      normal.dispose();
    }
  });

  it("generates a distinct cached emboss relief from opaque decal alpha", () => {
    const base = makeTexture();
    const normalData = new Uint8Array(WIDTH * HEIGHT * 4);
    for (let index = 0; index < normalData.length; index += 4) {
      normalData[index] = 128;
      normalData[index + 1] = 128;
      normalData[index + 2] = 255;
      normalData[index + 3] = 255;
    }
    const normal = new THREE.DataTexture(
      normalData,
      WIDTH,
      HEIGHT,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    normal.flipY = false;
    normal.userData.wh3SourceVirtualPath = "variantmeshes\\unit\\body_normal.dds";
    normal.needsUpdate = true;

    const painter = makePainter(base);
    (painter.material as THREE.MeshBasicMaterial & { normalMap?: THREE.Texture }).normalMap = normal;
    painter.session.dispose();
    const session = createUnitPainterSession(painter.mesh);
    const sourceBytes = new Uint8Array(16 * 16 * 4);
    for (let index = 0; index < sourceBytes.length; index += 4) {
      sourceBytes[index] = 255;
      sourceBytes[index + 1] = 255;
      sourceBytes[index + 2] = 255;
      sourceBytes[index + 3] = 255;
    }

    try {
      expect(session.addDecalLayerAtIntersection(painter.intersection, {
        name: "solid-badge.png",
        width: 16,
        height: 16,
        rgbaBytes: sourceBytes,
      })).toBeTruthy();
      expect(session.updateActiveDecal({
        affectNormal: true,
        normalStrength: 2,
        normalHeightSource: "alpha",
      })).toBe(true);
      const alphaNormal = session.exportModifiedTextures().find((texture) =>
        texture.sourceVirtualPath === "variantmeshes\\unit\\body_normal.dds"
      )?.rgbaBytes;
      expect(alphaNormal).toBeDefined();

      expect(session.updateActiveDecal({
        normalHeightSource: "emboss",
        normalBevelPx: 6,
        normalSoftnessPx: 1,
      })).toBe(true);
      const embossNormal = session.exportModifiedTextures().find((texture) =>
        texture.sourceVirtualPath === "variantmeshes\\unit\\body_normal.dds"
      )?.rgbaBytes;
      expect(embossNormal).toBeDefined();
      expect(embossNormal).not.toEqual(alphaNormal);
      expect(session.activeDecalInfo?.normalBevelPx).toBe(6);
      expect(session.activeDecalInfo?.normalSoftnessPx).toBe(1);

      // Reapplying the same emboss settings exercises the cached height field
      // and must be deterministic.
      expect(session.updateActiveDecal({ normalStrength: 2 })).toBe(true);
      const secondEmboss = session.exportModifiedTextures().find((texture) =>
        texture.sourceVirtualPath === "variantmeshes\\unit\\body_normal.dds"
      )?.rgbaBytes;
      expect(secondEmboss).toEqual(embossNormal);
    } finally {
      session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
      normal.dispose();
    }
  });

  it("replaces a decal image without changing its transform or placement", () => {
    const painter = makePainter();
    const original = new Uint8Array(4 * 4 * 4);
    const replacement = new Uint8Array(2 * 6 * 4);
    for (let index = 0; index < original.length; index += 4) {
      original[index] = 255;
      original[index + 3] = 255;
    }
    for (let index = 0; index < replacement.length; index += 4) {
      replacement[index + 1] = 255;
      replacement[index + 3] = 255;
    }

    try {
      expect(painter.session.addDecalLayerAtIntersection(painter.intersection, {
        name: "old.png",
        width: 4,
        height: 4,
        rgbaBytes: original,
      })).toBeTruthy();
      expect(painter.session.updateActiveDecal({
        centerU: 0.44,
        centerV: 0.34,
        widthU: 0.13,
        heightV: 0.09,
        rotationDeg: 27,
        tintEnabled: true,
        tint: { r: 90, g: 120, b: 210 },
        affectNormal: true,
        normalStrength: -1.5,
        flipX: true,
      })).toBe(true);
      const before = painter.session.activeDecalInfo!;

      expect(painter.session.replaceActiveDecalSource({
        name: "new.png",
        width: 2,
        height: 6,
        rgbaBytes: replacement,
      })).toBe(true);

      const after = painter.session.activeDecalInfo!;
      expect(after.sourceName).toBe("new.png");
      expect(after.targetTextureId).toBe(before.targetTextureId);
      expect(after.centerU).toBe(before.centerU);
      expect(after.centerV).toBe(before.centerV);
      expect(after.widthU).toBe(before.widthU);
      expect(after.heightV).toBe(before.heightV);
      expect(after.rotationDeg).toBe(before.rotationDeg);
      expect(after.tintEnabled).toBe(before.tintEnabled);
      expect(after.tint).toEqual(before.tint);
      expect(after.affectNormal).toBe(before.affectNormal);
      expect(after.normalStrength).toBe(before.normalStrength);
      expect(after.flipX).toBe(before.flipX);

      expect(painter.session.undo()).toBe(true);
      expect(painter.session.activeDecalInfo?.sourceName).toBe("old.png");
      expect(painter.session.redo()).toBe(true);
      expect(painter.session.activeDecalInfo?.sourceName).toBe("new.png");
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("resets decal transform while keeping its center and placement", () => {
    const painter = makePainter();
    const source = new Uint8Array(2 * 4 * 4);
    for (let index = 0; index < source.length; index += 4) source[index + 3] = 255;

    try {
      expect(painter.session.addDecalLayerAtIntersection(painter.intersection, {
        name: "tall.png",
        width: 2,
        height: 4,
        rgbaBytes: source,
      })).toBeTruthy();
      expect(painter.session.updateActiveDecal({
        widthU: 0.47,
        heightV: 0.11,
        rotationDeg: -83,
        flipX: true,
        flipY: true,
      })).toBe(true);
      const centerU = painter.session.activeDecalInfo!.centerU;
      const centerV = painter.session.activeDecalInfo!.centerV;

      expect(painter.session.resetActiveDecalTransform()).toBe(true);
      const reset = painter.session.activeDecalInfo!;
      expect(reset.centerU).toBe(centerU);
      expect(reset.centerV).toBe(centerV);
      expect(reset.widthU).toBeCloseTo(0.2);
      expect(reset.heightV).toBeCloseTo(0.4);
      expect(reset.rotationDeg).toBe(0);
      expect(reset.flipX).toBe(false);
      expect(reset.flipY).toBe(false);

      expect(painter.session.undo()).toBe(true);
      expect(painter.session.activeDecalInfo?.rotationDeg).toBe(-83);
      expect(painter.session.activeDecalInfo?.flipX).toBe(true);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("moves one decal layer across materials without leaving the old footprint", () => {
    const textureA = makeTexture();
    textureA.userData.wh3SourceVirtualPath = "variantmeshes\\unit\\decal_a_base_colour.dds";
    const textureB = makeTexture();
    textureB.userData.wh3SourceVirtualPath = "variantmeshes\\unit\\decal_b_base_colour.dds";

    const makeTriangle = (u0: number, v0: number, u1: number, v1: number, u2: number, v2: number) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
      );
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute([u0, v0, u1, v1, u2, v2], 2),
      );
      return geometry;
    };

    const geometryA = makeTriangle(0.15, 0.2, 0.45, 0.2, 0.15, 0.5);
    const geometryB = makeTriangle(0.55, 0.2, 0.85, 0.2, 0.55, 0.5);
    const materialA = new THREE.MeshBasicMaterial({ map: textureA });
    const materialB = new THREE.MeshBasicMaterial({ map: textureB });
    const meshA = new THREE.Mesh(geometryA, materialA);
    const meshB = new THREE.Mesh(geometryB, materialB);
    const root = new THREE.Group();
    root.add(meshA, meshB);
    root.updateMatrixWorld(true);
    const session = createUnitPainterSession(root);

    const hit = (
      mesh: THREE.Mesh,
      uv: THREE.Vector2,
    ) => ({
      distance: 1,
      point: new THREE.Vector3(),
      object: mesh,
      uv,
      face: {
        a: 0,
        b: 1,
        c: 2,
        normal: new THREE.Vector3(0, 0, 1),
        materialIndex: 0,
      },
      faceIndex: 0,
    }) as THREE.Intersection<THREE.Object3D>;

    const sourceBytes = new Uint8Array(4 * 4 * 4);
    for (let index = 0; index < sourceBytes.length; index += 4) {
      sourceBytes[index] = 255;
      sourceBytes[index + 1] = 255;
      sourceBytes[index + 2] = 255;
      sourceBytes[index + 3] = 255;
    }

    try {
      expect(
        session.addDecalLayerAtIntersection(hit(meshA, new THREE.Vector2(0.3, 0.3)), {
          name: "eagle.png",
          width: 4,
          height: 4,
          rgbaBytes: sourceBytes,
        }),
      ).toBeTruthy();
      const firstTextureId = session.activeDecalInfo?.targetTextureId;
      expect(getPixel(materialA, 9, 9)).toEqual([255, 255, 255, 255]);

      expect(session.beginActiveDecalTransform()).toBe(true);
      expect(
        session.moveActiveDecalToIntersection(
          hit(meshB, new THREE.Vector2(0.7, 0.3)),
          true,
        ),
      ).toBe(true);
      expect(session.endActiveDecalTransform()).toBe(true);

      expect(session.activeDecalInfo?.targetTextureId).not.toBe(firstTextureId);
      expect(getPixel(materialA, 9, 9)).toEqual([0, 0, 0, 255]);
      expect(getPixel(materialB, 22, 9)).toEqual([255, 255, 255, 255]);

      expect(session.undo()).toBe(true);
      expect(getPixel(materialA, 9, 9)).toEqual([255, 255, 255, 255]);
      expect(getPixel(materialB, 22, 9)).toEqual([0, 0, 0, 255]);
      expect(session.redo()).toBe(true);
      expect(getPixel(materialA, 9, 9)).toEqual([0, 0, 0, 255]);
      expect(getPixel(materialB, 22, 9)).toEqual([255, 255, 255, 255]);
    } finally {
      session.dispose();
      geometryA.dispose();
      geometryB.dispose();
      materialA.dispose();
      materialB.dispose();
      textureA.dispose();
      textureB.dispose();
    }
  });

  it("persists decal source and exact normal-map binding in project state", () => {
    const base = makeTexture();
    const normalData = new Uint8Array(WIDTH * HEIGHT * 4);
    for (let index = 0; index < normalData.length; index += 4) {
      normalData[index] = 128;
      normalData[index + 1] = 128;
      normalData[index + 2] = 255;
      normalData[index + 3] = 255;
    }
    const normal = new THREE.DataTexture(
      normalData,
      WIDTH,
      HEIGHT,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    normal.flipY = false;
    normal.userData.wh3SourceVirtualPath = "variantmeshes\\unit\\body_normal.dds";
    normal.needsUpdate = true;

    const painter = makePainter(base);
    (painter.material as THREE.MeshBasicMaterial & { normalMap?: THREE.Texture }).normalMap = normal;
    painter.session.dispose();

    // Recreate after attaching the normal so discovery sees it.
    const replacement = createUnitPainterSession(painter.mesh);
    try {
      const sourceBytes = new Uint8Array(4 * 4 * 4);
      for (let index = 0; index < sourceBytes.length; index += 4) {
        sourceBytes[index] = 255;
        sourceBytes[index + 1] = 255;
        sourceBytes[index + 2] = 255;
        sourceBytes[index + 3] = 255;
      }

      expect(
        replacement.addDecalLayerAtIntersection(painter.intersection, {
          name: "raised-eagle.png",
          width: 4,
          height: 4,
          rgbaBytes: sourceBytes,
        }),
      ).toBeTruthy();
      expect(replacement.activeDecalInfo?.hasNormalMap).toBe(true);
      expect(
        replacement.updateActiveDecal({
          affectNormal: true,
          normalStrength: -2,
          normalHeightSource: "emboss",
          normalBevelPx: 9,
          normalSoftnessPx: 2,
          flipX: true,
          flipY: true,
        }),
      ).toBe(true);

      const project = replacement.exportProjectState();
      expect(project.layers.at(-1)?.kind).toBe("decal");
      expect(project.layers.at(-1)?.decal?.sourceName).toBe("raised-eagle.png");
      expect(project.layers.at(-1)?.decal?.sourceRgbaBytes).toEqual(sourceBytes);
      expect(project.layers.at(-1)?.decal?.normalStrength).toBe(-2);
      expect(project.layers.at(-1)?.decal?.normalHeightSource).toBe("emboss");
      expect(project.layers.at(-1)?.decal?.normalBevelPx).toBe(9);
      expect(project.layers.at(-1)?.decal?.normalSoftnessPx).toBe(2);
      expect(project.layers.at(-1)?.decal?.flipX).toBe(true);
      expect(project.layers.at(-1)?.decal?.flipY).toBe(true);
      expect(project.layers.at(-1)?.decal?.normalSourceVirtualPath)
        .toBe("variantmeshes\\unit\\body_normal.dds");
      expect(project.layers.at(-1)?.decal?.placementMask?.tiles.length).toBeGreaterThan(0);
      expect(project.layers.at(-1)?.decal?.placementMask?.width).toBe(WIDTH);
      expect(project.layers.at(-1)?.decal?.placementMask?.height).toBe(HEIGHT);

      expect(replacement.updateActiveDecal({
        centerU: 0.41,
        centerV: 0.33,
        widthU: 0.17,
        heightV: 0.12,
        rotationDeg: 31,
        tintEnabled: true,
        tint: { r: 180, g: 70, b: 45 },
      })).toBe(true);

      const finalProject = replacement.exportProjectState();
      const exported = replacement.exportModifiedTextures();
      expect(exported.some((texture) =>
        texture.sourceVirtualPath === "variantmeshes\\unit\\body_base_colour.dds"
      )).toBe(true);
      const normalExport = exported.find((texture) =>
        texture.sourceVirtualPath === "variantmeshes\\unit\\body_normal.dds"
      );
      expect(normalExport).toBeDefined();
      expect(normalExport?.rgbaBytes).not.toEqual(normalData);

      const roundTripBase = makeTexture();
      const roundTripNormalData = new Uint8Array(normalData);
      const roundTripNormal = new THREE.DataTexture(
        roundTripNormalData,
        WIDTH,
        HEIGHT,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
      roundTripNormal.flipY = false;
      roundTripNormal.userData.wh3SourceVirtualPath = "variantmeshes\\unit\\body_normal.dds";
      roundTripNormal.needsUpdate = true;
      const roundTripPainter = makePainter(roundTripBase);
      (
        roundTripPainter.material as THREE.MeshBasicMaterial & { normalMap?: THREE.Texture }
      ).normalMap = roundTripNormal;
      roundTripPainter.session.dispose();
      const roundTripSession = createUnitPainterSession(roundTripPainter.mesh);
      try {
        roundTripSession.loadProjectLayers(finalProject);
        expect(roundTripSession.activeDecalInfo).toEqual(replacement.activeDecalInfo);

        const roundTripExport = roundTripSession.exportModifiedTextures();
        const byPath = new Map(exported.map((texture) => [
          texture.sourceVirtualPath,
          texture.rgbaBytes,
        ]));
        expect(roundTripExport.map((texture) => texture.sourceVirtualPath).toSorted())
          .toEqual([...byPath.keys()].toSorted());
        for (const texture of roundTripExport) {
          expect(texture.rgbaBytes).toEqual(byPath.get(texture.sourceVirtualPath));
        }

        const reexportedProject = roundTripSession.exportProjectState();
        expect(reexportedProject.layers.at(-1)?.decal?.sourceName)
          .toBe(finalProject.layers.at(-1)?.decal?.sourceName);
        expect(reexportedProject.layers.at(-1)?.decal?.placementMask)
          .toEqual(finalProject.layers.at(-1)?.decal?.placementMask);
      } finally {
        roundTripSession.dispose();
        roundTripPainter.geometry.dispose();
        roundTripPainter.material.dispose();
        roundTripNormal.dispose();
      }
    } finally {
      replacement.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
      normal.dispose();
    }
  });

  it("selects UV islands from interleaved texture coordinates", () => {
    const painter = makePainter();
    try {
      painter.geometry.setAttribute(
        "uv",
        new THREE.InterleavedBufferAttribute(
          new THREE.InterleavedBuffer(
            new Float32Array([
              0.25, 0.25, 0,
              0.5, 0.25, 0,
              0.25, 0.5, 0,
              0.52, 0.25, 0,
              0.77, 0.25, 0,
              0.52, 0.5, 0,
            ]),
            3,
          ),
          2,
          0,
        ),
      );

      const textureId = painter.session.textureViews[0].id;
      const island = painter.session.selectTexturePoint(textureId, 14.5, 8.5, "island");
      expect(island?.textureId).toBe(textureId);
      expect(island?.hasUvIsland).toBe(true);
      expect(painter.session.getTexturePointSurfaceHighlight(textureId, 14.5, 8.5, "island")?.scope)
        .toBe("island");
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("exposes the selected material footprint as UV triangles for texture display masking", () => {
    const painter = makePainter();
    try {
      painter.session.selectIntersection(painter.intersection);
      const islandView = painter.session.getTextureViews("island")[0];
      const materialView = painter.session.getTextureViews("material")[0];

      expect(islandView.selectedUvTriangles).toHaveLength(6);
      expect(materialView.selectedUvTriangles).toHaveLength(12);
      expect(materialView.selectedUvSegments.length).toBeGreaterThan(islandView.selectedUvSegments.length);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("maps 3D hover into texture coordinates and UV-island wireframe segments", () => {
    const painter = makePainter();
    try {
      const hover = painter.session.getIntersectionTextureHover(painter.intersection, "island");
      expect(hover?.textureId).toBe(painter.session.textureViews[0].id);
      expect(hover?.x).toBeCloseTo(0.46 * WIDTH, 6);
      expect(hover?.y).toBeCloseTo(0.28 * HEIGHT, 6);
      expect(hover?.scope).toBe("island");
      expect(hover?.uvSegments.length).toBeGreaterThan(0);

      const materialHover = painter.session.getIntersectionTextureHover(painter.intersection, "material");
      expect(materialHover?.uvSegments.length).toBeGreaterThan(hover?.uvSegments.length ?? 0);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("resolves texture-space material and island hover outlines", () => {
    const painter = makePainter();
    try {
      const textureId = painter.session.textureViews[0].id;

      const island = painter.session.getTexturePointHover(textureId, 14.5, 8.5, "island");
      expect(island?.textureId).toBe(textureId);
      expect(island?.scope).toBe("island");
      expect(island?.uvSegments.length).toBeGreaterThan(0);

      const material = painter.session.getTexturePointHover(textureId, 14.5, 8.5, "material");
      expect(material?.scope).toBe("material");
      expect(material?.uvSegments.length).toBeGreaterThan(island?.uvSegments.length ?? 0);

      expect(painter.session.getTexturePointHover(textureId, 2.5, 2.5, "island")).toBeUndefined();
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("maps texture hover back to the matching 3D material or UV island", () => {
    const painter = makePainter();
    try {
      const textureId = painter.session.textureViews[0].id;
      const island = painter.session.getTexturePointSurfaceHighlight(textureId, 14.5, 8.5, "island");
      expect(island?.scope).toBe("island");
      expect(island?.indices).toEqual([0, 1, 2]);

      const material = painter.session.getTexturePointSurfaceHighlight(textureId, 14.5, 8.5, "material");
      expect(material?.scope).toBe("material");
      expect(material?.indices).toEqual([0, 1, 2, 3, 4, 5]);

      const secondIsland = painter.session.getTexturePointSurfaceHighlight(textureId, 20.5, 8.5, "island");
      expect(secondIsland?.indices).toEqual([3, 4, 5]);
      expect(painter.session.getTexturePointSurfaceHighlight(textureId, 2.5, 2.5, "island")).toBeUndefined();
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
      expect(selectedView?.selectedUvTriangles.length).toBeGreaterThan(0);
      expect((selectedView?.selectedUvTriangles.length ?? 0) % 6).toBe(0);
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

  it("applies UV padding to Fill Island without painting neighboring islands", () => {
    const painter = makePainter();
    try {
      expect(painter.session.selectIntersection(painter.intersection)?.hasUvIsland).toBe(true);
      const changed = painter.session.fillSelection(
        "island",
        {
          radiusPx: 1,
          opacity: 1,
          hardness: 1,
          mode: "paint",
          color: { r: 240, g: 100, b: 30 },
        },
        2,
      );

      expect(changed).toBe(true);
      expect(getPixel(painter.material, 14, 8)).toEqual([240, 100, 30, 255]);
      // Just outside the selected island but inside its 2px atlas padding.
      expect(getPixel(painter.material, 7, 8)).toEqual([240, 100, 30, 255]);
      // Occupied by the disconnected second island: protected from padding.
      expect(getPixel(painter.material, 17, 8)).toEqual([0, 0, 0, 255]);

      expect(painter.session.undo()).toBe(true);
      expect(getPixel(painter.material, 7, 8)).toEqual([0, 0, 0, 255]);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
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

  it("reports normalized sample positions for UV-space drag interpolation", () => {
    const result = sampleUnitPainterStrokeSegment(10, 20, 30, 20, 5, 0);
    expect(result.samples.map((sample) => sample.amount)).toEqual([0.25, 0.5, 0.75, 1]);
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


  it("keeps touched-tile GPU update ranges within individual texture rows", () => {
    const painter = makePainter();
    try {
      const internal = painter.session as unknown as {
        getTouchedTileUpdateRanges: (target: {
          width: number;
          height: number;
          touchedLayerTiles: Set<number>;
        }) => Array<{ start: number; count: number }>;
      };

      // Three r186 uploads each DataTexture update range as a one-row
      // texSubImage2D call, so even vertically contiguous rows must remain
      // separate ranges. Horizontally adjacent tiles still coalesce per row.
      const ranges = internal.getTouchedTileUpdateRanges({
        width: 128,
        height: 128,
        touchedLayerTiles: new Set([0, 1, 2]),
      });

      expect(ranges).toHaveLength(128);
      expect(ranges[0]).toEqual({ start: 0, count: 128 * 4 });
      expect(ranges[63]).toEqual({ start: 128 * 63 * 4, count: 128 * 4 });
      expect(ranges[64]).toEqual({ start: 128 * 64 * 4, count: 64 * 4 });
      expect(ranges.at(-1)).toEqual({ start: 128 * 127 * 4, count: 64 * 4 });
      expect(ranges.every((range) => {
        const firstRow = Math.floor(range.start / (128 * 4));
        const lastRow = Math.floor((range.start + range.count - 1) / (128 * 4));
        return firstRow === lastRow;
      })).toBe(true);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("batches interpolated drag stamps into one dirty span per touched row", () => {
    const painter = makePainter();
    try {
      const internal = painter.session as unknown as {
        targetsByEditableTexture: Map<
          THREE.Texture,
          {
            editable: THREE.DataTexture;
            fullUploadPending: boolean;
          }
        >;
      };
      const target = [...internal.targetsByEditableTexture.values()][0];
      target.fullUploadPending = false;
      target.editable.clearUpdateRanges();

      // Keep both synthetic hits inside triangle 0 (u + v <= 1). A real
      // raycast could not report faceIndex 0 for a UV point beyond that diagonal.
      const startUv = new THREE.Vector2(0.38, 0.36);
      const endUv = new THREE.Vector2(0.48, 0.42);
      const start = {
        ...painter.intersection,
        point: new THREE.Vector3((startUv.x - 0.5) * 2, (startUv.y - 0.5) * 2, 0),
        uv: startUv,
      } as THREE.Intersection<THREE.Object3D>;
      const end = {
        ...painter.intersection,
        point: new THREE.Vector3((endUv.x - 0.5) * 2, (endUv.y - 0.5) * 2, 0),
        uv: endUv,
      } as THREE.Intersection<THREE.Object3D>;

      painter.session.beginStroke();
      expect(
        painter.session.paintIntersectionSamples(
          start,
          end,
          [0.2, 0.4, 0.6, 0.8, 1],
          {
            radiusPx: 12,
            opacity: 1,
            hardness: 1,
            mode: "paint",
            color: { r: 220, g: 40, b: 20 },
          },
          painter.camera,
          1000,
          12,
        ),
      ).toBe(true);
      painter.session.endStroke();

      const rows = target.editable.updateRanges.map((range) =>
        Math.floor(range.start / (WIDTH * 4)),
      );
      expect(new Set(rows).size).toBe(rows.length);
      expect(target.editable.updateRanges.every((range) => {
        const firstRow = Math.floor(range.start / (WIDTH * 4));
        const lastRow = Math.floor((range.start + range.count - 1) / (WIDTH * 4));
        return firstRow === lastRow;
      })).toBe(true);
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("reports submitted GPU update ranges for the completed stroke", () => {
    const painter = makePainter();
    try {
      const internal = painter.session as unknown as {
        targetsByEditableTexture: Map<
          THREE.Texture,
          {
            editable: THREE.DataTexture;
            fullUploadPending: boolean;
          }
        >;
      };
      const target = [...internal.targetsByEditableTexture.values()][0];
      target.fullUploadPending = false;
      target.editable.clearUpdateRanges();

      painter.session.beginStroke();
      expect(
        painter.session.paintIntersection(
          painter.intersection,
          {
            radiusPx: 12,
            opacity: 1,
            hardness: 1,
            mode: "paint",
            color: { r: 230, g: 40, b: 20 },
          },
          painter.camera,
          1000,
          12,
        ),
      ).toBe(true);
      expect(painter.session.endStroke()).toBe(true);

      expect(painter.session.lastStrokeGpuProfile.updateRanges).toBeGreaterThan(0);
      expect(painter.session.lastStrokeGpuProfile.updateBytes).toBeGreaterThan(0);
      expect(painter.session.lastStrokeGpuProfile.updateRanges).toBe(
        target.editable.updateRanges.length,
      );
      expect(painter.session.lastStrokeGpuProfile.updateBytes).toBe(
        target.editable.updateRanges.reduce((total, range) => total + range.count, 0),
      );
    } finally {
      painter.session.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
    }
  });

  it("keeps live brush GPU update ranges within individual texture rows", () => {
    const painter = makePainter();
    try {
      const internal = painter.session as unknown as {
        targetsByEditableTexture: Map<
          THREE.Texture,
          {
            editable: THREE.DataTexture;
            fullUploadPending: boolean;
          }
        >;
      };
      const target = [...internal.targetsByEditableTexture.values()][0];

      // Emulate the initial renderer upload so live brush edits use partial ranges.
      target.fullUploadPending = false;
      target.editable.clearUpdateRanges();

      paint(painter, { color: { r: 230, g: 40, b: 20 } });

      expect(target.editable.updateRanges.length).toBeGreaterThan(1);
      expect(target.editable.updateRanges.every((range) => {
        const firstRow = Math.floor(range.start / (WIDTH * 4));
        const lastRow = Math.floor((range.start + range.count - 1) / (WIDTH * 4));
        return firstRow === lastRow;
      })).toBe(true);
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
      expect(target.editable.updateRanges).toHaveLength(HEIGHT);
      expect(target.editable.updateRanges[0]).toEqual({ start: 0, count: WIDTH * 4 });
      expect(target.editable.updateRanges.at(-1)).toEqual({
        start: WIDTH * (HEIGHT - 1) * 4,
        count: WIDTH * 4,
      });
      expect(target.editable.updateRanges.every((range) => {
        const firstRow = Math.floor(range.start / (WIDTH * 4));
        const lastRow = Math.floor((range.start + range.count - 1) / (WIDTH * 4));
        return firstRow === lastRow;
      })).toBe(true);
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
