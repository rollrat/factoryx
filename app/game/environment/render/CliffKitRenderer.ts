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
  metadata?: Readonly<{
    seams: Readonly<{
      start: Readonly<{ x: number; y: number; z: number }>;
      end: Readonly<{ x: number; y: number; z: number }>;
    }>;
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

export const cliffLodForDistance = (distance: number, quality: EnvironmentQuality, currentLod?: number) => {
  const near = quality === "high" ? 56 : 0;
  const far = quality === "high" ? 128 : 70;
  const nearHysteresis = 7;
  const farHysteresis = 12;
  if (quality === "high" && currentLod === 0 && distance < near + nearHysteresis) return 0;
  if (quality === "high" && currentLod === 1 && distance > near - nearHysteresis && distance < far + farHysteresis) return 1;
  if (currentLod === 2 && distance > far - farHysteresis) return 2;
  if (quality === "high" && distance < near) return 0;
  if (distance < far) return 1;
  return 2;
};

const stringHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
};

/** Runtime owner for authored cliff-kit placements and their distance LODs. */
export class CliffKitRenderer {
  readonly root = new THREE.Group();
  readonly debugRoot = new THREE.Group();
  readonly placements: readonly CliffKitPlacement[];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly loadedLods = new Map<string, LoadedLods>();
  private readonly fallbackGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = [0x57483f, 0x5d4b40, 0x51443d].map((color) => new THREE.MeshStandardMaterial({
    color, roughness: 0.98, metalness: 0.02, flatShading: true,
  }));
  private readonly debugGeometry = new THREE.SphereGeometry(0.22, 8, 6);
  private readonly debugMaterial = new THREE.MeshBasicMaterial({ color: 0x58f3dc, depthTest: false });
  private quality: EnvironmentQuality;
  private loadState: EnvironmentAssetLoadState = "loading";
  private disposed = false;

  constructor(placements: readonly CliffKitPlacement[], quality: EnvironmentQuality) {
    this.placements = placements;
    this.quality = quality;
    this.root.name = "ironwind-cliff-kit";
    this.debugRoot.name = "ironwind-cliff-sockets";
    this.debugRoot.visible = false;
    this.debugRoot.renderOrder = 20;
    this.root.add(this.debugRoot);
    placements.forEach((placement) => {
      let geometry = this.fallbackGeometries.get(placement.assetId);
      if (!geometry) {
        geometry = fallbackGeometryFor(placement.assetId);
        this.fallbackGeometries.set(placement.assetId, geometry);
      }
      const variant = stringHash(placement.id) % this.materials.length;
      const mesh = new THREE.Mesh(geometry, this.materials[variant]);
      const { position, rotation, scale } = placement.transform;
      mesh.name = `cliff-kit:${placement.id}`;
      mesh.position.set(position.x, position.y, position.z);
      mesh.rotation.set(rotation.x, rotation.y, rotation.z);
      const depthVariation = placement.assetId === "ironwind_cliff_straight_16m" ? 0.96 + variant * 0.045 : 1;
      mesh.scale.set(scale.x, scale.y, scale.z * depthVariation);
      mesh.castShadow = quality === "high";
      mesh.receiveShadow = true;
      mesh.userData.assetId = placement.assetId;
      mesh.userData.placementId = placement.id;
      this.meshes.push(mesh);
      this.root.add(mesh);
      if (placement.metadata) {
        [placement.metadata.seams.start, placement.metadata.seams.end].forEach((point, socketIndex) => {
          const socket = new THREE.Mesh(this.debugGeometry, this.debugMaterial);
          socket.name = `${placement.id}:socket:${socketIndex}`;
          socket.position.set(point.x, point.y + 0.3, point.z);
          socket.renderOrder = 20;
          this.debugRoot.add(socket);
        });
      }
    });
    if (typeof window === "undefined") this.loadState = "fallback";
    else this.loadAssets();
  }

  update(camera: THREE.Camera) {
    for (const mesh of this.meshes) {
      const assetId = mesh.userData.assetId as string;
      const lods = this.loadedLods.get(assetId);
      if (!lods) continue;
      const lod = cliffLodForDistance(
        camera.position.distanceTo(mesh.position),
        this.quality,
        typeof mesh.userData.lodIndex === "number" ? mesh.userData.lodIndex : undefined,
      );
      if (mesh.geometry !== lods[lod]) {
        mesh.geometry = lods[lod];
        mesh.userData.lodIndex = lod;
      }
    }
  }

  setPreviewQuality(quality: EnvironmentQuality) {
    this.quality = quality;
    this.meshes.forEach((mesh) => { mesh.castShadow = quality === "high"; });
  }

  setDebugVisible(visible: boolean) { this.debugRoot.visible = visible; }

  assetStatus() { return this.loadState; }

  dispose() {
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>(this.fallbackGeometries.values());
    this.loadedLods.forEach((lods) => lods.forEach((geometry) => geometries.add(geometry)));
    geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.debugGeometry.dispose();
    this.debugMaterial.dispose();
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
        this.meshes.filter((mesh) => mesh.userData.assetId === assetId).forEach((mesh) => {
          const initialLod = this.quality === "high" ? 0 : 1;
          mesh.geometry = lods[initialLod];
          mesh.userData.lodIndex = initialLod;
        });
      }).catch((error: unknown) => {
        failed = true;
        console.warn(`FactoryX cliff asset fallback: ${assetId}`, error);
      }).finally(settle);
    });
  }
}
