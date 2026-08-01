import * as THREE from "three";
import type { EnvironmentQuality } from "../types.ts";
import type { TerrainSampler } from "../terrain/TerrainSampler.ts";
import type { WeatherKind } from "./WeatherSystem.ts";

export type IndustrialFootprint = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;

const hash2 = (x: number, z: number, salt: number) => {
  const value = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};

const createCrackGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.62, -0.018);
  shape.lineTo(-0.18, 0.035);
  shape.lineTo(0.08, -0.025);
  shape.lineTo(0.66, 0.018);
  shape.lineTo(0.65, -0.018);
  shape.lineTo(0.09, -0.06);
  shape.lineTo(-0.2, 0.002);
  shape.lineTo(-0.62, -0.048);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
};

/** Camera-local micro detail. It is rebuilt on a coarse grid, never across the full map. */
export class TerrainDetailRenderer {
  readonly root = new THREE.Group();
  readonly cracks: THREE.InstancedMesh;
  readonly gravel: THREE.InstancedMesh;
  readonly wetPatches: THREE.InstancedMesh;
  readonly industrialDust: THREE.InstancedMesh;
  private readonly sampler: TerrainSampler;
  private readonly radius = 8;
  private readonly capacities: Readonly<{ cracks: number; gravel: number; wet: number; dust: number }>;
  private weatherKind: WeatherKind = "clear";
  private weatherStrength = 0;
  private industrialFootprints: readonly IndustrialFootprint[] = [];
  private lastCellX = Number.NaN;
  private lastCellZ = Number.NaN;
  private dirty = true;

