import * as THREE from "three";
import { EXPLORATION_SITES } from "../exploration.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";

export class ExplorationRenderer {
  readonly root = new THREE.Group();
  private elapsed = 0;

  constructor(sampler: TerrainSampler) {
    this.root.name = "a17-survey-sites";
    EXPLORATION_SITES.forEach((site) => {
      const group = new THREE.Group();
      group.name = `survey-site:${site.id}`;
      group.userData.siteId = site.id;
      group.userData.stratumId = site.stratumId;
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.22, 1.8, 6),
        new THREE.MeshStandardMaterial({ color: 0x26383b, roughness: 0.7, metalness: 0.45 }),
      );
      stem.position.y = 0.9;
      const signal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.24, 0),
        new THREE.MeshStandardMaterial({ color: 0xe5a04b, emissive: 0xa55222, emissiveIntensity: 2 }),
      );
      signal.name = "survey-signal";
      signal.position.y = 1.95;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.65, 0.78, 24),
        new THREE.MeshBasicMaterial({ color: 0xe5a04b, transparent: true, opacity: 0.44, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.name = "survey-ring";
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      group.add(stem, signal, ring);
      const height = site.stratumId === "surface"
        ? sampler.constructionHeightAt(site.position.x, site.position.z)
        : sampler.caveHeightAt(site.position.x, site.position.z, site.stratumId);
      group.position.set(site.position.x, height, site.position.z);
      this.root.add(group);
    });
  }

  update(delta: number, stratumId: string) {
    this.elapsed += delta;
    this.root.children.forEach((group) => {
      group.visible = group.userData.stratumId === stratumId;
      const signal = group.getObjectByName("survey-signal");
      if (signal) signal.position.y = 1.95 + Math.sin(this.elapsed * 2.2 + group.id) * 0.08;
    });
  }

  setDiscovered(id: string) {
    const group = this.root.getObjectByName(`survey-site:${id}`);
    if (!group) return;
    const signal = group.getObjectByName("survey-signal") as THREE.Mesh | undefined;
    const ring = group.getObjectByName("survey-ring") as THREE.Mesh | undefined;
    if (signal?.material instanceof THREE.MeshStandardMaterial) {
      signal.material.color.setHex(0x69d9cb);
      signal.material.emissive.setHex(0x246e67);
    }
    if (ring?.material instanceof THREE.MeshBasicMaterial) ring.material.opacity = 0.12;
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
}
