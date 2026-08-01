import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { A17_ENVIRONMENT, EnvironmentRenderer, TerrainSampler } from "../../app/game/environment/index.ts";
import { DistantHorizonRenderer } from "../../app/game/environment/render/DistantHorizonRenderer.ts";
import { TerrainDetailRenderer } from "../../app/game/environment/render/TerrainDetailRenderer.ts";
import { WeatherSystem } from "../../app/game/environment/render/WeatherSystem.ts";

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
  detail.setPreviewQuality("low");
  detail.update(camera);
  assert.ok(detail.gravel.count <= Math.floor(150 * 0.42));
  assert.ok(detail.cracks.count <= Math.floor(72 * 0.42));
  detail.root.visible = false;
  assert.equal(detail.visibleInstanceCount(), 0);
  detail.dispose();
});

test("preview quality dynamically reduces weather particle work", () => {
  const scene = new THREE.Scene();
  const weather = new WeatherSystem(scene, "high");
  assert.equal(weather.activeParticleCount(), 360);
  weather.setPreviewQuality("low");
  assert.equal(weather.activeParticleCount(), 160);
  weather.setPreviewQuality("high");
  assert.equal(weather.activeParticleCount(), 360);
  weather.dispose();
});

test("environment preview quality couples props, particles, terrain detail, and shadow distance", () => {
  const scene = new THREE.Scene();
  const environment = new EnvironmentRenderer(scene, A17_ENVIRONMENT, "high");
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 6, 0);
  environment.setScatterDensity(1);
  environment.setShadowDistance(70);
  environment.update(1 / 60, camera);
  const highPropCount = environment.props.visibleInstanceCount();
  assert.ok(highPropCount > 0);
  const sun = environment.sky.root.children.find((child): child is THREE.DirectionalLight => child instanceof THREE.DirectionalLight);
  assert.ok(sun);
  assert.equal((sun.shadow.camera as THREE.OrthographicCamera).right, 70);

  environment.setPreviewQuality("low");
  environment.update(1 / 60, camera);
  assert.ok(environment.props.visibleInstanceCount() < highPropCount);
  assert.equal(environment.weather.activeParticleCount(), 160);
  assert.equal((sun.shadow.camera as THREE.OrthographicCamera).right, 24);

  environment.setPreviewQuality("high");
  environment.update(1 / 60, camera);
  assert.equal(environment.props.visibleInstanceCount(), highPropCount);
  assert.equal(environment.weather.activeParticleCount(), 360);
  assert.equal((sun.shadow.camera as THREE.OrthographicCamera).right, 70);
  environment.dispose();
});

test("distant terrain silhouettes follow the camera horizontally and fade into weather", () => {
  const horizon = new DistantHorizonRenderer(A17_ENVIRONMENT.seed, "high");
  assert.equal(horizon.nearRidges.count, 18);
  assert.equal(horizon.farRidges.count, 24);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  horizon.nearRidges.getMatrixAt(0, matrix);
  position.setFromMatrixPosition(matrix);
  assert.ok(Math.hypot(position.x, position.z) >= 200);
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
