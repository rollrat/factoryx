import * as THREE from "three";
import { loadEnvironmentAsset, type EnvironmentAssetLoadState } from "../assets/EnvironmentAssetLoader.ts";
import type { EnvironmentQuality } from "../types.ts";

export type CliffKitPlacement = Readonly<{
  id: string;
  assetId: string;
  transform: Readonly<{
    position: Readonly<{ x: number; y: number; z: number }>;
    rotation: Readonly<{ x: number; y: number; z: number }>;
    scale: Readonly<{ x: number; y: number; z: number }>;
  }>;
}>;

type LoadedLods = readonly [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry];

const fallbackGeometryFor = (assetId: string) => {
  if (assetId.includes("arch")) {
    const shape = new THREE.Shape();
    shape.moveTo(-8, 0); shape.lineTo(8, 0); shape.lineTo(8, 11.8); shape.lineTo(-8, 11.8); shape.closePath();
    const opening = new THREE.Path();
    opening.moveTo(-4, 0); opening.lineTo(-4, 6.4); opening.lineTo(4, 6.4); opening.lineTo(4, 0); opening.closePath();
    shape.holes.push(opening);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 5.2, bevelEnabled: false });
    geometry.translate(0, 0, -2.6);
    return geometry;
  }
  if (assetId.includes("corner")) return new THREE.BoxGeometry(12, 12, 12);
  return new THREE.BoxGeometry(16, 12, 4.2);
};

export const cliffLodForDistance = (distance: number, quality: EnvironmentQuality) => {
  if (quality === "low") return distance < 70 ? 1 : 2;
  if (distance < 55) return 0;
  if (distance < 120) return 1;
  return 2;
};

/** Runtime owner for authored cliff-kit placements and their distance LODs. */
export class CliffKitRenderer {
  readonly root = new THREE.Group();
  readonly placements: readonly CliffKitPlacement[];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly loadedLods = new Map<string, LoadedLods>();
  private readonly fallbackGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0x57483f,
    roughness: 0.98,
    metalness: 0.02,
    flatShading: true,
  });
  private quality: EnvironmentQuality;
  private loadState: EnvironmentAssetLoadState = "loading";
  private disposed = false;

  constructor(placements: readonly CliffKitPlacement[], quality: EnvironmentQuality) {
    this.placements = placements;
    this.quality = quality;
    this.root.name = "ironwind-cliff-kit";
    placements.forEach((placement) => {
      let geometry = this.fallbackGeometries.get(placement.assetId);
      if (!geometry) {
        geometry = fallbackGeometryFor(placement.assetId);
        this.fallbackGeometries.set(placement.assetId, geometry);
      }
      const mesh = new THREE.Mesh(geometry, this.material);
      const { position, rotation, scale } = placement.transform;
      mesh.name = `cliff-kit:${placement.id}`;
      mesh.position.set(position.x, position.y, position.z);
      mesh.rotation.set(rotation.x, rotation.y, rotation.z);
      mesh.scale.set(scale.x, scale.y, scale.z);
      mesh.castShadow = quality === "high";
      mesh.receiveShadow = true;
      mesh.userData.assetId = placement.assetId;
      mesh.userData.placementId = placement.id;
      this.meshes.push(mesh);
      this.root.add(mesh);
    });
    if (typeof window === "undefined") this.loadState = "fallback";
    else this.loadAssets();
  }

  update(camera: THREE.Camera) {
    for (const mesh of this.meshes) {
      const assetId = mesh.userData.assetId as string;
      const lods = this.loadedLods.get(assetId);
      if (!lods) continue;
      const lod = cliffLodForDistance(camera.position.distanceTo(mesh.position), this.quality);
      if (mesh.geometry !== lods[lod]) mesh.geometry = lods[lod];
    }
  }

  setPreviewQuality(quality: EnvironmentQuality) {
    this.quality = quality;
    this.meshes.forEach((mesh) => { mesh.castShadow = quality === "high"; });
  }

  assetStatus() { return this.loadState; }

  dispose() {
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>(this.fallbackGeometries.values());
    this.loadedLods.forEach((lods) => lods.forEach((geometry) => geometries.add(geometry)));
    geometries.forEach((geometry) => geometry.dispose());
    this.material.dispose();
    this.root.clear();
  }

  private loadAssets() {
    const assetIds = [...new Set(this.placements.map(({ assetId }) => assetId))];
    if (assetIds.length === 0) {
      this.loadState = "ready";
      return;
    }
    let pending = assetIds.length;
    let failed = false;
    const settle = () => {
      pending -= 1;
      if (pending === 0 && !this.disposed) this.loadState = failed ? "fallback" : "ready";
    };
    assetIds.forEach((assetId) => {
      void loadEnvironmentAsset(assetId).then((asset) => {
        if (this.disposed) return;
        const lods = asset.lods.map((geometry) => geometry.clone()) as [
          THREE.BufferGeometry,
          THREE.BufferGeometry,
          THREE.BufferGeometry,
        ];
        this.loadedLods.set(assetId, lods);
        this.meshes.filter((mesh) => mesh.userData.assetId === assetId).forEach((mesh) => { mesh.geometry = lods[0]; });
      }).catch((error: unknown) => {
        failed = true;
        console.warn(`FactoryX cliff asset fallback: ${assetId}`, error);
      }).finally(settle);
    });
  }
}
