import * as THREE from "three";
import { parseWh3TextureEncoding } from "./wh3DdsTexture";

/**
 * Shader support for WH3 texture encodings carried by passthrough DDS textures (`userData.wh3TextureEncoding`).
 *
 * - normal-dxt5nm on `normalMap`: X = R*A, Y = G, Z rebuilt (matches the host's packed-normal conversion).
 * - material-map-wh3 on `metalnessMap`: metalness reads R instead of glTF's B; roughness stays G.
 *
 * The patch is decided from the textures CURRENTLY assigned to the material each time the program is
 * compiled, and its flags are part of the program cache key. So when the unit painter swaps in an editable
 * standard-form DataTexture (which carries no encoding) and sets `material.needsUpdate`, the patch drops out,
 * and it returns when the original texture is restored. It composes with other `onBeforeCompile` /
 * `customProgramCacheKey` users (such as the faction colour preview) in either order, because the material's
 * two hooks are accessors that wrap whatever function was last assigned.
 */

export type Wh3TextureEncodingFlags = {
  normalDxt5nm: boolean;
  materialMapWh3: boolean;
};

export const getWh3TextureEncodingFlags = (material: THREE.Material): Wh3TextureEncodingFlags => {
  const standard = material as Partial<THREE.MeshStandardMaterial>;
  return {
    normalDxt5nm: parseWh3TextureEncoding(standard.normalMap?.userData?.wh3TextureEncoding) === "normal-dxt5nm",
    materialMapWh3: parseWh3TextureEncoding(standard.metalnessMap?.userData?.wh3TextureEncoding) === "material-map-wh3",
  };
};

export const getWh3TextureEncodingCacheKey = (flags: Wh3TextureEncodingFlags) =>
  `wh3enc:${flags.normalDxt5nm ? "n" : "-"}${flags.materialMapWh3 ? "m" : "-"}`;

const NORMAL_INCLUDE = "#include <normal_fragment_maps>";
const METALNESS_INCLUDE = "#include <metalnessmap_fragment>";

const NORMAL_REPLACEMENT = `#ifdef USE_NORMALMAP_TANGENTSPACE
	vec4 wh3NormalTexel = texture2D( normalMap, vNormalMapUv );
	vec3 mapN = vec3( wh3NormalTexel.r * wh3NormalTexel.a, wh3NormalTexel.g, 0.0 ) * 2.0 - 1.0;
	mapN.z = sqrt( max( 0.0, 1.0 - dot( mapN.xy, mapN.xy ) ) );
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#else
	${NORMAL_INCLUDE}
#endif`;

const METALNESS_REPLACEMENT = `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	// WH3 material maps keep metalness in R (glTF would read B).
	metalnessFactor *= texelMetalness.r;
#endif`;

/** Rewrites the fragment shader for the given encodings; leaves it untouched when no flag is set. */
export const applyWh3TextureEncodingToFragmentShader = (fragmentShader: string, flags: Wh3TextureEncodingFlags) => {
  let result = fragmentShader;
  if (flags.normalDxt5nm) result = result.replace(NORMAL_INCLUDE, () => NORMAL_REPLACEMENT);
  if (flags.materialMapWh3) result = result.replace(METALNESS_INCLUDE, () => METALNESS_REPLACEMENT);
  return result;
};

type CompileHook = (this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms, renderer: never) => void;
type CacheKeyHook = (this: THREE.Material) => string;
const PATCHED_SHADERS = new WeakSet<object>();
const PATCHED_MATERIALS = new WeakSet<object>();

/**
 * Installs the encoding patch on one material (idempotent). Returns whether it was installed. Materials with
 * no encoded textures are left alone so non-DDS models are unaffected.
 */
export const installWh3TextureEncodingPatch = (material: THREE.Material) => {
  if (!(material instanceof THREE.MeshStandardMaterial)) return false;
  if (PATCHED_MATERIALS.has(material)) return false;
  const flags = getWh3TextureEncodingFlags(material);
  if (!flags.normalDxt5nm && !flags.materialMapWh3) return false;

  let userOnBeforeCompile = material.onBeforeCompile as unknown as CompileHook;
  let userCacheKey = material.customProgramCacheKey as unknown as CacheKeyHook;
  Object.defineProperty(material, "onBeforeCompile", {
    configurable: true,
    enumerable: false,
    get() {
      const user = userOnBeforeCompile;
      return function (this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms, renderer: never) {
        user.call(this, shader, renderer);
        // The hook can be reached twice when another user captured our getter and wrapped it; patch once.
        if (PATCHED_SHADERS.has(shader)) return;
        PATCHED_SHADERS.add(shader);
        shader.fragmentShader = applyWh3TextureEncodingToFragmentShader(
          shader.fragmentShader,
          getWh3TextureEncodingFlags(this),
        );
      };
    },
    set(value: CompileHook) {
      userOnBeforeCompile = value;
    },
  });
  Object.defineProperty(material, "customProgramCacheKey", {
    configurable: true,
    enumerable: false,
    get() {
      const user = userCacheKey;
      return function (this: THREE.Material) {
        return `${user.call(this)}|${getWh3TextureEncodingCacheKey(getWh3TextureEncodingFlags(this))}`;
      };
    },
    set(value: CacheKeyHook) {
      userCacheKey = value;
    },
  });
  PATCHED_MATERIALS.add(material);
  material.needsUpdate = true;
  return true;
};

/** Applies the patch to every MeshStandardMaterial under `root` that uses an encoded texture. */
export const installWh3TextureEncodingPatches = (root: THREE.Object3D) => {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) if (material) installWh3TextureEncodingPatch(material);
  });
};
