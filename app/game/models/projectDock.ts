import * as THREE from "three";
import {
  addBeam,
  addBox,
  addCylinder,
  createIndicatorMaterial,
  setIndicator,
} from "./shared.ts";

export type ProjectDockMaterials = {
  dark: THREE.Material;
  steel: THREE.Material;
  pale: THREE.Material;
  cyan: THREE.Material;
  amber: THREE.Material;
  orange: THREE.Material;
  rubber: THREE.Material;
  belt: THREE.Material;
  copper?: THREE.Material;
};

export type ProjectDockDeliveryCounts = Readonly<{
  ironPlate: number;
  constructionBlock: number;
  fastenerPack: number;
}>;

export type ProjectDockVisualState = Readonly<{
  time: number;
  progress: number;
  deliveryCounts: ProjectDockDeliveryCounts;
  completed: boolean;
}>;

export const PROJECT_DOCK_TARGETS: ProjectDockDeliveryCounts = {
  ironPlate: 120,
  constructionBlock: 80,
  fastenerPack: 40,
};

type DeliveryKind = keyof ProjectDockDeliveryCounts;

const DELIVERY_LANES: readonly Readonly<{
  kind: DeliveryKind;
  z: number;
  materialKey: "pale" | "steel" | "orange";
  displayCount: number;
}>[] = [
  { kind: "ironPlate", z: -1.5, materialKey: "pale", displayCount: 12 },
  { kind: "constructionBlock", z: -0.5, materialKey: "steel", displayCount: 10 },
  { kind: "fastenerPack", z: 0.5, materialKey: "orange", displayCount: 8 },
];

const addFoundation = (group: THREE.Group, materials: ProjectDockMaterials) => {
  addBox(group, [5.86, 0.2, 5.86], [0, 0.1, 0], materials.dark);
  addBox(group, [5.5, 0.09, 5.5], [0, 0.245, 0], materials.steel);
  for (const x of [-2.7, -0.9, 0.9, 2.7]) {
    addBox(group, [0.08, 0.025, 5.4], [x, 0.305, 0], materials.dark, false);
  }
  for (const z of [-2.7, -0.9, 0.9, 2.7]) {
    addBox(group, [5.4, 0.025, 0.08], [0, 0.305, z], materials.dark, false);
  }
  for (const x of [-2.65, 2.65]) {
    for (const z of [-2.65, 2.65]) addBox(group, [0.42, 0.18, 0.42], [x, 0.09, z], materials.dark);
  }
};

const addInputLane = (
  group: THREE.Group,
  lane: (typeof DELIVERY_LANES)[number],
  laneIndex: number,
  materials: ProjectDockMaterials,
) => {
  addBox(group, [1.72, 0.16, 0.7], [-2.06, 0.34, lane.z], materials.dark);
  addBox(group, [1.64, 0.035, 0.58], [-2.08, 0.435, lane.z], materials.belt, false);
  for (const z of [lane.z - 0.34, lane.z + 0.34]) {
    addBox(group, [1.66, 0.16, 0.065], [-2.08, 0.52, z], materials.pale);
    addBox(group, [1.5, 0.025, 0.035], [-2.1, 0.62, z], materials.orange, false);
  }
  const port = addBox(
    group,
    [0.045, 0.075, 0.46],
    [-3.01, 0.72, lane.z],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.4),
    false,
  );
  port.userData.animationRole = "dockInputPort";
  port.userData.portIndex = laneIndex;
  port.userData.deliveryKind = lane.kind;

  const gate = new THREE.Group();
  gate.position.set(-1.3, 0.77, lane.z);
  gate.userData.animationRole = "dockInputGate";
  gate.userData.deliveryKind = lane.kind;
  gate.userData.baseRotation = 0;
  addBox(gate, [0.06, 0.48, 0.58], [0, -0.24, 0], materials.rubber, false);
  addBox(gate, [0.065, 0.045, 0.46], [0.002, -0.23, 0], materials.orange, false);
  group.add(gate);

  for (let rollerIndex = 0; rollerIndex < 4; rollerIndex += 1) {
    const roller = addCylinder(
      group,
      0.045,
      0.045,
      0.5,
      [-2.72 + rollerIndex * 0.44, 0.44, lane.z],
      materials.steel,
      8,
    );
    roller.rotation.x = Math.PI / 2;
    roller.userData.animationRole = "dockInputRoller";
    roller.userData.deliveryKind = lane.kind;
  }
};

