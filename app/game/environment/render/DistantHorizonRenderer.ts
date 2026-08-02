import * as THREE from "three";
import type { EnvironmentQuality } from "../types.ts";
import { weatherVisibilityProfile, type WeatherKind } from "./WeatherSystem.ts";

const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const createRidgeRibbon = (
  seed: number,
  segments: number,
  innerRadius: number,
  outerRadius: number,
  minHeight: number,
  maxHeight: number,
) => {
  const random = seeded(seed);
  const phases = [random(), random(), random(), random()].map((value) => value * Math.PI * 2);
  const positions = new Float32Array((segments + 1) * 9);
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const broad = Math.sin(angle * 3 + phases[0]) * 0.32 + Math.sin(angle * 7 + phases[1]) * 0.2;
    const crags = Math.abs(Math.sin(angle * 11 + phases[2])) * 0.34 + Math.sin(angle * 17 + phases[3]) * 0.1;
    const height = THREE.MathUtils.lerp(minHeight, maxHeight, THREE.MathUtils.clamp(0.38 + broad + crags, 0, 1));
    const radiusVariation = Math.sin(angle * 5 + phases[2]) * 7 + Math.sin(angle * 13 + phases[0]) * 2.5;
    const inner = innerRadius + radiusVariation;
    const crest = THREE.MathUtils.lerp(innerRadius, outerRadius, 0.58) + radiusVariation;
    const outer = outerRadius + radiusVariation * 0.45;
    const offset = index * 9;
    positions.set([
      Math.cos(angle) * inner, 0, Math.sin(angle) * inner,
      Math.cos(angle) * crest, height, Math.sin(angle) * crest,
      Math.cos(angle) * outer, -7, Math.sin(angle) * outer,
    ], offset);
    if (index < segments) {
      const next = (index + 1) * 3;
      const current = index * 3;
      indices.push(current, next, current + 1, current + 1, next, next + 1);
      indices.push(current + 1, next + 1, current + 2, current + 2, next + 1, next + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.kind = "authored-ridge-ribbon";
  return geometry;
};

/** World-fixed low-poly ridge ribbons that continue the playable terrain silhouette. */
export class DistantHorizonRenderer {
  readonly root = new THREE.Group();
  readonly nearRidges: THREE.Mesh;
  readonly farRidges: THREE.Mesh;
  private readonly nearBaseOpacity = 0.72;
  private readonly farBaseOpacity = 0.43;
  /** Exposed without moving the world-fixed ridge toward the camera. */
  visibilityMeters = 240;

  constructor(seed: number, quality: EnvironmentQuality) {
    this.root.name = "a17-distant-horizon";
    const nearMaterial = new THREE.MeshBasicMaterial({ color: 0x263b3d, fog: true, transparent: true, opacity: this.nearBaseOpacity, side: THREE.DoubleSide });
    const farMaterial = new THREE.MeshBasicMaterial({ color: 0x536665, fog: true, transparent: true, opacity: this.farBaseOpacity, depthWrite: false, side: THREE.DoubleSide });
    this.nearRidges = new THREE.Mesh(
      createRidgeRibbon(seed ^ 0x5f3759df, quality === "high" ? 128 : 72, 150, 190, 19, 53),
      nearMaterial,
    );
    this.farRidges = new THREE.Mesh(
      createRidgeRibbon(seed ^ 0x27d4eb2d, quality === "high" ? 160 : 88, 190, 244, 29, 67),
      farMaterial,
    );
    this.nearRidges.name = "near-authored-ridge";
    this.farRidges.name = "far-authored-ridge";
    this.nearRidges.frustumCulled = false;
    this.farRidges.frustumCulled = false;
    this.root.position.y = -11;
    this.root.add(this.farRidges, this.nearRidges);
  }

  update(camera: THREE.Camera) {
    void camera;
    // Intentionally world-fixed: the silhouette now has stable parallax and direction.
    // TODO(P8-D): project cloud coverage into a camera-independent terrain shadow map.
  }

  setWeather(kind: WeatherKind, strength: number) {
    const amount = THREE.MathUtils.clamp(strength, 0, 1);
    const profile = weatherVisibilityProfile(kind, amount);
    const obscuring = kind === "mist" ? amount * 0.62
      : kind === "electrical_storm" ? amount * 0.36
        : kind === "mineral_wind" ? amount * 0.24 : 0;
    this.visibilityMeters = profile.visibilityMeters;
    (this.nearRidges.material as THREE.MeshBasicMaterial).opacity = this.nearBaseOpacity * (1 - obscuring);
    (this.farRidges.material as THREE.MeshBasicMaterial).opacity = this.farBaseOpacity * (1 - obscuring * 1.2);
  }

  dispose() {
    this.nearRidges.geometry.dispose();
    this.farRidges.geometry.dispose();
    (this.nearRidges.material as THREE.Material).dispose();
    (this.farRidges.material as THREE.Material).dispose();
  }
}
