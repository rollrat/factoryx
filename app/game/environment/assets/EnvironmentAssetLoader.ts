import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type EnvironmentAssetLoadState = "loading" | "ready" | "fallback";

type ManifestAsset = Readonly<{
  id: string;
  kind: "environment_prop" | "environment_landmark" | "environment_cliff";
  url: string;
  previewUrl: string;
  lodNodes: readonly [string, string, string];
  collisionNode: string;
  collisionNodes?: readonly string[];
  socketNode?: string;
  lodTriangles: readonly [number, number, number];
}>;

type EnvironmentAssetManifest = Readonly<{
  schemaVersion: 1;
  assets: readonly ManifestAsset[];
}>;

export type LoadedEnvironmentAsset = Readonly<{
  id: string;
  lods: readonly [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry];
  collision: THREE.BufferGeometry;
  triangles: readonly [number, number, number];
  sockets: readonly EnvironmentAssetSocket[];
}>;

export type EnvironmentAssetSocket = Readonly<{
  name: string;
  semantic: string;
  matrix: THREE.Matrix4;
}>;

let manifestPromise: Promise<EnvironmentAssetManifest> | null = null;
const assetPromises = new Map<string, Promise<LoadedEnvironmentAsset>>();

const loadManifest = () => {
  manifestPromise ??= fetch("/assets/environment/manifests/environment-assets.json")
    .then(async (response) => {
      if (!response.ok) throw new Error(`environment manifest ${response.status}`);
      const value = await response.json() as EnvironmentAssetManifest;
      if (value.schemaVersion !== 1 || !Array.isArray(value.assets)) throw new Error("invalid environment asset manifest");
      return value;
    });
  return manifestPromise;
};

const bakedGeometry = (object: THREE.Object3D, names: string | readonly string[]) => {
  const requestedNames = typeof names === "string" ? [names] : names;
  object.updateMatrixWorld(true);
  const meshes = new Set<THREE.Mesh>();
  requestedNames.forEach((name) => {
    const container = object.getObjectByName(name);
    container?.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.add(child);
    });
    if (!container) throw new Error(`missing environment asset mesh group ${name}`);
  });
  if (!meshes.size) throw new Error(`empty environment asset mesh group ${requestedNames.join(", ")}`);
  const parts = [...meshes].map((node) => {
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);
    return geometry;
  });
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!geometry) {
    parts.forEach((part) => part.dispose());
    throw new Error(`incompatible environment asset mesh group ${requestedNames.join(", ")}`);
  }
  if (parts.length > 1) parts.forEach((part) => part.dispose());
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const readSockets = (object: THREE.Object3D, socketNode = "SOCKETS"): readonly EnvironmentAssetSocket[] => {
  const container = object.getObjectByName(socketNode);
  if (!container) return [];
  object.updateMatrixWorld(true);
  const sockets: EnvironmentAssetSocket[] = [];
  container.traverse((child) => {
    if (child === container || child.userData.fx_asset_role !== "socket") return;
    sockets.push({
      name: child.name,
      semantic: typeof child.userData.fx_socket_semantic === "string" ? child.userData.fx_socket_semantic : child.name,
      matrix: child.matrixWorld.clone(),
    });
  });
  return sockets;
};

export const loadEnvironmentAsset = (assetId: string): Promise<LoadedEnvironmentAsset> => {
  const cached = assetPromises.get(assetId);
  if (cached) return cached;
  const promise = loadManifest().then(async (manifest) => {
    const asset = manifest.assets.find(({ id }) => id === assetId);
    if (!asset) throw new Error(`unknown environment asset ${assetId}`);
    const gltf = await new GLTFLoader().loadAsync(asset.url);
    const lods = asset.lodNodes.map((name) => bakedGeometry(gltf.scene, name)) as [
      THREE.BufferGeometry,
      THREE.BufferGeometry,
      THREE.BufferGeometry,
    ];
    const collision = bakedGeometry(gltf.scene, asset.collisionNodes ?? asset.collisionNode);
    const sockets = readSockets(gltf.scene, asset.socketNode);
    gltf.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose());
    });
    return { id: assetId, lods, collision, triangles: asset.lodTriangles, sockets };
  });
  assetPromises.set(assetId, promise);
  promise.catch(() => assetPromises.delete(assetId));
  return promise;
};

export const resetEnvironmentAssetCacheForTests = () => {
  manifestPromise = null;
  assetPromises.clear();
};
