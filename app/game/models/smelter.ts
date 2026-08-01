import * as THREE from "three";
import {
  addBox,
  addCylinder,
  createIndicatorMaterial,
  setIndicator,
  type MachineMaterials,
  type ProcessingVisualState,
} from "./shared.ts";

const addFoundation = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [1.76, 0.2, 1.72], [0, 0.1, 0], materials.dark);
  addBox(group, [1.48, 0.1, 1.42], [0, 0.25, 0], materials.steel);
  const feet = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.28, 0.12, 0.28),
    materials.dark,
    4,
  );
  const matrix = new THREE.Matrix4();
  ([[-0.7, 0.06, -0.68], [-0.7, 0.06, 0.68], [0.7, 0.06, -0.68], [0.7, 0.06, 0.68]] as const)
    .forEach(([x, y, z], index) => {
      matrix.makeTranslation(x, y, z);
      feet.setMatrixAt(index, matrix);
    });
  feet.castShadow = true;
  feet.receiveShadow = true;
  group.add(feet);
};

const addFurnace = (group: THREE.Group, materials: MachineMaterials) => {
  addCylinder(group, 0.59, 0.68, 1.12, [0, 0.91, 0.1], materials.steel, 12);
  addCylinder(group, 0.64, 0.6, 0.15, [0, 1.55, 0.1], materials.dark, 12);
  addCylinder(group, 0.51, 0.57, 0.11, [0, 1.64, 0.1], materials.pale, 12);

  [0.43, 1.15, 1.49].forEach((y) => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.61, 0.05, 6, 20), materials.dark);
    band.position.set(0, y, 0.1);
    band.rotation.x = Math.PI / 2;
    band.castShadow = true;
    group.add(band);
  });

  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    const clamp = addBox(
      group,
      [0.09, 0.96, 0.13],
      [Math.cos(angle) * 0.61, 0.93, 0.1 + Math.sin(angle) * 0.61],
      materials.dark,
    );
    clamp.rotation.y = -angle;
  }

  addBox(group, [0.54, 0.44, 0.12], [0, 0.9, 0.66], materials.dark);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xff8b3d,
    emissive: 0xff3f0d,
    emissiveIntensity: 0.25,
    metalness: 0.08,
    roughness: 0.38,
  });
  const core = addBox(group, [0.28, 0.17, 0.035], [0, 0.9, 0.73], coreMaterial, false);
  core.userData.animationRole = "smelterCore";

  const shutter = new THREE.Group();
  shutter.position.set(0, 1.08, 0.75);
  shutter.userData.animationRole = "smelterShutter";
  shutter.userData.baseY = shutter.position.y;
  addBox(shutter, [0.42, 0.08, 0.045], [0, 0, 0], materials.pale, false);
  group.add(shutter);

  const heatMaterial = new THREE.MeshStandardMaterial({
    color: 0xff9b42,
    emissive: 0xff5218,
    emissiveIntensity: 1.3,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  });
  const heatBand = new THREE.Mesh(new THREE.TorusGeometry(0.535, 0.028, 5, 18), heatMaterial);
  heatBand.position.set(0, 1.29, 0.1);
  heatBand.rotation.x = Math.PI / 2;
  heatBand.userData.animationRole = "smelterHeatBand";
  group.add(heatBand);
};

const addBlower = (group: THREE.Group, materials: MachineMaterials) => {
  const ductCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.54, 0.87, 0.54),
    new THREE.Vector3(-0.61, 0.86, 0.28),
    new THREE.Vector3(-0.51, 0.82, 0.04),
  ]);
  const duct = new THREE.Mesh(new THREE.TubeGeometry(ductCurve, 12, 0.12, 7, false), materials.dark);
  duct.castShadow = true;
  group.add(duct);

  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.045, 7, 18), materials.dark);
  cage.position.set(-0.54, 0.92, 0.67);
  cage.castShadow = true;
  group.add(cage);

  const fan = new THREE.Group();
  fan.position.set(-0.54, 0.92, 0.68);
  fan.userData.animationRole = "smelterFan";
  const hub = addCylinder(fan, 0.075, 0.075, 0.12, [0, 0, 0], materials.orange, 10);
  hub.rotation.x = Math.PI / 2;
  for (let index = 0; index < 4; index += 1) {
    const blade = addBox(fan, [0.08, 0.25, 0.045], [0, 0.13, 0], materials.steel, false);
    blade.rotation.z = index * (Math.PI / 2) + 0.24;
  }
  group.add(fan);
};

