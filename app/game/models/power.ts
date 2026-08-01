import * as THREE from "three";
import {
  addBeam,
  addBox,
  addCylinder,
  createIndicatorMaterial,
  setIndicator,
} from "./shared.ts";

export type PowerMaterials = {
  dark: THREE.Material;
  steel: THREE.Material;
  pale: THREE.Material;
  cyan: THREE.Material;
  amber: THREE.Material;
  orange: THREE.Material;
  rubber: THREE.Material;
  copper?: THREE.Material;
};

export type PowerVisualState = Readonly<{
  time: number;
  delta: number;
  generating: boolean;
  connected: boolean;
  supplyRatio: number;
  loadRatio: number;
  overloaded: boolean;
}>;

const addPowerPort = (
  group: THREE.Group,
  position: [number, number, number],
  index: number,
  material: THREE.Material,
) => {
  const socket = new THREE.Group();
  socket.position.set(...position);
  socket.userData.animationRole = "powerPort";
  socket.userData.portIndex = index;
  const body = addCylinder(socket, 0.095, 0.12, 0.14, [0, 0, 0], material, 10);
  body.rotation.z = Math.PI / 2;
  const contact = addCylinder(socket, 0.035, 0.035, 0.16, [0.08, 0, 0], material, 8);
  contact.rotation.z = Math.PI / 2;
  group.add(socket);
};

const addCoreFoundation = (group: THREE.Group, materials: PowerMaterials) => {
  addBox(group, [1.78, 0.17, 1.76], [0, 0.085, 0], materials.dark);
  addBox(group, [1.56, 0.08, 1.5], [0, 0.215, 0], materials.steel);
  for (const x of [-0.72, 0.72]) {
    for (const z of [-0.66, 0.66]) addBox(group, [0.25, 0.14, 0.25], [x, 0.07, z], materials.dark);
  }
};

const addCoreFrame = (group: THREE.Group, materials: PowerMaterials) => {
  for (const x of [-0.68, 0.68]) {
    for (const z of [-0.58, 0.58]) addBox(group, [0.13, 1.18, 0.13], [x, 0.88, z], materials.dark);
  }
  for (const z of [-0.58, 0.58]) addBox(group, [1.5, 0.14, 0.15], [0, 1.48, z], materials.pale);
  addBeam(group, [-0.63, 0.35, 0.55], [-0.63, 1.42, -0.55], 0.05, materials.steel);
  addBeam(group, [0.63, 0.35, -0.55], [0.63, 1.42, 0.55], 0.05, materials.steel);
};

const addCoreGenerator = (group: THREE.Group, materials: PowerMaterials) => {
  addBox(group, [0.82, 0.58, 0.92], [0.12, 0.62, -0.12], materials.dark);
  addBox(group, [0.68, 0.42, 0.78], [0.12, 0.65, -0.12], materials.pale);
  const rotor = new THREE.Group();
  rotor.position.set(0.12, 0.67, 0.31);
  rotor.userData.animationRole = "powerCoreRotor";
  addCylinder(rotor, 0.21, 0.21, 0.22, [0, 0, 0], materials.steel, 12).rotation.x = Math.PI / 2;
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    const vane = addBox(
      rotor,
      [0.045, 0.19, 0.08],
      [Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0.13],
      materials.orange,
      false,
    );
    vane.rotation.z = angle;
  }
  group.add(rotor);

  const coreMaterial = createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.35);
  const core = addCylinder(group, 0.22, 0.28, 0.58, [0.12, 1.12, -0.12], coreMaterial, 12);
  core.userData.animationRole = "powerCoreGlow";
  addCylinder(group, 0.31, 0.31, 0.08, [0.12, 0.82, -0.12], materials.dark, 12);
  addCylinder(group, 0.31, 0.31, 0.08, [0.12, 1.42, -0.12], materials.dark, 12);
};

const addFlywheel = (group: THREE.Group, materials: PowerMaterials) => {
  const flywheel = new THREE.Group();
  flywheel.position.set(-0.56, 0.83, -0.12);
  flywheel.userData.animationRole = "powerCoreFlywheel";
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.075, 8, 16), materials.dark);
  rim.rotation.y = Math.PI / 2;
  rim.castShadow = true;
  flywheel.add(rim);
  addCylinder(flywheel, 0.1, 0.1, 0.2, [0, 0, 0], materials.steel, 10).rotation.z = Math.PI / 2;
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    const spoke = addBox(
      flywheel,
      [0.045, 0.27, 0.045],
      [0, Math.sin(angle) * 0.16, Math.cos(angle) * 0.16],
      materials.steel,
    );
    spoke.rotation.x = angle;
  }
  group.add(flywheel);

  addBox(group, [0.13, 0.86, 0.78], [-0.77, 0.83, -0.12], materials.dark);
  for (let index = -2; index <= 2; index += 1) {
    addBox(group, [0.035, 0.66, 0.04], [-0.85, 0.83, -0.12 + index * 0.13], materials.steel, false);
  }
};

