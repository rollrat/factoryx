import * as THREE from "three";
import type { BuildType, ItemType } from "./types.ts";
import type { BuildingDefinition, BuildingId } from "./domain/types.ts";
import { START_REGISTRY } from "./data/index.ts";
import { createMinerModel } from "./models/miner.ts";
import { createSmelterModel } from "./models/smelter.ts";
import { createAssemblerModel } from "./models/assembler.ts";
import { createStorageModel } from "./models/storage.ts";
import { createMergerModel, createSplitterModel } from "./models/logistics.ts";
import { createCrusherModel } from "./models/crusher.ts";
import { createRegisteredItemModel } from "./models/item.ts";
import { createGenericBuildingModel } from "./models/genericBuilding.ts";
import { createDistributionPoleModel, createFieldPowerCoreModel } from "./models/power.ts";
import { createProjectDockModel } from "./models/projectDock.ts";

export type FactoryMaterials = ReturnType<typeof createFactoryMaterials>;

export const createFactoryMaterials = () => {
  const standard = (color: number, metalness = 0.28, roughness = 0.48) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });
  return {
    dark: standard(0x16242a, 0.65, 0.34),
    steel: standard(0x657b80, 0.72, 0.28),
    pale: standard(0xa8bcc0, 0.52, 0.32),
    cyan: new THREE.MeshStandardMaterial({
      color: 0x5de4d1,
      emissive: 0x1a8f82,
      emissiveIntensity: 1.25,
      metalness: 0.3,
      roughness: 0.25,
    }),
    amber: new THREE.MeshStandardMaterial({
      color: 0xffa94d,
      emissive: 0x9b480c,
      emissiveIntensity: 1.2,
      metalness: 0.25,
      roughness: 0.3,
    }),
    orange: standard(0xd96f32, 0.4, 0.42),
    rubber: standard(0x0b1215, 0.08, 0.9),
    belt: standard(0x27393d, 0.08, 0.82),
    beltRib: standard(0x405255, 0.08, 0.72),
    copper: standard(0xb76e43, 0.58, 0.3),
    ore: standard(0x5d7b8b, 0.65, 0.38),
    limestone: standard(0xc8c3aa, 0.18, 0.78),
  };
};

const addBox = (
  group: THREE.Group,
  size: [number, number, number],
  position: [number, number, number],
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

export const createStructureModel = (type: BuildType, materials: FactoryMaterials) => {
  const group = new THREE.Group();

  if (type === "belt") {
    // The belt is the moving surface. Its pulleys stay inside the frame instead of
    // reading as three exposed rollers on every one-metre module.
    addBox(group, [0.78, 0.15, 0.96], [0, 0.22, 0], materials.dark);
    addBox(group, [0.7, 0.055, 0.98], [0, 0.325, 0], materials.belt, false);

    // Side extrusions carry the belt and create a continuous silhouette when
    // neighbouring modules touch.
    for (const x of [-0.43, 0.43]) {
      addBox(group, [0.11, 0.22, 0.98], [x, 0.22, 0], materials.steel);
      addBox(group, [0.04, 0.075, 0.94], [x * 0.91, 0.37, 0], materials.dark);
    }

    // Narrow end shrouds hide the point where the procedural treads recycle.
    for (const z of [-0.47, 0.47]) {
      addBox(group, [0.78, 0.075, 0.075], [0, 0.345, z], materials.dark);
    }

    for (const x of [-0.36, 0.36]) {
      for (const z of [-0.34, 0.34]) addBox(group, [0.09, 0.2, 0.09], [x, 0.1, z], materials.dark);
    }

    [-5 / 12, -3 / 12, -1 / 12, 1 / 12, 3 / 12, 5 / 12].forEach((offset) => {
      const tread = addBox(group, [0.62, 0.012, 0.035], [0, 0.36, offset], materials.beltRib, false);
      tread.userData.animationRole = "beltTread";
      tread.userData.offset = offset;
    });

    // The large direction cue belongs to build mode only. Placed belts communicate
    // motion through their treads and items, leaving the load surface uncluttered.
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(-0.07, -0.14);
    arrowShape.lineTo(0.07, -0.14);
    arrowShape.lineTo(0.07, 0.01);
    arrowShape.lineTo(0.15, 0.01);
    arrowShape.lineTo(0, 0.18);
    arrowShape.lineTo(-0.15, 0.01);
    arrowShape.lineTo(-0.07, 0.01);
    arrowShape.closePath();
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), materials.cyan);
    arrow.position.set(0, 0.374, 0);
    arrow.rotation.x = Math.PI / 2;
    arrow.scale.setScalar(0.82);
    arrow.userData.animationRole = "beltBuildArrow";
    arrow.renderOrder = 2;
    arrow.visible = false;
    group.add(arrow);

    const statusMaterial = new THREE.MeshStandardMaterial({
      color: 0x5de4d1,
      emissive: 0x1a8f82,
      emissiveIntensity: 1.7,
      metalness: 0.2,
      roughness: 0.25,
    });
    const status = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), statusMaterial);
    status.position.set(0.49, 0.37, 0.3);
    status.userData.animationRole = "beltStatusLight";
    group.add(status);
    return group;
  }

  if (type === "splitter") return createSplitterModel(materials);
  if (type === "merger") return createMergerModel(materials);

  if (type === "miner") return createMinerModel(materials);
  if (type === "smelter") return createSmelterModel(materials);
  if (type === "crusher") return createCrusherModel(materials);
  if (type === "assembler") return createAssemblerModel(materials);
  if (type === "storage") return createStorageModel(materials);
  return group;
};

