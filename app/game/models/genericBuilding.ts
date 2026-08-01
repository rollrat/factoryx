import * as THREE from "three";
import type { BuildingDefinition, PortDefinition } from "../domain/types.ts";

export type GenericBuildingMaterials = Readonly<{
  dark: THREE.Material;
  steel: THREE.Material;
  pale: THREE.Material;
  cyan: THREE.Material;
  amber: THREE.Material;
  orange: THREE.Material;
  rubber: THREE.Material;
  belt?: THREE.Material;
  beltRib?: THREE.Material;
  copper?: THREE.Material;
}>;

export type GenericBuildingCategory =
  | "production"
  | "logistics"
  | "fluid"
  | "generator"
  | "distribution"
  | "storage"
  | "infrastructure";

export type GenericBuildingRuntimeState =
  | "idle"
  | "working"
  | "starved"
  | "blocked"
  | "disconnected"
  | "paused";

export type GenericBuildingVisualState = Readonly<{
  runtimeState: GenericBuildingRuntimeState;
  progress: number;
  activity: number;
  time: number;
}>;

const add = (
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  role?: string,
) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = role !== "status" && role !== "powerPulse";
  mesh.receiveShadow = true;
  if (role) mesh.userData.animationRole = role;
  group.add(mesh);
  return mesh;
};

const box = (
  group: THREE.Group,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  role?: string,
  rotation: [number, number, number] = [0, 0, 0],
) => add(group, new THREE.BoxGeometry(...size), material, position, rotation, role);

const cylinder = (
  group: THREE.Group,
  radius: number,
  height: number,
  segments: number,
  position: [number, number, number],
  material: THREE.Material,
  role?: string,
  rotation: [number, number, number] = [0, 0, 0],
) => add(group, new THREE.CylinderGeometry(radius, radius, height, segments), material, position, rotation, role);

const hashUnit = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash, 31) + value.charCodeAt(index) | 0;
  return (hash >>> 0) / 0xffffffff;
};

export const genericBuildingCategory = (definition: BuildingDefinition): GenericBuildingCategory => {
  if (definition.generatorPolicy) return "generator";
  if (definition.placementMode === "preplaced_unique") return "infrastructure";
  if (definition.distributionPolicy || definition.powerStoragePolicy) return "distribution";
  if (definition.storagePolicy || definition.fluidStoragePolicy || definition.id === "fluid_tank") return "storage";
  if (definition.recipeIds.length > 0) return "production";
  if (definition.transportPolicy || definition.id === "splitter" || definition.id === "merger") {
    return definition.ports.some(({ medium }) => medium === "fluid") ? "fluid" : "logistics";
  }
  if (definition.ports.some(({ medium }) => medium === "fluid")) return "fluid";
  return "infrastructure";
};

const addFoundation = (
  group: THREE.Group,
  definition: BuildingDefinition,
  materials: GenericBuildingMaterials,
) => {
  const { x, z } = definition.footprint;
  box(group, [Math.max(0.42, x - 0.1), 0.12, Math.max(0.42, z - 0.1)], [0, 0.06, 0], materials.dark, "foundation");
  const footX = Math.max(0.15, x / 2 - 0.16);
  const footZ = Math.max(0.15, z / 2 - 0.16);
  for (const px of [-footX, footX]) {
    for (const pz of [-footZ, footZ]) box(group, [0.16, 0.16, 0.16], [px, 0.08, pz], materials.steel, "supportFoot");
  }
};

const addStatus = (
  group: THREE.Group,
  definition: BuildingDefinition,
  materials: GenericBuildingMaterials,
  height: number,
) => {
  const panel = box(
    group,
    [0.08, 0.25, 0.3],
    [definition.footprint.x / 2 - 0.09, Math.min(height, 1.25), definition.footprint.z / 2 - 0.3],
    materials.dark,
    "controlPanel",
  );
  panel.userData.activeMW = definition.activeMW ?? 0;
  const statusMaterial = new THREE.MeshStandardMaterial({
    color: 0x5de4d1,
    emissive: 0x1a8f82,
    emissiveIntensity: 0.5,
    metalness: 0.2,
    roughness: 0.3,
  });
  const lamp = add(
    group,
    new THREE.SphereGeometry(0.045, 8, 6),
    statusMaterial,
    [definition.footprint.x / 2 - 0.13, Math.min(height + 0.09, 1.36), definition.footprint.z / 2 - 0.3],
    [0, 0, 0],
    "status",
  );
  lamp.userData.buildingId = definition.id;
};

