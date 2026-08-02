import * as THREE from "three";
import { loadEnvironmentAsset, type EnvironmentAssetLoadState } from "../assets/EnvironmentAssetLoader.ts";
import type { EnvironmentQuality } from "../types.ts";
import type { TerrainChunkState } from "../terrain/TerrainChunkManager.ts";
import { WorldSourceEnvironmentSampler } from "../worldSourceSampler/WorldSourceEnvironmentSampler.ts";
import type { AssetPlacement, WorldSourceV3 } from "../worldSourceV3/types.ts";

type ScatterModel = "basalt" | "hematite" | "windglass" | "layered" | "fan" | "tube" | "membrane";
type ScatterInstance = Readonly<{ x: number; y: number; z: number; rotation: number; scale: number }>;

const SCATTER_ASSETS: Readonly<Record<ScatterModel, string>> = {
  basalt: "rock_basalt_medium_a",
  hematite: "rock_hematite_slab_a",
  windglass: "rock_windglass_shard_cluster_a",
  layered: "rock_layered_plate_a",
  fan: "flora_wind_fan_a",
  tube: "flora_marsh_tube_a",
  membrane: "flora_sail_membrane_a",
};

const BIOME_MODELS: Readonly<Record<string, readonly [ScatterModel, ScatterModel, ScatterModel]>> = {
  windglass_basin: ["basalt", "windglass", "fan"],
  ironwind_faults: ["hematite", "layered", "fan"],
  silicate_sailwood: ["windglass", "membrane", "fan"],
  blackwater_marsh: ["basalt", "tube", "membrane"],
  hematite_crown: ["hematite", "layered", "windglass"],
  thermal_rift: ["basalt", "windglass", "tube"],
};

const BIOME_DENSITY: Readonly<Record<string, number>> = {
  windglass_basin: 0.34,
  ironwind_faults: 0.44,
  silicate_sailwood: 0.68,
  blackwater_marsh: 0.58,
  hematite_crown: 0.48,
  thermal_rift: 0.4,
};

const hash = (x: number, z: number, seed: number) => {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 0.017) * 43758.5453123;
  return value - Math.floor(value);
};

