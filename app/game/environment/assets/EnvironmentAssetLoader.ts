import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type EnvironmentAssetLoadState = "loading" | "ready" | "fallback";

type ManifestAsset = Readonly<{
  id: string;
  kind: "environment_prop" | "environment_landmark";
  url: string;
  previewUrl: string;
  lodNodes: readonly [string, string, string];
  collisionNode: string;
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

const bakedGeometry = (object: THREE.Object3D, name: string) => {
  const node = object.getObjectByName(name);
  if (!(node instanceof THREE.Mesh)) throw new Error(`missing environment asset mesh ${name}`);
  object.updateMatrixWorld(true);
  const geometry = node.geometry.clone();
  geometry.applyMatrix4(node.matrixWorld);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

export const loadEnvironmentAsset = (assetId: string): Promise<LoadedEnvironmentAsset> => {
  const cached = assetPromises.get(assetId);
  if (cached) return cached;
  const promise = loadManifest().then(async (manifest) => {
    const asset = manifest.assets.find(({ id }) => id === assetId);
    if (!asset) throw new Error(`unknown environment asset ${assetId}`);
    const gltf = await new GLTFLoader().loadAsync(asset.url);
    const lods = asset.lodNodes.map((name) => bakedGeometry(gltf.scene, `${assetId}_lod${name.at(-1)}`)) as [
      THREE.BufferGeometry,
      THREE.BufferGeometry,
      THREE.BufferGeometry,
    ];
    const collision = bakedGeometry(gltf.scene, `${assetId}_collision`);
    gltf.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose());
    });
    return { id: assetId, lods, collision, triangles: asset.lodTriangles };
  });
  assetPromises.set(assetId, promise);
  promise.catch(() => assetPromises.delete(assetId));
  return promise;
};

export const resetEnvironmentAssetCacheForTests = () => {
  manifestPromise = null;
  assetPromises.clear();
};