const addProduction = (
  group: THREE.Group,
  definition: BuildingDefinition,
  materials: GenericBuildingMaterials,
  seed: number,
) => {
  const { x, z } = definition.footprint;
  const height = 0.78 + Math.min(0.72, (definition.activeMW ?? 4) / 40);
  const fluidProcess = definition.ports.some(({ medium }) => medium === "fluid");
  box(group, [x * 0.68, height, z * 0.62], [0, 0.12 + height / 2, 0], materials.pale, "processHousing");
  if (fluidProcess) {
    cylinder(group, Math.min(x, z) * 0.22, height * 1.45, 12, [0, 0.16 + height * 0.72, 0], materials.steel, "processCore");
    for (const y of [0.42, 0.72, 1.02].filter((value) => value < height * 1.4)) {
      add(group, new THREE.TorusGeometry(Math.min(x, z) * 0.24, 0.035, 6, 16), materials.orange, [0, y, 0], [Math.PI / 2, 0, 0], "processRing");
    }
  } else {
    const coreRadius = Math.min(0.38, Math.min(x, z) * (0.16 + seed * 0.035));
    cylinder(group, coreRadius, z * 0.54, 10, [0, 0.55, 0], materials.steel, "processCore", [Math.PI / 2, 0, 0]);
    const inputCount = definition.ports.filter(({ direction, medium }) => direction === "input" && medium !== "power").length;
    for (let index = 0; index < Math.max(1, inputCount); index += 1) {
      const laneZ = (index - (Math.max(1, inputCount) - 1) / 2) * 0.38;
      box(group, [x * 0.38, 0.09, 0.18], [-x * 0.2, 0.4, laneZ], materials.orange, "materialGuide");
    }
  }
  box(group, [x * 0.46, 0.09, 0.12], [0, 0.22 + height, -z * 0.22], materials.orange, "processActuator");
  addStatus(group, definition, materials, height);
};

const addLogistics = (
  group: THREE.Group,
  definition: BuildingDefinition,
  materials: GenericBuildingMaterials,
) => {
  const { x, z } = definition.footprint;
  box(group, [Math.max(0.5, x * 0.78), 0.08, Math.max(0.38, z * 0.72)], [0, 0.23, 0], materials.belt ?? materials.rubber, "transportSurface");
  for (const side of [-1, 1]) box(group, [x * 0.78, 0.14, 0.07], [0, 0.28, side * z * 0.32], materials.steel, "transportRail");
  const branches = Math.max(1, definition.ports.length - 1);
  for (let index = 0; index < branches; index += 1) {
    const laneZ = (index - (branches - 1) / 2) * Math.min(0.42, z * 0.34);
    box(group, [x * 0.42, 0.025, 0.08], [0.12, 0.3, laneZ], materials.beltRib ?? materials.orange, "transportLane");
  }
  cylinder(group, 0.12, 0.18, 10, [0, 0.38, 0], materials.orange, "routingGate");
  addStatus(group, definition, materials, 0.55);
};

const addFluid = (
  group: THREE.Group,
  definition: BuildingDefinition,
  materials: GenericBuildingMaterials,
) => {
  const { x, z } = definition.footprint;
  const pipeRadius = Math.min(0.18, Math.min(x, z) * 0.16);
  cylinder(group, pipeRadius, x * 0.78, 12, [0, 0.5, 0], materials.steel, "fluidPath", [0, 0, Math.PI / 2]);
  const sidePort = definition.ports.find(({ localFacing }) => localFacing.z !== 0);
  if (sidePort) cylinder(group, pipeRadius, z * 0.58, 12, [0, 0.5, sidePort.localFacing.z * z * 0.2], materials.steel, "fluidBranch", [Math.PI / 2, 0, 0]);
  if (definition.id.includes("pump")) {
    cylinder(group, 0.3, 0.4, 14, [0, 0.5, 0], materials.pale, "pumpHousing", [0, 0, Math.PI / 2]);
    cylinder(group, 0.18, 0.07, 10, [0, 0.5, 0.22], materials.orange, "pumpRotor", [Math.PI / 2, 0, 0]);
  }
  if (definition.id.includes("flare")) {
    cylinder(group, 0.14, 1.5, 10, [0.2, 0.88, 0], materials.dark, "flareStack");
    add(group, new THREE.ConeGeometry(0.2, 0.35, 8), materials.orange, [0.2, 1.82, 0], [0, 0, 0], "flareFlame");
  }
  addStatus(group, definition, materials, definition.id.includes("flare") ? 1.1 : 0.72);
};

