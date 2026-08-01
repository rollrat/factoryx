import * as THREE from "three";
import {
  addBox,
  addCylinder,
  createIndicatorMaterial,
  setIndicator,
  type MachineMaterials,
  type StorageVisualState,
} from "./shared";

const addFoundation = (group: THREE.Group, materials: MachineMaterials) => {
  for (const z of [-0.67, 0.67]) addBox(group, [1.62, 0.16, 0.18], [0, 0.12, z], materials.dark);
  for (const x of [-0.69, 0.69]) addBox(group, [0.18, 0.16, 1.18], [x, 0.12, 0], materials.dark);
  for (const x of [-0.68, 0.68]) {
    for (const z of [-0.66, 0.66]) addBox(group, [0.28, 0.14, 0.28], [x, 0.07, z], materials.dark);
  }
  addBox(group, [1.38, 0.08, 1.28], [0, 0.23, 0], materials.steel);
};

const addFrame = (group: THREE.Group, materials: MachineMaterials) => {
  for (const x of [-0.68, 0.68]) {
    for (const z of [-0.61, 0.61]) {
      addBox(group, [0.16, 1.72, 0.16], [x, 1.1, z], materials.dark);
      addBox(group, [0.24, 0.14, 0.24], [x, 1.98, z], materials.orange);
    }
  }
  for (const y of [0.32, 1.98]) {
    addBox(group, [1.52, 0.16, 0.17], [0, y, -0.61], materials.dark);
    addBox(group, [1.52, 0.16, 0.17], [0, y, 0.61], materials.dark);
    addBox(group, [0.17, 0.16, 1.08], [-0.68, y, 0], materials.dark);
    addBox(group, [0.17, 0.16, 1.08], [0.68, y, 0], materials.dark);
  }
  addBox(group, [1.34, 0.1, 1.08], [0, 2.06, 0], materials.steel);
  for (const z of [-0.42, 0.42]) addBox(group, [1.2, 0.08, 0.08], [0, 2.15, z], materials.orange, false);
};

const addStackModules = (group: THREE.Group, materials: MachineMaterials) => {
  const rack = new THREE.Group();
  rack.userData.animationRole = "storageRackShock";
  rack.userData.baseY = 0;
  [0.62, 1.14, 1.66].forEach((y, level) => {
    addBox(rack, [1.14, 0.42, 1.0], [0, y, 0], level % 2 === 0 ? materials.steel : materials.pale);
    addBox(rack, [1.02, 0.06, 1.06], [0, y - 0.24, 0], materials.dark);
    addBox(rack, [0.88, 0.22, 0.045], [-0.08, y, 0.525], materials.dark, false);
    for (let index = 0; index < 4; index += 1) {
      addBox(
        rack,
        [0.055, 0.27, 0.03],
        [-0.42 + index * 0.28, y, 0.555],
        materials.orange,
        false,
      );
    }
  });
  group.add(rack);
};

const addIntake = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [0.64, 0.48, 0.68], [-0.68, 0.49, -0.5], materials.dark);
  addBox(group, [0.57, 0.045, 0.5], [-0.71, 0.42, -0.5], materials.belt, false);
  for (const z of [-0.78, -0.22]) {
    addBox(group, [0.58, 0.14, 0.07], [-0.7, 0.56, z], materials.pale);
  }

  const roller = new THREE.Group();
  roller.position.set(-0.72, 0.48, -0.5);
  roller.userData.animationRole = "storageIntakeRoller";
  const rollerMesh = addCylinder(roller, 0.07, 0.07, 0.44, [0, 0, 0], materials.steel, 10);
  rollerMesh.rotation.x = Math.PI / 2;
  group.add(roller);

  const gate = new THREE.Group();
  gate.position.set(-0.43, 0.76, -0.5);
  gate.userData.animationRole = "storageIntakeGate";
  gate.userData.baseRotation = 0;
  addBox(gate, [0.055, 0.42, 0.48], [0, -0.21, 0], materials.rubber, false);
  addBox(gate, [0.06, 0.04, 0.38], [0.002, -0.2, 0], materials.orange, false);
  group.add(gate);

  const port = addBox(
    group,
    [0.04, 0.055, 0.36],
    [-1.01, 0.82, -0.5],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82),
    false,
  );
  port.userData.animationRole = "inputPort";
  port.userData.inputIndex = 0;

  const item = new THREE.Group();
  item.position.set(-0.94, 0.53, -0.5);
  item.userData.animationRole = "storageTransferItem";
  item.userData.startX = item.position.x;
  addCylinder(item, 0.085, 0.085, 0.2, [0, 0, 0], materials.cyan, 10).rotation.z = Math.PI / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 10), materials.steel);
  ring.rotation.y = Math.PI / 2;
  item.add(ring);
  item.visible = false;
  group.add(item);
};