const addPalletBase = (
  group: THREE.Group,
  lane: (typeof DELIVERY_LANES)[number],
  materials: ProjectDockMaterials,
) => {
  addBox(group, [1.02, 0.14, 0.72], [-0.72, 0.39, lane.z], materials.dark);
  for (const z of [lane.z - 0.27, lane.z, lane.z + 0.27]) {
    addBox(group, [0.94, 0.055, 0.09], [-0.72, 0.49, z], materials.steel);
  }
  addBox(group, [0.08, 0.54, 0.08], [-1.14, 0.72, lane.z + 0.31], materials.dark);
  addBox(group, [0.08, 0.54, 0.08], [-0.3, 0.72, lane.z + 0.31], materials.dark);
  const gauge = addBox(
    group,
    [0.62, 0.07, 0.035],
    [-0.72, 0.92, lane.z + 0.355],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.35),
    false,
  );
  gauge.userData.animationRole = "dockPalletGauge";
  gauge.userData.deliveryKind = lane.kind;
  gauge.userData.fullWidth = 0.62;
};

const addPlateStack = (
  group: THREE.Group,
  lane: (typeof DELIVERY_LANES)[number],
  materials: ProjectDockMaterials,
) => {
  for (let index = 0; index < lane.displayCount; index += 1) {
    const level = Math.floor(index / 4);
    const slot = index % 4;
    const plate = addBox(
      group,
      [0.36, 0.045, 0.24],
      [-1.0 + slot * 0.19, 0.53 + level * 0.06, lane.z - 0.14 + (slot % 2) * 0.27],
      materials.pale,
    );
    plate.userData.animationRole = "dockPalletItem";
    plate.userData.deliveryKind = lane.kind;
    plate.userData.deliveryIndex = index;
  }
};

const addBlockStack = (
  group: THREE.Group,
  lane: (typeof DELIVERY_LANES)[number],
  materials: ProjectDockMaterials,
) => {
  for (let index = 0; index < lane.displayCount; index += 1) {
    const level = Math.floor(index / 5);
    const slot = index % 5;
    const block = addBox(
      group,
      [0.17, 0.18, 0.24],
      [-1.05 + slot * 0.17, 0.58 + level * 0.2, lane.z + (slot % 2 ? 0.13 : -0.13)],
      materials.steel,
    );
    block.userData.animationRole = "dockPalletItem";
    block.userData.deliveryKind = lane.kind;
    block.userData.deliveryIndex = index;
  }
};

const addFastenerPacks = (
  group: THREE.Group,
  lane: (typeof DELIVERY_LANES)[number],
  materials: ProjectDockMaterials,
) => {
  for (let index = 0; index < lane.displayCount; index += 1) {
    const level = Math.floor(index / 4);
    const slot = index % 4;
    const pack = new THREE.Group();
    pack.position.set(-1.0 + slot * 0.2, 0.59 + level * 0.2, lane.z + (slot % 2 ? 0.13 : -0.13));
    pack.userData.animationRole = "dockPalletItem";
    pack.userData.deliveryKind = lane.kind;
    pack.userData.deliveryIndex = index;
    addBox(pack, [0.18, 0.16, 0.22], [0, 0, 0], materials.orange);
    addBox(pack, [0.2, 0.035, 0.08], [0, 0.02, 0], materials.dark, false);
    group.add(pack);
  }
};

const addDeliveryPallets = (group: THREE.Group, materials: ProjectDockMaterials) => {
  DELIVERY_LANES.forEach((lane) => {
    addPalletBase(group, lane, materials);
    if (lane.kind === "ironPlate") addPlateStack(group, lane, materials);
    if (lane.kind === "constructionBlock") addBlockStack(group, lane, materials);
    if (lane.kind === "fastenerPack") addFastenerPacks(group, lane, materials);
  });
};

