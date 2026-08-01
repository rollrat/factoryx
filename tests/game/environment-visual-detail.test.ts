import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { A17_ENVIRONMENT, TerrainSampler } from "../../app/game/environment/index.ts";
import { DistantHorizonRenderer } from "../../app/game/environment/render/DistantHorizonRenderer.ts";
import { TerrainDetailRenderer } from "../../app/game/environment/render/TerrainDetailRenderer.ts";

test("near terrain detail stays camera-local and reacts to rain and industry", () => {
  const detail = new TerrainDetailRenderer(new TerrainSampler(A17_ENVIRONMENT), "high");
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 4, 0);
  detail.update(camera);
  assert.ok(detail.gravel.count > 0);
  assert.ok(detail.cracks.count > 0);
  assert.ok(detail.gravel.count <= 150);
  const clearWetCount = detail.wetPatches.count;

  detail.setWeather("electrical_storm", 1);
  detail.update(camera);
  assert.ok(detail.wetPatches.count > clearWetCount);

  detail.setIndustrialFootprints([{ minX: -2, maxX: 2, minZ: -2, maxZ: 2 }]);
  detail.update(camera);
  assert.ok(detail.industrialDust.count > 0);
  assert.equal(detail.visibleInstanceCount(), detail.cracks.count + detail.gravel.count + detail.wetPatches.count + detail.industrialDust.count);
  detail.root.visible = false;
  assert.equal(detail.visibleInstanceCount(), 0);
  detail.dispose();
});

test("distant terrain silhouettes follow the camera horizontally and fade into weather", () => {
  const horizon = new DistantHorizonRenderer(A17_ENVIRONMENT.seed, "high");
  assert.equal(horizon.nearRidges.count, 18);
  assert.equal(horizon.farRidges.count, 24);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(48, 36, -27);
  horizon.update(camera);
  assert.equal(horizon.root.position.x, 48);
  assert.equal(horizon.root.position.y, -18);
  assert.equal(horizon.root.position.z, -27);
  const clearOpacity = (horizon.farRidges.material as THREE.MeshBasicMaterial).opacity;
  horizon.setWeather("mist", 1);
  assert.ok((horizon.farRidges.material as THREE.MeshBasicMaterial).opacity < clearOpacity);
  horizon.dispose();
});
