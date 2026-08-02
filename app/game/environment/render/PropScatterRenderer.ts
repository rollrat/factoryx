import * as THREE from "three";
import type { EnvironmentDefinition, EnvironmentPropDefinition, EnvironmentQuality } from "../types.ts";
import { BIOME_BY_ID } from "../data/biomes.ts";
import { ENVIRONMENT_PROPS } from "../data/environment.ts";
import {
  choosePropModel,
  propScatterProfileForBiome,
  type EnvironmentPropKind,
  type EnvironmentPropModelKey,
} from "../data/propScatterProfiles.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";
import type { TerrainChunkState } from "../terrain/TerrainChunkManager.ts";
import type { EnvironmentObstacle } from "../collision/EnvironmentObstacleIndex.ts";
import { loadEnvironmentAsset, type EnvironmentAssetLoadState } from "../assets/EnvironmentAssetLoader.ts";

const randomFactory = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const PROP_BY_MODEL = new Map<EnvironmentPropModelKey, EnvironmentPropDefinition>(
  ENVIRONMENT_PROPS.map((definition) => [definition.modelKey, definition]),
);
const VEGETATION_MODELS = new Set<EnvironmentPropModelKey>(["fan", "tube", "membrane", "plate"]);

type PropInstance = {
  readonly id: string;
  readonly baseMatrix: THREE.Matrix4;
  readonly position: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
  readonly scale: THREE.Vector3;
  readonly phase: number;
  readonly sway: number;
  readonly removableByFoundation: boolean;
  cleared: boolean;
};

type Placement = Readonly<{ matrix: THREE.Matrix4; color: THREE.Color; instance: PropInstance }>;
type PlacementBucket = { modelKey: EnvironmentPropModelKey; chunkKey: string; entries: Placement[] };

const createFanGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-0.68, 0.48);
  shape.lineTo(-0.82, 0.92);
  shape.lineTo(-0.47, 1.28);
  shape.lineTo(0, 1.5);
  shape.lineTo(0.47, 1.28);
  shape.lineTo(0.82, 0.92);
  shape.lineTo(0.68, 0.48);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 2);
};

const createMembraneGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-0.72, 0.42, -0.58, 1.45, -0.12, 1.9);
  shape.bezierCurveTo(0.42, 1.58, 0.68, 0.58, 0, 0);
  return new THREE.ShapeGeometry(shape, 3);
};

const createGeometry = (modelKey: EnvironmentPropModelKey): THREE.BufferGeometry => {
  switch (modelKey) {
    case "basalt":
      return new THREE.DodecahedronGeometry(0.72, 0).scale(0.92, 1.15, 0.92);
    case "hematite":
      return new THREE.OctahedronGeometry(0.82, 0).scale(1.45, 0.52, 0.92);
    case "silicate": {
      const geometry = new THREE.ConeGeometry(0.52, 1.85, 5, 1);
      geometry.translate(0, 0.72, 0);
      return geometry;
    }
    case "fan":
      return createFanGeometry();
    case "tube": {
      const geometry = new THREE.CylinderGeometry(0.24, 0.38, 1.75, 7, 1, true);
      geometry.translate(0, 0.875, 0);
      return geometry;
    }
    case "membrane":
      return createMembraneGeometry();
    case "plate": {
      const geometry = new THREE.OctahedronGeometry(0.7, 0).scale(1.25, 0.28, 0.68);
      geometry.translate(0, 0.25, 0);
      return geometry;
    }
  }
};

const createMaterial = (modelKey: EnvironmentPropModelKey) => new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: VEGETATION_MODELS.has(modelKey) ? 0.74 : modelKey === "silicate" ? 0.58 : 0.94,
  metalness: modelKey === "hematite" ? 0.13 : modelKey === "silicate" ? 0.07 : 0.02,
  side: VEGETATION_MODELS.has(modelKey) ? THREE.DoubleSide : THREE.FrontSide,
  transparent: modelKey === "membrane",
  opacity: modelKey === "membrane" ? 0.88 : 1,
});