const dedicatedBuildingModel = (
  modelKey: string,
  materials: FactoryMaterials,
): THREE.Group | null => {
  if (modelKey === "vein_miner") return createMinerModel(materials);
  if (modelKey === "arc_smelter") return createSmelterModel(materials);
  if (modelKey === "crusher") return createCrusherModel(materials);
  // The current detailed work-cell model remains shared by the legacy former and
  // the data-defined precision assembler until a dedicated press model lands.
  if (modelKey === "hydraulic_former" || modelKey === "precision_assembler") return createAssemblerModel(materials);
  if (modelKey === "small_storage") return createStorageModel(materials);
  if (modelKey === "conveyor_mk1") return createStructureModel("belt", materials);
  if (modelKey === "splitter") return createSplitterModel(materials);
  if (modelKey === "merger") return createMergerModel(materials);
  if (modelKey === "field_power_core") return createFieldPowerCoreModel(materials);
  if (modelKey === "distribution_pole_mk1") return createDistributionPoleModel(materials);
  if (modelKey === "project_dock") return createProjectDockModel(materials);
  return null;
};

/** Routes a validated definition by modelKey, falling back to its data-driven blockout. */
export const createBuildingModelFromDefinition = (
  definition: BuildingDefinition,
  materials: FactoryMaterials,
) => {
  const modelKey = definition.modelKey ?? definition.id;
  const dedicated = dedicatedBuildingModel(modelKey, materials);
  const group = dedicated ?? createGenericBuildingModel(definition, materials);
  group.userData.buildingId = definition.id;
  group.userData.modelKey = modelKey;
  group.userData.modelSource = dedicated ? "dedicated" : "generic";
  return group;
};

/** Creates any campaign building by registry id without changing the legacy BuildType API. */
export const createBuildingModel = (
  buildingId: BuildingId,
  materials: FactoryMaterials,
) => {
  const definition = START_REGISTRY.buildings.get(buildingId);
  if (!definition) throw new Error(`Unknown building definition: ${buildingId}`);
  return createBuildingModelFromDefinition(definition, materials);
};

export const createOrePatch = (materials: FactoryMaterials, copper = false, limestone = false) => {
  const group = new THREE.Group();
  const material = limestone ? materials.limestone : copper ? materials.copper : materials.ore;
  const points = [
    [-0.5, 0.13, -0.38, 0.28],
    [0.34, 0.2, -0.22, 0.36],
    [-0.12, 0.26, 0.34, 0.42],
    [0.52, 0.13, 0.42, 0.24],
  ];
  points.forEach(([x, y, z, scale], index) => {
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(scale, 0), material);
    crystal.position.set(x, y, z);
    crystal.rotation.y = index * 0.7;
    crystal.castShadow = true;
    group.add(crystal);
  });
  return group;
};

export const createItemModel = (type: ItemType, materials: FactoryMaterials) => {
  return createRegisteredItemModel(type, materials);
};