const addStorage = (
  group: THREE.Group,
  definition: BuildingDefinition,
  materials: GenericBuildingMaterials,
) => {
  const { x, z } = definition.footprint;
  const fluid = definition.fluidStoragePolicy || definition.id === "fluid_tank";
  const height = 0.95 + Math.min(0.9, ((definition.storagePolicy?.slotCount ?? 4) / 24) * 0.75);
  if (fluid) {
    cylinder(group, Math.min(x, z) * 0.34, height, 14, [0, 0.12 + height / 2, 0], materials.pale, "storageTank");
    for (const y of [0.34, 0.76].filter((value) => value < height)) {
      add(group, new THREE.TorusGeometry(Math.min(x, z) * 0.35, 0.035, 6, 18), materials.orange, [0, y, 0], [Math.PI / 2, 0, 0], "tankBand");
    }
  } else {
    box(group, [x * 0.7, height, z * 0.68], [0, 0.12 + height / 2, 0], materials.pale, "storageBody");
    const bays = Math.max(2, Math.min(5, Math.round((definition.storagePolicy?.slotCount ?? 4) / 4)));
    for (let index = 0; index < bays; index += 1) {
      const y = 0.3 + index * ((height - 0.22) / bays);
      box(group, [x * 0.72, 0.035, z * 0.7], [0, y, 0], materials.steel, "storageShelf");
    }
    box(group, [0.12, height * 0.72, 0.16], [x * 0.22, 0.18 + height * 0.36, 0], materials.orange, "storageLift");
  }
  box(group, [0.06, height * 0.72, 0.08], [x * 0.38, 0.18 + height * 0.36, z * 0.36], materials.cyan, "storageGauge");
  addStatus(group, definition, materials, height);
};

const addGenerator = (
  group: THREE.Group,
  definition: BuildingDefinition,
  materials: GenericBuildingMaterials,
) => {
  const { x, z } = definition.footprint;
  const scale = Math.max(1, Math.sqrt((definition.generatorPolicy?.capacityMW ?? 24) / 24));
  const bodyHeight = Math.min(1.65, 0.72 + scale * 0.18);
  box(group, [x * 0.68, bodyHeight, z * 0.6], [0, 0.12 + bodyHeight / 2, 0], materials.dark, "generatorHousing");
  cylinder(group, Math.min(0.42, z * 0.2), x * 0.56, 14, [0, 0.55, 0], materials.steel, "generatorRotor", [0, 0, Math.PI / 2]);
  add(group, new THREE.TorusGeometry(Math.min(0.46, z * 0.22), 0.045, 7, 18), materials.orange, [0, 0.55, 0], [0, Math.PI / 2, 0], "generatorCoil");
  const stacks = definition.id.includes("thermal") ? 3 : definition.id.includes("turbine") ? 2 : 1;
  for (let index = 0; index < stacks; index += 1) {
    const zPos = (index - (stacks - 1) / 2) * 0.42;
    cylinder(group, 0.12, 0.75 + scale * 0.1, 10, [x * 0.26, bodyHeight + 0.42, zPos], materials.pale, "exhaustStack");
  }
  addStatus(group, definition, materials, bodyHeight);
};

