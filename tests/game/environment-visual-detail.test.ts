import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { A17_ENVIRONMENT, EnvironmentRenderer, TerrainSampler } from "../../app/game/environment/index.ts";
import { DistantHorizonRenderer } from "../../app/game/environment/render/DistantHorizonRenderer.ts";
import { TerrainDetailRenderer } from "../../app/game/environment/render/TerrainDetailRenderer.ts";
import { TerrainRenderer } from "../../app/game/environment/render/TerrainRenderer.ts";
import { SurfaceFeatureRenderer } from "../../app/game/environment/render/SurfaceFeatureRenderer.ts";
import { WeatherSystem } from "../../app/game/environment/render/WeatherSystem.ts";
import { SkySystem } from "../../app/game/environment/render/SkySystem.ts";

test("near terrain detail stays camera-local and reacts to rain and industry", () => {
  const detail = new TerrainDetailRenderer(new TerrainSampler(A17_ENVIRONMENT), "high");
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 4, 0);
  detail.update(camera);
  assert.ok(detail.gravel.count > 0);
  assert.ok(detail.gravel.instanceColor);
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

test("clear weather keeps an Earth-like cloud sky without a permanent dust band", () => {
  const scene = new THREE.Scene();
  const sky = new SkySystem(scene, "high");
  const dustBand = sky.root.getObjectByName("mineral-wind-dust-band") as THREE.Mesh;
  const cloud = sky.root.getObjectByName("cloud-layer-1") as THREE.Mesh;
  sky.setTimeOfDay(0.5);
  sky.setWeatherInfluence("clear", 0);
  assert.equal(dustBand.visible, false);
  assert.ok(((cloud.material as THREE.ShaderMaterial).uniforms.opacity.value as number) > 0.2);
  sky.setWeatherInfluence("mineral_wind", 0.7);
  assert.equal(dustBand.visible, true);
  sky.dispose();
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

test("surface cave entrances stay visible until the cutaway reveals the cave network", () => {
  const scene = new THREE.Scene();
  const environment = new EnvironmentRenderer(scene, A17_ENVIRONMENT, "low");
  assert.ok(environment.caves.surfaceEntrances.children.length >= 2);
  assert.equal(environment.caves.surfaceEntrances.visible, true);
  assert.equal(environment.caves.root.visible, false);
  environment.setCaveCutaway(true);
  assert.equal(environment.caves.surfaceEntrances.visible, false);
  assert.equal(environment.caves.root.visible, true);
  assert.equal(environment.caves.cutawayRoot.visible, true);
  assert.equal(environment.terrain.root.visible, false);
  assert.equal(environment.props.root.visible, false);
  assert.ok(environment.caves.cutawayRoot.getObjectByName("cave-cutaway-route"));
  environment.dispose();
});

test("distant terrain uses world-fixed ridge ribbons and fades into weather", () => {
  const horizon = new DistantHorizonRenderer(A17_ENVIRONMENT.seed, "high");
  assert.equal(horizon.nearRidges.geometry.userData.kind, "authored-ridge-ribbon");
  assert.equal(horizon.farRidges.geometry.userData.kind, "authored-ridge-ribbon");
  assert.notEqual(horizon.nearRidges.geometry.type, "ConeGeometry");
  assert.ok((horizon.nearRidges.geometry.getAttribute("position") as THREE.BufferAttribute).count > 300);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(48, 36, -27);
  horizon.update(camera);
  assert.equal(horizon.root.position.x, 0);
  assert.equal(horizon.root.position.y, -11);
  assert.equal(horizon.root.position.z, 0);
  const clearOpacity = (horizon.farRidges.material as THREE.MeshBasicMaterial).opacity;
  horizon.setWeather("mist", 1);
  assert.ok((horizon.farRidges.material as THREE.MeshBasicMaterial).opacity < clearOpacity);
  horizon.dispose();
});

test("surface features derive actual water, shoreline, and cliff strata from terrain", () => {
  const features = new SurfaceFeatureRenderer(A17_ENVIRONMENT, new TerrainSampler(A17_ENVIRONMENT), "high");
  assert.ok((features.water.geometry.getAttribute("position") as THREE.BufferAttribute).count > 0);
  assert.ok(features.shore.count > 0);
  assert.ok(features.cliffStrata.count > 0);
  features.dispose();
});

test("terrain chunks use half-meter source samples, power-of-two LODs, shared edge normals, and skirts", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const terrain = new TerrainRenderer(A17_ENVIRONMENT, sampler, "high");
  assert.equal((terrain.terrain.material as THREE.Material).userData.detailMode, "procedural-micro-surface");
  const chunks = new Map<string, THREE.Mesh>();
  terrain.root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name.startsWith("terrain-chunk:")) chunks.set(object.name, object);
  });
  const left = chunks.get("terrain-chunk:0,0:lod0")!;
  const right = chunks.get("terrain-chunk:1,0:lod0")!;
  assert.equal(left.geometry.userData.segments, 64);
  assert.equal(left.geometry.userData.skirtDepth, 2.5);
  assert.deepEqual([0, 1, 2].map((lod) => chunks.get(`terrain-chunk:0,0:lod${lod}`)!.geometry.userData.segments), [64, 32, 16]);
  const leftPositions = left.geometry.getAttribute("position") as THREE.BufferAttribute;
  const leftNormals = left.geometry.getAttribute("normal") as THREE.BufferAttribute;
  const rightPositions = right.geometry.getAttribute("position") as THREE.BufferAttribute;
  const rightNormals = right.geometry.getAttribute("normal") as THREE.BufferAttribute;
  for (let row = 0; row <= 64; row += 8) {
    const leftIndex = row * 65 + 64;
    const rightIndex = row * 65;
    assert.equal(leftPositions.getY(leftIndex), rightPositions.getY(rightIndex));
    assert.equal(leftNormals.getX(leftIndex), rightNormals.getX(rightIndex));
    assert.equal(leftNormals.getY(leftIndex), rightNormals.getY(rightIndex));
    assert.equal(leftNormals.getZ(leftIndex), rightNormals.getZ(rightIndex));
  }
  terrain.dispose();
});
