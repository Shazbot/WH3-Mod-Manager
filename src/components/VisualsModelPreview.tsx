import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useAppSelector } from "../hooks";
import { exportVisualsModel, releaseVisualsModelPreview } from "../visuals/modelPreviewApi";

type VisualsModelPreviewProps = {
  assetPath: string;
};

type ThreePreviewContext = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  grid: THREE.GridHelper;
};

const disposeMaterial = (material: THREE.Material) => {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
};

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach(disposeMaterial);
    else if (child.material) disposeMaterial(child.material);
  });
};

const disposeGrid = (grid: THREE.GridHelper) => {
  grid.geometry.dispose();
  if (Array.isArray(grid.material)) grid.material.forEach(disposeMaterial);
  else disposeMaterial(grid.material);
};

const frameObject = (context: ThreePreviewContext, object: THREE.Object3D) => {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.01);
  const halfFovRadians = THREE.MathUtils.degToRad(context.camera.fov * 0.5);
  const distance = ((maxDimension * 0.5) / Math.tan(halfFovRadians)) * 1.45;
  const direction = new THREE.Vector3(1, 0.55, 1).normalize();

  context.camera.position.copy(center).addScaledVector(direction, distance);
  context.camera.near = Math.max(distance / 1000, 0.001);
  context.camera.far = Math.max(distance * 100, maxDimension * 100);
  context.camera.updateProjectionMatrix();

  context.controls.target.copy(center);
  context.controls.minDistance = Math.max(maxDimension * 0.05, 0.01);
  context.controls.maxDistance = Math.max(maxDimension * 20, distance * 5);
  context.controls.update();

  const gridBaseSize = 10;
  context.grid.scale.setScalar(Math.max(maxDimension * 2, 1) / gridBaseSize);
  context.grid.position.set(center.x, box.min.y, center.z);
};

const VisualsModelPreview = memo(({ assetPath }: VisualsModelPreviewProps) => {
  const currentPresetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const enabledMods = useMemo(
    () => currentPresetMods.filter((mod) => mod.isEnabled).map(({ name, path, loadOrder }) => ({ name, path, loadOrder })),
    [currentPresetMods],
  );
  const mountRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<ThreePreviewContext | null>(null);
  const [status, setStatus] = useState<"exporting" | "loading" | "ready" | "error">("exporting");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111827);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    camera.position.set(2, 1.5, 2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = "block h-full w-full";
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x334155, 2.2);
    scene.add(hemisphereLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);
    keyLight.position.set(4, 7, 5);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbfd7ff, 1.4);
    fillLight.position.set(-4, 3, -2);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(10, 20, 0x4b5563, 0x273244);
    scene.add(grid);

    const context = { scene, camera, renderer, controls, grid };
    contextRef.current = context;

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    let isVisible = true;
    const intersectionObserver = new IntersectionObserver((entries) => {
      isVisible = entries[0]?.isIntersecting ?? true;
    });
    intersectionObserver.observe(mount);

    renderer.setAnimationLoop(() => {
      if (!isVisible) return;
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      disposeGrid(grid);
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      contextRef.current = null;
    };
  }, []);

  useEffect(() => {
    const context = contextRef.current;
    if (!context || !assetPath) return;

    let isCancelled = false;
    let ownedPreviewId: string | undefined;
    let ownedModel: THREE.Object3D | undefined;
    let previewCanBeReleasedImmediately = false;

    const releasePreview = (previewId: string) => {
      void releaseVisualsModelPreview(previewId).catch(() => undefined);
    };

    const cleanupOwnedPreview = () => {
      if (ownedModel) {
        context.scene.remove(ownedModel);
        disposeObject(ownedModel);
        ownedModel = undefined;
      }
      if (ownedPreviewId && previewCanBeReleasedImmediately) {
        releasePreview(ownedPreviewId);
        ownedPreviewId = undefined;
      }
    };

    const run = async () => {
      setStatus("exporting");
      setError(null);
      setWarnings([]);

      try {
        const exportResult = await exportVisualsModel(assetPath, enabledMods);
        if (!exportResult.success || !exportResult.previewId || !exportResult.url) {
          if (!isCancelled) {
            setStatus("error");
            setError(exportResult.error || "Failed to export this model.");
            setWarnings(exportResult.warnings || []);
          }
          return;
        }

        ownedPreviewId = exportResult.previewId;
        if (isCancelled) {
          previewCanBeReleasedImmediately = true;
          cleanupOwnedPreview();
          return;
        }

        setWarnings(exportResult.warnings || []);
        setStatus("loading");

        try {
          const gltf = await new GLTFLoader().loadAsync(exportResult.url);
          previewCanBeReleasedImmediately = true;
          if (isCancelled) {
            disposeObject(gltf.scene);
            cleanupOwnedPreview();
            return;
          }

          ownedModel = gltf.scene;
          ownedModel.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            child.castShadow = true;
            child.receiveShadow = true;
          });
          context.scene.add(ownedModel);
          frameObject(context, ownedModel);
          setStatus("ready");
        } catch (loadError) {
          previewCanBeReleasedImmediately = true;
          cleanupOwnedPreview();
          if (!isCancelled) {
            setStatus("error");
            setError(loadError instanceof Error ? loadError.message : "Failed to load the exported GLB.");
          }
        }
      } catch (exportError) {
        cleanupOwnedPreview();
        if (!isCancelled) {
          setStatus("error");
          setError(exportError instanceof Error ? exportError.message : "Failed to request the model export.");
        }
      }
    };

    void run();

    return () => {
      isCancelled = true;
      cleanupOwnedPreview();
    };
  }, [assetPath, enabledMods]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950">
      <div className="relative min-h-0 flex-1 w-full overflow-hidden">
        <div ref={mountRef} className="absolute inset-0" />
        {status !== "ready" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gray-950/70 text-sm text-gray-200">
            {status === "exporting" && "Exporting model with WH3AssetHost..."}
            {status === "loading" && "Loading exported model..."}
            {status === "error" && <span className="max-w-2xl px-6 text-center text-red-300">{error}</span>}
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 left-3 rounded bg-black/50 px-2 py-1 text-[11px] text-gray-300">
          Left drag: orbit · Right drag: pan · Wheel: zoom
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="shrink-0 border-t border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          {warnings.join(" | ")}
        </div>
      )}
    </div>
  );
});

export default VisualsModelPreview;
