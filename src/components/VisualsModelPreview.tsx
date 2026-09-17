import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IoPause, IoPlay, IoRefresh } from "react-icons/io5";
import { useAppSelector } from "../hooks";
import {
  exportVisualsModel,
  getVisualsModelAnimationCatalog,
  releaseVisualsModelPreview,
} from "../visuals/modelPreviewApi";

type VisualsModelPreviewProps = {
  assetPath: string;
};

type ThreePreviewContext = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  grid: THREE.GridHelper;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  isPlaying: boolean;
};

type PreviewAnimation = {
  path: string;
  label: string;
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

const getAnimationLabel = (path: string) => {
  const fileName = path.split(/[\\/]/).pop() || path;
  return fileName.replace(/\.anim$/i, "").replace(/[_-]+/g, " ");
};

const formatAnimationTime = (seconds: number) => {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
};

const ANIMATION_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const VisualsModelPreview = memo(({ assetPath }: VisualsModelPreviewProps) => {
  const currentPresetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const enabledMods = useMemo(
    () =>
      currentPresetMods.filter((mod) => mod.isEnabled).map(({ name, path, loadOrder }) => ({ name, path, loadOrder })),
    [currentPresetMods],
  );
  const mountRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<ThreePreviewContext | null>(null);
  const [status, setStatus] = useState<"exporting" | "loading" | "ready" | "error">("exporting");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [animationOptions, setAnimationOptions] = useState<PreviewAnimation[]>([]);
  const [selectedAnimationPath, setSelectedAnimationPath] = useState("");
  const [animationCatalogReady, setAnimationCatalogReady] = useState(false);
  const [catalogDiagnostics, setCatalogDiagnostics] = useState<string[]>([]);
  const [clipDuration, setClipDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const catalogLoadingRef = useRef(true);
  const isPlayingRef = useRef(true);
  const animationSpeedRef = useRef(1);

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
    // Imported game meshes often contain thin/double-sided surfaces. With no ground receiver in
    // this preview, shadow maps only add self-shadow artifacts that are not present in-game.
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
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbfd7ff, 1.4);
    fillLight.position.set(-4, 3, -2);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(10, 20, 0x4b5563, 0x273244);
    scene.add(grid);

    const context: ThreePreviewContext = {
      scene,
      camera,
      renderer,
      controls,
      grid,
      mixer: null,
      action: null,
      isPlaying: true,
    };
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

    let previousFrameTime = performance.now();
    renderer.setAnimationLoop((timestamp) => {
      const now = typeof timestamp === "number" ? timestamp : performance.now();
      const delta = Math.min(Math.max((now - previousFrameTime) / 1000, 0), 0.1);
      previousFrameTime = now;
      if (!isVisible) return;
      if (context.mixer && context.isPlaying) context.mixer.update(delta);
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      context.mixer?.stopAllAction();
      context.mixer = null;
      context.action = null;
      controls.dispose();
      disposeGrid(grid);
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      contextRef.current = null;
    };
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    const context = contextRef.current;
    if (!context) return;
    context.isPlaying = isPlaying;
    if (context.action) context.action.paused = !isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    animationSpeedRef.current = animationSpeed;
    const action = contextRef.current?.action;
    if (action) action.timeScale = animationSpeed;
  }, [animationSpeed]);

  useEffect(() => {
    let isCancelled = false;
    catalogLoadingRef.current = true;
    setAnimationCatalogReady(false);
    setAnimationOptions([]);
    setSelectedAnimationPath("");
    setCatalogDiagnostics([]);
    setClipDuration(0);
    setCurrentTime(0);

    const loadCatalog = async () => {
      try {
        const result = await getVisualsModelAnimationCatalog(assetPath, enabledMods);
        if (isCancelled) return;
        const options = (result.animations || [])
          .filter((animation) => animation.path?.trim())
          .map((animation) => ({ path: animation.path, label: getAnimationLabel(animation.path) }))
          .filter((animation, index, all) => all.findIndex((candidate) => candidate.path === animation.path) === index)
          .sort((first, second) => first.label.localeCompare(second.label) || first.path.localeCompare(second.path));
        const defaultAnimation =
          options.find(
            (animation) =>
              /stand[_-]idle/i.test(animation.path) &&
              !/^cam(?:\s|[_-]|$)/i.test(getAnimationLabel(animation.path)),
          ) ||
          options.find((animation) => /stand[_-]idle/i.test(animation.path)) ||
          options[0];
        setAnimationOptions(options);
        setSelectedAnimationPath(defaultAnimation?.path || "");
        setCatalogDiagnostics(result.diagnostics || (result.error ? [result.error] : []));
      } catch (catalogError) {
        if (!isCancelled) {
          setAnimationOptions([]);
          setSelectedAnimationPath("");
          setCatalogDiagnostics([
            catalogError instanceof Error ? catalogError.message : "Unable to resolve model animations.",
          ]);
        }
      } finally {
        if (!isCancelled) {
          catalogLoadingRef.current = false;
          setAnimationCatalogReady(true);
        }
      }
    };

    void loadCatalog();
    return () => {
      isCancelled = true;
    };
  }, [assetPath, enabledMods]);

  useEffect(() => {
    if (!animationCatalogReady || catalogLoadingRef.current) return;
    const context = contextRef.current;
    if (!context || !assetPath) return;

    let isCancelled = false;
    let ownedPreviewId: string | undefined;
    let ownedModel: THREE.Object3D | undefined;
    let ownedMixer: THREE.AnimationMixer | undefined;
    let previewCanBeReleasedImmediately = false;

    const releasePreview = (previewId: string) => {
      void releaseVisualsModelPreview(previewId).catch(() => undefined);
    };

    const cleanupOwnedPreview = () => {
      if (ownedModel) {
        context.scene.remove(ownedModel);
        ownedMixer?.stopAllAction();
        ownedMixer?.uncacheRoot(ownedModel);
        disposeObject(ownedModel);
        ownedModel = undefined;
      }
      ownedMixer = undefined;
      context.mixer = null;
      context.action = null;
      if (ownedPreviewId && previewCanBeReleasedImmediately) {
        releasePreview(ownedPreviewId);
        ownedPreviewId = undefined;
      }
    };

    const run = async () => {
      setStatus("exporting");
      setError(null);
      setClipDuration(0);
      setCurrentTime(0);
      setWarnings(catalogDiagnostics);

      try {
        const exportResult = await exportVisualsModel(
          assetPath,
          enabledMods,
          selectedAnimationPath ? [selectedAnimationPath] : [],
        );
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

        setWarnings([...catalogDiagnostics, ...(exportResult.warnings || [])]);
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
          context.scene.add(ownedModel);
          if (gltf.animations.length > 0) {
            ownedMixer = new THREE.AnimationMixer(ownedModel);
            const action = ownedMixer.clipAction(gltf.animations[0]);
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.timeScale = animationSpeedRef.current;
            action.play();
            action.paused = !isPlayingRef.current;
            context.mixer = ownedMixer;
            context.action = action;
            setClipDuration(gltf.animations[0].duration);
            setCurrentTime(0);
          }
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
  }, [animationCatalogReady, assetPath, catalogDiagnostics, enabledMods, selectedAnimationPath]);

  useEffect(() => {
    if (status !== "ready" || clipDuration <= 0) return;
    const timer = window.setInterval(() => {
      const action = contextRef.current?.action;
      if (action) setCurrentTime(Math.min(action.time, clipDuration));
    }, 100);
    return () => window.clearInterval(timer);
  }, [clipDuration, status]);

  const seekAnimation = (value: number) => {
    const action = contextRef.current?.action;
    if (!action) return;
    action.time = Math.max(0, Math.min(value, clipDuration));
    setCurrentTime(action.time);
  };

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
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-t border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300">
        <button
          type="button"
          disabled={!clipDuration}
          onClick={() => setIsPlaying((playing) => !playing)}
          aria-label={isPlaying ? "Pause animation" : "Play animation"}
          title={isPlaying ? "Pause animation" : "Play animation"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-600 bg-gray-800 text-gray-200 hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPlaying ? <IoPause size={14} /> : <IoPlay size={14} />}
        </button>
        <button
          type="button"
          disabled={!clipDuration}
          onClick={() => {
            seekAnimation(0);
            setIsPlaying(true);
          }}
          aria-label="Restart animation"
          title="Restart animation"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-600 bg-gray-800 text-gray-200 hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IoRefresh size={14} />
        </button>
        {animationOptions.length > 0 ? (
          <select
            value={selectedAnimationPath}
            onChange={(event) => {
              setCurrentTime(0);
              setIsPlaying(true);
              setSelectedAnimationPath(event.target.value);
            }}
            aria-label="Animation"
            title={selectedAnimationPath}
            className="min-w-0 max-w-[18rem] flex-1 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100"
          >
            {animationOptions.map((animation) => (
              <option key={animation.path} value={animation.path}>
                {animation.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 flex-1 truncate text-gray-500">No animations available</span>
        )}
        <select
          value={animationSpeed}
          onChange={(event) => setAnimationSpeed(Number(event.target.value))}
          aria-label="Animation speed"
          title="Animation speed"
          disabled={!clipDuration}
          className="w-[4.5rem] shrink-0 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {ANIMATION_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {Math.round(speed * 100)}%
            </option>
          ))}
        </select>
        <input
          type="range"
          min={0}
          max={clipDuration || 1}
          step={0.01}
          value={Math.min(currentTime, clipDuration || 1)}
          onChange={(event) => seekAnimation(Number(event.target.value))}
          aria-label="Animation timeline"
          disabled={!clipDuration}
          className="hidden min-w-24 flex-[2] accent-blue-500 sm:block"
        />
        <span className="w-16 shrink-0 text-right tabular-nums text-gray-500">
          {clipDuration ? `${formatAnimationTime(currentTime)} / ${formatAnimationTime(clipDuration)}` : "—"}
        </span>
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