const addDistribution = (
  group: THREE.Group,
  definition: BuildingDefinition,
  materials: GenericBuildingMaterials,
) => {
  const { x, z } = definition.footprint;
  const tower = definition.id.includes("pole") || definition.id.includes("tower");
  if (tower) {
    const height = definition.id.includes("tower") ? 2.2 : definition.id.includes("mk2") ? 1.6 : 1.25;
    for (const px of [-0.16, 0.16]) box(group, [0.1, height, 0.1], [px, 0.12 + height / 2, 0], materials.dark, "distributionMast");
    const arms = Math.max(2, Math.min(4, definition.distributionPolicy?.maxCableConnections ?? 2));
    for (let index = 0; index < arms; index += 1) {
      const y = height * (0.62 + index * 0.1);
      box(group, [Math.max(0.7, x * 0.75), 0.07, 0.08], [0, y, 0], materials.steel, "distributionCrossarm");
      for (const px of [-x * 0.28, x * 0.28]) cylinder(group, 0.045, 0.13, 8, [px, y + 0.09, 0], materials.cyan, "powerPulse");
    }
  } else {
    box(group, [x * 0.68, 0.85, z * 0.64], [0, 0.545, 0], materials.pale, "switchgearCabinet");
    const connections = Math.min(6, definition.distributionPolicy?.maxCableConnections ?? 2);
    for (let index = 0; index < connections; index += 1) {
      const zPos = (index - (connections - 1) / 2) * Math.min(0.22, z * 0.14);
      box(group, [x * 0.54, 0.035, 0.045], [0, 0.64, zPos], index % 2 ? materials.orange : materials.cyan, "distributionBusbar");
    }
    if (definition.powerStoragePolicy) {
      for (const px of [-0.22, 0, 0.22]) cylinder(group, 0.1, 0.58, 10, [px, 0.48, 0], materials.dark, "accumulatorCell");
    }
  }
  addStatus(group, definition, materials, tower ? 1.1 : 0.9);
};

const addInfrastructure = (
  group: THREE.Group,
  definition: BuildingDefinition,
  materials: GenericBuildingMaterials,
) => {
  const { x, z } = definition.footprint;
  const height = Math.min(1.6, 0.7 + Math.max(x, z) * 0.12);
  for (const px of [-x * 0.36, x * 0.36]) {
    for (const pz of [-z * 0.36, z * 0.36]) box(group, [0.16, height, 0.16], [px, 0.12 + height / 2, pz], materials.dark, "infrastructureColumn");
  }
  box(group, [x * 0.78, 0.14, z * 0.78], [0, height, 0], materials.steel, "infrastructureGantry");
  cylinder(group, Math.min(x, z) * 0.16, 0.34, 12, [0, 0.34, 0], materials.orange, "assemblyCradle");
  addStatus(group, definition, materials, height);
};

const addPortMarker = (
  group: THREE.Group,
  port: PortDefinition,
  index: number,
  materials: GenericBuildingMaterials,
) => {
  const position: [number, number, number] = [port.localPosition.x, port.localPosition.y, port.localPosition.z];
  const role = port.medium === "power"
    ? "powerPort"
    : port.direction === "input"
      ? "inputPort"
      : port.direction === "output"
        ? "outputPort"
        : "bidirectionalPort";
  let marker: THREE.Mesh;
  if (port.medium === "solid") {
    const alongX = port.localFacing.x !== 0;
    marker = box(
      group,
      alongX ? [0.12, 0.12, 0.66] : [0.66, 0.12, 0.12],
      position,
      port.direction === "input" ? materials.amber : materials.cyan,
      role,
    );
    if (port.direction !== "bidirectional") {
      const gatePosition: [number, number, number] = [
        position[0] - port.localFacing.x * 0.075,
        position[1] + 0.09,
        position[2] - port.localFacing.z * 0.075,
      ];
      const gate = box(
        group,
        alongX ? [0.055, 0.2, 0.58] : [0.58, 0.2, 0.055],
        gatePosition,
        materials.orange,
        port.direction === "input" ? "inputGate" : "outputGate",
      );
      gate.userData.controlledPortId = port.id;
    }
  } else if (port.medium === "fluid") {
    const rotation: [number, number, number] = port.localFacing.x !== 0
      ? [0, 0, Math.PI / 2]
      : [Math.PI / 2, 0, 0];
    marker = cylinder(group, 0.16, 0.12, 12, position, materials.steel, role, rotation);
    add(group, new THREE.TorusGeometry(0.18, 0.025, 6, 14), materials.cyan, position, rotation, "fluidPortRing");
  } else {
    marker = add(group, new THREE.SphereGeometry(0.105, 10, 7), materials.cyan, position, [0, 0, 0], role);
    add(group, new THREE.TorusGeometry(0.15, 0.025, 6, 14), materials.steel, position, [Math.PI / 2, 0, 0], "powerSocketRing");
  }
  marker.userData.portId = port.id;
  marker.userData.portIndex = index;
  marker.userData.direction = port.direction;
  marker.userData.medium = port.medium;
  marker.userData.connectorProfile = port.connectorProfile;
  marker.userData.connectionCell = { ...port.connectionCell };
  marker.userData.localFacing = { ...port.localFacing };
  marker.userData.acceptedItemIds = [...port.acceptedItemIds];
};

