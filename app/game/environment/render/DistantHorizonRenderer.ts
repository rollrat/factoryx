import * as THREE from "three";
import type { EnvironmentQuality } from "../types.ts";
import type { WeatherKind } from "./WeatherSystem.ts";

const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

/** Low-density atmospheric silhouettes that sell a world beyond the playable sector. */
export class DistantHorizonRenderer {
  readonly root = new THREE.Group();
  readonly nearRidges: THREE.InstancedMesh;
  readonly farRidges: THREE.InstancedMesh;

  constructor(seed: number, quality: EnvironmentQuality) {
    this.root.name = "a17-distant-horizon";
    const random = seeded(seed ^ 0x5f3759df);
    const nearCount = quality === "high" ? 18 : 10;
    const farCount = quality === "high" ? 24 : 12;
    const geometry = new THREE.ConeGeometry(1, 1, quality === "high" ? 7 : 5, 1);
    geometry.translate(0, 0.5, 0);
    const nearMaterial = new THREE.MeshBasicMaterial({ color: 0x263b3d, fog: true, transparent: true, opacity: 0.72 });
    const farMaterial = new THREE.MeshBasicMaterial({ color: 0x536665, fog: true, transparent: true, opacity: 0.43, depthWrite: false });
    this.nearRidges = new THREE.InstancedMesh(geometry, nearMaterial, nearCount);
    this.farRidges = new THREE.InstancedMesh(geometry, farMaterial, farCount);
    this.populateRing(this.nearRidges, 154, 171, random, 30, 62);
    this.populateRing(this.farRidges, 171, 188, random, 21, 48);
    this.nearRidges.frustumCulled = false;
    this.farRidges.frustumCulled = false;
    this.root.position.y = -18;
    this.root.add(this.farRidges, this.nearRidges);
  }

  update(camera: THREE.Camera) {
    // Following only X/Z keeps the horizon distant without making it rise with an overview camera.
    this.root.position.x = camera.position.x;
    this.root.position.z = camera.position.z;
  }

  setWeather(kind: WeatherKind, strength: number) {
    const amount = THREE.MathUtils.clamp(strength, 0, 1);
    const obscuring = kind === "mist" ? amount * 0.62
      : kind === "electrical_storm" ? amount * 0.36
        : kind === "mineral_wind" ? amount * 0.24 : 0;
    (this.nearRidges.material as THREE.MeshBasicMaterial).opacity = 0.72 * (1 - obscuring);
    (this.farRidges.material as THREE.MeshBasicMaterial).opacity = 0.43 * (1 - obscuring * 1.2);
  }

  dispose() {
    this.nearRidges.geometry.dispose();
    (this.nearRidges.material as THREE.Material).dispose();
    // Both rings share geometry.
    (this.farRidges.material as THREE.Material).dispose();
  }

  private populateRing(
    mesh: THREE.InstancedMesh,
    minRadius: number,
    maxRadius: number,
    random: () => number,
    minHeight: number,
    maxHeight: number,
  ) {
    const dummy = new THREE.Object3D();
    for (let index = 0; index < mesh.count; index += 1) {
      const angle = index / mesh.count * Math.PI * 2 + (random() - 0.5) * 0.16;
      const radius = THREE.MathUtils.lerp(minRadius, maxRadius, random());
      const height = THREE.MathUtils.lerp(minHeight, maxHeight, random());
      dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      dummy.rotation.y = -angle + (random() - 0.5) * 0.3;
      dummy.scale.set(THREE.MathUtils.lerp(12, 27, random()), height, THREE.MathUtils.lerp(5, 11, random()));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}