const addGantry = (group: THREE.Group, materials: ProjectDockMaterials) => {
  for (const x of [-2.28, 2.28]) {
    for (const z of [-2.18, 2.18]) {
      addBox(group, [0.24, 2.7, 0.24], [x, 1.62, z], materials.dark);
      addBox(group, [0.36, 0.16, 0.36], [x, 0.31, z], materials.orange);
    }
  }
  for (const z of [-2.18, 2.18]) addBox(group, [4.8, 0.22, 0.26], [0, 2.94, z], materials.pale);
  for (const x of [-2.28, 2.28]) addBox(group, [0.26, 0.22, 4.12], [x, 2.94, 0], materials.dark);
  addBeam(group, [-2.15, 0.42, 2.05], [-2.15, 2.82, -2.05], 0.08, materials.steel);
  addBeam(group, [2.15, 0.42, -2.05], [2.15, 2.82, 2.05], 0.08, materials.steel);

  const trolley = new THREE.Group();
  trolley.position.set(0, 2.76, 0);
  trolley.userData.animationRole = "dockGantryTrolley";
  trolley.userData.baseX = 0;
  addBox(trolley, [0.72, 0.32, 0.72], [0, 0, 0], materials.dark);
  addCylinder(trolley, 0.1, 0.1, 0.56, [0, -0.42, 0], materials.steel, 10);
  addBox(trolley, [0.44, 0.1, 0.44], [0, -0.72, 0], materials.orange, false);
  group.add(trolley);
};

const addAssemblyCradle = (group: THREE.Group, materials: ProjectDockMaterials) => {
  addCylinder(group, 1.14, 1.24, 0.22, [0.72, 0.42, 0.08], materials.dark, 18);
  addCylinder(group, 0.94, 1.04, 0.1, [0.72, 0.58, 0.08], materials.steel, 18);
  for (let index = 0; index < 3; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.66 + index * 0.14, 0.07, 8, 20),
      index === 1 ? materials.orange : materials.pale,
    );
    ring.position.set(0.72, 0.78 + index * 0.42, 0.08);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    ring.userData.animationRole = "dockAssemblyRing";
    ring.userData.ringIndex = index;
    ring.userData.baseY = ring.position.y;
    group.add(ring);
  }

  const cradle = new THREE.Group();
  cradle.position.set(0.72, 0.66, 0.08);
  cradle.userData.animationRole = "dockAssemblyCradle";
  cradle.userData.baseY = cradle.position.y;
  addCylinder(cradle, 0.42, 0.52, 0.2, [0, 0, 0], materials.dark, 14);
  const core = addCylinder(
    cradle,
    0.25,
    0.31,
    0.9,
    [0, 0.48, 0],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.2),
    12,
  );
  core.userData.animationRole = "dockAssemblyCore";
  core.userData.baseScaleY = 1;
  group.add(cradle);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 8),
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0),
  );
  beacon.position.set(0.72, 2.2, 0.08);
  beacon.userData.animationRole = "dockCompletionBeacon";
  beacon.visible = false;
  group.add(beacon);
};

const addControlStation = (group: THREE.Group, materials: ProjectDockMaterials) => {
  addBox(group, [0.86, 1.02, 0.34], [1.82, 0.88, 2.15], materials.dark);
  addBox(group, [0.68, 0.72, 0.04], [1.82, 0.95, 2.35], materials.pale, false);
  const status = addBox(
    group,
    [0.5, 0.24, 0.025],
    [1.82, 1.08, 2.38],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.45),
    false,
  );
  status.userData.animationRole = "dockStatus";
  addBox(group, [0.42, 0.05, 0.025], [1.82, 0.72, 2.38], materials.orange, false);
};

export const createProjectDockModel = (materials: ProjectDockMaterials) => {
  const group = new THREE.Group();
  addFoundation(group, materials);
  DELIVERY_LANES.forEach((lane, index) => addInputLane(group, lane, index, materials));
  addDeliveryPallets(group, materials);
  addGantry(group, materials);
  addAssemblyCradle(group, materials);
  addControlStation(group, materials);
  return group;
};