const addServiceLayer = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [0.86, 0.42, 0.12], [-0.08, 1.3, 0.67], materials.dark);
  addBox(group, [0.61, 0.2, 0.025], [-0.18, 1.36, 0.74], materials.pale, false);
  addBox(group, [0.47, 0.035, 0.028], [-0.18, 1.24, 0.745], materials.orange, false);

  addBox(group, [0.15, 1.18, 0.08], [0.49, 1.08, 0.69], materials.dark);
  const gauge = addBox(
    group,
    [0.075, 1.0, 0.025],
    [0.49, 0.98, 0.745],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 1.2),
    false,
  );
  gauge.userData.animationRole = "storageGaugeFill";
  gauge.userData.baseY = 0.48;
  gauge.userData.fullHeight = 1;
  gauge.scale.y = 0.001;
  gauge.position.y = 0.48;
  for (let index = 0; index <= 5; index += 1) {
    addBox(group, [0.13, 0.025, 0.03], [0.49, 0.48 + index * 0.2, 0.76], materials.pale, false);
  }

  const status = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 10, 7),
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 1.1),
  );
  status.position.set(0.49, 1.76, 0.75);
  status.userData.animationRole = "storageStatus";
  group.add(status);

  addBox(group, [0.32, 0.52, 0.12], [0.74, 0.82, 0.12], materials.dark);
  for (let index = 0; index < 5; index += 1) {
    addBox(group, [0.045, 0.05, 0.44], [0.81, 0.54 + index * 0.2, 0.12], materials.steel, false);
  }
  addBox(group, [0.045, 1.02, 0.06], [0.81, 0.94, -0.08], materials.orange, false);
  addBox(group, [0.045, 1.02, 0.06], [0.81, 0.94, 0.32], materials.orange, false);
};

export const createStorageModel = (materials: MachineMaterials) => {
  const group = new THREE.Group();
  addFoundation(group, materials);
  addFrame(group, materials);
  addStackModules(group, materials);
  addIntake(group, materials);
  addServiceLayer(group, materials);
  return group;
};

export const animateStorageModel = (group: THREE.Group, state: StorageVisualState) => {
  const ratio = THREE.MathUtils.clamp(state.stored / Math.max(1, state.capacity), 0, 1);
  const pulse = THREE.MathUtils.clamp(state.intakePulse, 0, 1);
  const phase = 1 - pulse;
  const intake = pulse > 0 ? Math.sin(phase * Math.PI) : 0;
  const impact = pulse > 0 ? Math.sin(phase * Math.PI * 5) * Math.exp(-phase * 5) : 0;
  const full = state.stored >= state.capacity;

  group.traverse((part) => {
    const role = part.userData.animationRole as string | undefined;
    if (role === "storageIntakeGate") {
      const baseRotation = part.userData.baseRotation as number;
      part.rotation.z = baseRotation - intake * 0.98;
    }
    if (role === "storageIntakeRoller") {
      const travel = ((part.userData.travel as number | undefined) ?? 0) + state.delta * intake * 11;
      part.userData.travel = travel;
      part.rotation.z = -travel;
    }
    if (role === "storageTransferItem") {
      part.visible = pulse > 0.02;
      part.position.x = (part.userData.startX as number) + phase * 0.62;
      part.position.y = 0.53 + Math.sin(phase * Math.PI) * 0.045;
      part.rotation.x = phase * 3.6;
    }
    if (role === "storageRackShock") {
      const baseY = part.userData.baseY as number;
      part.position.y = baseY + impact * 0.018;
    }
    if (role === "storageGaugeFill") {
      const fullHeight = part.userData.fullHeight as number;
      const baseY = part.userData.baseY as number;
      part.scale.y = Math.max(0.001, ratio);
      part.position.y = baseY + (fullHeight * ratio) / 2;
      if (full) setIndicator(part, 0xff5268, 0xa8172b, 2.1 + Math.sin(state.time * 2.4) * 0.35);
      else setIndicator(part, 0x5de4d1, 0x1a8f82, 0.8 + ratio * 1.2);
    }
    if (role === "storageStatus") {
      if (full) setIndicator(part, 0xff5268, 0xa8172b, 1.9 + Math.sin(state.time * 2.4) * 0.4);
      else if (!state.inputConnected) setIndicator(part, 0xffa94d, 0x9b480c, 1.25);
      else if (pulse > 0.02) setIndicator(part, 0xe7fbff, 0x5de4d1, 2.4);
      else setIndicator(part, 0x5de4d1, 0x1a8f82, 0.9 + ratio * 0.6);
    }
  });
};