export const createGenericBuildingModel = (
  definition: BuildingDefinition,
  materials: GenericBuildingMaterials,
) => {
  const group = new THREE.Group();
  const category = genericBuildingCategory(definition);
  const seed = hashUnit(definition.modelKey ?? definition.id);
  group.name = `generic-building:${definition.id}`;
  group.userData.buildingId = definition.id;
  group.userData.modelKey = definition.modelKey ?? definition.id;
  group.userData.modelCategory = category;
  group.userData.footprint = { ...definition.footprint };
  group.userData.animationKey = definition.animationKey;
  group.userData.activeMW = definition.activeMW ?? 0;

  addFoundation(group, definition, materials);
  if (category === "production") addProduction(group, definition, materials, seed);
  else if (category === "logistics") addLogistics(group, definition, materials);
  else if (category === "fluid") addFluid(group, definition, materials);
  else if (category === "generator") addGenerator(group, definition, materials);
  else if (category === "distribution") addDistribution(group, definition, materials);
  else if (category === "storage") addStorage(group, definition, materials);
  else addInfrastructure(group, definition, materials);

  definition.ports.forEach((port, index) => addPortMarker(group, port, index, materials));
  return group;
};

type GenericBaseTransform = Readonly<{
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: readonly [number, number, number];
  visible: boolean;
}>;

const baseTransform = (part: THREE.Object3D): GenericBaseTransform => {
  const existing = part.userData.genericBaseTransform as GenericBaseTransform | undefined;
  if (existing) return existing;
  const created: GenericBaseTransform = {
    position: [part.position.x, part.position.y, part.position.z],
    rotation: [part.rotation.x, part.rotation.y, part.rotation.z],
    scale: [part.scale.x, part.scale.y, part.scale.z],
    visible: part.visible,
  };
  part.userData.genericBaseTransform = created;
  return created;
};

const restoreTransform = (part: THREE.Object3D, base: GenericBaseTransform) => {
  part.position.set(...base.position);
  part.rotation.set(...base.rotation);
  part.scale.set(...base.scale);
  part.visible = base.visible;
};

const setStatusMaterial = (
  part: THREE.Object3D,
  color: number,
  emissive: number,
  intensity: number,
) => {
  if (!(part instanceof THREE.Mesh) || !(part.material instanceof THREE.MeshStandardMaterial)) return;
  part.material.color.setHex(color);
  part.material.emissive.setHex(emissive);
  part.material.emissiveIntensity = intensity;
};

const animateStatus = (
  part: THREE.Object3D,
  state: GenericBuildingRuntimeState,
  time: number,
  activity: number,
) => {
  if (state === "working") {
    setStatusMaterial(part, 0x5de4d1, 0x1a8f82, 1.15 + Math.sin(time * 4) * 0.22 * activity);
  } else if (state === "starved") {
    const flash = Math.sin(time * 7) > 0.45 ? 1.65 : 0.35;
    setStatusMaterial(part, 0xffa94d, 0x9b480c, flash);
  } else if (state === "blocked") {
    setStatusMaterial(part, 0xffa94d, 0x9b480c, 1.15 + Math.sin(time * 2.5) * 0.28);
  } else if (state === "disconnected") {
    setStatusMaterial(part, 0xd96f32, 0x5f2410, 0.28);
  } else if (state === "paused") {
    setStatusMaterial(part, 0xa8bcc0, 0x263136, 0.12);
  } else {
    setStatusMaterial(part, 0x5d7b80, 0x163e3c, 0.24);
  }
};

