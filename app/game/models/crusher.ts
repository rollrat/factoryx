import * as THREE from "three";
import {
  addBeam,
  addBox,
  addCylinder,
  createIndicatorMaterial,
  setIndicator,
  type MachineMaterials,
  type ProcessingVisualState,
} from "./shared.ts";

const addFoundation = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [1.78, 0.16, 1.76], [0, 0.08, 0], materials.dark);
  addBox(group, [1.58, 0.07, 1.52], [0, 0.195, 0], materials.steel);
  for (const x of [-0.72, 0.72]) {
    for (const z of [-0.66, 0.66]) addBox(group, [0.24, 0.14, 0.24], [x, 0.07, z], materials.dark);
  }
};

const addInputRamp = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [0.78, 0.14, 0.62], [-0.65, 0.32, -0.5], materials.dark);
  const ramp = addBox(group, [0.72, 0.035, 0.5], [-0.66, 0.405, -0.5], materials.belt, false);
  ramp.rotation.z = -0.08;
  for (const z of [-0.79, -0.21]) {
    const rail = addBox(group, [0.7, 0.13, 0.055], [-0.66, 0.49, z], materials.pale);
    rail.rotation.z = -0.08;
  }

  const gate = new THREE.Group();
  gate.position.set(-0.34, 0.68, -0.5);
  gate.userData.animationRole = "crusherInputGate";
  gate.userData.baseRotation = 0;
  addBox(gate, [0.055, 0.38, 0.5], [0, -0.19, 0], materials.rubber, false);
  addBox(gate, [0.06, 0.045, 0.4], [-0.002, -0.18, 0], materials.orange, false);
  group.add(gate);

  const port = addBox(
    group,
    [0.04, 0.055, 0.36],
    [-1.01, 0.72, -0.5],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.3),
    false,
  );
  port.userData.animationRole = "inputPort";
  port.userData.inputIndex = 0;

  for (let index = 0; index < 2; index += 1) {
    const chunk = new THREE.Mesh(new THREE.OctahedronGeometry(0.12 - index * 0.018, 0), materials.ore);
    chunk.position.set(-0.88 + index * 0.22, 0.49, -0.5 + (index - 0.5) * 0.12);
    chunk.rotation.set(index * 0.4, index * 0.7, index * 0.3);
    chunk.castShadow = true;
    chunk.userData.animationRole = "crusherInputChunk";
    chunk.userData.chunkIndex = index;
    chunk.userData.baseX = chunk.position.x;
    chunk.userData.baseY = chunk.position.y;
    group.add(chunk);
  }
};

const createRoller = (
  materials: MachineMaterials,
  x: number,
  direction: number,
) => {
  const roller = new THREE.Group();
  roller.position.set(x, 1.14, -0.5);
  roller.userData.animationRole = "crusherRoller";
  roller.userData.direction = direction;
  const core = addCylinder(roller, 0.23, 0.23, 0.68, [0, 0, 0], materials.dark, 12);
  core.rotation.x = Math.PI / 2;
  const shaft = addCylinder(roller, 0.075, 0.075, 0.82, [0, 0, 0], materials.steel, 10);
  shaft.rotation.x = Math.PI / 2;
  const toothGeometry = new THREE.BoxGeometry(0.1, 0.09, 0.56);
  const teeth = new THREE.InstancedMesh(toothGeometry, materials.steel, 8);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2;
    quaternion.setFromEuler(new THREE.Euler(0, 0, angle));
    matrix.compose(
      new THREE.Vector3(Math.cos(angle) * 0.245, Math.sin(angle) * 0.245, 0),
      quaternion,
      scale,
    );
    teeth.setMatrixAt(index, matrix);
  }
  teeth.castShadow = true;
  roller.add(teeth);
  return roller;
};

