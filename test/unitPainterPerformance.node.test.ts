import { it } from "vitest";
import { performance } from "node:perf_hooks";
import * as THREE from "three";

import {
  createUnitPainterSession,
  getUnitPainterBrushSpacing,
  sampleUnitPainterStrokeSegment,
  type UnitPainterBrushSettings,
} from "../src/visuals/unitPainter";

const SIZE = 4096;
const SOURCE_PATH = "variantmeshes\\benchmark\\benchmark_base_colour.dds";
const runBenchmark = process.env.WHMM_UNIT_PAINTER_BENCHMARK === "1" ? it : it.skip;

const makePainter = () => {
  const data = new Uint8Array(SIZE * SIZE * 4);
  data.fill(255, 3, 4);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;

  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.flipY = false;
  texture.userData.wh3SourceVirtualPath = SOURCE_PATH;
  texture.needsUpdate = true;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
      -0.5,  0.5, 0,
       0.5, -0.5, 0,
       0.5,  0.5, 0,
      -0.5,  0.5, 0,
    ], 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute([
      0.25, 0.25,
      0.75, 0.25,
      0.25, 0.75,
      0.75, 0.25,
      0.75, 0.75,
      0.25, 0.75,
    ], 2),
  );

  const material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);

  const session = createUnitPainterSession(mesh);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(0, 0, 2);
  camera.updateMatrixWorld(true);

  const makeIntersection = (u: number, v: number) => ({
    distance: 2,
    point: new THREE.Vector3((u - 0.5) * 2, (v - 0.5) * 2, 0),
    object: mesh,
    uv: new THREE.Vector2(u, v),
    face: {
      a: 0,
      b: 1,
      c: 2,
      normal: new THREE.Vector3(0, 0, 1),
      materialIndex: 0,
    },
    faceIndex: 0,
  } as THREE.Intersection<THREE.Object3D>);

  const dispose = () => {
    session.dispose();
    geometry.dispose();
    material.dispose();
    texture.dispose();
  };

  return { session, camera, makeIntersection, dispose };
};

const paintSettings: UnitPainterBrushSettings = {
  radiusPx: 12,
  opacity: 1,
  hardness: 1,
  mode: "paint",
  color: { r: 210, g: 50, b: 30 },
};

const time = async (name: string, fn: () => void | Promise<void>) => {
  const start = performance.now();
  await fn();
  return { operation: name, ms: Number((performance.now() - start).toFixed(2)) };
};

runBenchmark(
  "profiles representative 4K painter operations",
  { timeout: 120_000 },
  async () => {
    const painter = makePainter();
    const rows: Array<{ operation: string; ms: number }> = [];
    let projectState: ReturnType<typeof painter.session.exportProjectState> | undefined;

    try {
      const center = painter.makeIntersection(0.5, 0.5);

      rows.push(await time("first brush dab", () => {
        painter.session.beginStroke();
        painter.session.paintIntersection(center, paintSettings, painter.camera, 1000, paintSettings.radiusPx);
        painter.session.endStroke();
      }));

      painter.session.addLayer("Continuous drag");
      rows.push(await time("continuous drag (24 pointer events)", () => {
        painter.session.beginStroke();
        let previousScreenX = 100;
        let previousU = 0.3;
        let carried = 0;
        const spacing = getUnitPainterBrushSpacing(paintSettings.radiusPx);

        const first = painter.makeIntersection(previousU, 0.5);
        painter.session.paintIntersection(
          first,
          paintSettings,
          painter.camera,
          1000,
          paintSettings.radiusPx,
        );
        let previousHit = first;

        for (let eventIndex = 1; eventIndex <= 24; eventIndex += 1) {
          const screenX = 100 + eventIndex * 8;
          const u = 0.3 + (eventIndex / 24) * 0.4;
          const sampled = sampleUnitPainterStrokeSegment(
            previousScreenX,
            500,
            screenX,
            500,
            spacing,
            carried,
          );
          const hit = painter.makeIntersection(u, 0.5);
          if (sampled.samples.length > 0) {
            painter.session.paintIntersectionSamples(
              previousHit,
              hit,
              sampled.samples.map((sample) => sample.amount),
              paintSettings,
              painter.camera,
              1000,
              paintSettings.radiusPx,
            );
          }
          carried = sampled.distanceSinceLastStamp;
          previousScreenX = screenX;
          previousU = u;
          previousHit = hit;
        }
        painter.session.endStroke();
      }));

      painter.session.addLayer("100 stamps");
      rows.push(await time("100 brush stamps", () => {
        painter.session.beginStroke();
        for (let y = 0; y < 10; y += 1) {
          for (let x = 0; x < 10; x += 1) {
            const u = 0.3 + (x / 9) * 0.4;
            const v = 0.3 + (y / 9) * 0.4;
            painter.session.paintIntersection(
              painter.makeIntersection(u, v),
              paintSettings,
              painter.camera,
              1000,
              paintSettings.radiusPx,
            );
          }
        }
        painter.session.endStroke();
      }));

      painter.session.selectIntersection(center);
      painter.session.addLayer("Material fill");
      rows.push(await time("fill material", () => {
        painter.session.fillSelection("material", {
          ...paintSettings,
          color: { r: 40, g: 120, b: 220 },
        });
      }));

      const filledLayerId = painter.session.activeLayerId;
      rows.push(await time("visibility toggle", () => {
        painter.session.setLayerVisible(filledLayerId, false);
        painter.session.setLayerVisible(filledLayerId, true);
      }));

      rows.push(await time("opacity change", () => {
        painter.session.setLayerOpacity(filledLayerId, 0.55);
      }));

      let duplicateId = "";
      rows.push(await time("duplicate layer", () => {
        duplicateId = painter.session.duplicateActiveLayer() ?? "";
      }));

      rows.push(await time("clear duplicated layer", () => {
        if (duplicateId) painter.session.reset();
      }));

      if (duplicateId) {
        painter.session.setActiveLayer(duplicateId);
        rows.push(await time("merge down", () => {
          painter.session.mergeActiveLayerDown();
        }));
      }

      rows.push(await time("undo + redo", () => {
        painter.session.undo();
        painter.session.redo();
      }));

      rows.push(await time("project state export", () => {
        projectState = painter.session.exportProjectState();
      }));

      if (!projectState) throw new Error("Benchmark project state was not created.");

      const reopened = makePainter();
      try {
        rows.push(await time("project state reopen", () => {
          reopened.session.loadProjectLayers(projectState!);
        }));
      } finally {
        reopened.dispose();
      }

      const memory = process.memoryUsage();
      console.table(rows);
      console.log("Painter benchmark memory", {
        heapUsedMiB: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
        arrayBuffersMiB: Number((memory.arrayBuffers / 1024 / 1024).toFixed(1)),
        rssMiB: Number((memory.rss / 1024 / 1024).toFixed(1)),
      });
    } finally {
      painter.dispose();
    }
  },
);