/** Applies deterministic, non-accumulating motion to a generic data-driven blockout. */
export const animateGenericBuildingModel = (
  group: THREE.Group,
  visual: GenericBuildingVisualState,
) => {
  const progress = THREE.MathUtils.clamp(visual.progress, 0, 1);
  const activity = THREE.MathUtils.clamp(visual.activity, 0, 1);
  const operating = visual.runtimeState === "working" && activity > 0;
  const motion = operating ? activity : 0;
  const intake = operating ? 1 - THREE.MathUtils.smoothstep(progress, 0.14, 0.28) : 0;
  const process = operating
    ? THREE.MathUtils.smoothstep(progress, 0.22, 0.36) * (1 - THREE.MathUtils.smoothstep(progress, 0.76, 0.88))
    : 0;
  const release = operating
    ? THREE.MathUtils.smoothstep(progress, 0.8, 0.92) * (1 - THREE.MathUtils.smoothstep(progress, 0.98, 1))
    : 0;

  group.traverse((part: THREE.Object3D) => {
    const role = part.userData.animationRole as string | undefined;
    if (!role) return;
    const base = baseTransform(part);
    restoreTransform(part, base);

    if (role === "status") {
      animateStatus(part, visual.runtimeState, visual.time, activity);
      return;
    }
    if (role === "processCore") {
      part.rotation.y = base.rotation[1] + visual.time * 3.2 * motion * Math.max(0.2, process);
      return;
    }
    if (role === "processRing") {
      const pulse = 1 + process * (0.04 + Math.sin(visual.time * 6) * 0.025);
      part.scale.set(base.scale[0] * pulse, base.scale[1] * pulse, base.scale[2] * pulse);
      part.rotation.z = base.rotation[2] + visual.time * 0.7 * motion;
      return;
    }
    if (role === "processActuator") {
      part.position.y = base.position[1] - process * (0.11 + Math.sin(progress * Math.PI * 6) * 0.025);
      return;
    }
    if (role === "inputGate") {
      part.position.y = base.position[1] + intake * 0.16;
      return;
    }
    if (role === "outputGate") {
      part.position.y = base.position[1] + release * 0.16;
      return;
    }
    if (role === "routingGate") {
      part.rotation.y = base.rotation[1] + Math.sin(visual.time * 5) * 0.58 * motion;
      return;
    }
    if (role === "transportLane") {
      part.position.x = base.position[0] + (operating ? ((visual.time * 0.32 * activity + 0.09) % 0.18) - 0.09 : 0);
      return;
    }
    if (role === "pumpRotor") {
      part.rotation.z = base.rotation[2] + visual.time * 7 * motion;
      return;
    }
    if (role === "fluidPath" || role === "fluidBranch") {
      const flowPulse = operating ? 1 + Math.sin(visual.time * 5) * 0.018 * activity : 1;
      part.scale.set(base.scale[0], base.scale[1] * flowPulse, base.scale[2] * flowPulse);
      return;
    }
    if (role === "flareFlame") {
      part.visible = operating;
      const flamePulse = 0.88 + (Math.sin(visual.time * 9) * 0.5 + 0.5) * 0.22;
      part.scale.set(base.scale[0] * flamePulse, base.scale[1] * flamePulse, base.scale[2] * flamePulse);
      return;
    }
    if (role === "generatorRotor") {
      part.rotation.x = base.rotation[0] + visual.time * 4.5 * motion;
      return;
    }
    if (role === "generatorCoil") {
      const loadPulse = operating ? 1 + Math.sin(visual.time * 4) * 0.025 * activity : 1;
      part.scale.set(base.scale[0] * loadPulse, base.scale[1] * loadPulse, base.scale[2] * loadPulse);
      return;
    }
    if (role === "powerPulse") {
      part.visible = operating;
      const pulse = 0.8 + (Math.sin(visual.time * 6 + part.position.x * 3) * 0.5 + 0.5) * 0.45;
      part.scale.set(base.scale[0] * pulse, base.scale[1] * pulse, base.scale[2] * pulse);
      return;
    }
    if (role === "distributionBusbar") {
      const busPulse = operating ? 1 + Math.sin(visual.time * 3 + part.position.z * 4) * 0.018 : 1;
      part.scale.set(base.scale[0] * busPulse, base.scale[1], base.scale[2]);
      return;
    }
    if (role === "storageLift") {
      part.position.y = base.position[1] + (operating ? Math.sin(progress * Math.PI) * 0.24 : 0);
      return;
    }
    if (role === "storageGauge") {
      part.scale.y = base.scale[1] * Math.max(0.08, progress);
      part.position.y = base.position[1] - (1 - Math.max(0.08, progress)) * 0.12;
      return;
    }
    if (role === "assemblyCradle") {
      part.rotation.y = base.rotation[1] + visual.time * 0.45 * motion;
    }
  });
};