const addCrusherChamber = (group: THREE.Group, materials: MachineMaterials) => {
  // Wide receiving hood narrows toward the roller bite without relying on a
  // high-tier vertical belt connection.
  addBox(group, [0.92, 0.14, 1.18], [-0.18, 1.82, -0.5], materials.pale);
  for (const z of [-1.03, 0.03]) {
    addBeam(group, [-0.55, 1.76, z], [-0.34, 1.28, z], 0.1, materials.dark);
    addBeam(group, [0.19, 1.76, z], [0.36, 1.28, z], 0.1, materials.dark);
  }
  addBox(group, [0.18, 0.7, 0.12], [-0.54, 1.47, 0.08], materials.dark);
  addBox(group, [0.18, 0.7, 0.12], [0.38, 1.47, 0.08], materials.dark);
  addBox(group, [0.92, 0.12, 0.12], [-0.08, 1.2, 0.08], materials.orange, false);

  const chamber = new THREE.Group();
  chamber.userData.animationRole = "crusherChamberImpact";
  chamber.userData.baseY = 0;
  addBox(chamber, [0.96, 0.72, 1.02], [-0.08, 1.18, -0.5], materials.dark);
  addBox(chamber, [0.76, 0.5, 0.055], [-0.08, 1.2, 0.025], materials.pale, false);
  addBox(chamber, [0.58, 0.12, 0.035], [-0.08, 1.2, 0.06], materials.orange, false);
  chamber.add(createRoller(materials, -0.27, 1));
  chamber.add(createRoller(materials, 0.11, -1));
  group.add(chamber);

  for (const x of [-0.7, 0.54]) {
    addBox(group, [0.34, 0.54, 0.64], [x, 1.15, -0.5], materials.steel);
    const motor = addCylinder(group, 0.14, 0.14, 0.38, [x, 1.15, -0.5], materials.dark, 10);
    motor.rotation.x = Math.PI / 2;
  }

  addBox(group, [0.46, 0.62, 0.38], [-0.58, 1.48, 0.34], materials.dark);
  addBox(group, [0.3, 0.08, 0.24], [-0.58, 1.63, 0.55], materials.orange, false);
  for (let index = 0; index < 4; index += 1) {
    addBox(group, [0.045, 0.34, 0.04], [-0.72 + index * 0.1, 1.47, 0.55], materials.steel, false);
  }
};

const addScreenAndOutput = (group: THREE.Group, materials: MachineMaterials) => {
  const screen = new THREE.Group();
  screen.position.set(0.2, 0.62, -0.5);
  screen.userData.animationRole = "crusherScreen";
  screen.userData.baseX = screen.position.x;
  screen.userData.baseY = screen.position.y;
  const tray = addBox(screen, [0.72, 0.1, 0.62], [0, 0, 0], materials.steel);
  tray.rotation.z = -0.12;
  for (let index = -2; index <= 2; index += 1) {
    addBox(screen, [0.55, 0.025, 0.025], [0, 0.065, index * 0.1], materials.dark, false).rotation.z = -0.12;
  }
  group.add(screen);

  addBox(group, [0.72, 0.14, 0.62], [0.65, 0.32, -0.5], materials.dark);
  addBox(group, [0.66, 0.035, 0.5], [0.66, 0.405, -0.5], materials.belt, false);
  for (const z of [-0.79, -0.21]) addBox(group, [0.65, 0.13, 0.055], [0.66, 0.49, z], materials.pale);

  const gate = new THREE.Group();
  gate.position.set(0.37, 0.67, -0.5);
  gate.userData.animationRole = "crusherOutputGate";
  gate.userData.baseRotation = 0;
  addBox(gate, [0.055, 0.34, 0.48], [0, -0.17, 0], materials.rubber, false);
  addBox(gate, [0.06, 0.04, 0.38], [0.002, -0.16, 0], materials.orange, false);
  group.add(gate);

  const port = addBox(
    group,
    [0.04, 0.055, 0.36],
    [1.01, 0.72, -0.5],
    createIndicatorMaterial(0xffa94d, 0x9b480c, 0.3),
    false,
  );
  port.userData.animationRole = "outputPort";

  const product = new THREE.Group();
  product.position.set(0.4, 0.49, -0.5);
  product.userData.animationRole = "crusherProduct";
  product.userData.baseX = product.position.x;
  for (let index = 0; index < 3; index += 1) {
    const fragment = new THREE.Mesh(new THREE.OctahedronGeometry(0.085 - index * 0.012, 0), materials.pale);
    fragment.position.set(index * 0.08, index * 0.02, (index - 1) * 0.07);
    fragment.castShadow = true;
    product.add(fragment);
  }
  product.visible = false;
  group.add(product);
};