export class PropScatterRenderer {
  readonly root = new THREE.Group();
  private baseInstanceCount = 0;
  private authoredInstanceCount = 0;
  private readonly quality: EnvironmentQuality;
  private readonly chunkSize: number;
  private readonly definition: EnvironmentDefinition;
  private readonly sampler: TerrainSampler;
  private landmarksVisible = true;
  private density = 1;
  private readonly collisionObstacles: EnvironmentObstacle[] = [];
  private readonly instancesByMesh = new Map<THREE.InstancedMesh, PropInstance[]>();
  private readonly authoringMeshes = new Set<THREE.InstancedMesh>();
  private readonly authoredIds = new Set<string>();
  private readonly knownPropIds = new Set<string>();
  private readonly clearedIds = new Set<string>();
  private readonly windDirection = new THREE.Vector2(0.91, 0.41).normalize();
  private windStrength = 0.72;
  private windElapsed = 0;
  private readonly externalLodsByModel = new Map<EnvironmentPropModelKey, readonly [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry]>();
  private assetLoadState: EnvironmentAssetLoadState = "fallback";
  private disposed = false;

  constructor(definition: EnvironmentDefinition, sampler: TerrainSampler, quality: EnvironmentQuality) {
    this.root.name = "a17-props";
    this.definition = definition;
    this.sampler = sampler;
    this.quality = quality;
    this.chunkSize = definition.chunkSize;
    const random = randomFactory(definition.seed);
    const placements = new Map<string, PlacementBucket>();
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const place = (kind: EnvironmentPropKind, attemptIndex: number) => {
      let x = 0;
      let z = 0;
      do {
        x = definition.worldBounds.minX + random() * (definition.worldBounds.maxX - definition.worldBounds.minX);
        z = definition.worldBounds.minZ + random() * (definition.worldBounds.maxZ - definition.worldBounds.minZ);
      } while (Math.max(Math.abs(x), Math.abs(z)) < 17);

      const sample = sampler.sample(x, z);
      const biomeBlend = sampler.biomeBlendAt(x, z);
      const scatterBiome = random() < biomeBlend.secondaryWeight ? biomeBlend.secondary : biomeBlend.primary;
      const profile = propScatterProfileForBiome(scatterBiome.id);
      const density = kind === "rock" ? profile.rockDensity : profile.vegetationDensity;
      if (random() > density) return;
      const modelKey = choosePropModel(profile, kind, random());
      if (sample.surface === "submerged" && modelKey !== "tube") return;
      if (sample.surface === "hazard" && modelKey !== "tube" && modelKey !== "plate") return;

      const size = kind === "vegetation" ? 0.55 + random() * 1.55 : 0.5 + random() * 2.05;
      dummy.position.set(x, sample.height + (kind === "rock" ? size * 0.2 : 0.02), z);
      dummy.rotation.set(
        kind === "rock" ? (random() - 0.5) * 0.34 : (random() - 0.5) * 0.1,
        random() * Math.PI * 2,
        kind === "rock" ? (random() - 0.5) * 0.34 : (random() - 0.5) * 0.12,
      );
      const width = 0.68 + random() * 0.62;
      const depth = 0.68 + random() * 0.62;
      const height = modelKey === "silicate" || modelKey === "tube" || modelKey === "membrane"
        ? 0.9 + random() * 0.72
        : 0.72 + random() * 0.5;
      dummy.scale.set(size * width, size * height, size * depth);
      dummy.updateMatrix();

      const palette = BIOME_BY_ID.get(scatterBiome.id)?.palette ?? BIOME_BY_ID.values().next().value!.palette;
      color.setHex(kind === "vegetation" ? palette.vegetation : palette.rock);
      if (modelKey === "silicate" || modelKey === "membrane") color.lerp(new THREE.Color(palette.accent), 0.34);
      if (modelKey === "hematite") color.lerp(new THREE.Color(0x843e32), 0.22);
      color.offsetHSL((random() - 0.5) * 0.028, 0, (random() - 0.5) * 0.1);
      const phase = random() * Math.PI * 2;
      const sway = kind === "vegetation" ? 0.025 + random() * 0.065 : 0;

      const stableId = `prop:${definition.id}:${kind}:${attemptIndex}`;
      this.knownPropIds.add(stableId);
      const qualityHash = (Math.imul(attemptIndex + 1, 2654435761)
        ^ definition.seed ^ (kind === "vegetation" ? 0x9e3779b9 : 0)) >>> 0;
      if (quality === "low" && qualityHash / 0x100000000 > 0.48) return;

      const chunkX = Math.floor(x / definition.chunkSize);
      const chunkZ = Math.floor(z / definition.chunkSize);
      const chunkKey = `${chunkX},${chunkZ}`;
      const bucketKey = `${chunkKey}:${modelKey}`;
      const bucket = placements.get(bucketKey) ?? { modelKey, chunkKey, entries: [] };
      const position = dummy.position.clone();
      const rotation = dummy.quaternion.clone();
      const scale = dummy.scale.clone();
      const instance: PropInstance = {
        id: stableId,
        baseMatrix: dummy.matrix.clone(),
        position,
        rotation,
        scale,
        phase,
        sway,
        removableByFoundation: PROP_BY_MODEL.get(modelKey)?.removableByFoundation ?? false,
        cleared: false,
      };
      bucket.entries.push({ matrix: dummy.matrix.clone(), color: color.clone(), instance });
      placements.set(bucketKey, bucket);

      const propDefinition = PROP_BY_MODEL.get(modelKey);
      const collisionRadius = Math.max(scale.x, scale.z) * (modelKey === "membrane" ? 0.34 : 0.46);
      if (propDefinition?.collisionMode === "solid" && collisionRadius > 0.72) {
        this.collisionObstacles.push({
          id: stableId,
          x,
          z,
          radius: collisionRadius,
          stratumId: "surface",
        });
      }
    };

    for (let index = 0; index < 520; index += 1) place("rock", index);
    for (let index = 0; index < 560; index += 1) place("vegetation", index);

    const geometries = new Map<EnvironmentPropModelKey, THREE.BufferGeometry>();
    const materials = new Map<EnvironmentPropModelKey, THREE.Material>();
    let totalInstances = 0;
    placements.forEach((bucket) => {
      const geometry = geometries.get(bucket.modelKey) ?? createGeometry(bucket.modelKey);
      const material = materials.get(bucket.modelKey) ?? createMaterial(bucket.modelKey);
      geometries.set(bucket.modelKey, geometry);
      materials.set(bucket.modelKey, material);
      const mesh = new THREE.InstancedMesh(geometry, material, bucket.entries.length);
      bucket.entries.forEach((entry, index) => {
        mesh.setMatrixAt(index, entry.matrix);
        mesh.setColorAt(index, entry.color);
      });
      this.instancesByMesh.set(mesh, bucket.entries.map(({ instance }) => instance));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = quality === "high";
      mesh.receiveShadow = !VEGETATION_MODELS.has(bucket.modelKey);
      mesh.frustumCulled = false;
      mesh.userData.chunkKey = bucket.chunkKey;
      mesh.userData.modelKey = bucket.modelKey;
      mesh.userData.animating = false;
      mesh.userData.authoringFullCount = bucket.entries.length;
      mesh.visible = false;
      totalInstances += bucket.entries.length;
      this.root.add(mesh);
    });
    this.baseInstanceCount = totalInstances;
    this.addLandmarks(definition, sampler);
    this.rebuildAuthoringClusters();
    this.beginAssetUpgrade();
  }

