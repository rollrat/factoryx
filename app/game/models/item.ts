import * as THREE from "three";
import { START_REGISTRY } from "../data/index.ts";
import type { ItemDefinition, ItemId } from "../domain/types.ts";

export type ItemModelDefinition = Omit<
  Pick<ItemDefinition, "id" | "category" | "medium" | "defaultColor" | "geometryType" | "modelKey">,
  "defaultColor" | "geometryType"
> & Readonly<{
  defaultColor: number | string;
  geometryType: ItemDefinition["geometryType"] | string;
}>;

export type ItemModelMaterials = Readonly<{
  dark: THREE.Material;
  steel: THREE.Material;
  pale: THREE.Material;
  orange: THREE.Material;
  rubber: THREE.Material;
}>;

const itemMaterialCache = new WeakMap<object, Map<string, Readonly<{
  base: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
}>>>();

const seededUnit = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
};

const add = (
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
) => {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(...position);
  part.rotation.set(...rotation);
  part.castShadow = true;
  group.add(part);
  return part;
};

const box = (
  group: THREE.Group,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  rotation: [number, number, number] = [0, 0, 0],
) => add(group, new THREE.BoxGeometry(...size), material, position, rotation);

const cylinder = (
  group: THREE.Group,
  radii: [number, number],
  height: number,
  segments: number,
  position: [number, number, number],
  material: THREE.Material,
  rotation: [number, number, number] = [0, 0, 0],
) => add(group, new THREE.CylinderGeometry(radii[0], radii[1], height, segments), material, position, rotation);

const tray = (group: THREE.Group, base: THREE.Material, rail: THREE.Material) => {
  box(group, [0.34, 0.025, 0.25], [0, 0.012, 0], base);
  for (const z of [-0.118, 0.118]) box(group, [0.34, 0.055, 0.018], [0, 0.04, z], rail);
};

const addGear = (group: THREE.Group, x: number, z: number, radius: number, material: THREE.Material) => {
  cylinder(group, [radius, radius], 0.055, 12, [x, 0.075, z], material);
  for (let tooth = 0; tooth < 8; tooth += 1) {
    const angle = (tooth / 8) * Math.PI * 2;
    box(
      group,
      [0.045, 0.06, 0.035],
      [x + Math.cos(angle) * radius, 0.075, z + Math.sin(angle) * radius],
      material,
      [0, -angle, 0],
    );
  }
};

const addFrame = (group: THREE.Group, material: THREE.Material, scale = 1) => {
  const length = 0.3 * scale;
  const width = 0.025 * scale;
  for (const y of [0.035, 0.225 * scale]) {
    for (const z of [-0.12 * scale, 0.12 * scale]) box(group, [length, width, width], [0, y, z], material);
    for (const x of [-0.15 * scale, 0.15 * scale]) box(group, [width, width, 0.24 * scale], [x, y, 0], material);
  }
  for (const x of [-0.15 * scale, 0.15 * scale]) {
    for (const z of [-0.12 * scale, 0.12 * scale]) box(group, [width, 0.21 * scale, width], [x, 0.13 * scale, z], material);
  }
};

