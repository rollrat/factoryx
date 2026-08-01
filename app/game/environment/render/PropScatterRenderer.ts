import * as THREE from "three";
import type { EnvironmentDefinition, EnvironmentQuality } from "../types.ts";
import { BIOME_BY_ID } from "../data/biomes.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";
import type { TerrainChunkState } from "../terrain/TerrainChunkManager.ts";
import type { EnvironmentObstacle } from "../collision/EnvironmentObstacleIndex.ts";

const randomFactory = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

export class PropScatterRenderer {
  readonly root = new THREE.Group();
  readonly instanceCount: number;
  private readonly quality: EnvironmentQuality;
  private landmarksVisible = true;
  private readonly collisionObstacles: EnvironmentObstacle[] = [];
  private readonly baseMatrices = new Map<THREE.InstancedMesh, readonly THREE.Matrix4[]>();

  constructor(definition: EnvironmentDefinition, sampler: TerrainSampler, quality: EnvironmentQuality) {
    this.root.name = "a17-props";
    this.quality = quality;
    const density = quality === "high" ? 1 : 0.48;
    const random = randomFactory(definition.seed);
    const rockCount = Math.floor(360 * density);
    const plantCount = Math.floor(300 * density);
    this.instanceCount = rockCount + plantCount;

    const rockGeometry = new THREE.DodecahedronGeometry(0.75, 0);
    const plantGeometry = new THREE.ConeGeometry(0.52, 2.4, 5, 1, true);
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0.02 });
    const plantMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, side: THREE.DoubleSide });
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const placements = new Map<string, { rock: Array<{ matrix: THREE.Matrix4; color: THREE.Color }>; plant: Array<{ matrix: THREE.Matrix4; color: THREE.Color }> }>();
    const place = (plantLike: boolean) => {
      let x = 0;
      let z = 0;
      do {
        x = definition.worldBounds.minX + random() * (definition.worldBounds.maxX - definition.worldBounds.minX);
        z = definition.worldBounds.minZ + random() * (definition.worldBounds.maxZ - definition.worldBounds.minZ);
      } while (Math.max(Math.abs(x), Math.abs(z)) < 17);
      const sample = sampler.sample(x, z);
      const scale = plantLike ? 0.55 + random() * 1.7 : 0.45 + random() * 2.2;
      dummy.position.set(x, sample.height + (plantLike ? scale * 0.8 : scale * 0.25), z);
      dummy.rotation.set((random() - 0.5) * 0.2, random() * Math.PI * 2, plantLike ? -0.28 : (random() - 0.5) * 0.35);
      dummy.scale.set(scale * (0.65 + random() * 0.7), scale, scale * (0.65 + random() * 0.7));
      dummy.updateMatrix();
      const palette = BIOME_BY_ID.get(sample.biomeId)!.palette;
      color.setHex(plantLike ? palette.vegetation : palette.rock).offsetHSL((random() - 0.5) * 0.025, 0, (random() - 0.5) * 0.08);
      const chunkX = Math.floor(x / definition.chunkSize);
      const chunkZ = Math.floor(z / definition.chunkSize);
      const key = `${chunkX},${chunkZ}`;
      const bucket = placements.get(key) ?? { rock: [], plant: [] };
      bucket[plantLike ? "plant" : "rock"].push({ matrix: dummy.matrix.clone(), color: color.clone() });
      placements.set(key, bucket);
      if (!plantLike && scale > 1.45) {
        this.collisionObstacles.push({ id: `rock:${key}:${bucket.rock.length}`, x, z, radius: scale * 0.48, stratumId: "surface" });
      }
    };
    for (let index = 0; index < rockCount; index += 1) place(false);
    for (let index = 0; index < plantCount; index += 1) place(true);
    placements.forEach((bucket, key) => {
      (["rock", "plant"] as const).forEach((kind) => {
        const entries = bucket[kind];
        if (entries.length === 0) return;
        const mesh = new THREE.InstancedMesh(kind === "rock" ? rockGeometry : plantGeometry, kind === "rock" ? rockMaterial : plantMaterial, entries.length);
        entries.forEach((entry, index) => {
          mesh.setMatrixAt(index, entry.matrix);
          mesh.setColorAt(index, entry.color);
        });
        this.baseMatrices.set(mesh, entries.map(({ matrix }) => matrix.clone()));
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = quality === "high";
        mesh.receiveShadow = kind === "rock";
        mesh.userData.chunkKey = key;
        mesh.userData.propKind = kind;
        mesh.visible = false;
        this.root.add(mesh);
      });
    });
    this.addLandmarks(definition, sampler);
  }

  update(camera: THREE.Camera, activeChunks: readonly TerrainChunkState[]) {
    const active = new Map(activeChunks.map((chunk) => [`${chunk.x},${chunk.z}`, chunk]));
    this.root.children.forEach((child) => {
      const key = child.userData.chunkKey as string | undefined;
      if (key) {
        const chunk = active.get(key);
        child.visible = Boolean(chunk && (child.userData.propKind !== "plant" || chunk.lod < 2));
        return;
      }
      if (child.name.startsWith("landmark:")) {
        const world = new THREE.Vector3();
        child.getWorldPosition(world);
        child.visible = this.landmarksVisible && world.distanceTo(camera.position) < (this.quality === "high" ? 210 : 145);
      }
    });
  }

  setLandmarksVisible(visible: boolean) { this.landmarksVisible = visible; }
  obstacles() { return this.collisionObstacles.map((obstacle) => ({ ...obstacle })); }
  obstaclesOutside(areas: readonly Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>[]) {
    return this.obstacles().filter((obstacle) => !areas.some((area) => obstacle.x >= area.minX && obstacle.x <= area.maxX
      && obstacle.z >= area.minZ && obstacle.z <= area.maxZ));
  }
  applyFoundationClearing(areas: readonly Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>[]) {
    const position = new THREE.Vector3();
    this.baseMatrices.forEach((matrices, mesh) => {
      matrices.forEach((base, index) => {
        position.setFromMatrixPosition(base);
        const cleared = areas.some((area) => position.x >= area.minX && position.x <= area.maxX
          && position.z >= area.minZ && position.z <= area.maxZ);
        const matrix = base.clone();
        if (cleared) matrix.scale(new THREE.Vector3(0, 0, 0));
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  dispose() {
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
      this.root.add(group);
    });
  }
}