const addDustAndControls = (group: THREE.Group, materials: MachineMaterials) => {
  const dustMaterial = new THREE.MeshBasicMaterial({
    color: 0xa8bcc0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  for (let index = 0; index < 6; index += 1) {
    const dust = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), dustMaterial);
    dust.position.set(0, 1.0, -0.5);
    dust.userData.animationRole = "crusherDust";
    dust.userData.phase = index / 6;
    dust.userData.angle = index / 6 * Math.PI * 2;
    dust.visible = false;
    group.add(dust);
  }

  addBox(group, [0.38, 0.5, 0.14], [0.58, 1.42, 0.24], materials.dark);
  const status = addBox(
    group,
    [0.24, 0.16, 0.025],
    [0.58, 1.47, 0.325],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.8),
    false,
  );
  status.userData.animationRole = "crusherStatus";
  addBox(group, [0.18, 0.04, 0.025], [0.58, 1.35, 0.327], materials.orange, false);
};

export const createCrusherModel = (materials: MachineMaterials) => {
  const group = new THREE.Group();
  addFoundation(group, materials);
  addInputRamp(group, materials);
  addCrusherChamber(group, materials);
  addScreenAndOutput(group, materials);
  addDustAndControls(group, materials);
  return group;
};

export const animateCrusherModel = (group: THREE.Group, state: ProcessingVisualState) => {
  const progress = THREE.MathUtils.clamp(state.progress, 0, 1);
  const intake = THREE.MathUtils.smoothstep(progress, 0.02, 0.16)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.2, 0.3));
  const crush = THREE.MathUtils.smoothstep(progress, 0.26, 0.36)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.68, 0.76));
  const screen = THREE.MathUtils.smoothstep(progress, 0.58, 0.68)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.84, 0.9));
  const release = THREE.MathUtils.smoothstep(progress, 0.82, 0.92)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.98, 1));
  const impact = crush * Math.sin(state.time * 42) * 0.012;

  group.traverse((part: THREE.Object3D) => {
    const role = part.userData.animationRole as string | undefined;
    if (role === "crusherInputGate") {
      part.rotation.z = (part.userData.baseRotation as number) - intake * 0.95;
    }
    if (role === "crusherInputChunk") {
      const index = part.userData.chunkIndex as number;
      part.visible = state.working || (!state.working && index < state.inputCount);
      part.position.x = (part.userData.baseX as number) + intake * (0.55 + index * 0.04);
      part.position.y = (part.userData.baseY as number) + intake * 0.45;
      part.rotation.z = intake * (2.2 + index * 0.5);
    }
    if (role === "crusherRoller") {
      const direction = part.userData.direction as number;
      part.rotation.z = direction * state.time * 9 * crush;
    }
    if (role === "crusherChamberImpact") {
      part.position.y = (part.userData.baseY as number) + impact;
    }
    if (role === "crusherScreen") {
      const vibration = screen * Math.sin(state.time * 38);
      part.position.x = (part.userData.baseX as number) + vibration * 0.018;
      part.position.y = (part.userData.baseY as number) + Math.abs(vibration) * 0.008;
    }
    if (role === "crusherOutputGate") {
      part.rotation.z = (part.userData.baseRotation as number)
        - release * 0.9;
    }
    if (role === "crusherProduct") {
      const queued = state.outputQueued;
      part.visible = queued || release > 0.02;
      const travel = queued ? 0.82 : release;
      part.position.x = (part.userData.baseX as number) + travel * 0.5;
      part.rotation.x = travel * 1.4;
    }
    if (role === "crusherDust" && part instanceof THREE.Mesh) {
      const phase = (state.time * 1.8 + (part.userData.phase as number)) % 1;
      const angle = part.userData.angle as number;
      part.visible = crush > 0.18;
      part.position.set(
        -0.04 + Math.cos(angle) * phase * 0.26,
        1.02 + phase * 0.44,
        -0.5 + Math.sin(angle) * phase * 0.28,
      );
      part.scale.setScalar((1 - phase) * (0.65 + crush * 0.45));
    }
    if (role === "crusherStatus") {
      if (state.outputQueued) setIndicator(part, 0xffa94d, 0x9b480c, 1.8 + Math.sin(state.time * 3) * 0.35);
      else if (!state.inputConnected) setIndicator(part, 0xffa94d, 0x9b480c, 1.35);
      else if (!state.outputConnected) setIndicator(part, 0xffa94d, 0x9b480c, 1.05);
      else setIndicator(part, 0x5de4d1, 0x1a8f82, 0.55 + state.activity * 1.2);
    }
  });
};
