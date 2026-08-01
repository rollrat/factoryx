import * as THREE from "three";

export type MachineMaterials = {
  dark: THREE.Material;
  steel: THREE.Material;
  pale: THREE.Material;
  cyan: THREE.Material;
  amber: THREE.Material;
  orange: THREE.Material;
  rubber: THREE.Material;
  belt: THREE.Material;
  copper: THREE.Material;
  ore: THREE.Material;
};

export type ProcessingVisualState = {
  time: number;
  delta: number;
  progress: number;
  activity: number;
  working: boolean;
  inputCount: number;
  outputQueued: boolean;
  inputConnected: boolean;
  outputConnected: boolean;
};

export type StorageVisualState = {
  time: number;
  delta: number;
  stored: number;
  capacity: number;
  intakePulse: number;
  inputConnected: boolean;
};

export type Point = [number, number, number];

export const addBox = (
  group: THREE.Group,
  size: Point,
  position: Point,
  material: THREE.Material,
  castShadow = true,
) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
};

export const addCylinder = (
  group: THREE.Group,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: Point,
  material: THREE.Material,
  segments = 12,
) => {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
};

export const addBeam = (
  group: THREE.Group,
  start: Point,
  end: Point,
  thickness: number,
  material: THREE.Material,
) => {
  const from = new THREE.Vector3(...start);
  const to = new THREE.Vector3(...end);
  const direction = to.clone().sub(from);
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(thickness, direction.length(), thickness),
    material,
  );
  beam.position.copy(from).add(to).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  beam.castShadow = true;
  beam.receiveShadow = true;
  group.add(beam);
  return beam;
};

export const createIndicatorMaterial = (
  color: number,
  emissive: number,
  intensity = 0.2,
) => new THREE.MeshStandardMaterial({
  color,
  emissive,
  emissiveIntensity: intensity,
  metalness: 0.24,
  roughness: 0.3,
});

export const setIndicator = (
  part: THREE.Object3D,
  color: number,
  emissive: number,
  intensity: number,
) => {
  if (!(part instanceof THREE.Mesh)) return;
  const material = part.material;
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  material.color.setHex(color);
  material.emissive.setHex(emissive);
  material.emissiveIntensity = intensity;
};

export const triangleCount = (group: THREE.Group) => {
  let meshes = 0;
  let triangles = 0;
  const materials = new Set<THREE.Material>();
  group.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    meshes += 1;
    const geometry = part.geometry;
    const instances = part instanceof THREE.InstancedMesh ? part.count : 1;
    triangles += (geometry.index
      ? geometry.index.count / 3
      : geometry.attributes.position.count / 3) * instances;
    const meshMaterials = Array.isArray(part.material) ? part.material : [part.material];
    meshMaterials.forEach((material) => materials.add(material));
  });
  return { meshes, triangles: Math.round(triangles), materials: materials.size };
};