  constructor(sampler: TerrainSampler, quality: EnvironmentQuality) {
    this.sampler = sampler;
    this.root.name = "terrain-near-detail";
    this.capacities = quality === "high"
      ? { cracks: 72, gravel: 150, wet: 54, dust: 84 }
      : { cracks: 28, gravel: 58, wet: 20, dust: 32 };
    this.cracks = new THREE.InstancedMesh(
      createCrackGeometry(),
      new THREE.MeshBasicMaterial({ color: 0x101a1b, transparent: true, opacity: 0.52, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      this.capacities.cracks,
    );
    this.gravel = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.095, 0),
      new THREE.MeshStandardMaterial({ color: 0x38484a, roughness: 0.98, metalness: 0.02 }),
      this.capacities.gravel,
    );
    this.wetPatches = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.58, 10).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x132b2d, roughness: 0.24, metalness: 0.08, transparent: true, opacity: 0.48, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
      this.capacities.wet,
    );
    this.industrialDust = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.48, 8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x75513a, transparent: true, opacity: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
      this.capacities.dust,
    );
    [this.cracks, this.gravel, this.wetPatches, this.industrialDust].forEach((mesh) => {
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.receiveShadow = mesh === this.gravel;
      this.root.add(mesh);
    });
  }

  setWeather(kind: WeatherKind, strength: number) {
    const nextStrength = THREE.MathUtils.clamp(strength, 0, 1);
    if (kind !== this.weatherKind || Math.abs(nextStrength - this.weatherStrength) > 0.08) this.dirty = true;
    this.weatherKind = kind;
    this.weatherStrength = nextStrength;
  }

  setIndustrialFootprints(footprints: readonly IndustrialFootprint[]) {
    this.industrialFootprints = footprints.map((footprint) => ({ ...footprint }));
    this.dirty = true;
  }

  update(camera: THREE.Camera) {
    const cellX = Math.floor(camera.position.x / 1.25);
    const cellZ = Math.floor(camera.position.z / 1.25);
    if (!this.dirty && cellX === this.lastCellX && cellZ === this.lastCellZ) return;
    this.lastCellX = cellX;
    this.lastCellZ = cellZ;
    this.dirty = false;
    this.rebuild(camera.position.x, camera.position.z);
  }

  visibleInstanceCount() {
    if (!this.root.visible) return 0;
    return this.cracks.count + this.gravel.count + this.wetPatches.count + this.industrialDust.count;
  }

  dispose() {
    [this.cracks, this.gravel, this.wetPatches, this.industrialDust].forEach((mesh) => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
  }

  private rebuild(cameraX: number, cameraZ: number) {
    const step = this.capacities.gravel > 100 ? 1.2 : 1.85;
    const minX = Math.floor((cameraX - this.radius) / step);
    const maxX = Math.ceil((cameraX + this.radius) / step);
    const minZ = Math.floor((cameraZ - this.radius) / step);
    const maxZ = Math.ceil((cameraZ + this.radius) / step);
    let crackCount = 0;
    let gravelCount = 0;
    let wetCount = 0;
    let dustCount = 0;

    for (let gridZ = minZ; gridZ <= maxZ; gridZ += 1) {
      for (let gridX = minX; gridX <= maxX; gridX += 1) {
        const x = (gridX + hash2(gridX, gridZ, 1)) * step;
        const z = (gridZ + hash2(gridX, gridZ, 2)) * step;
        if (Math.hypot(x - cameraX, z - cameraZ) > this.radius) continue;
        const sample = this.sampler.sample(x, z);
        const rotation = hash2(gridX, gridZ, 3) * Math.PI * 2;
        const scale = 0.62 + hash2(gridX, gridZ, 4) * 0.86;

        if (sample.surface !== "submerged" && gravelCount < this.capacities.gravel && hash2(gridX, gridZ, 5) > 0.28) {
          this.writeMatrix(this.gravel, gravelCount++, x, sample.height + 0.045, z, sample.normal, rotation, scale);
        }
        if (["stable", "soft", "steep"].includes(sample.surface)
          && crackCount < this.capacities.cracks && hash2(gridX, gridZ, 6) > 0.68) {
          this.writeMatrix(this.cracks, crackCount++, x, sample.height + 0.026, z, sample.normal, rotation, scale);
        }
        const weatherWetness = this.weatherKind === "mist" ? this.weatherStrength * 0.48
          : this.weatherKind === "electrical_storm" ? this.weatherStrength * 0.7 : 0;
        const surfaceWetness = sample.surface === "submerged" ? 1 : sample.surface === "soft" ? 0.4 : sample.surface === "hazard" ? 0.24 : 0;
        if (wetCount < this.capacities.wet && hash2(gridX, gridZ, 7) < Math.max(weatherWetness, surfaceWetness)) {
          this.writeMatrix(this.wetPatches, wetCount++, x, sample.height + 0.021, z, sample.normal, rotation, scale * 1.2);
        }
      }
    }

    const cameraRadius = this.radius + 3;
    for (const area of this.industrialFootprints) {
      const closestX = THREE.MathUtils.clamp(cameraX, area.minX, area.maxX);
      const closestZ = THREE.MathUtils.clamp(cameraZ, area.minZ, area.maxZ);
      if (Math.hypot(closestX - cameraX, closestZ - cameraZ) > cameraRadius) continue;
      const perimeter = [
        { horizontal: true, fixed: area.minZ - 0.34, from: area.minX, to: area.maxX },
        { horizontal: true, fixed: area.maxZ + 0.34, from: area.minX, to: area.maxX },
        { horizontal: false, fixed: area.minX - 0.34, from: area.minZ, to: area.maxZ },
        { horizontal: false, fixed: area.maxX + 0.34, from: area.minZ, to: area.maxZ },
      ];
      for (const edge of perimeter) {
        for (let cursor = edge.from + 0.42; cursor < edge.to && dustCount < this.capacities.dust; cursor += 1.15) {
          const x = edge.horizontal ? cursor : edge.fixed;
          const z = edge.horizontal ? edge.fixed : cursor;
          if (Math.hypot(x - cameraX, z - cameraZ) > this.radius) continue;
          const sample = this.sampler.sample(x, z);
          const random = hash2(Math.floor(x * 10), Math.floor(z * 10), 11);
          this.writeMatrix(this.industrialDust, dustCount++, x, sample.height + 0.023, z, sample.normal, random * Math.PI * 2, 0.75 + random * 0.65);
        }
      }
    }

    this.cracks.count = crackCount;
    this.gravel.count = gravelCount;
    this.wetPatches.count = wetCount;
    this.industrialDust.count = dustCount;
    [this.cracks, this.gravel, this.wetPatches, this.industrialDust].forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
    const wetMaterial = this.wetPatches.material as THREE.MeshStandardMaterial;
    wetMaterial.opacity = 0.32 + Math.max(
      this.weatherKind === "mist" ? this.weatherStrength * 0.22 : 0,
      this.weatherKind === "electrical_storm" ? this.weatherStrength * 0.4 : 0,
    );
  }

  private writeMatrix(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    normal: Readonly<{ x: number; y: number; z: number }>,
    yaw: number,
    scale: number,
  ) {
    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    const surfaceNormal = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    const align = new THREE.Quaternion().setFromUnitVectors(up, surfaceNormal);
    const spin = new THREE.Quaternion().setFromAxisAngle(up, yaw);
    dummy.position.set(x, y, z);
    dummy.quaternion.multiplyQuaternions(align, spin);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
}