  get instanceCount() { return this.baseInstanceCount + this.authoredInstanceCount; }

  update(delta: number, camera: THREE.Camera, activeChunks: readonly TerrainChunkState[]) {
    this.windElapsed += Math.min(Math.max(delta, 0), 0.1);
    const active = new Map(activeChunks.map((chunk) => [`${chunk.x},${chunk.z}`, chunk]));
    this.root.children.forEach((child) => {
      const key = child.userData.chunkKey as string | undefined;
      if (key && child instanceof THREE.InstancedMesh) {
        const chunk = active.get(key);
        const modelKey = child.userData.modelKey as EnvironmentPropModelKey;
        const definition = PROP_BY_MODEL.get(modelKey);
        const [chunkX, chunkZ] = key.split(",").map(Number);
        const centerX = (chunkX + 0.5) * this.chunkSize;
        const centerZ = (chunkZ + 0.5) * this.chunkSize;
        const distance = Math.hypot(centerX - camera.position.x, centerZ - camera.position.z);
        const vegetation = VEGETATION_MODELS.has(modelKey);
        const externalLods = this.externalLodsByModel.get(modelKey);
        if (externalLods && child.geometry !== externalLods[chunk?.lod ?? 2]) {
          child.geometry = externalLods[chunk?.lod ?? 2];
        }
        child.visible = Boolean(chunk && definition && distance <= definition.lodDistances[1]
          && (!vegetation || chunk.lod < 2));
        child.castShadow = Boolean(child.visible && this.quality === "high" && definition
          && distance <= definition.shadowDistance);
        const animate = Boolean(child.visible && vegetation && definition && distance <= definition.lodDistances[0]);
        if (animate || child.userData.animating) this.updateInstanceMatrices(child, animate);
        child.userData.animating = animate;
        return;
      }
      if (child.name.startsWith("landmark:")) {
        const world = new THREE.Vector3();
        child.getWorldPosition(world);
        const distance = world.distanceTo(camera.position);
        child.visible = this.landmarksVisible && distance < (this.quality === "high" ? 210 : 145);
        const externalMesh = child.children.find((candidate): candidate is THREE.Mesh => (
          candidate instanceof THREE.Mesh && Array.isArray(candidate.userData.externalLandmarkLods)
        ));
        if (externalMesh) {
          const lods = externalMesh.userData.externalLandmarkLods as readonly [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry];
          const lod = distance < 72 ? 0 : distance < 138 ? 1 : 2;
          if (externalMesh.geometry !== lods[lod]) externalMesh.geometry = lods[lod];
        }
        if (child.name === "landmark:pressure_vent") this.updatePressureVent(child);
      }
    });
  }