const addExhaust = (group: THREE.Group, materials: MachineMaterials) => {
  const elbowCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.08, 1.58, 0.02),
    new THREE.Vector3(0.3, 1.66, -0.12),
    new THREE.Vector3(0.36, 1.78, -0.22),
  ]);
  const elbow = new THREE.Mesh(new THREE.TubeGeometry(elbowCurve, 12, 0.15, 8, false), materials.dark);
  elbow.castShadow = true;
  group.add(elbow);
  addCylinder(group, 0.15, 0.18, 0.72, [0.36, 1.98, -0.22], materials.dark, 10);
  const cap = addCylinder(group, 0.22, 0.18, 0.1, [0.36, 2.39, -0.22], materials.steel, 10);
  cap.userData.animationRole = "smelterExhaustCap";
  cap.userData.baseY = cap.position.y;

  const smokeMaterial = new THREE.MeshStandardMaterial({
    color: 0x8fa2a5,
    transparent: true,
    opacity: 0.16,
    roughness: 1,
    depthWrite: false,
  });
  [0, 0.33, 0.67].forEach((phase) => {
    const smoke = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), smokeMaterial);
    smoke.position.set(0.36, 2.5, -0.22);
    smoke.userData.animationRole = "smelterSmoke";
    smoke.userData.phase = phase;
    smoke.visible = false;
    group.add(smoke);
  });
};

const addInput = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [0.58, 0.12, 0.72], [-0.7, 0.39, -0.5], materials.dark);
  const hopper = addCylinder(group, 0.25, 0.16, 0.48, [-0.67, 0.54, -0.5], materials.pale, 4);
  hopper.rotation.z = Math.PI / 2;
  for (const z of [-0.8, -0.2]) {
    addBox(group, [0.46, 0.08, 0.08], [-0.78, 0.74, z], materials.orange, false);
  }
  const gate = new THREE.Group();
  gate.position.set(-0.91, 0.68, -0.5);
  gate.userData.animationRole = "smelterInputGate";
  gate.userData.baseRotation = 0;
  addBox(gate, [0.05, 0.3, 0.48], [0, -0.15, 0], materials.rubber, false);
  group.add(gate);

  const port = addBox(
    group,
    [0.04, 0.055, 0.36],
    [-1.01, 0.76, -0.5],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82),
    false,
  );
  port.userData.animationRole = "inputPort";

  for (let index = 0; index < 2; index += 1) {
    const ore = new THREE.Mesh(new THREE.OctahedronGeometry(0.08 + index * 0.012, 0), materials.ore);
    ore.position.set(-0.73 + index * 0.12, 0.55 + index * 0.04, -0.5 + index * 0.08);
    ore.userData.animationRole = "smelterInputOre";
    ore.userData.inputIndex = index;
    group.add(ore);
  }
};

const addOutput = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [0.7, 0.12, 0.66], [0.68, 0.39, -0.5], materials.dark);
  addBox(group, [0.62, 0.035, 0.5], [0.7, 0.47, -0.5], materials.belt, false);
  for (const z of [-0.78, -0.22]) {
    addBox(group, [0.64, 0.16, 0.07], [0.69, 0.54, z], materials.pale);
    addBox(group, [0.56, 0.025, 0.035], [0.71, 0.64, z], materials.orange, false);
  }

  const gate = new THREE.Group();
  gate.position.set(0.48, 0.7, -0.5);
  gate.userData.animationRole = "smelterOutputGate";
  gate.userData.baseRotation = 0;
  addBox(gate, [0.055, 0.3, 0.45], [0, -0.15, 0], materials.rubber, false);
  group.add(gate);

  const port = addBox(
    group,
    [0.04, 0.055, 0.36],
    [1.01, 0.76, -0.5],
    createIndicatorMaterial(0xffa94d, 0x9b480c),
    false,
  );
  port.userData.animationRole = "outputPort";

  const ingot = addCylinder(group, 0.11, 0.15, 0.32, [0.48, 0.54, -0.5], materials.pale, 4);
  ingot.rotation.z = Math.PI / 2;
  ingot.userData.animationRole = "smelterIngot";
  ingot.userData.startX = ingot.position.x;
  ingot.visible = false;
};

