import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { addTechAttachmentNodes, attachModelToSeat, attachRiderToSaddle } from "../src/visuals/modelAttachments";
import type { TwAnimBone } from "../src/visuals/twAnimSkeleton";

const bone = (name: string, parent: number, translation: [number, number, number]): TwAnimBone => ({
  name,
  parent,
  translation,
  rotation: [0, 0, 0, 1],
});

describe("mounted rider saddle attachments", () => {
  it("seats a rider on a tech-only saddle and follows the mount's animated bone", () => {
    const mount = new THREE.Group();
    const spine = new THREE.Bone();
    spine.name = "spine";
    spine.position.set(1, 2, 0);
    mount.add(spine);
    addTechAttachmentNodes(mount, [
      bone("spine", -1, [1, 2, 0]),
      bone("saddle_base", 0, [0, 0.5, 0]),
      bone("ap_saddle_rider1_00", 1, [0, 0.25, 0]),
    ]);
    const rider = new THREE.Group();
    rider.position.set(5, 0, 0);
    rider.rotation.y = Math.PI;
    const pelvis = new THREE.Bone();
    // Seated rider animation root is relative to the saddle, rather than the ground.
    pelvis.position.set(0, -0.03, -0.06);
    rider.add(pelvis);
    expect(attachRiderToSaddle(mount, rider)).toBe(true);
    expect(rider.parent?.name).toBe("ap_saddle_rider1_00");
    expect(rider.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([1, 2.75, 0]);
    expect(rider.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    const mixer = new THREE.AnimationMixer(mount);
    mixer
      .clipAction(
        new THREE.AnimationClip("hover", 1, [
          new THREE.VectorKeyframeTrack("spine.position", [0, 1], [1, 2, 0, 1, 4, 0]),
        ]),
      )
      .play();
    mixer.update(0.5);
    expect(rider.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([1, 3.75, 0]);
    expect(pelvis.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(3.72);
  });

  it("mirrors the saddle transform consistently with the exported skeleton", () => {
    const mount = new THREE.Group();
    const spine = new THREE.Bone();
    spine.name = "spine";
    spine.position.set(-1, 2, 0);
    mount.add(spine);
    addTechAttachmentNodes(mount, [bone("spine", -1, [1, 2, 0]), bone("ap_saddle_rider1_00", 0, [0.5, 0.75, 0])]);
    const rider = new THREE.Group();
    expect(attachRiderToSaddle(mount, rider)).toBe(true);
    expect(rider.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([-1.5, 2.75, 0]);
  });

  it("preserves shared-origin models when the mount has no saddle attachment", () => {
    const group = new THREE.Group();
    const mount = new THREE.Group();
    const rider = new THREE.Group();
    group.add(mount, rider);
    rider.position.set(1, 0, 0);
    expect(attachRiderToSaddle(mount, rider)).toBe(false);
    expect(rider.parent).toBe(group);
    expect(rider.position.toArray()).toEqual([1, 0, 0]);
  });
});

describe("personality rider placement", () => {
  it("does not add a horse seat height twice to a pose authored in mount space", () => {
    const mount = new THREE.Group();
    const marker = new THREE.Object3D();
    marker.name = "ap_riderposition_0";
    marker.position.set(0, 1.64, 0.63);
    mount.add(marker);
    const rider = new THREE.Group();
    const animroot = new THREE.Object3D();
    animroot.name = "animroot";
    animroot.position.set(0.015, 1.638, 0.629);
    rider.add(animroot);
    const clip = new THREE.AnimationClip("warhorse_idle", 1, [
      new THREE.VectorKeyframeTrack("animroot.position", [0, 1], [0.015, 1.638, 0.629, 0.015, 1.638, 0.629]),
    ]);
    attachModelToSeat(marker, rider, mount, clip);
    expect(rider.parent).toBe(mount);
    expect(animroot.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([0.015, 1.638, 0.629]);
  });

  it("attaches a Longma's seat-local flying clip despite sharing the warhorse attachment name", () => {
    const mount = new THREE.Group();
    const marker = new THREE.Object3D();
    marker.name = "ap_riderposition_0";
    marker.position.set(0, 1.4, 0.6);
    mount.add(marker);
    const rider = new THREE.Group();
    const animroot = new THREE.Object3D();
    animroot.name = "animroot";
    // Bind transforms must not override the selected animation's coordinate space.
    animroot.position.set(0, 1.64, 0.63);
    rider.add(animroot);
    const clip = new THREE.AnimationClip("longma_fly", 1, [
      new THREE.VectorKeyframeTrack("animroot.position", [0, 1], [0, 0, 0, 0, 0.02, 0]),
    ]);
    attachModelToSeat(marker, rider, mount, clip);
    expect(rider.parent).toBe(marker);
    const mixer = new THREE.AnimationMixer(rider);
    mixer.clipAction(clip).play();
    mixer.update(0.5);
    expect(animroot.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(1.41);
    marker.position.y += 1;
    expect(animroot.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(2.41);
  });

  it("keeps monster seat poses relative to their attachment point", () => {
    const mount = new THREE.Group();
    const seat = new THREE.Object3D();
    seat.name = "ap_thundertusk_rider_01";
    seat.position.y = 3;
    mount.add(seat);
    const rider = new THREE.Group();
    attachModelToSeat(seat, rider, mount);
    expect(rider.parent).toBe(seat);
    expect(rider.getWorldPosition(new THREE.Vector3()).y).toBe(3);
  });

  it("preserves engine crew attachment and inverse world scale", () => {
    const engine = new THREE.Group();
    engine.scale.setScalar(2);
    const seat = new THREE.Object3D();
    seat.name = "ap_riderposition_0";
    seat.position.y = 1;
    engine.add(seat);
    const crew = new THREE.Group();
    attachModelToSeat(seat, crew);
    expect(crew.parent).toBe(seat);
    expect(crew.getWorldPosition(new THREE.Vector3()).y).toBe(2);
    expect(crew.getWorldScale(new THREE.Vector3()).toArray()).toEqual([1, 1, 1]);
  });
});