export const createItemModelFromDefinition = (
  definition: ItemModelDefinition,
  materials: ItemModelMaterials,
) => {
  const group = new THREE.Group();
  const seed = seededUnit(definition.modelKey);
  let cachedByItem = itemMaterialCache.get(materials);
  if (!cachedByItem) {
    cachedByItem = new Map();
    itemMaterialCache.set(materials, cachedByItem);
  }
  let itemMaterials = cachedByItem.get(definition.id);
  if (!itemMaterials) {
    const color = new THREE.Color(definition.defaultColor as unknown as THREE.ColorRepresentation);
    const accentColor = color.clone().offsetHSL((seed - 0.5) * 0.08, 0.08, seed > 0.5 ? 0.12 : -0.08);
    itemMaterials = {
      base: new THREE.MeshStandardMaterial({
        color,
        metalness: definition.category === "resource" || definition.medium === "fluid" ? 0.18 : 0.5,
        roughness: definition.medium === "fluid" ? 0.24 : definition.category === "resource" ? 0.7 : 0.38,
      }),
      accent: new THREE.MeshStandardMaterial({ color: accentColor, metalness: 0.48, roughness: 0.32 }),
    };
    cachedByItem.set(definition.id, itemMaterials);
  }
  const { base, accent } = itemMaterials;
  const geometryType = String(definition.geometryType);

  group.name = `item:${definition.id}`;
  group.userData.itemId = definition.id;
  group.userData.modelKey = definition.modelKey;
  group.userData.geometryType = geometryType;
  group.userData.transportMedium = definition.medium;

  switch (geometryType) {
    case "ore_chunk": {
      const points: Array<[number, number, number, number]> = [
        [-0.09, 0.08, 0.02, 0.15],
        [0.08, 0.075, 0.04, 0.12],
        [0.01, 0.095, -0.075, 0.1],
      ];
      points.forEach(([x, y, z, size], index) => {
        const fragment = add(group, new THREE.OctahedronGeometry(size, 0), base, [x, y, z]);
        fragment.rotation.set(seed * 0.7 + index * 0.35, index * 0.8, seed * 0.5);
      });
      break;
    }
    case "crystal_cluster":
      [-0.095, 0, 0.09].forEach((x, index) => {
        cylinder(
          group,
          [0.065 - index * 0.008, 0.025],
          0.2 + index * 0.035,
          6,
          [x, 0.1 + index * 0.018, (index - 1) * 0.025],
          index === 1 ? accent : base,
          [0, 0, (index - 1) * 0.18],
        );
      });
      break;
    case "ingot":
      cylinder(group, [0.12, 0.17], 0.34, 4, [0, 0.105, 0], base, [0, 0, Math.PI / 2]);
      box(group, [0.035, 0.19, 0.19], [(seed - 0.5) * 0.08, 0.105, 0], accent);
      break;
    case "plate":
      box(group, [0.34, 0.035, 0.24], [-0.018, 0.025, -0.012], base);
      box(group, [0.31, 0.035, 0.21], [0.018, 0.065, 0.012], accent);
      break;
    case "rod_bundle":
    case "rod":
      [-0.07, 0, 0.07].forEach((z) => cylinder(group, [0.035, 0.035], 0.36, 8, [0, 0.075, z], base, [0, 0, Math.PI / 2]));
      for (const x of [-0.09, 0.09]) box(group, [0.025, 0.15, 0.19], [x, 0.075, 0], accent);
      break;
    case "block":
      box(group, [0.32, 0.17, 0.24], [0, 0.085, 0], base);
      box(group, [0.2, 0.035, 0.12], [0, 0.19, 0], accent);
      box(group, [0.04, 0.19, 0.035], [0.1, 0.095, 0.075], materials.orange);
      break;
    case "parts_pack":
      tray(group, materials.dark, accent);
      [-0.1, -0.035, 0.035, 0.1].forEach((x) => {
        cylinder(group, [0.024, 0.024], 0.19, 6, [x, 0.09, 0], base, [Math.PI / 2, 0, 0]);
        cylinder(group, [0.04, 0.04], 0.025, 6, [x, 0.09, 0.085], accent, [Math.PI / 2, 0, 0]);
      });
      break;
    case "wire_coil":
      add(group, new THREE.TorusGeometry(0.105, 0.035, 7, 18), base, [0, 0.11, 0]);
      cylinder(group, [0.035, 0.035], 0.25, 8, [0, 0.11, 0], materials.dark, [Math.PI / 2, 0, 0]);
      box(group, [0.04, 0.16, 0.035], [0.115, 0.1, 0], accent, [0, 0, 0.28]);
      break;
    case "billet":
      cylinder(group, [0.085, 0.085], 0.38, 6, [0, 0.085, 0], base, [0, 0, Math.PI / 2]);
      box(group, [0.025, 0.17, 0.17], [0.08, 0.085, 0], accent);
      break;
    case "gear_set":
      addGear(group, -0.075, 0.025, 0.09, base);
      addGear(group, 0.09, -0.04, 0.065, accent);
      cylinder(group, [0.025, 0.025], 0.28, 8, [0, 0.075, 0], materials.dark, [Math.PI / 2, 0, 0]);
      break;
    case "coil":
      add(group, new THREE.TorusGeometry(0.105, 0.035, 7, 18), base, [0, 0.12, 0], [Math.PI / 2, 0, 0]);
      box(group, [0.08, 0.25, 0.08], [0, 0.12, 0], materials.dark);
      for (const x of [-0.14, 0.14]) box(group, [0.06, 0.04, 0.12], [x, 0.12, 0], accent);
      break;
    case "motor":
      cylinder(group, [0.11, 0.11], 0.27, 12, [0, 0.12, 0], base, [0, 0, Math.PI / 2]);
      for (const x of [-0.145, 0.145]) cylinder(group, [0.125, 0.125], 0.025, 12, [x, 0.12, 0], accent, [0, 0, Math.PI / 2]);
      cylinder(group, [0.025, 0.025], 0.11, 8, [0.19, 0.12, 0], materials.steel, [0, 0, Math.PI / 2]);
      [-0.06, 0, 0.06].forEach((z) => box(group, [0.21, 0.025, 0.025], [0, 0.235, z], materials.dark));
      break;
    case "frame":
      addFrame(group, base);
      break;
    case "circuit_board":
      box(group, [0.34, 0.025, 0.23], [0, 0.025, 0], base);
      box(group, [0.1, 0.055, 0.085], [(seed - 0.5) * 0.09, 0.065, 0], materials.dark);
      for (const x of [-0.12, 0.12]) box(group, [0.055, 0.04, 0.04], [x, 0.055, -0.06], accent);
      box(group, [0.035, 0.055, 0.19], [0.17, 0.055, 0], materials.steel);
      break;
    case "core":
      addFrame(group, materials.dark, 0.88);
      cylinder(group, [0.085, 0.085], 0.22, 6, [0, 0.13, 0], base);
      add(group, new THREE.TorusGeometry(0.12, 0.018, 6, 16), accent, [0, 0.13, 0], [Math.PI / 2, 0, 0]);
      break;
    case "resin_pellet":
      tray(group, materials.dark, materials.steel);
      [-0.1, 0, 0.1].forEach((x) => [-0.055, 0.055].forEach((z) => add(group, new THREE.SphereGeometry(0.045, 7, 5), base, [x, 0.07, z])));
      break;
    case "sheet":
      [-0.025, 0, 0.025].forEach((x, index) => box(group, [0.33, 0.022, 0.23], [x, 0.02 + index * 0.026, 0], base));
      for (const x of [-0.135, 0.135]) box(group, [0.025, 0.075, 0.04], [x, 0.055, 0.085], accent);
      break;
    case "powder":
      tray(group, materials.dark, materials.steel);
      for (let index = 0; index < 7; index += 1) {
        const angle = (index / 7) * Math.PI * 2;
        add(group, new THREE.SphereGeometry(0.035, 6, 4), base, [Math.cos(angle) * 0.09, 0.06, Math.sin(angle) * 0.065]);
      }
      box(group, [0.3, 0.018, 0.2], [0, 0.1, 0], accent);
      break;
    case "sensor":
      add(group, new THREE.TorusGeometry(0.1, 0.022, 6, 16), materials.dark, [0, 0.115, 0], [Math.PI / 2, 0, 0]);
      cylinder(group, [0.078, 0.09], 0.06, 8, [0, 0.115, 0], base, [Math.PI / 2, 0, 0]);
      for (const x of [-0.13, 0.13]) box(group, [0.045, 0.19, 0.045], [x, 0.095, 0], accent);
      break;
    case "electrode":
      for (const z of [-0.07, 0.07]) cylinder(group, [0.045, 0.045], 0.34, 10, [0, 0.075, z], base, [0, 0, Math.PI / 2]);
      for (const x of [-0.1, 0.1]) box(group, [0.035, 0.15, 0.2], [x, 0.075, 0], accent);
      break;
    case "case":
      box(group, [0.34, 0.035, 0.24], [0, 0.025, 0], base);
      for (const z of [-0.105, 0.105]) box(group, [0.34, 0.16, 0.03], [0, 0.105, z], base);
      box(group, [0.035, 0.16, 0.18], [-0.15, 0.105, 0], accent);
      break;
    case "beam":
      for (const z of [-0.065, 0.065]) {
        box(group, [0.36, 0.025, 0.1], [0, 0.025, z], base);
        box(group, [0.36, 0.025, 0.1], [0, 0.165, z], base);
        box(group, [0.36, 0.13, 0.025], [0, 0.095, z], accent);
      }
      break;
    case "power_cell":
      tray(group, materials.dark, accent);
      [-0.1, 0, 0.1].forEach((x) => cylinder(group, [0.045, 0.055], 0.2, 6, [x, 0.125, 0], base));
      box(group, [0.27, 0.035, 0.05], [0, 0.22, 0], materials.steel);
      break;
    case "actuator":
      box(group, [0.22, 0.18, 0.22], [-0.06, 0.09, 0], base);
      cylinder(group, [0.04, 0.04], 0.19, 10, [0.145, 0.1, 0], materials.steel, [0, 0, Math.PI / 2]);
      box(group, [0.045, 0.22, 0.25], [-0.18, 0.1, 0], accent);
      break;
    case "shell":
      box(group, [0.34, 0.025, 0.24], [0, 0.02, 0], materials.dark);
      box(group, [0.26, 0.025, 0.2], [-0.06, 0.13, 0], base, [0, 0, -0.42]);
      box(group, [0.26, 0.025, 0.2], [0.06, 0.13, 0], accent, [0, 0, 0.42]);
      break;
    case "component":
      cylinder(group, [0.085, 0.04], 0.25, 8, [0, 0.105, 0], base, [0, 0, Math.PI / 2]);
      add(group, new THREE.TorusGeometry(0.105, 0.025, 6, 12), accent, [0, 0.105, 0], [0, Math.PI / 2, 0]);
      for (const z of [-0.11, 0.11]) box(group, [0.18, 0.045, 0.035], [0, 0.04, z], materials.dark);
      break;
    case "module":
      box(group, [0.3, 0.12, 0.23], [0, 0.06, 0], base);
      for (const x of [-0.12, -0.06, 0, 0.06, 0.12]) box(group, [0.022, 0.13, 0.25], [x, 0.175, 0], accent);
      cylinder(group, [0.035, 0.035], 0.28, 8, [0, 0.08, 0], materials.steel, [Math.PI / 2, 0, 0]);
      break;
    case "seed":
      cylinder(group, [0.1, 0.1], 0.25, 12, [0, 0.145, 0], base);
      cylinder(group, [0.1, 0.025], 0.1, 12, [0, 0.32, 0], accent);
      cylinder(group, [0.04, 0.1], 0.08, 12, [0, -0.02, 0], materials.dark);
      add(group, new THREE.TorusGeometry(0.125, 0.018, 6, 16), materials.steel, [0, 0.22, 0], [Math.PI / 2, 0, 0]);
      break;
    case "fluid":
      // Fluids never travel as belt cubes; this sealed gauge capsule is an inventory/UI proxy.
      cylinder(group, [0.095, 0.095], 0.24, 12, [0, 0.13, 0], base);
      for (const y of [0.025, 0.235]) add(group, new THREE.TorusGeometry(0.1, 0.016, 6, 14), materials.steel, [0, y, 0], [Math.PI / 2, 0, 0]);
      cylinder(group, [0.025, 0.04], 0.07, 8, [0, 0.285, 0], accent);
      break;
    default:
      // Definitions added before a dedicated silhouette lands still remain visible and diagnosable.
      box(group, [0.3, 0.16, 0.22], [0, 0.08, 0], base);
      box(group, [0.08, 0.2, 0.08], [(seed - 0.5) * 0.16, 0.12, 0], accent);
      break;
  }

  return group;
};

export const createRegisteredItemModel = (itemId: ItemId, materials: ItemModelMaterials) => {
  const definition = START_REGISTRY.items.get(itemId);
  if (!definition) throw new Error(`Unknown item definition: ${itemId}`);
  return createItemModelFromDefinition(definition, materials);
};