const addCoreControls = (group: THREE.Group, materials: PowerMaterials) => {
  addBox(group, [0.52, 0.6, 0.17], [0.48, 0.86, 0.68], materials.dark);
  addBox(group, [0.4, 0.42, 0.03], [0.48, 0.9, 0.785], materials.pale, false);
  const gauge = new THREE.Group();
  gauge.position.set(0.48, 0.96, 0.81);
  gauge.userData.animationRole = "powerCoreGaugeNeedle";
  gauge.userData.baseRotation = Math.PI / 3;
  const needle = addBox(gauge, [0.035, 0.18, 0.025], [0, 0.07, 0], materials.orange, false);
  needle.position.y = 0.075;
  group.add(gauge);
  const status = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 9, 6),
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.5),
  );
  status.position.set(0.68, 1.15, 0.8);
  status.userData.animationRole = "powerCoreStatus";
  group.add(status);
  addBox(group, [0.22, 0.05, 0.03], [0.4, 0.68, 0.79], materials.orange, false);
};

const addCoreBus = (group: THREE.Group, materials: PowerMaterials) => {
  const conductor = materials.copper ?? materials.orange;
  addBox(group, [0.84, 0.09, 0.1], [0.38, 1.58, -0.12], conductor);
  addBox(group, [0.1, 0.48, 0.1], [0.76, 1.36, -0.12], conductor);
  addPowerPort(group, [0.83, 0.57, -0.36], 0, materials.dark);
  addPowerPort(group, [0.83, 0.57, 0.12], 1, materials.dark);
  for (let index = 0; index < 4; index += 1) {
    const pulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 7, 5),
      createIndicatorMaterial(0x5de4d1, 0x1a8f82, 1.4),
    );
    pulse.userData.animationRole = "powerCorePulse";
    pulse.userData.phase = index / 4;
    pulse.visible = false;
    group.add(pulse);
  }
};

export const createFieldPowerCoreModel = (materials: PowerMaterials) => {
  const group = new THREE.Group();
  addCoreFoundation(group, materials);
  addCoreFrame(group, materials);
  addCoreGenerator(group, materials);
  addFlywheel(group, materials);
  addCoreControls(group, materials);
  addCoreBus(group, materials);
  return group;
};

const addPoleFoundation = (group: THREE.Group, materials: PowerMaterials) => {
  addBox(group, [0.86, 0.16, 0.86], [0, 0.08, 0], materials.dark);
  addBox(group, [0.66, 0.08, 0.66], [0, 0.2, 0], materials.steel);
  for (const x of [-0.3, 0.3]) {
    for (const z of [-0.3, 0.3]) addBox(group, [0.13, 0.12, 0.13], [x, 0.06, z], materials.dark);
  }
};

const addPoleMast = (group: THREE.Group, materials: PowerMaterials) => {
  addBox(group, [0.2, 2.5, 0.2], [0, 1.46, 0], materials.dark);
  addBox(group, [0.11, 2.34, 0.11], [0, 1.49, 0], materials.steel);
  addBeam(group, [-0.32, 0.28, 0], [0, 1.2, 0], 0.06, materials.dark);
  addBeam(group, [0.32, 0.28, 0], [0, 1.2, 0], 0.06, materials.dark);
  addBox(group, [1.18, 0.15, 0.18], [0, 2.65, 0], materials.dark);
  addBox(group, [0.86, 0.07, 0.22], [0, 2.77, 0], materials.pale);
};

const addPoleInsulators = (group: THREE.Group, materials: PowerMaterials) => {
  const conductor = materials.copper ?? materials.orange;
  for (let index = 0; index < 3; index += 1) {
    const x = -0.4 + index * 0.4;
    const insulator = new THREE.Group();
    insulator.position.set(x, 2.92, 0);
    insulator.userData.animationRole = "distributionInsulator";
    insulator.userData.lineIndex = index;
    for (let ring = 0; ring < 3; ring += 1) {
      addCylinder(insulator, 0.075 - ring * 0.008, 0.075 - ring * 0.008, 0.045, [0, ring * 0.06, 0], materials.rubber, 8);
    }
    addCylinder(insulator, 0.025, 0.025, 0.3, [0, 0.13, 0], conductor, 7);
    group.add(insulator);
  }
  addBox(group, [1.02, 0.045, 0.05], [0, 3.12, 0], conductor, false);
};