const deliveryRatio = (state: ProjectDockVisualState, kind: DeliveryKind) => THREE.MathUtils.clamp(
  state.deliveryCounts[kind] / PROJECT_DOCK_TARGETS[kind],
  0,
  1,
);

export const animateProjectDockModel = (group: THREE.Group, state: ProjectDockVisualState) => {
  const progress = THREE.MathUtils.clamp(state.progress, 0, 1);
  group.traverse((part: THREE.Object3D) => {
    const role = part.userData.animationRole as string | undefined;
    const kind = part.userData.deliveryKind as DeliveryKind | undefined;
    if (role === "dockPalletItem" && kind) {
      const index = part.userData.deliveryIndex as number;
      const lane = DELIVERY_LANES.find((candidate) => candidate.kind === kind)!;
      part.visible = index < Math.ceil(deliveryRatio(state, kind) * lane.displayCount);
    }
    if (role === "dockPalletGauge" && kind) {
      const ratio = deliveryRatio(state, kind);
      const fullWidth = part.userData.fullWidth as number;
      part.scale.x = Math.max(0.001, ratio);
      part.position.x = -0.72 - fullWidth * (1 - ratio) / 2;
      if (ratio >= 1) setIndicator(part, 0x5de4d1, 0x1a8f82, 1.6);
      else setIndicator(part, 0xffa94d, 0x9b480c, 0.4 + ratio * 0.8);
    }
    if (role === "dockInputGate" && kind) {
      const ratio = deliveryRatio(state, kind);
      const activity = ratio > 0 && ratio < 1 ? Math.sin(state.time * 2.4 + DELIVERY_LANES.findIndex((lane) => lane.kind === kind)) * 0.5 + 0.5 : 0;
      part.rotation.z = (part.userData.baseRotation as number) - activity * 0.55;
    }
    if (role === "dockInputRoller" && kind) {
      const ratio = deliveryRatio(state, kind);
      if (ratio > 0 && ratio < 1) part.rotation.z = -state.time * 3.5;
    }
    if (role === "dockInputPort" && kind) {
      const ratio = deliveryRatio(state, kind);
      if (ratio >= 1) setIndicator(part, 0x5de4d1, 0x1a8f82, 1.5);
      else setIndicator(part, 0xffa94d, 0x9b480c, 0.65 + Math.sin(state.time * 2.5) * 0.15);
    }
    if (role === "dockGantryTrolley") {
      part.position.x = (part.userData.baseX as number) + Math.sin(progress * Math.PI) * 0.72;
    }
    if (role === "dockAssemblyRing") {
      const index = part.userData.ringIndex as number;
      const revealAt = index * 0.22;
      const ringProgress = THREE.MathUtils.smoothstep(progress, revealAt, Math.min(1, revealAt + 0.36));
      part.visible = ringProgress > 0.01;
      part.position.y = (part.userData.baseY as number) - (1 - ringProgress) * 0.35;
      part.scale.setScalar(Math.max(0.05, ringProgress));
      part.rotation.z = state.time * (state.completed ? 0.35 : 0.12 + index * 0.04);
    }
    if (role === "dockAssemblyCradle") {
      part.position.y = (part.userData.baseY as number) + progress * 0.2;
    }
    if (role === "dockAssemblyCore") {
      part.scale.y = Math.max(0.04, progress);
      part.position.y = 0.48 * progress;
      setIndicator(part, 0x5de4d1, 0x1a8f82, 0.2 + progress * 1.45);
    }
    if (role === "dockCompletionBeacon") {
      part.visible = state.completed;
      part.scale.setScalar(state.completed ? 0.85 + Math.sin(state.time * 3) * 0.15 : 0.01);
      if (state.completed) setIndicator(part, 0xe7fbff, 0x5de4d1, 2.4 + Math.sin(state.time * 3) * 0.5);
    }
    if (role === "dockStatus") {
      if (state.completed) setIndicator(part, 0xe7fbff, 0x5de4d1, 2.2);
      else setIndicator(part, 0x5de4d1, 0x1a8f82, 0.45 + progress * 1.3);
    }
  });
};
