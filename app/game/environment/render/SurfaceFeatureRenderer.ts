import * as THREE from "three";
import type { EnvironmentDefinition, EnvironmentQuality } from "../types.ts";
import type { TerrainSampler } from "../terrain/TerrainSampler.ts";
import { sampleIronwindTopography } from "../data/ironwindTopography.ts";

/** Water, shoreline and exposed strata derived from the authoritative terrain sampler. */
export class SurfaceFeatureRenderer {
  readonly root = new THREE.Group();
  readonly water: THREE.Mesh;
  readonly shore: THREE.InstancedMesh;
  readonly cliffStrata: THREE.InstancedMesh;
  private elapsed = 0;

  constructor(definition: EnvironmentDefinition, sampler: TerrainSampler, quality: EnvironmentQuality) {
    this.root.name = "surface-water-and-cliffs";
    const step = quality === "high" ? 4 : 8;
    const positions: number[] = [];
    const indices: number[] = [];
    const shoreSegments: Array<{ x: number; y: number; z: number; length: number; rotation: number }> = [];
    const wet = new Map<string, number>();
    const minX = Math.ceil(definition.worldBounds.minX / step) * step;
    const maxX = Math.floor(definition.worldBounds.maxX / step) * step;
    const minZ = Math.ceil(definition.worldBounds.minZ / step) * step;
    const maxZ = Math.floor(definition.worldBounds.maxZ / step) * step;
    for (let z = minZ; z < maxZ; z += step) {
      for (let x = minX; x < maxX; x += step) {
        const level = sampler.waterLevelAt(x + step / 2, z + step / 2);
        if (level !== null) wet.set(`${x},${z}`, level);
      }
    }
    wet.forEach((level, key) => {
      const [x, z] = key.split(",").map(Number);
      const offset = positions.length / 3;
      positions.push(x, level, z, x + step, level, z, x, level, z + step, x + step, level, z + step);
      indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
      const edges = [
        { key: `${x},${z - step}`, x: x + step / 2, z, rotation: 0 },
        { key: `${x},${z + step}`, x: x + step / 2, z: z + step, rotation: 0 },
        { key: `${x - step},${z}`, x, z: z + step / 2, rotation: Math.PI / 2 },
        { key: `${x + step},${z}`, x: x + step, z: z + step / 2, rotation: Math.PI / 2 },
      ];
      edges.filter((edge) => !wet.has(edge.key)).forEach((edge) => shoreSegments.push({ ...edge, y: level + 0.015, length: step }));
    });
    const waterGeometry = new THREE.BufferGeometry();
    waterGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    waterGeometry.setIndex(indices);
    waterGeometry.computeVertexNormals();
    waterGeometry.computeBoundingSphere();
    this.water = new THREE.Mesh(waterGeometry, new THREE.MeshPhysicalMaterial({
      color: 0x164b57,
      emissive: 0x061b20,
      emissiveIntensity: 0.22,
      roughness: 0.18,
      metalness: 0.08,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this.water.name = "blackwater-surface";
    this.water.renderOrder = 2;
    this.root.add(this.water);

    const shoreGeometry = new THREE.BoxGeometry(1, 0.07, 0.22);
    const shoreMaterial = new THREE.MeshStandardMaterial({ color: 0x172422, roughness: 1, metalness: 0 });
    this.shore = new THREE.InstancedMesh(shoreGeometry, shoreMaterial, shoreSegments.length);
    const dummy = new THREE.Object3D();
    shoreSegments.forEach((segment, index) => {
      dummy.position.set(segment.x, segment.y, segment.z);
      dummy.rotation.set(0, segment.rotation, 0);
      dummy.scale.set(segment.length, 1, 1);
      dummy.updateMatrix();
      this.shore.setMatrixAt(index, dummy.matrix);
    });
    this.shore.name = "blackwater-shoreline";
    this.shore.receiveShadow = true;
    this.root.add(this.shore);

    const cliffEntries: Array<{ x: number; y: number; z: number; rotation: number; scale: number }> = [];
    const cliffStep = quality === "high" ? 4 : 7;
    for (let z = definition.worldBounds.minZ + cliffStep; z < definition.worldBounds.maxZ; z += cliffStep) {
      for (let x = definition.worldBounds.minX + cliffStep; x < definition.worldBounds.maxX; x += cliffStep) {
        const sample = sampler.sample(x, z);
        const ironwind = sampleIronwindTopography(x, z, sample.height);
        if (ironwind.influence > 0.7 && ironwind.region === "fault_wall") continue;
        if (sample.slopeDegrees < 24 || cliffEntries.length >= (quality === "high" ? 240 : 100)) continue;
        const hash = Math.sin(x * 17.17 + z * 41.73) * 43758.5453;
        if (hash - Math.floor(hash) < 0.44) continue;
        cliffEntries.push({
          x, y: sample.height + 0.08, z,
          rotation: Math.atan2(sample.normal.z, sample.normal.x) + Math.PI / 2,
          scale: 0.72 + (hash - Math.floor(hash)) * 0.58,
        });
      }
    }
    this.cliffStrata = new THREE.InstancedMesh(
      new THREE.BoxGeometry(3.2, 0.13, 0.38),
      new THREE.MeshStandardMaterial({ color: 0x273033, roughness: 0.96, metalness: 0.04 }),
      cliffEntries.length,
    );
    cliffEntries.forEach((entry, index) => {
      dummy.position.set(entry.x, entry.y, entry.z);
      dummy.rotation.set(0, entry.rotation, 0);
      dummy.scale.set(entry.scale, 1, entry.scale);
      dummy.updateMatrix();
      this.cliffStrata.setMatrixAt(index, dummy.matrix);
    });
    this.cliffStrata.name = "cliff-strata-accents";
    this.cliffStrata.castShadow = quality === "high";
    this.cliffStrata.receiveShadow = true;
    this.root.add(this.cliffStrata);
  }

  update(delta: number) {
    this.elapsed += delta;
    this.water.position.y = Math.sin(this.elapsed * 0.48) * 0.012;
  }

  dispose() {
    for (const object of [this.water, this.shore, this.cliffStrata]) {
      object.geometry.dispose();
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose());
    }
  }
}