const addPoleService = (group: THREE.Group, materials: PowerMaterials) => {
  addBox(group, [0.46, 0.68, 0.32], [0.24, 1.05, 0.22], materials.dark);
  addBox(group, [0.34, 0.48, 0.035], [0.24, 1.07, 0.4], materials.pale, false);
  const status = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 6),
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.5),
  );
  status.position.set(0.37, 1.27, 0.43);
  status.userData.animationRole = "distributionPoleStatus";
  group.add(status);
  addBox(group, [0.2, 0.04, 0.03], [0.18, 0.88, 0.42], materials.orange, false);
  addPowerPort(group, [0.39, 0.58, 0.18], 0, materials.dark);
  addPowerPort(group, [-0.39, 0.58, 0.18], 1, materials.dark);

  for (let index = 0; index < 5; index += 1) {
    const pulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 7, 5),
      createIndicatorMaterial(0x5de4d1, 0x1a8f82, 1.3),
    );
    pulse.userData.animationRole = "distributionPowerPulse";
    pulse.userData.phase = index / 5;
    pulse.visible = false;
    group.add(pulse);
  }
};

export const createDistributionPoleModel = (materials: PowerMaterials) => {
  const group = new THREE.Group();
  addPoleFoundation(group, materials);
  addPoleMast(group, materials);
  addPoleInsulators(group, materials);
  addPoleService(group, materials);
  return group;
};

const powerSpeed = (state: PowerVisualState) => {
  if (!state.generating || !state.connected || state.overloaded) return 0;
  return THREE.MathUtils.clamp(state.supplyRatio, 0, 1);
};

const setPowerStatus = (part: THREE.Object3D, state: PowerVisualState) => {
  if (state.overloaded) {
    setIndicator(part, 0xff5268, 0xa8172b, 2 + Math.sin(state.time * 7) * 0.45);
  } else if (!state.connected) {
    setIndicator(part, 0xffa94d, 0x9b480c, 1.25);
  } else if (state.generating && state.supplyRatio > 0) {
    setIndicator(part, 0x5de4d1, 0x1a8f82, 0.8 + THREE.MathUtils.clamp(state.supplyRatio, 0, 1) * 1.1);
  } else {
    setIndicator(part, 0xa8bcc0, 0x1a8f82, 0.2);
  }
};

export const animateFieldPowerCoreModel = (group: THREE.Group, state: PowerVisualState) => {
  const speed = powerSpeed(state);
  const gaugeRatio = THREE.MathUtils.clamp(state.loadRatio, 0, 1.25);
  group.traverse((part: THREE.Object3D) => {
    const role = part.userData.animationRole as string | undefined;
    if (role === "powerCoreFlywheel") part.rotation.x = state.time * 5.5 * speed;
    if (role === "powerCoreRotor") part.rotation.z = -state.time * 8 * speed;
    if (role === "powerCoreGaugeNeedle") {
      part.rotation.z = (part.userData.baseRotation as number) - gaugeRatio / 1.25 * Math.PI * 0.68;
    }
    if (role === "powerCoreGlow") {
      const intensity = state.generating ? 0.45 + speed * 1.45 : 0.12;
      if (state.overloaded) setIndicator(part, 0xff5268, 0xa8172b, 1.8 + Math.sin(state.time * 9) * 0.35);
      else setIndicator(part, 0x5de4d1, 0x1a8f82, intensity);
    }
    if (role === "powerCorePulse") {
      const phase = (state.time * (0.65 + speed * 1.8) + (part.userData.phase as number)) % 1;
      part.visible = speed > 0.03;
      part.position.set(0.12 + phase * 0.66, 1.6 - Math.max(0, phase - 0.78) * 3.7, -0.12);
      part.scale.setScalar(0.65 + Math.sin(phase * Math.PI) * 0.55);
    }
    if (role === "powerCoreStatus") setPowerStatus(part, state);
  });
};

export const animateDistributionPoleModel = (group: THREE.Group, state: PowerVisualState) => {
  const speed = powerSpeed(state);
  group.traverse((part: THREE.Object3D) => {
    const role = part.userData.animationRole as string | undefined;
    if (role === "distributionPowerPulse") {
      const phase = (state.time * (0.55 + speed * 1.5) + (part.userData.phase as number)) % 1;
      part.visible = speed > 0.03;
      if (phase < 0.72) part.position.set(0.39 - phase * 0.54, 0.62 + phase * 3.2, 0.18 - phase * 0.25);
      else part.position.set(-0.15 - (phase - 0.72) * 2.5, 2.92, 0);
      part.scale.setScalar(0.6 + Math.sin(phase * Math.PI) * 0.5);
    }
    if (role === "distributionInsulator") {
      const lineIndex = part.userData.lineIndex as number;
      part.position.y = 2.92 + (state.overloaded ? Math.sin(state.time * 20 + lineIndex) * 0.008 : 0);
    }
    if (role === "distributionPoleStatus") setPowerStatus(part, state);
  });
};
