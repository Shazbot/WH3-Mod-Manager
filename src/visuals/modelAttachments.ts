import * as THREE from "three";
import type { TwAnimBone } from "./twAnimSkeleton";

/**
 * Add tech-only attachment bones under their nearest exported skeleton ancestor so they follow animation.
 * Detect the exporter's X mirroring by comparing shared bones, then apply it to the attachment transforms.
 */
export const addTechAttachmentNodes = (engine: THREE.Object3D, bones: readonly TwAnimBone[]) => {
  const nodesByName = new Map<string, THREE.Object3D>();
  engine.traverse((node) => {
    const name = node.name.toLowerCase();
    if (name && !nodesByName.has(name)) nodesByName.set(name, node);
  });
  const isAp = (bone: TwAnimBone) => bone.name.toLowerCase().startsWith("ap_");
  const convert = (bone: TwAnimBone, mirror: boolean) => {
    const [x, y, z] = bone.translation;
    const [qx, qy, qz, qw] = bone.rotation;
    return {
      position: new THREE.Vector3(mirror ? -x : x, y, z),
      quaternion: new THREE.Quaternion(qx, mirror ? -qy : qy, mirror ? -qz : qz, qw),
    };
  };
  const mismatch = (mirror: boolean) => {
    let total = 0;
    for (const bone of bones) {
      const node = isAp(bone) ? undefined : nodesByName.get(bone.name.toLowerCase());
      if (!node) continue;
      const local = convert(bone, mirror);
      total += local.position.distanceTo(node.position) + (1 - Math.abs(local.quaternion.dot(node.quaternion)));
    }
    return total;
  };
  const mirror = mismatch(true) < mismatch(false);
  const created: string[] = [];
  const missing: string[] = [];
  for (const bone of bones) {
    if (!isAp(bone) || nodesByName.has(bone.name.toLowerCase())) continue;
    const local = convert(bone, mirror);
    const matrix = new THREE.Matrix4().compose(local.position, local.quaternion, new THREE.Vector3(1, 1, 1));
    let parentIndex = bone.parent;
    let anchor: THREE.Object3D | undefined;
    while (parentIndex >= 0 && !anchor) {
      const parentBone = bones[parentIndex];
      anchor = nodesByName.get(parentBone.name.toLowerCase());
      if (!anchor) {
        const parentLocal = convert(parentBone, mirror);
        matrix.premultiply(
          new THREE.Matrix4().compose(parentLocal.position, parentLocal.quaternion, new THREE.Vector3(1, 1, 1)),
        );
        parentIndex = parentBone.parent;
      }
    }
    if (!anchor) {
      missing.push(bone.name);
      continue;
    }
    const node = new THREE.Object3D();
    node.name = bone.name;
    matrix.decompose(node.position, node.quaternion, node.scale);
    anchor.add(node);
    nodesByName.set(bone.name.toLowerCase(), node);
    created.push(bone.name);
  }
  console.log("[unit viewer] engine tech-anim attachment nodes", { mirrorX: mirror, created, noAnchor: missing });
};

/** Ordinary rider clips are authored relative to the mount's saddle attachment, when one exists. */
export const attachRiderToSaddle = (mount: THREE.Object3D, rider: THREE.Object3D): boolean => {
  let saddle: THREE.Object3D | undefined;
  mount.traverse((node) => {
    if (!saddle && /^ap_saddle_rider1(?:_00)?$/i.test(node.name)) saddle = node;
  });
  if (!saddle) return false;
  saddle.add(rider);
  rider.position.set(0, 0, 0);
  rider.quaternion.identity();
  console.log("[unit viewer] mounted rider saddle", { attachmentPoint: saddle.name });
  return true;
};

/** Rider-position clips can use mount space or seat space, even on the same horse skeleton. */
export const attachModelToSeat = (
  node: THREE.Object3D,
  model: THREE.Object3D,
  mount?: THREE.Object3D,
  clip?: THREE.AnimationClip,
) => {
  let parent = node;
  if (mount && /^ap_riderposition_\d+$/i.test(node.name)) {
    const rootTrack = clip?.tracks.find((track) => {
      const binding = THREE.PropertyBinding.parseTrackName(track.name);
      return binding.nodeName === "animroot" && binding.propertyName === "position";
    });
    const authoredRoot = rootTrack
      ? new THREE.Vector3().fromArray(rootTrack.values)
      : (model.getObjectByName("animroot")?.position.clone() ?? new THREE.Vector3());
    // A mount-space pose is already near the saddle; a seat-local pose starts near the origin.
    mount.updateWorldMatrix(true, true);
    const seatPosition = mount.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
    if (authoredRoot.distanceToSquared(seatPosition) < authoredRoot.lengthSq()) parent = mount;
    console.log("[unit viewer] mounted rider coordinate space", {
      attachmentPoint: node.name,
      space: parent === mount ? "mount" : "seat",
      authoredRoot: authoredRoot.toArray(),
      seatPosition: seatPosition.toArray(),
    });
  }
  parent.add(model);
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  parent.updateWorldMatrix(true, false);
  const worldScale = parent.getWorldScale(new THREE.Vector3());
  model.scale.set(1 / (worldScale.x || 1), 1 / (worldScale.y || 1), 1 / (worldScale.z || 1));
};