const groundGeometry = <Geometry extends THREE.BufferGeometry>(geometry: Geometry): Geometry => {
  geometry.computeBoundingBox();
  geometry.translate(0, -(geometry.boundingBox?.min.y ?? 0), 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const fallbackGeometry = (model: ScatterModel) => groundGeometry(
  model === "fan" ? new THREE.ConeGeometry(0.65, 2.2, 5)
    : model === "tube" ? new THREE.CylinderGeometry(0.34, 0.58, 2.4, 7)
      : model === "membrane" ? new THREE.ConeGeometry(0.18, 3.1, 3)
        : model === "windglass" ? new THREE.OctahedronGeometry(0.8, 0)
          : model === "layered" ? new THREE.BoxGeometry(1.6, 0.42, 1.15, 1, 1, 1)
            : new THREE.DodecahedronGeometry(model === "hematite" ? 0.9 : 0.72, 0),
);

const normalizeScatterGeometry = (geometry: THREE.BufferGeometry, model: ScatterModel) => {
  const target = fallbackGeometry(model);
  target.computeBoundingBox();
  const targetSize = new THREE.Vector3();
  target.boundingBox?.getSize(targetSize);
  target.dispose();
  groundGeometry(geometry);
  const sourceSize = new THREE.Vector3();
  geometry.boundingBox?.getSize(sourceSize);
  const factor = Math.max(targetSize.x, targetSize.y, targetSize.z)
    / Math.max(sourceSize.x, sourceSize.y, sourceSize.z, 0.001);
  geometry.scale(factor, factor, factor);
  return groundGeometry(geometry);
};

const scatterMaterial = (model: ScatterModel) => new THREE.MeshStandardMaterial({
  color: model === "hematite" ? 0x805544
    : model === "windglass" ? 0x72959a
      : model === "layered" ? 0x5d5148
        : model === "fan" ? 0x849b70
          : model === "tube" ? 0x507f69
            : model === "membrane" ? 0x7da898 : 0x424b49,
  roughness: model === "windglass" ? 0.58 : 0.9,
  metalness: model === "hematite" || model === "windglass" ? 0.1 : 0.02,
});

const landmarkMaterial = (placement: AssetPlacement) => new THREE.MeshStandardMaterial({
  color: placement.biomeId === "ironwind_faults" || placement.biomeId === "hematite_crown" ? 0x875b48
    : placement.biomeId === "silicate_sailwood" ? 0x8eb0a0
      : placement.biomeId === "blackwater_marsh" ? 0x52776d
        : placement.biomeId === "thermal_rift" ? 0x6d4e47 : 0x71847c,
  emissive: placement.biomeId === "thermal_rift" ? 0x351717 : 0x0b1515,
  emissiveIntensity: placement.biomeId === "thermal_rift" ? 0.42 : 0.12,
  roughness: 0.78,
  metalness: 0.08,
});

const makeLandmarkFallback = () => new THREE.ConeGeometry(0.5, 1, 6);

/**
 * Presents authored WorldSource placements and deterministic biome scatter.
 * The source remains authoritative; scatter is a derived, disposable visual
 * layer and never participates in gameplay or serialization.
 */
export class WorldSourcePlacementRenderer {
  readonly root = new THREE.Group();
  readonly landmarkRoot = new THREE.Group();
  readonly scatterRoot = new THREE.Group();
  private readonly scatterMeshes = new Map<string, THREE.InstancedMesh>();
  private readonly landmarkGroups = new Map<string, THREE.Group>();
  private disposed = false;
  private loadState: EnvironmentAssetLoadState = "fallback";
  private scatterDensity = 1;

  constructor(source?: WorldSourceV3, sampler?: WorldSourceEnvironmentSampler, quality: EnvironmentQuality = "high") {
    this.root.name = "world-source-placements";
    this.landmarkRoot.name = "world-source-landmarks";
    this.scatterRoot.name = "world-source-biome-scatter";
    this.root.add(this.scatterRoot, this.landmarkRoot);
    if (!source) return;
    const sourceSampler = sampler ?? new WorldSourceEnvironmentSampler(source);
    this.buildScatter(source, sourceSampler, quality);
    this.buildLandmarks(source, sourceSampler);
    this.beginAssetUpgrade();
  }

  visibleInstanceCount() {
    if (!this.root.visible || !this.scatterRoot.visible) return 0;
    let count = 0;
    this.scatterMeshes.forEach((mesh) => { if (mesh.visible) count += mesh.count; });
    return count;
  }
  landmarkCount() { return this.landmarkGroups.size; }
  visibleLandmarkCount() {
    if (!this.root.visible || !this.landmarkRoot.visible) return 0;
    let count = 0;
    this.landmarkGroups.forEach((group) => { if (group.visible) count += 1; });
    return count;
  }
  assetStatus() { return this.loadState; }
  setVisible(visible: boolean) { this.root.visible = visible; }
  setScatterVisible(visible: boolean) { this.scatterRoot.visible = visible; }
  setLandmarksVisible(visible: boolean) { this.landmarkRoot.visible = visible; }
  setDensity(density: number) {
    this.scatterDensity = THREE.MathUtils.clamp(density, 0, 1);
    this.scatterMeshes.forEach((mesh) => {
      mesh.count = Math.floor((mesh.userData.capacity as number) * this.scatterDensity);
      mesh.computeBoundingSphere();
    });
  }
  updateChunks(states: readonly TerrainChunkState[]) {
    const active = new Set(states.map(({ x, z }) => `${x},${z}`));
    this.scatterMeshes.forEach((mesh) => { mesh.visible = active.has(mesh.userData.chunkKey as string); });
    this.landmarkGroups.forEach((group) => { group.visible = active.has(group.userData.chunkKey as string); });
  }

  dispose() {
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.root.clear();
    this.root.removeFromParent();
    this.scatterMeshes.clear();
    this.landmarkGroups.clear();
  }

  private buildScatter(source: WorldSourceV3, sampler: WorldSourceEnvironmentSampler, quality: EnvironmentQuality) {
    const instances = new Map<string, { model: ScatterModel; chunkKey: string; values: ScatterInstance[] }>();
    const spacing = quality === "high" ? 7 : 10;
    const anchorClear = (x: number, z: number) => source.resourceAnchors.every((anchor) => (
      anchor.stratumId !== "surface" || Math.hypot(x - anchor.position.x, z - anchor.position.z) > anchor.protectionRadius
    ));
    let row = 0;
    for (let z = source.bounds.minZ + spacing * 0.5; z < source.bounds.maxZExclusive; z += spacing, row += 1) {
      let column = 0;
      for (let x = source.bounds.minX + spacing * 0.5; x < source.bounds.maxXExclusive; x += spacing, column += 1) {
        const jitterX = (hash(column, row, source.seed + 11) - 0.5) * spacing * 0.72;
        const jitterZ = (hash(column, row, source.seed + 29) - 0.5) * spacing * 0.72;
        const worldX = Math.min(source.bounds.maxXExclusive - 1e-6, x + jitterX);
        const worldZ = Math.min(source.bounds.maxZExclusive - 1e-6, z + jitterZ);
        const sample = sampler.sample(worldX, worldZ);
        const density = BIOME_DENSITY[sample.biomeId] ?? 0.22;
        if (hash(column, row, source.seed + 47) > density || sample.slopeDegrees > 31
          || sample.surface === "submerged" || sample.surface === "hazard" || !anchorClear(worldX, worldZ)) continue;
        const models = BIOME_MODELS[sample.biomeId] ?? BIOME_MODELS.windglass_basin;
        const choice = Math.min(2, Math.floor(hash(column, row, source.seed + 71) * 3));
        const model = models[choice];
        const vegetation = model === "fan" || model === "tube" || model === "membrane";
        const scale = (vegetation ? 0.62 : 0.48) + hash(column, row, source.seed + 97) * (vegetation ? 0.9 : 0.82);
        const chunkKey = `${Math.floor(worldX / source.chunkSize)},${Math.floor(worldZ / source.chunkSize)}`;
        const bucketKey = `${chunkKey}:${model}`;
        const bucket = instances.get(bucketKey) ?? { model, chunkKey, values: [] };
        bucket.values.push({ x: worldX, y: sample.height, z: worldZ, rotation: hash(column, row, source.seed + 113) * Math.PI * 2, scale });
        instances.set(bucketKey, bucket);
      }
    }

    const dummy = new THREE.Object3D();
    instances.forEach(({ model, chunkKey, values }, bucketKey) => {
      const mesh = new THREE.InstancedMesh(fallbackGeometry(model), scatterMaterial(model), values.length);
      mesh.name = `world-source-scatter:${bucketKey}`;
      mesh.castShadow = quality === "high";
      mesh.receiveShadow = true;
      mesh.userData.model = model;
      mesh.userData.chunkKey = chunkKey;
      mesh.userData.capacity = values.length;
      values.forEach((instance, index) => {
        dummy.position.set(instance.x, instance.y, instance.z);
        dummy.rotation.set(0, instance.rotation, model === "membrane" ? (hash(index, values.length, source.seed) - 0.5) * 0.28 : 0);
        dummy.scale.setScalar(instance.scale);
        if (model === "layered") dummy.scale.y *= 0.55;
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.scatterMeshes.set(bucketKey, mesh);
      this.scatterRoot.add(mesh);
    });
  }

  private buildLandmarks(source: WorldSourceV3, sampler: WorldSourceEnvironmentSampler) {
    [...source.placements]
      .filter(({ stratumId }) => stratumId === "surface")
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
      .forEach((placement) => {
        const group = new THREE.Group();
        const sample = sampler.sample(placement.transform.position.x, placement.transform.position.z);
        group.name = `world-source-placement:${placement.id}`;
        group.position.set(placement.transform.position.x, sample.height, placement.transform.position.z);
        group.quaternion.set(
          placement.transform.rotation.x,
          placement.transform.rotation.y,
          placement.transform.rotation.z,
          placement.transform.rotation.w,
        );
        group.userData.placement = placement;
        group.userData.chunkKey = `${Math.floor(placement.transform.position.x / source.chunkSize)},${Math.floor(placement.transform.position.z / source.chunkSize)}`;
        const fallback = new THREE.Mesh(makeLandmarkFallback(), landmarkMaterial(placement));
        fallback.name = `world-source-placement-fallback:${placement.id}`;
        fallback.scale.set(placement.transform.scale.x, placement.transform.scale.y, placement.transform.scale.z);
        fallback.position.y = placement.transform.scale.y * 0.5;
        fallback.castShadow = true;
        fallback.receiveShadow = true;
        group.add(fallback);
        this.landmarkGroups.set(placement.id, group);
        this.landmarkRoot.add(group);
      });
  }

  private beginAssetUpgrade() {
    if (typeof window === "undefined" || this.landmarkGroups.size === 0) return;
    this.loadState = "loading";
    const jobs: Promise<void>[] = [];
    this.landmarkGroups.forEach((group) => {
      const placement = group.userData.placement as AssetPlacement;
      jobs.push(loadEnvironmentAsset(placement.assetId).then((asset) => {
        if (this.disposed) return;
        const previous = group.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh | undefined;
        const material = previous?.material ?? landmarkMaterial(placement);
        if (previous) { group.remove(previous); previous.geometry.dispose(); }
        const geometry = asset.lods[0].clone();
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox!;
        const size = new THREE.Vector3();
        bounds.getSize(size);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `world-source-placement-asset:${placement.id}`;
        mesh.scale.set(
          placement.transform.scale.x / Math.max(size.x, 0.001),
          placement.transform.scale.y / Math.max(size.y, 0.001),
          placement.transform.scale.z / Math.max(size.z, 0.001),
        );
        mesh.position.y = -bounds.min.y * mesh.scale.y;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }));
    });
    this.scatterMeshes.forEach((mesh) => {
      const model = mesh.userData.model as ScatterModel;
      jobs.push(loadEnvironmentAsset(SCATTER_ASSETS[model]).then((asset) => {
        if (this.disposed) return;
        const previous = mesh.geometry;
        mesh.geometry = normalizeScatterGeometry(asset.lods[1].clone(), model);
        previous.dispose();
      }));
    });
    void Promise.allSettled(jobs).then((results) => {
      if (this.disposed) return;
      this.loadState = results.some(({ status }) => status === "rejected") ? "fallback" : "ready";
    });
  }
}