const addControls = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [0.38, 0.56, 0.18], [0.55, 0.83, 0.66], materials.dark);
  const screen = addBox(
    group,
    [0.24, 0.18, 0.025],
    [0.55, 0.9, 0.765],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.8),
    false,
  );
  screen.userData.animationRole = "smelterStatus";
  addBox(group, [0.2, 0.045, 0.03], [0.55, 0.73, 0.77], materials.orange, false);
};

export const createSmelterModel = (materials: MachineMaterials) => {
  const group = new THREE.Group();
  addFoundation(group, materials);
  addFurnace(group, materials);
  addBlower(group, materials);
  addExhaust(group, materials);
  addInput(group, materials);
  addOutput(group, materials);
  addControls(group, materials);
  return group;
};

export const animateSmelterModel = (group: THREE.Group, state: ProcessingVisualState) => {
  const progress = THREE.MathUtils.clamp(state.progress, 0, 1);
  const heatUp = THREE.MathUtils.smoothstep(progress, 0.04, 0.3);
  const coolDown = 1 - THREE.MathUtils.smoothstep(progress, 0.82, 1);
  const heat = state.working ? Math.max(0.1, heatUp * coolDown) * state.activity : 0.08 * state.activity;
  const release = THREE.MathUtils.smoothstep(progress, 0.82, 0.91)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.97, 1));
  const intake = state.working
    ? 1 - THREE.MathUtils.smoothstep(progress, 0.04, 0.15)
    : state.inputCount > 0 ? 0.16 : 0;

  group.traverse((part) => {
    const role = part.userData.animationRole as string | undefined;
    if (role === "smelterCore" && part instanceof THREE.Mesh) {
      const material = part.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissiveIntensity = 0.14 + heat * (1.75 + Math.sin(state.time * 4.2) * 0.25);
        material.color.setHex(heat > 0.45 ? 0xff8b3d : 0x8b4029);
      }
    }
    if (role === "smelterHeatBand" && part instanceof THREE.Mesh) {
      const material = part.material;
      if (material instanceof THREE.MeshStandardMaterial) material.opacity = 0.04 + heat * 0.5;
      const breath = 1 + Math.sin(state.time * 4.2) * 0.025 * heat;
      part.scale.setScalar(breath);
    }
    if (role === "smelterShutter") {
      const baseY = part.userData.baseY as number;
      part.position.y = baseY + heat * 0.22;
    }
    if (role === "smelterFan") part.rotation.z = -state.time * 8.4;
    if (role === "smelterExhaustCap") {
      const baseY = part.userData.baseY as number;
      part.position.y = baseY + Math.sin(state.time * 8) * 0.018 * heat;
    }
    if (role === "smelterSmoke" && part instanceof THREE.Mesh) {
      const phase = (state.time * 0.38 + (part.userData.phase as number)) % 1;
      part.visible = heat > 0.08;
      part.position.set(
        0.36 + Math.sin(phase * Math.PI * 2) * 0.06,
        2.5 + phase * 0.72,
        -0.22 + Math.cos(phase * Math.PI * 2) * 0.04,
      );
      part.scale.setScalar((0.55 + phase * 1.05) * (0.55 + heat * 0.45));
      const material = part.material;
      if (material instanceof THREE.MeshStandardMaterial) material.opacity = 0.14 * heat;
    }
    if (role === "smelterInputGate") {
      const baseRotation = part.userData.baseRotation as number;
      part.rotation.z = baseRotation - intake * 0.9;
    }
    if (role === "smelterInputOre") {
      const inputIndex = part.userData.inputIndex as number;
      part.visible = inputIndex < state.inputCount && !state.working;
    }
    if (role === "smelterOutputGate") {
      const baseRotation = part.userData.baseRotation as number;
      part.rotation.z = baseRotation - Math.max(release, state.outputQueued ? 0.32 : 0) * 1.05;
    }
    if (role === "smelterIngot") {
      const queued = state.outputQueued;
      part.visible = queued || release > 0.02;
      const travel = queued ? 0.86 : release;
      part.position.x = (part.userData.startX as number) + travel * 0.5;
      part.position.y = 0.54 + Math.sin(travel * Math.PI) * 0.035;
      part.rotation.x = travel * 1.2;
    }
    if (role === "smelterStatus") {
      if (state.outputQueued) setIndicator(part, 0xff5268, 0xa8172b, 2.2);
      else if (!state.inputConnected) setIndicator(part, 0xffa94d, 0x9b480c, 1.5);
      else setIndicator(part, 0x5de4d1, 0x1a8f82, 0.65 + state.activity * 1.15);
    }
  });
};
