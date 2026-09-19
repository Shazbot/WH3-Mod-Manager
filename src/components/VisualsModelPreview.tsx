import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Wh3Ktx2Loader } from "../visuals/Wh3Ktx2Loader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IoPause, IoPlay, IoRefresh } from "react-icons/io5";
import { useAppSelector } from "../hooks";
import { useLocalizations } from "../localizationContext";
import {
  exportVisualsModel,
  getVisualsModelAnimationCatalog,
  releaseVisualsModelPreview,
  reportVisualsModelPreviewTiming,
} from "../visuals/modelPreviewApi";
import { filterVisualsModelPreviewWarnings } from "../visuals/modelPreviewWarnings";
import { getActiveVariantMeshSlots, type VariantMeshCatalog, type VariantMeshSelection } from "../visuals/variantMesh";

type VisualsModelPreviewProps = {
  assetPath: string;
  /** False while the owning main-window tab is kept mounted but hidden. */
  isActive?: boolean;
  /** Whether to show the ground wireframe beneath the model. */
  showWireframe?: boolean;
  /** Session used to inspect VMD slots and select appearances. */
  variantMeshSessionId?: string;
  variantMeshSessionType?: "unitViewer" | "visuals";
};

type ThreePreviewContext = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  ktx2Loader: Wh3Ktx2Loader;
  controls: OrbitControls;
  grid: THREE.GridHelper;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  isPlaying: boolean;
  afterNextRender: ((timing: { renderMs: number; completedAt: number }) => void) | null;
};

type CameraView = {
  position: THREE.Vector3;
  target: THREE.Vector3;
};

type PreviewAnimation = {
  path: string;
  label: string;
};

const NONE_ANIMATION: PreviewAnimation = { path: "", label: "None" };

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

const preloadObjectTextures = (context: ThreePreviewContext, object: THREE.Object3D) => {
  const textures = new Set<THREE.Texture>();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });

  for (const texture of textures) context.ktx2Loader.preloadTexture(texture);
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

const captureCameraView = (context: ThreePreviewContext): CameraView => ({
  position: context.camera.position.clone(),
  target: context.controls.target.clone(),
});

