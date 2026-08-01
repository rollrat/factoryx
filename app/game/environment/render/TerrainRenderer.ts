import * as THREE from "three";
import type { EnvironmentDefinition, EnvironmentQuality } from "../types.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";

export class TerrainRenderer {
  readonly root = new THREE.Group();
  readonly terrain: THREE.Mesh;
  readonly surveyPad: THREE.Group;
  readonly sampler: TerrainSampler;
  private readonly definition: EnvironmentDefinition;

  constructor(
    definition: EnvironmentDefinition,
    sampler: TerrainSampler,
    quality: EnvironmentQuality,
  ) {
    this.definition = definition;
    this.sampler = sampler;
    this.root.name = "a17-terrain";
    const width = definition.worldBounds.maxX - definition.worldBounds.minX + 1;
    const depth = definition.worldBounds.maxZ - definition.worldBounds.minZ + 1;
    const segments = quality === "high" ? 128 : 72;
    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = new Float32Array(positions.count * 3);
    const color = new THREE.Color();
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      positions.setY(index, sampler.heightAt(x, z));
      color.setHex(sampler.colorAt(x, z));
      const variation = 0.88 + (Math.sin(x * 0.43 + z * 0.19) * 0.5 + 0.5) * 0.15;
      colors[index * 3] = color.r * variation;
      colors[index * 3 + 1] = color.g * variation;
      colors[index * 3 + 2] = color.b * variation;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    this.terrain = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.05 }),
    );
    this.terrain.receiveShadow = true;
    this.root.add(this.terrain);

    this.surveyPad = this.createSurveyPad();
    this.root.add(this.surveyPad);
  }

  dispose() {
    this.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }

  private createSurveyPad() {
    const group = new THREE.Group();
    group.name = "survey-pad";
    const slabMaterial = new THREE.MeshStandardMaterial({ color: 0x1c3035, roughness: 0.84, metalness: 0.24 });
    const insetMaterial = new THREE.MeshStandardMaterial({ color: 0x263b3f, roughness: 0.9, metalness: 0.08 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x84604a, roughness: 0.55, metalness: 0.42 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(27, 0.42, 27), slabMaterial);
    slab.position.y = -0.28;
    slab.receiveShadow = true;
    group.add(slab);
    const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(3.18, 0.045, 3.18), insetMaterial, 64);
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let z = -3.5; z <= 3.5; z += 1) {
      for (let x = -3.5; x <= 3.5; x += 1) {
        matrix.makeTranslation(x * 3.28, -0.035, z * 3.28);
        panels.setMatrixAt(index++, matrix);
      }
    }
    panels.receiveShadow = true;
    group.add(panels);
    const railLong = new THREE.BoxGeometry(27.7, 0.3, 0.26);
    const railShort = new THREE.BoxGeometry(0.26, 0.3, 27.7);
    [
      [new THREE.Mesh(railLong, trimMaterial), 0, -13.65],
      [new THREE.Mesh(railLong, trimMaterial), 0, 13.65],
      [new THREE.Mesh(railShort, trimMaterial), -13.65, 0],
      [new THREE.Mesh(railShort, trimMaterial), 13.65, 0],
    ].forEach(([mesh, x, z]) => {
      const rail = mesh as THREE.Mesh;
      rail.position.set(x as number, 0.07, z as number);
      rail.castShadow = true;
      group.add(rail);
    });
    return group;
  }
}