  setWind(direction: Readonly<{ x: number; z: number }>, strength = this.windStrength) {
    this.windDirection.set(direction.x, direction.z);
    if (this.windDirection.lengthSq() < 0.0001) this.windDirection.set(0.91, 0.41);
    this.windDirection.normalize();
    this.windStrength = THREE.MathUtils.clamp(strength, 0, 2);
  }

  setWindStrength(strength: number) {
    this.windStrength = THREE.MathUtils.clamp(strength, 0, 2);
  }

  setDensity(density: number) {
    this.density = THREE.MathUtils.clamp(density, 0, 1);
    this.instancesByMesh.forEach((instances, mesh) => {
      mesh.count = Math.floor(instances.length * this.density);
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  setAuthoringClusters() {
    this.rebuildAuthoringClusters();
  }

  visibleInstanceCount() {
    if (!this.root.visible) return 0;
    let count = 0;
    this.instancesByMesh.forEach((instances, mesh) => {
      if (!mesh.visible) return;
      const renderedCount = Math.min(mesh.count, instances.length);
      for (let index = 0; index < renderedCount; index += 1) {
        if (!instances[index].cleared) count += 1;
      }
    });
    return count;
  }

  assetStatus() { return this.assetLoadState; }

  setLandmarksVisible(visible: boolean) { this.landmarksVisible = visible; }
  setHazardState(landmarkId: string, stabilized: boolean) {
    const landmark = this.root.getObjectByName(`landmark:${landmarkId}`);
    if (landmark) landmark.userData.stabilized = stabilized;
  }
  propIds() {
    return [...this.instancesByMesh.values()].flatMap((instances) => instances.map(({ id }) => id)).sort();
  }
  clearedPropIds() { return [...this.clearedIds].sort(); }
  applyClearedPropIds(ids: readonly string[]) {
    ids.filter((id) => this.knownPropIds.has(id)).forEach((id) => this.clearedIds.add(id));
    this.instancesByMesh.forEach((instances, mesh) => {
      instances.forEach((instance) => { instance.cleared = this.clearedIds.has(instance.id); });
      this.updateInstanceMatrices(mesh, Boolean(mesh.userData.animating));
    });
  }
  obstacles() {
    return this.collisionObstacles.filter(({ id }) => !this.clearedIds.has(id)).map((obstacle) => ({ ...obstacle }));
  }
  obstaclesOutside(areas: readonly Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>[]) {
    return this.obstacles().filter((obstacle) => !areas.some((area) => obstacle.x >= area.minX && obstacle.x <= area.maxX
      && obstacle.z >= area.minZ && obstacle.z <= area.maxZ));
  }
  applyFoundationClearing(areas: readonly Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>[]) {
    this.instancesByMesh.forEach((instances, mesh) => {
      instances.forEach((instance) => {
        if (instance.removableByFoundation && areas.some((area) => instance.position.x >= area.minX && instance.position.x <= area.maxX
          && instance.position.z >= area.minZ && instance.position.z <= area.maxZ)) this.clearedIds.add(instance.id);
        instance.cleared = this.clearedIds.has(instance.id);
      });
      this.updateInstanceMatrices(mesh, Boolean(mesh.userData.animating));
    });
  }

  dispose() {
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      geometries.add(child.geometry);
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }

  private beginAssetUpgrade() {
    if (typeof window === "undefined") return;
    this.assetLoadState = "loading";
    const assets: ReadonlyArray<readonly [EnvironmentPropModelKey, string]> = [
      ["basalt", "rock_basalt_medium_a"],
      ["hematite", "rock_hematite_slab_a"],
      ["silicate", "rock_windglass_shard_cluster_a"],
      ["fan", "flora_wind_fan_a"],
      ["tube", "flora_marsh_tube_a"],
      ["membrane", "flora_sail_membrane_a"],
      ["plate", "rock_layered_plate_a"],
    ];
    let pending = assets.length + 1;
    let failed = false;
    const settle = () => {
      pending -= 1;
      if (pending === 0 && !this.disposed) this.assetLoadState = failed ? "fallback" : "ready";
    };
    assets.forEach(([modelKey, assetId]) => {
      void loadEnvironmentAsset(assetId).then((asset) => {
        if (this.disposed) {
          [...asset.lods, asset.collision].forEach((geometry) => geometry.dispose());
          return;
        }
        const replaced = new Set<THREE.BufferGeometry>();
        this.instancesByMesh.forEach((_instances, mesh) => {
          if (mesh.userData.modelKey !== modelKey) return;
          replaced.add(mesh.geometry);
          mesh.geometry = asset.lods[2];
          mesh.userData.externalAssetId = asset.id;
        });
        replaced.forEach((geometry) => geometry.dispose());
        this.externalLodsByModel.set(modelKey, asset.lods);
      }).catch((error: unknown) => {
        failed = true;
        console.warn(`FactoryX environment asset fallback: ${assetId}`, error);
      }).finally(() => {
        settle();
      });
    });
    void loadEnvironmentAsset("landmark_twin_needles_a").then((asset) => {
      if (this.disposed) {
        [...asset.lods, asset.collision].forEach((geometry) => geometry.dispose());
        return;
      }
      const group = this.root.getObjectByName("landmark:twin_needles");
      const definition = this.definition.landmarks.find(({ id }) => id === "twin_needles");
      if (!group || !definition) throw new Error("missing twin needles landmark target");
      const fallbackMeshes = group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
      const material = fallbackMeshes[0]?.material;
      if (!material) throw new Error("missing twin needles landmark material");
      fallbackMeshes.forEach((mesh) => mesh.geometry.dispose());
      group.clear();
      const mesh = new THREE.Mesh(asset.lods[0], material);
      asset.lods[0].computeBoundingBox();
      const bounds = asset.lods[0].boundingBox!;
      const size = new THREE.Vector3();
      bounds.getSize(size);
      const scale = definition.scale.y / Math.max(size.y, 0.001);
      mesh.scale.setScalar(scale);
      mesh.position.y = -bounds.min.y * scale;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.externalLandmarkLods = asset.lods;
      mesh.userData.externalAssetId = asset.id;
      group.add(mesh);
    }).catch((error: unknown) => {
      failed = true;
      console.warn("FactoryX landmark asset fallback: landmark_twin_needles_a", error);
    }).finally(settle);
  }

  private updateInstanceMatrices(mesh: THREE.InstancedMesh, animate: boolean) {
    const instances = this.instancesByMesh.get(mesh);
    if (!instances) return;
    const dummy = new THREE.Object3D();
    const windRotation = new THREE.Quaternion();
    const rotation = new THREE.Quaternion();
    const windAxis = new THREE.Vector3(this.windDirection.y, 0, -this.windDirection.x);
    instances.forEach((instance, index) => {
      if (instance.cleared) {
        dummy.position.copy(instance.position);
        dummy.quaternion.copy(instance.rotation);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        return;
      }
      if (!animate || instance.sway <= 0) {
        mesh.setMatrixAt(index, instance.baseMatrix);
        return;
      }
      const gust = Math.sin(this.windElapsed * 1.35 + instance.phase)
        + Math.sin(this.windElapsed * 0.43 + instance.phase * 0.37) * 0.35;
      windRotation.setFromAxisAngle(windAxis, gust * instance.sway * this.windStrength);
      rotation.multiplyQuaternions(windRotation, instance.rotation);
      dummy.position.copy(instance.position);
      dummy.quaternion.copy(rotation);
      dummy.scale.copy(instance.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  private rebuildAuthoringClusters() {
    this.authoredIds.forEach((id) => { this.knownPropIds.delete(id); this.clearedIds.delete(id); });
    this.authoredIds.clear();
    const disposedGeometries = new Set<THREE.BufferGeometry>();
    const disposedMaterials = new Set<THREE.Material>();
    this.authoringMeshes.forEach((mesh) => {
      this.root.remove(mesh);
      this.instancesByMesh.delete(mesh);
      disposedGeometries.add(mesh.geometry);
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => disposedMaterials.add(material));
    });
    disposedGeometries.forEach((geometry) => geometry.dispose());
    disposedMaterials.forEach((material) => material.dispose());
    this.authoringMeshes.clear();
    this.authoredInstanceCount = 0;
    for (let index = this.collisionObstacles.length - 1; index >= 0; index -= 1) {
      if (this.collisionObstacles[index].id.startsWith("authored-prop:")) this.collisionObstacles.splice(index, 1);
    }

    const buckets = new Map<string, PlacementBucket>();
    const dummy = new THREE.Object3D();
    this.sampler.scatterClusters().forEach((stroke, strokeIndex) => {
      const kind: EnvironmentPropKind = stroke.brush === "rock_scatter" ? "rock" : "vegetation";
      const seed = (this.definition.seed ^ Math.imul(Math.round(stroke.x * 10), 73856093)
        ^ Math.imul(Math.round(stroke.z * 10), 19349663) ^ Math.imul(strokeIndex + 1, 83492791)) >>> 0;
      const random = randomFactory(seed);
      const attempts = Math.min(180, Math.max(1, Math.round((stroke.radius * stroke.radius * 0.2 + 3) * stroke.strength)));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const distance = Math.sqrt(random()) * stroke.radius;
        const angle = random() * Math.PI * 2;
        const x = stroke.x + Math.cos(angle) * distance;
        const z = stroke.z + Math.sin(angle) * distance;
        if (x < this.definition.worldBounds.minX || x > this.definition.worldBounds.maxX
          || z < this.definition.worldBounds.minZ || z > this.definition.worldBounds.maxZ) continue;
        const sample = this.sampler.sample(x, z);
        if (sample.surface === "submerged" && kind === "rock") continue;
        const blend = this.sampler.biomeBlendAt(x, z);
        const biome = random() < blend.secondaryWeight ? blend.secondary : blend.primary;
        const profile = propScatterProfileForBiome(biome.id);
        const modelKey = choosePropModel(profile, kind, random());
        if (sample.surface === "submerged" && modelKey !== "tube") continue;
        if (sample.surface === "hazard" && modelKey !== "tube" && modelKey !== "plate") continue;

        const size = kind === "vegetation" ? 0.55 + random() * 1.55 : 0.5 + random() * 2.05;
        dummy.position.set(x, sample.height + (kind === "rock" ? size * 0.2 : 0.02), z);
        dummy.rotation.set(
          kind === "rock" ? (random() - 0.5) * 0.34 : (random() - 0.5) * 0.1,
          random() * Math.PI * 2,
          kind === "rock" ? (random() - 0.5) * 0.34 : (random() - 0.5) * 0.12,
        );
        const elongated = modelKey === "silicate" || modelKey === "tube" || modelKey === "membrane";
        dummy.scale.set(size * (0.68 + random() * 0.62), size * (elongated ? 0.9 + random() * 0.72 : 0.72 + random() * 0.5), size * (0.68 + random() * 0.62));
        dummy.updateMatrix();
        const palette = BIOME_BY_ID.get(biome.id)?.palette ?? BIOME_BY_ID.values().next().value!.palette;
        const color = new THREE.Color(kind === "vegetation" ? palette.vegetation : palette.rock);
        if (modelKey === "silicate" || modelKey === "membrane") color.lerp(new THREE.Color(palette.accent), 0.34);
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(z / this.chunkSize);
        const chunkKey = `${chunkX},${chunkZ}`;
        const bucketKey = `${chunkKey}:${modelKey}`;
        const bucket = buckets.get(bucketKey) ?? { modelKey, chunkKey, entries: [] };
        const id = `authored-prop:${strokeIndex}:${kind}:${attempt}`;
        this.knownPropIds.add(id);
        this.authoredIds.add(id);
        const propDefinition = PROP_BY_MODEL.get(modelKey);
        const instance: PropInstance = {
          id,
          baseMatrix: dummy.matrix.clone(),
          position: dummy.position.clone(),
          rotation: dummy.quaternion.clone(),
          scale: dummy.scale.clone(),
          phase: random() * Math.PI * 2,
          sway: kind === "vegetation" ? 0.025 + random() * 0.065 : 0,
          removableByFoundation: propDefinition?.removableByFoundation ?? false,
          cleared: this.clearedIds.has(id),
        };
        bucket.entries.push({ matrix: dummy.matrix.clone(), color, instance });
        buckets.set(bucketKey, bucket);
        const collisionRadius = Math.max(dummy.scale.x, dummy.scale.z) * (modelKey === "membrane" ? 0.34 : 0.46);
        if (propDefinition?.collisionMode === "solid" && collisionRadius > 0.72) {
          this.collisionObstacles.push({ id, x, z, radius: collisionRadius, stratumId: "surface" });
        }
      }
    });

    buckets.forEach((bucket) => {
      const mesh = new THREE.InstancedMesh(createGeometry(bucket.modelKey), createMaterial(bucket.modelKey), bucket.entries.length);
      bucket.entries.forEach((entry, index) => { mesh.setMatrixAt(index, entry.matrix); mesh.setColorAt(index, entry.color); });
      const instances = bucket.entries.map(({ instance }) => instance);
      this.instancesByMesh.set(mesh, instances);
      mesh.count = Math.floor(instances.length * this.density);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = this.quality === "high";
      mesh.receiveShadow = !VEGETATION_MODELS.has(bucket.modelKey);
      mesh.frustumCulled = false;
      mesh.userData.chunkKey = bucket.chunkKey;
      mesh.userData.modelKey = bucket.modelKey;
      mesh.userData.animating = false;
      mesh.userData.authoringFullCount = instances.length;
      mesh.userData.authoredCluster = true;
      mesh.visible = false;
      this.authoredInstanceCount += instances.length;
      this.authoringMeshes.add(mesh);
      this.root.add(mesh);
    });
  }

  private updatePressureVent(group: THREE.Object3D) {
    const stabilized = group.userData.stabilized === true;
    const pulse = (Math.sin(this.windElapsed * (stabilized ? 1.1 : 3.4)) + 1) * 0.5;
    const plume = group.getObjectByName("vent-plume") as THREE.Mesh | undefined;
    const warning = group.getObjectByName("vent-warning") as THREE.Mesh | undefined;
    if (plume) {
      plume.scale.y = stabilized ? 0.18 + pulse * 0.05 : 0.78 + pulse * 0.5;
      if (plume.material instanceof THREE.MeshBasicMaterial) {
        plume.material.opacity = stabilized ? 0.08 : 0.2 + pulse * 0.16;
        plume.material.color.setHex(stabilized ? 0x65d8ca : 0xd8e4dc);
      }
    }
    if (warning) {
      warning.scale.setScalar((stabilized ? 0.78 : 0.9) + pulse * (stabilized ? 0.04 : 0.22));
      if (warning.material instanceof THREE.MeshBasicMaterial) {
        warning.material.color.setHex(stabilized ? 0x5de4d1 : 0xe59a45);
        warning.material.opacity = stabilized ? 0.24 : 0.36 + pulse * 0.3;
      }
    }
  }

  private addLandmarks(definition: EnvironmentDefinition, sampler: TerrainSampler) {
    definition.landmarks.forEach((landmark, landmarkIndex) => {
      const group = new THREE.Group();
      group.name = `landmark:${landmark.id}`;
      const palette = BIOME_BY_ID.get(landmark.biomeId)!.palette;
      const material = new THREE.MeshStandardMaterial({
        color: landmark.kind === "sail" ? palette.accent : palette.rock,
        roughness: landmark.kind === "sail" ? 0.42 : 0.92,
        metalness: landmark.kind === "sail" ? 0.18 : 0.03,
        transparent: landmark.kind === "sail",
        opacity: landmark.kind === "sail" ? 0.76 : 1,
        side: THREE.DoubleSide,
      });
      const parts = landmark.kind === "crown" ? 7 : landmark.kind === "rib" ? 6 : landmark.kind === "spire" ? 2 : 1;
      for (let index = 0; index < parts; index += 1) {
        const geometry = landmark.kind === "sail"
          ? new THREE.ConeGeometry(0.5, 1, 3)
          : landmark.kind === "sinkhole"
            ? new THREE.TorusGeometry(0.45, 0.13, 8, 28)
            : new THREE.ConeGeometry(0.48, 1, landmark.kind === "vent" ? 7 : 5);
        const mesh = new THREE.Mesh(geometry, material);
        const angle = parts === 1 ? 0 : index / parts * Math.PI * (landmark.kind === "crown" ? 1.55 : 0.75) - 0.8;
        mesh.position.set(Math.cos(angle) * landmark.scale.x * 0.34, landmark.scale.y * 0.5, Math.sin(angle) * landmark.scale.z * 0.34);
        mesh.scale.set(landmark.scale.x / Math.max(parts, 2), landmark.scale.y * (0.72 + index * 0.045), landmark.scale.z / Math.max(parts, 2));
        mesh.rotation.z = landmark.kind === "rib" ? -0.7 : landmark.kind === "spire" ? (index ? 0.14 : -0.12) : 0;
        mesh.rotation.y = -0.6 + index * 0.18 + landmarkIndex * 0.03;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      group.position.set(landmark.position.x, sampler.heightAt(landmark.position.x, landmark.position.z), landmark.position.z);
      if (landmark.kind === "vent") {
        group.userData.stabilized = false;
        const plume = new THREE.Mesh(
          new THREE.ConeGeometry(0.2, 1, 8, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xd8e4dc, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
        );
        plume.name = "vent-plume";
        plume.position.y = landmark.scale.y * 1.04;
        plume.scale.set(landmark.scale.x * 0.28, landmark.scale.y * 0.72, landmark.scale.z * 0.28);
        const warning = new THREE.Mesh(
          new THREE.RingGeometry(0.42, 0.54, 36),
          new THREE.MeshBasicMaterial({ color: 0xe59a45, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
        );
        warning.name = "vent-warning";
        warning.rotation.x = -Math.PI / 2;
        warning.position.y = 0.18;
        warning.scale.set(landmark.scale.x * 0.62, landmark.scale.z * 0.62, 1);
        group.add(plume, warning);
      }
      this.root.add(group);
    });
  }
}
