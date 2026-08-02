import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { WorldSourcePlacementRenderer } from "../../app/game/environment/render/WorldSourcePlacementRenderer.ts";
import { IRONWIND_WORLD_SOURCE_V3 } from "../../app/game/environment/worldSourceV3/index.ts";

test("WorldSource placement presentation fills the authored sector without occupying protected resource pads", () => {
  const first = new WorldSourcePlacementRenderer(IRONWIND_WORLD_SOURCE_V3, undefined, "low");
  const second = new WorldSourcePlacementRenderer(IRONWIND_WORLD_SOURCE_V3, undefined, "low");
  assert.equal(first.landmarkCount(), IRONWIND_WORLD_SOURCE_V3.placements.length);
  assert.ok(first.visibleInstanceCount() >= 150, "a review sector should not read as an empty terrain sheet");
  assert.equal(first.visibleInstanceCount(), second.visibleInstanceCount());
  const fullDensityCount = first.visibleInstanceCount();
  first.setDensity(0.5);
  assert.ok(first.visibleInstanceCount() < fullDensityCount);
  first.setScatterVisible(false);
  assert.equal(first.visibleInstanceCount(), 0);
  first.setScatterVisible(true);
  first.setLandmarksVisible(false);
  assert.equal(first.visibleLandmarkCount(), 0);
  first.setLandmarksVisible(true);

  const matricesFor = (renderer: WorldSourcePlacementRenderer) => renderer.scatterRoot.children
    .filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh)
    .map((mesh) => [mesh.name, Array.from(mesh.instanceMatrix.array)]);
  assert.deepEqual(matricesFor(first), matricesFor(second), "biome scatter must remain deterministic");

  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  first.scatterRoot.children.forEach((child) => {
    if (!(child instanceof THREE.InstancedMesh)) return;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < child.count; index += 1) {
      child.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      IRONWIND_WORLD_SOURCE_V3.resourceAnchors
        .filter(({ stratumId }) => stratumId === "surface")
        .forEach((anchor) => assert.ok(
          Math.hypot(position.x - anchor.position.x, position.z - anchor.position.z) > anchor.protectionRadius,
          `${child.name} overlaps protected anchor ${anchor.id}`,
        ));
    }
  });

  first.dispose();
  second.dispose();
  assert.equal(first.root.children.length, 0);
  assert.equal(first.visibleInstanceCount(), 0);
});

test("WorldSource placement presentation is empty without a source", () => {
  const renderer = new WorldSourcePlacementRenderer();
  assert.equal(renderer.landmarkCount(), 0);
  assert.equal(renderer.visibleInstanceCount(), 0);
  renderer.dispose();
});
