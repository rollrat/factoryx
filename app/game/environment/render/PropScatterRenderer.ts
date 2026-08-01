import * as THREE from "three";
import type { EnvironmentDefinition, EnvironmentQuality } from "../types.ts";
import { BIOME_BY_ID } from "../data/biomes.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";

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

  constructor(definition: EnvironmentDefinition, sampler: TerrainSampler, quality: EnvironmentQuality) {
    this.root.name = "a17-props";
    const density = quality === "high" ? 1 : 0.48;
    const random = randomFactory(definition.seed);
    const rockCount = Math.floor(360 * density);
    const plantCount = Math.floor(300 * density);
    this.instanceCount = rockCount + plantCount;

    const rock = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.75, 0),
      new THREE.MeshStandardMaterial({ color: 0x24353a, roughness: 0.96, metalness: 0.02 }),
      rockCount,
    );
    const plant = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.52, 2.4, 5, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x597468, roughness: 0.82, side: THREE.DoubleSide }),
      plantCount,
    );
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const place = (mesh: THREE.InstancedMesh, index: number, plantLike: boolean) => {
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
      mesh.setMatrixAt(index, dummy.matrix);
      const palette = BIOME_BY_ID.get(sample.biomeId)!.palette;
      color.setHex(plantLike ? palette.vegetation : palette.rock).offsetHSL((random() - 0.5) * 0.025, 0, (random() - 0.5) * 0.08);
      mesh.setColorAt(index, color);
    };
    for (let index = 0; index < rockCount; index += 1) place(rock, index, false);
    for (let index = 0; index < plantCount; index += 1) place(plant, index, true);
    rock.instanceMatrix.needsUpdate = true;
    plant.instanceMatrix.needsUpdate = true;
    if (rock.instanceColor) rock.instanceColor.needsUpdate = true;
    if (plant.instanceColor) plant.instanceColor.needsUpdate = true;
    rock.castShadow = quality === "high";
    rock.receiveShadow = true;
    plant.castShadow = quality === "high";
    this.root.add(rock, plant);
    this.addLandmarks(definition, sampler);
  }

  update(camera: THREE.Camera) {
    const distance = camera.position.length();
    this.root.visible = distance < 260;
  }

  dispose() {
    this.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
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