const restoreCameraView = (context: ThreePreviewContext, view: CameraView) => {
  context.camera.position.copy(view.position);
  context.controls.target.copy(view.target);
  context.controls.update();
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

const VisualsModelPreview = memo((props: VisualsModelPreviewProps) => {
  const {
    assetPath,
    isActive = true,
    showWireframe = true,
    variantMeshSessionId,
    variantMeshSessionType = "unitViewer",
  } = props;
  const localized = useLocalizations();
  const currentPresetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const enabledMods = useMemo(
    () =>
      currentPresetMods.filter((mod) => mod.isEnabled).map(({ name, path, loadOrder }) => ({ name, path, loadOrder })),
    [currentPresetMods],
  );
  const mountRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<ThreePreviewContext | null>(null);
  const showWireframeRef = useRef(showWireframe);
  showWireframeRef.current = showWireframe;
  const [status, setStatus] = useState<"exporting" | "loading" | "ready" | "error">("exporting");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [animationOptions, setAnimationOptions] = useState<PreviewAnimation[]>([]);
  const [selectedAnimationPath, setSelectedAnimationPath] = useState("");
  const [animationCatalogReady, setAnimationCatalogReady] = useState(false);
  const [catalogDiagnostics, setCatalogDiagnostics] = useState<string[]>([]);
  const [variantCatalog, setVariantCatalog] = useState<VariantMeshCatalog>();
  const [variantCatalogReady, setVariantCatalogReady] = useState(!variantMeshSessionId);
  const [variantCatalogDiagnostics, setVariantCatalogDiagnostics] = useState<string[]>([]);
  const [variantSelections, setVariantSelections] = useState<Record<string, number>>({});
  const [clipDuration, setClipDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const catalogLoadingRef = useRef(true);
  const isPlayingRef = useRef(true);
  const animationSpeedRef = useRef(1);
  const pendingCameraViewRef = useRef<{ assetPath: string; view: CameraView } | null>(null);
  const loadedAnimationCatalogKeyRef = useRef<string>();
  const loadedVariantCatalogKeyRef = useRef<string>();
  const animationCatalogKey = useMemo(() => JSON.stringify([assetPath, enabledMods]), [assetPath, enabledMods]);
  const variantCatalogKey = `${variantMeshSessionType}\0${variantMeshSessionId ?? ""}\0${assetPath}`;
  const visibleWarnings = filterVisualsModelPreviewWarnings(warnings, isFeaturesForModdersEnabled);

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

    // WH3AssetHost uses a low-latency raw RGBA + Zstd KTX2 flavor for
    // previews. The compatibility loader handles that format directly and
    // delegates standards-compliant Basis/UASTC KTX2 to Three's KTX2Loader.
    const ktx2Loader = new Wh3Ktx2Loader(renderer);
    ktx2Loader.detectSupport(renderer);

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
    grid.visible = showWireframeRef.current;
    scene.add(grid);

    const context: ThreePreviewContext = {
      scene,
      camera,
      renderer,
      ktx2Loader,
      controls,
      grid,
      mixer: null,
      action: null,
      isPlaying: true,
      afterNextRender: null,
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
      const renderStartedAt = performance.now();
      renderer.render(scene, camera);
      const completedAt = performance.now();
      const afterNextRender = context.afterNextRender;
      if (afterNextRender) {
        context.afterNextRender = null;
        afterNextRender({ renderMs: completedAt - renderStartedAt, completedAt });
      }
    });

    return () => {
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      context.mixer?.stopAllAction();
      context.mixer = null;
      context.action = null;
      context.afterNextRender = null;
      controls.dispose();
      disposeGrid(grid);
      ktx2Loader.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      contextRef.current = null;
    };
  }, []);

  useEffect(() => {
    const grid = contextRef.current?.grid;
    if (grid) grid.visible = showWireframe;
  }, [showWireframe]);

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
    if (!isActive || loadedAnimationCatalogKeyRef.current === animationCatalogKey) return;

    let isCancelled = false;
    loadedAnimationCatalogKeyRef.current = undefined;
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
        const animations = (result.animations || [])
          .filter((animation) => animation.path?.trim())
          .map((animation) => ({ path: animation.path, label: getAnimationLabel(animation.path) }))
          .filter((animation, index, all) => all.findIndex((candidate) => candidate.path === animation.path) === index)
          .sort((first, second) => first.label.localeCompare(second.label) || first.path.localeCompare(second.path));
        const options = [NONE_ANIMATION, ...animations];
        const defaultAnimation =
          animations.find(
            (animation) =>
              /stand[_-]idle/i.test(animation.path) && !/^cam(?:\s|[_-]|$)/i.test(getAnimationLabel(animation.path)),
          ) ||
          animations.find((animation) => /stand[_-]idle/i.test(animation.path));
        setAnimationOptions(options);
        setSelectedAnimationPath(defaultAnimation?.path || "");
        setCatalogDiagnostics(result.diagnostics || (result.error ? [result.error] : []));
        if (result.success) loadedAnimationCatalogKeyRef.current = animationCatalogKey;
      } catch (catalogError) {
        if (!isCancelled) {
          setAnimationOptions([NONE_ANIMATION]);
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
  }, [animationCatalogKey, assetPath, enabledMods, isActive]);

  useEffect(() => {
    if (!isActive || loadedVariantCatalogKeyRef.current === variantCatalogKey) return;

    let isCancelled = false;
    loadedVariantCatalogKeyRef.current = undefined;
    setVariantCatalog(undefined);
    setVariantCatalogDiagnostics([]);
    setVariantSelections({});
    setVariantCatalogReady(!variantMeshSessionId);
    if (!variantMeshSessionId) {
      loadedVariantCatalogKeyRef.current = variantCatalogKey;
      return;
    }

    const loadVariantCatalog = async () => {
      try {
        const result =
          variantMeshSessionType === "visuals"
            ? await window.api?.getVisualsVariantMeshCatalog(variantMeshSessionId, assetPath)
            : await window.api?.getUnitViewerVariantMeshCatalog(variantMeshSessionId, assetPath);
        if (isCancelled) return;
        if (!result?.success || !result.catalog) {
          throw new Error(result?.error || "Unable to resolve unit appearances.");
        }
        setVariantCatalog(result.catalog);
        setVariantCatalogDiagnostics(result.catalog.diagnostics);
        setVariantSelections(
          Object.fromEntries(result.catalog.slots.map((slot) => [slot.slotPath, slot.defaultChoiceIndex] as const)),
        );
        loadedVariantCatalogKeyRef.current = variantCatalogKey;
      } catch (catalogError) {
        if (!isCancelled) {
          setVariantCatalog(undefined);
          setVariantCatalogDiagnostics([
            catalogError instanceof Error ? catalogError.message : "Unable to resolve unit appearances.",
          ]);
        }
      } finally {
        if (!isCancelled) setVariantCatalogReady(true);
      }
    };

    void loadVariantCatalog();
    return () => {
      isCancelled = true;
    };
  }, [assetPath, isActive, variantCatalogKey, variantMeshSessionId, variantMeshSessionType]);

  const activeVariantSlots = useMemo(
    () =>
      variantCatalog
        ? getActiveVariantMeshSlots(variantCatalog, variantSelections).filter((slot) => slot.choices.length > 1)
        : [],
    [variantCatalog, variantSelections],
  );
  const selectedVariantSelections = useMemo<VariantMeshSelection[]>(
    () =>
      activeVariantSlots.map((slot) => ({
        slotPath: slot.slotPath,
        choiceIndex: variantSelections[slot.slotPath] ?? slot.defaultChoiceIndex,
      })),
    [activeVariantSlots, variantSelections],
  );

  useEffect(() => {
    if (isActive || status !== "ready") return;
    const context = contextRef.current;
    if (!context || !assetPath) return;
    pendingCameraViewRef.current = { assetPath, view: captureCameraView(context) };
  }, [assetPath, isActive, status]);

  useEffect(() => {
    if (!isActive || !animationCatalogReady || !variantCatalogReady || catalogLoadingRef.current) return;
    const context = contextRef.current;
    if (!context || !assetPath) return;
    if (pendingCameraViewRef.current?.assetPath !== assetPath) pendingCameraViewRef.current = null;

    let isCancelled = false;
    let ownedPreviewId: string | undefined;
    let ownedModel: THREE.Object3D | undefined;
    let ownedMixer: THREE.AnimationMixer | undefined;
    let previewCanBeReleasedImmediately = false;

    const releasePreview = (previewId: string) => {
      void releaseVisualsModelPreview(previewId).catch(() => undefined);
    };

    const cleanupOwnedPreview = () => {
      context.afterNextRender = null;
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
      const previewStartedAt = performance.now();
      setStatus("exporting");
      setError(null);
      setClipDuration(0);
      setCurrentTime(0);
      setWarnings([...catalogDiagnostics, ...variantCatalogDiagnostics]);

      try {
        const exportStartedAt = performance.now();
        const exportResult = await exportVisualsModel(
          assetPath,
          enabledMods,
          selectedAnimationPath ? [selectedAnimationPath] : [],
          selectedVariantSelections,
        );
        const exportRoundTripMs = performance.now() - exportStartedAt;
        if (!exportResult.success || !exportResult.previewId || !exportResult.url) {
          if (!isCancelled) {
            setStatus("error");
            setError(exportResult.error || "Failed to export this model.");
            setWarnings([...catalogDiagnostics, ...variantCatalogDiagnostics, ...(exportResult.warnings || [])]);
          }
          return;
        }

        ownedPreviewId = exportResult.previewId;
        if (isCancelled) {
          previewCanBeReleasedImmediately = true;
          cleanupOwnedPreview();
          return;
        }

        setWarnings([...catalogDiagnostics, ...variantCatalogDiagnostics, ...(exportResult.warnings || [])]);
        setStatus("loading");

        try {
          const gltfLoader = new GLTFLoader();
          gltfLoader.setKTX2Loader(context.ktx2Loader);
          context.ktx2Loader.resetTiming();
          const gltfLoadStartedAt = performance.now();
          const gltf = await gltfLoader.loadAsync(exportResult.url);
          const gltfLoadMs = performance.now() - gltfLoadStartedAt;
          previewCanBeReleasedImmediately = true;
          if (isCancelled) {
            disposeObject(gltf.scene);
            cleanupOwnedPreview();
            return;
          }

          const sceneSetupStartedAt = performance.now();
          ownedModel = gltf.scene;
          // GLTFLoader has now finalized sampler wrapping/filtering, so eager GPU
          // upload is safe and still keeps the first visible render lightweight.
          preloadObjectTextures(context, ownedModel);
          context.scene.add(ownedModel);
          if (selectedAnimationPath && gltf.animations.length > 0) {
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
          const pendingCameraView = pendingCameraViewRef.current;
          if (pendingCameraView?.assetPath === assetPath) {
            restoreCameraView(context, pendingCameraView.view);
            pendingCameraViewRef.current = null;
          }
          const sceneSetupMs = performance.now() - sceneSetupStartedAt;
          const sceneReadyAt = performance.now();

          context.afterNextRender = ({ renderMs, completedAt }) => {
            if (isCancelled || !ownedPreviewId) return;
            void reportVisualsModelPreviewTiming({
              assetPath,
              previewId: ownedPreviewId,
              totalMs: completedAt - previewStartedAt,
              exportRoundTripMs,
              gltfLoadMs,
              sceneSetupMs,
              firstFrameWaitMs: completedAt - sceneReadyAt,
              firstRenderMs: renderMs,
              main: exportResult.timings,
              ktx2: context.ktx2Loader.getTiming(),
            }).catch(() => undefined);
          };

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
  }, [
    animationCatalogReady,
    assetPath,
    catalogDiagnostics,
    enabledMods,
    isActive,
    selectedAnimationPath,
    selectedVariantSelections,
    variantCatalogDiagnostics,
    variantCatalogReady,
  ]);

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
      {variantMeshSessionId && !variantCatalogReady && (
        <div className="shrink-0 border-t border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-400">
          {localized.unitViewerLoadingAppearances || "Loading unit appearances…"}
        </div>
      )}
      {variantMeshSessionId && variantCatalog && activeVariantSlots.length > 0 && (
        <div className="shrink-0 border-t border-gray-700 bg-gray-900 px-3 py-2">
          <div className="mb-1 flex items-baseline gap-2 text-xs">
            <span className="font-semibold text-gray-200">{localized.unitViewerAppearance || "Appearance"}</span>
            <span className="text-gray-500">
              {(localized.unitViewerAppearanceCombinations || "{{count}} combinations").replace(
                "{{count}}",
                `${variantCatalog.combinationCount.toLocaleString()}${variantCatalog.combinationCountCapped ? "+" : ""}`,
              )}
            </span>
          </div>
          <div className="flex max-h-20 flex-wrap gap-x-3 gap-y-1 overflow-auto">
            {activeVariantSlots.map((slot) => (
              <label key={slot.slotPath} className="flex min-w-36 flex-1 items-center gap-1 text-[11px] text-gray-400">
                <span className="max-w-28 shrink-0 truncate" title={slot.slotPath}>
                  {slot.label}
                </span>
                <select
                  aria-label={`Appearance: ${slot.label}`}
                  value={variantSelections[slot.slotPath] ?? slot.defaultChoiceIndex}
                  onChange={(event) => {
                    const context = contextRef.current;
                    if (status === "ready" && context) {
                      pendingCameraViewRef.current = { assetPath, view: captureCameraView(context) };
                    }
                    setVariantSelections((current) => ({
                      ...current,
                      [slot.slotPath]: Number(event.target.value),
                    }));
                  }}
                  className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-800 px-1.5 py-1 text-xs text-gray-100"
                >
                  {slot.choices.map((choice) => (
                    <option key={choice.key} value={choice.index}>
                      {choice.index + 1} · {choice.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
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
      {visibleWarnings.length > 0 && (
        <div className="shrink-0 border-t border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          {visibleWarnings.join(" | ")}
        </div>
      )}
    </div>
  );
});

export default VisualsModelPreview;
